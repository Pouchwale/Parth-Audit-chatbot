// What the app knows about file types: which ones can be attached, the type to upload a file as, and how to show it.

/**
 * The largest file the server takes: its FILE_MAX_MB, which must stay at this. It drops the connection on a bigger
 * one, so the app checks first.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The most files one message can carry. */
export const MAX_ATTACHMENTS = 20;

const OCTET_STREAM = 'application/octet-stream';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS = 'application/vnd.ms-excel';

/** The types that can be attached, by extension. */
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  pdf: PDF,
  docx: DOCX,
  xlsx: XLSX,
  xls: XLS,
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

const SUPPORTED = new Set(Object.values(BY_EXTENSION));

/** The extensions of the types that can be attached, e.g. "pdf". */
export const ATTACHABLE_EXTENSIONS = Object.keys(BY_EXTENSION);

const EXTENSION_OF = new Map(Object.entries(BY_EXTENSION).map(([extension, type]) => [type, extension]));

// Names systems give their own bookkeeping files, which nobody means to attach.
const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini', '__macosx']);

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The type of an attachable file, going by its name's extension. */
export function typeFromName(name: string): string | null {
  return BY_EXTENSION[extension(name)] ?? null;
}

/** How many bytes from the start of an image `imageTypeOf` needs. */
export const IMAGE_SIGNATURE_BYTES = 12;

/** The type of a JPEG, PNG, GIF or WebP image, going by its first bytes, or null for any other format. */
export function imageTypeOf(start: Uint8Array): string | null {
  const text = String.fromCharCode(...start.subarray(0, IMAGE_SIGNATURE_BYTES));
  if (text.startsWith('\xFF\xD8\xFF')) return 'image/jpeg';
  if (text.startsWith('\x89PNG')) return 'image/png';
  if (text.startsWith('GIF8')) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The name with an extension of the attachable `mimeType` in place of its own, e.g. "IMG_1.heic" as "IMG_1.jpeg". */
export function withType(name: string, mimeType: string): string {
  const added = EXTENSION_OF.get(mimeType);
  if (!added || typeFromName(name) === mimeType) return name;
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${added}`;
}

/**
 * The type to upload a file as: the one its extension names, since phones often report none or a vague one (or name
 * CSV "text/comma-separated-values"), and otherwise the one the platform reported.
 */
export function fileType(name: string, reported: string | null): string {
  return typeFromName(name) ?? (reported || OCTET_STREAM);
}

export function canAttach(mimeType: string): boolean {
  return SUPPORTED.has(mimeType);
}

/** Hidden and system files, skipped when a whole folder is attached. */
export function isHidden(name: string): boolean {
  return name.startsWith('.') || SYSTEM_FILES.has(name.toLowerCase());
}

/**
 * A name fit to show and upload. Android's folder access names some files by an ID with a prefix and no extension,
 * e.g. "msf:1000005678": the prefix goes, and the extension of the reported type is added.
 */
export function readableName(name: string, reported: string | null): string {
  const bare = /^[a-z]+:/i.test(name) ? name.slice(name.indexOf(':') + 1) : name;
  if (extension(bare)) return bare;
  const added = reported ? EXTENSION_OF.get(reported) : undefined;
  return added ? `${bare}.${added}` : bare;
}

export type FileKind = 'pdf' | 'image' | 'document' | 'spreadsheet' | 'text' | 'other';

export function fileKind(mimeType: string): FileKind {
  if (mimeType === PDF) return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === DOCX || mimeType === 'application/msword') return 'document';
  if (mimeType === XLSX || mimeType === XLS || mimeType === 'text/csv') return 'spreadsheet';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return 'text';
  return 'other';
}

/** A short name for the type, e.g. "PDF" or "Spreadsheet". */
export const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  image: 'Image',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  text: 'Text',
  other: 'File',
};

// The image types every browser draws itself.
const WEB_IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Whether a browser shows the file in a tab of its own, rather than only saving it. */
export function browserShows(mimeType: string): boolean {
  return mimeType === PDF || WEB_IMAGES.has(mimeType) || mimeType === 'text/plain' || mimeType === 'application/json';
}

/** Whether the in-app viewer on iPhones shows the file. */
export function viewerShows(mimeType: string): boolean {
  return mimeType === PDF || mimeType.startsWith('image/');
}

/** The Uniform Type Identifier of the type, for the share sheet, when the type has a well-known one. */
export function uniformType(mimeType: string): string | undefined {
  return mimeType === PDF ? 'com.adobe.pdf' : undefined;
}
