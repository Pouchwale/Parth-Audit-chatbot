import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { FileInfo } from '@shared/api';
import { api, ApiError, errorMessage } from './api';
import { useAuth } from './auth';
import type { Call } from './call';
import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from './file-types';
import { count } from './format';
import { discardPicked, PickError, pickFiles, readPicked } from './pick';
import type { PickedFile, PickResult, PickSource } from './picked-files';

export type AttachmentStatus = 'waiting' | 'uploading' | 'uploaded' | 'failed';

/** A file attached to the message being written: uploaded as soon as it is picked. */
export interface Attachment {
  key: string;
  picked: PickedFile;
  status: AttachmentStatus;
  /** Set once it is uploaded. */
  file: FileInfo | null;
  error: string | null;
  /** Trying again may work, e.g. after a network error; not for a file the server won't take. */
  retryable: boolean;
}

export interface AttachmentsState {
  items: readonly Attachment[];
  /** Why files were left out of the last pick, or why it couldn't happen. */
  notice: string | null;
  /** A picked folder is being read. Phones do nothing else meanwhile. */
  reading: boolean;
}

export interface Attachments extends AttachmentsState {
  /** The uploaded files, in the order they were attached. */
  files: FileInfo[];
  /** Nothing is still uploading or failed, so a message can go with them. */
  ready: boolean;
  /** How many more files the message can carry. */
  room: number;
  /** Opens the picker. Must be called straight from a press: browsers open their file dialog only then. */
  pick(source: PickSource): void;
  remove(key: string): void;
  retry(key: string): void;
  dismissNotice(): void;
  /** Forgets the attachments once the message carrying them has been sent. */
  clear(): void;
}

// Each upload holds its whole file in memory, so a folder's worth goes up a few at a time.
const UPLOADS_AT_ONCE = 3;

const MAX_MB = MAX_FILE_BYTES / (1024 * 1024);

const PICK_FAILED: Record<PickSource, string> = {
  photos: "Your photos couldn't be opened. Try again.",
  camera: "The camera couldn't be opened. Try again.",
  files: "Your files couldn't be opened. Try again.",
  folder: "That folder couldn't be opened. Try again.",
};

let keys = 0;

/** The attachments of one message being written, and their uploads. */
class AttachmentUploads {
  private state: AttachmentsState = { items: [], notice: null, reading: false };
  private readonly listeners = new Set<() => void>();
  private readonly uploads = new Map<string, AbortController>();
  /** The newest sign-in's way of calling the API: the uploads outlive renders, so the hook keeps this current. */
  private readonly latest: RefObject<Call>;

  constructor(latest: RefObject<Call>) {
    this.latest = latest;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): AttachmentsState => this.state;

  pick(source: PickSource): void {
    const room = MAX_ATTACHMENTS - this.state.items.length;
    if (room <= 0) return this.update({ notice: `A message can carry up to ${MAX_ATTACHMENTS} files.` });
    this.update({ notice: null });
    pickFiles(source, room, () => this.update({ reading: true }))
      .then(
        (result) => {
          if (result) this.add(result);
        },
        (error: unknown) => this.update({ notice: error instanceof PickError ? error.message : PICK_FAILED[source] }),
      )
      .finally(() => this.update({ reading: false }));
  }

  remove(key: string): void {
    this.uploads.get(key)?.abort();
    const removed = this.state.items.find((item) => item.key === key);
    if (removed) discardPicked(removed.picked);
    this.update({ items: this.state.items.filter((item) => item !== removed) });
    this.startUploads();
  }

  retry(key: string): void {
    this.edit(key, { status: 'waiting', error: null });
    this.startUploads();
  }

  dismissNotice(): void {
    this.update({ notice: null });
  }

  /** Stops the uploads under way and forgets the attachments: once they have been sent, or when the screen closes. */
  clear(): void {
    for (const controller of this.uploads.values()) controller.abort();
    for (const item of this.state.items) discardPicked(item.picked);
    this.update({ items: [], notice: null });
  }

  private add(result: PickResult): void {
    const added = result.files.map(
      (picked): Attachment => ({ key: `attachment-${++keys}`, picked, status: 'waiting', file: null, error: null, retryable: false }),
    );
    const notice = leftOut(result) ?? (added.length === 0 ? 'There was nothing there to attach.' : null);
    this.update({ items: [...this.state.items, ...added], notice });
    this.startUploads();
  }

  /** Starts waiting uploads while fewer than UPLOADS_AT_ONCE are under way. */
  private startUploads(): void {
    const waiting = this.state.items.filter((item) => item.status === 'waiting');
    for (const item of waiting.slice(0, Math.max(0, UPLOADS_AT_ONCE - this.uploads.size))) void this.upload(item);
  }

  private async upload({ key, picked }: Attachment): Promise<void> {
    const controller = new AbortController();
    this.uploads.set(key, controller);
    this.edit(key, { status: 'uploading' });
    try {
      const data = await readPicked(picked);
      const file = await this.latest.current((token) =>
        api.uploadFile(token, { data, contentType: picked.mimeType, name: picked.name, path: picked.path }, controller.signal),
      );
      if (!controller.signal.aborted) this.edit(key, { status: 'uploaded', file });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof ApiError)) {
        this.edit(key, { status: 'failed', error: "This file couldn't be read. Try again.", retryable: true });
        return;
      }
      // Unreachable (0), too many in a minute (429) or a server fault (5xx) can pass; a refusal stays one.
      const retryable = error.status === 0 || error.status === 429 || error.status >= 500;
      this.edit(key, { status: 'failed', error: errorMessage(error), retryable });
    } finally {
      this.uploads.delete(key);
      this.startUploads();
    }
  }

  private edit(key: string, changes: Partial<Attachment>): void {
    this.update({ items: this.state.items.map((item) => (item.key === key ? { ...item, ...changes } : item)) });
  }

  private update(changes: Partial<AttachmentsState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
}

/** What a message says when the person sends files without words, or nothing when there are no files either. */
export function attachedFilesText(files: number): string {
  if (files === 0) return '';
  return files === 1 ? 'Here is the attached file.' : 'Here are the attached files.';
}

/** What was left out of a pick, and why, or null when nothing was. */
function leftOut({ overLimit, unsupported, tooLarge, empty }: PickResult): string | null {
  const reasons = [
    overLimit ? `A message can carry up to ${MAX_ATTACHMENTS} files, so the rest were left out.` : null,
    unsupported > 0
      ? `${count(unsupported, 'file was', 'files were')} left out: only photos, PDF, Word, Excel, CSV, text and JSON files can be attached.`
      : null,
    tooLarge > 0 ? `Files can be up to ${MAX_MB} MB, so ${count(tooLarge, 'larger one was', 'larger ones were')} left out.` : null,
    empty > 0 ? `${count(empty, 'empty file was', 'empty files were')} left out.` : null,
  ].filter(Boolean);
  return reasons.length > 0 ? reasons.join(' ') : null;
}

/** The files attached to the message being written on this screen. */
export function useAttachments(): Attachments {
  const { call } = useAuth();
  const latest = useRef(call);
  useEffect(() => {
    latest.current = call;
  }, [call]);
  const [uploads] = useState(() => new AttachmentUploads(latest));
  useEffect(() => () => uploads.clear(), [uploads]);
  const state = useSyncExternalStore(uploads.subscribe, uploads.getState);

  const files = state.items.flatMap((item) => (item.file ? [item.file] : []));
  return {
    ...state,
    files,
    ready: !state.reading && files.length === state.items.length,
    room: MAX_ATTACHMENTS - state.items.length,
    pick: (source) => uploads.pick(source),
    remove: (key) => uploads.remove(key),
    retry: (key) => uploads.retry(key),
    dismissNotice: () => uploads.dismissNotice(),
    clear: () => uploads.clear(),
  };
}
