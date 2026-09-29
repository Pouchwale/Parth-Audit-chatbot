import { Worker } from 'node:worker_threads';
import type { FastifyBaseLogger } from 'fastify';
import { atMost } from '../at-most.ts';
import type { files } from '../db/schema.ts';
import type { DocumentKind } from './extract.ts';
import type { ExtractRequest, ExtractResult } from './extract-worker.ts';
import { baseType, kindOf } from './formats.ts';
import { decodeText, tidyText } from './text.ts';
import { turnedDown, type ImageReader } from './vision.ts';

export type TextStatus = (typeof files.$inferSelect)['textStatus'];

export interface Reading {
  text: string | null;
  textStatus: TextStatus;
}

interface Picture {
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface Readable extends Picture {
  data: Uint8Array;
}

/** The most text kept for one file. */
const MAX_TEXT_CHARS = 100_000;
const EXTRACT_TIMEOUT_MS = 20_000;
const EXTRACT_MEMORY_MB = 256;
// Each document is read in a thread of its own that can use EXTRACT_MEMORY_MB plus whatever the document unpacks to,
// so only this many read at once (the app uploads three files at a time); the rest wait their turn.
const EXTRACTIONS_AT_ONCE = 3;

// What the image reader takes: these formats (not HEIC or HEIF), requests of about 10 MiB once the image is
// base64-encoded, and at most 33,177,600 pixels.
const READABLE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 33_177_600;

const extractions = atMost(EXTRACTIONS_AT_ONCE);

/** Why the image reader can't take an image, or null when it can. */
export function imageProblem(image: Picture): string | null {
  if (!READABLE_IMAGES.has(baseType(image.mimeType))) return 'photos in this format cannot be read; JPEG or PNG ones can';
  if (image.sizeBytes > MAX_IMAGE_BYTES || (image.width ?? 0) * (image.height ?? 0) > MAX_IMAGE_PIXELS) {
    return 'the image is too large to read';
  }
  return null;
}

/**
 * What the model is given for a file: a document's text, or the image reader's description of a picture. Never throws:
 * a picture the reader turned down for good is `unsupported`, and any other failure `failed`, which for a picture means
 * it is read once more when the message is sent.
 */
export async function readContent(file: Readable, readImage: ImageReader, log: FastifyBaseLogger): Promise<Reading> {
  const kind = kindOf(file.mimeType);
  if (kind === 'other' || (kind === 'image' && imageProblem(file))) return { text: null, textStatus: 'unsupported' };
  try {
    const read =
      kind === 'image'
        ? await readImage({ data: file.data, mimeType: baseType(file.mimeType) })
        : kind === 'text'
          ? decodeText(file.data, MAX_TEXT_CHARS)
          : await extractInWorker(file.data, kind);
    const text = tidyText(read, MAX_TEXT_CHARS);
    return text ? { text, textStatus: 'ok' } : { text: null, textStatus: 'none' };
  } catch (error) {
    const rejected = kind === 'image' && turnedDown(error);
    log.warn({ err: error, mimeType: file.mimeType }, rejected ? 'the image reader turned a picture down' : 'could not read a file');
    return { text: null, textStatus: rejected ? 'unsupported' : 'failed' };
  }
}

function extractInWorker(bytes: Uint8Array, kind: DocumentKind): Promise<string> {
  return extractions(() => {
    const request: ExtractRequest = { bytes, kind, maxChars: MAX_TEXT_CHARS };
    const worker = new Worker(new URL('./extract-worker.ts', import.meta.url), {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: EXTRACT_MEMORY_MB },
    });
    let timer: NodeJS.Timeout | undefined;
    return new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Reading the file took too long')), EXTRACT_TIMEOUT_MS);
      worker.once('message', (result: ExtractResult) => ('text' in result ? resolve(result.text) : reject(new Error(result.error))));
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error(`The file reader stopped with exit code ${code}`)));
    }).finally(() => {
      clearTimeout(timer);
      // Stops a worker still parsing when it timed out.
      void worker.terminate();
    });
  });
}
