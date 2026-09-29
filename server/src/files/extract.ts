import { inflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/node';
import { getDocumentProxy } from 'unpdf';
import { tidyText } from './text.ts';

export type DocumentKind = 'pdf' | 'docx' | 'xlsx';

const MAX_PDF_PAGES = 50;
// DOCX and XLSX files are ZIP archives. One whose parts unpack to more than this in all is refused before it is opened.
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

/** The text in a PDF, Word or Excel document: at most `maxChars` characters of it. */
export async function extractText(bytes: Uint8Array, kind: DocumentKind, maxChars: number): Promise<string> {
  return tidyText(await rawText(bytes, kind, maxChars), maxChars);
}

async function rawText(bytes: Uint8Array, kind: DocumentKind, maxChars: number): Promise<string> {
  if (kind === 'pdf') {
    if (!Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('Not a PDF file');
    return pdfText(bytes, maxChars);
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  checkUnzippedSize(bytes);
  if (kind === 'docx') return (await mammoth.extractRawText({ buffer })).value;
  const sheets = await readXlsxFile(buffer);
  return sheets.map(({ sheet, data }) => [`# Sheet: ${sheet}`, ...data.map((row) => row.map(csvCell).join(','))].join('\n')).join('\n\n');
}

async function pdfText(bytes: Uint8Array, maxChars: number): Promise<string> {
  // pdf.js takes over the buffer it is given, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    let text = '';
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES) && text.length < maxChars; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      text += `${items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('')}\n\n`;
      page.cleanup();
    }
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const notOpenable = () => new Error('Not a ZIP archive, or one too large to open');

/**
 * Unpacks each part of a ZIP archive, only to make sure that all of them together stay under MAX_UNZIPPED_BYTES. The
 * sizes an archive declares can't be trusted: a hostile one declares a few bytes for a part that unpacks to gigabytes,
 * and the document libraries unpack a whole part before they notice. Anything that isn't a plain ZIP archive of stored
 * or deflated parts, ZIP64 included, is refused too.
 */
function checkUnzippedSize(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) throw notOpenable();
  // The end-of-central-directory record is in the last 22 bytes, plus a comment of up to 65,535 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw notOpenable();
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (entries === 0xffff || at === 0xffffffff) throw notOpenable();
  let room = MAX_UNZIPPED_BYTES;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw notOpenable();
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const header = view.getUint32(at + 42, true);
    if (header + 30 > bytes.length || view.getUint32(header, true) !== 0x04034b50) throw notOpenable();
    const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
    if (start + compressed > bytes.length) throw notOpenable();
    const part = bytes.subarray(start, start + compressed);
    if (method === 8) room -= inflatedSize(part, room);
    else if (method === 0) room -= part.length;
    else throw notOpenable();
    if (room < 0) throw notOpenable();
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
}

/** How many bytes a deflated part unpacks to, stopping as soon as it passes `room`. */
function inflatedSize(part: Uint8Array, room: number): number {
  try {
    return inflateRawSync(part, { maxOutputLength: Math.max(1, room) }).length;
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw notOpenable();
    throw error;
  }
}
