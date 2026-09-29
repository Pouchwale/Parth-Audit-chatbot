import type { FilePurpose } from '@shared/api';

/** A file to hand to the person: to open, download or share. */
export interface Handout {
  filename: string;
  mimeType: string;
}

/**
 * Gets the file's content for `purpose`, the way it is actually handed over: the server records it with that
 * purpose, so a browser that can't share a file and downloads it instead asks for a download.
 */
export type FetchFile = (purpose: FilePurpose) => Promise<ArrayBuffer>;

/** How handing a file over went. */
export type Handover =
  | { status: 'done'; message: string }
  | { status: 'cancelled' }
  /** Browsers only: the file is here, but sharing it needs another tap. `finish` must be called straight from it. */
  | { status: 'ready'; message: string; finish(): Promise<Handover> };

/** A file that couldn't be handed over, with why in words for the person. */
export class HandoverError extends Error {}
