import { useEffect, useState } from 'react';
import type { FileInfo } from '@shared/api';
import { api } from './api';
import { useAuth } from './auth';
import type { FileImage } from './file-image';

// Browsers' images can't send the session token, so the image is fetched and shown from memory. These are the
// person's own uploads, which the server doesn't record.

interface Loaded {
  url: Promise<string>;
  /** Images showing it now. */
  users: number;
  release: ReturnType<typeof setTimeout> | null;
}

// A message is drawn afresh when the server confirms it and again when a new chat moves to its own address, so an
// image is kept a little while after it was last shown rather than fetched again each time.
const KEEP_MS = 30_000;
const loaded = new Map<string, Loaded>();

function acquire(file: FileInfo, fetchContent: () => Promise<ArrayBuffer>): Promise<string> {
  let entry = loaded.get(file.id);
  if (!entry) {
    const url = fetchContent().then((content) => URL.createObjectURL(new Blob([content], { type: file.mimeType })));
    const created: Loaded = { url, users: 0, release: null };
    // An image that couldn't be fetched is tried again next time.
    url.catch(() => {
      if (loaded.get(file.id) === created) loaded.delete(file.id);
    });
    loaded.set(file.id, created);
    entry = created;
  }
  if (entry.release) clearTimeout(entry.release);
  entry.release = null;
  entry.users++;
  return entry.url;
}

function release(fileId: string): void {
  const entry = loaded.get(fileId);
  if (!entry || --entry.users > 0) return;
  entry.release = setTimeout(() => {
    loaded.delete(fileId);
    entry.url.then(URL.revokeObjectURL, () => undefined);
  }, KEEP_MS);
}

/** An image the person attached, to show. */
export function useFileImage(file: FileInfo): FileImage {
  const { call } = useAuth();
  const [image, setImage] = useState<FileImage>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    acquire(file, () => call((token) => api.file(token, file.id, 'open'))).then(
      (uri) => {
        if (active) setImage({ status: 'ready', source: { uri } });
      },
      () => {
        if (active) setImage({ status: 'failed' });
      },
    );
    return () => {
      active = false;
      release(file.id);
    };
  }, [call, file]);

  return image;
}
