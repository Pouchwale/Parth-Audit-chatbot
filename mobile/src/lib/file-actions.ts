import { useEffect, useRef, useState } from 'react';
import type { FileInfo, FilePurpose } from '@shared/api';
import { announce } from './announce';
import { api, ApiError } from './api';
import { handOver } from './hand-over';
import { HandoverError, type FetchFile, type Handout, type Handover } from './handout';
import { tapFeedback } from './haptics';
import { DOWNLOADS_RECORDED } from './share';

/** A file the person can open, download or share. */
export interface FileTarget extends Handout {
  /** Tells files apart in the state, e.g. by their IDs. */
  key: string;
  fetchFile: FetchFile;
  /** Getting it is recorded in the download audit. */
  recorded: boolean;
}

export type FileActionState =
  | { status: 'idle' }
  | { status: 'busy'; key: string; action: FilePurpose }
  /** Browsers only: pressing the action again finishes it. */
  | { status: 'ready'; key: string; action: FilePurpose; message: string; finish(): Promise<Handover> }
  | { status: 'done'; key: string; action: FilePurpose; message: string }
  | { status: 'failed'; key: string; action: FilePurpose; error: string };

export interface FileActions {
  state: FileActionState;
  /** Opens, downloads or shares the file. Browsers allow a new tab and sharing only straight from a press. */
  run(action: FilePurpose, target: FileTarget): void;
  dismiss(): void;
}

const DONE_SHOWN_MS = 6000;
const BUSY = 'Another file is still being prepared. Try again in a moment.';
const FAILED: Record<FilePurpose, string> = {
  open: "The file couldn't be opened on this device. Try again.",
  download: "The file couldn't be saved on this device. Try again.",
  share: "The file couldn't be shared from this device. Try again.",
};

// One file is handed over at a time in the whole app: phones keep only the file being handed over in their cache,
// and show one share sheet or folder picker at a time.
let handingOver = false;

/** A file in a conversation, fetched with the person's sign-in. */
export function fileTarget(file: FileInfo, call: <T>(request: (token: string) => Promise<T>) => Promise<T>): FileTarget {
  return {
    key: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    fetchFile: (purpose) => call((token) => api.file(token, file.id, purpose)),
    recorded: file.origin === 'system',
  };
}

/** Opening, downloading and sharing files, one at a time, and how the last one went. */
export function useFileActions(): FileActions {
  const [state, setState] = useState<FileActionState>({ status: 'idle' });
  // Each action gets a number; only the latest may report how it went.
  const latest = useRef(0);

  useEffect(() => {
    if (state.status !== 'done') return;
    const timer = setTimeout(() => setState({ status: 'idle' }), DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );

  function run(action: FilePurpose, target: FileTarget) {
    if (state.status === 'busy') return;
    const { key } = target;
    const attempt = ++latest.current;
    const report = (next: FileActionState) => {
      if (attempt !== latest.current) return;
      setState(next);
      if (next.status === 'done' || next.status === 'ready') announce(next.message);
      if (next.status === 'failed') announce(next.error);
    };
    tapFeedback();
    if (handingOver) return report({ status: 'failed', key, action, error: BUSY });
    const resumed = state.status === 'ready' && state.key === key && state.action === action ? state.finish() : null;
    handingOver = true;
    setState({ status: 'busy', key, action });
    (resumed ?? handOver(action, target, target.fetchFile))
      .then((result) => {
        if (result.status === 'cancelled') return report({ status: 'idle' });
        if (result.status === 'ready') return report({ status: 'ready', key, action, message: result.message, finish: result.finish });
        report({ status: 'done', key, action, message: target.recorded ? `${result.message} ${DOWNLOADS_RECORDED}` : result.message });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return report({ status: 'idle' }); // Signed out: the sign-in screen says why.
        const message = error instanceof ApiError || error instanceof HandoverError ? error.message : FAILED[action];
        report({ status: 'failed', key, action, error: message });
      })
      .finally(() => {
        handingOver = false;
      });
  }

  return { state, run, dismiss: () => setState({ status: 'idle' }) };
}
