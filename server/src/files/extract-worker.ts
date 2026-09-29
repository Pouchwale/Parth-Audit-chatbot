// The entry point of the worker thread that reads documents (see reading.ts). Parsing a document can use the CPU for
// a long time and a hostile one can use a lot of memory, so it happens here, where it can be stopped and capped.
import { parentPort, workerData } from 'node:worker_threads';
import { extractText, type DocumentKind } from './extract.ts';

export interface ExtractRequest {
  bytes: Uint8Array;
  kind: DocumentKind;
  maxChars: number;
}

/** The text, or why it couldn't be read. Errors are sent as text: their classes don't survive the trip. */
export type ExtractResult = { text: string } | { error: string };

const { bytes, kind, maxChars } = workerData as ExtractRequest;
let result: ExtractResult;
try {
  result = { text: await extractText(bytes, kind, maxChars) };
} catch (error) {
  result = { error: error instanceof Error ? error.message : String(error) };
}
parentPort?.postMessage(result);
