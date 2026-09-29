/** How the server reads a kind of file: an image is described by the image reader, the others have their text taken out. */
export type FileKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'text' | 'other';

const OCTET_STREAM = 'application/octet-stream';
const XLS = 'application/vnd.ms-excel';
const CSV = 'text/csv';

// The files people can attach, by extension.
const BY_EXTENSION: Record<string, { mimeType: string; kind: FileKind }> = {
  jpg: { mimeType: 'image/jpeg', kind: 'image' },
  jpeg: { mimeType: 'image/jpeg', kind: 'image' },
  png: { mimeType: 'image/png', kind: 'image' },
  webp: { mimeType: 'image/webp', kind: 'image' },
  gif: { mimeType: 'image/gif', kind: 'image' },
  heic: { mimeType: 'image/heic', kind: 'image' },
  heif: { mimeType: 'image/heif', kind: 'image' },
  pdf: { mimeType: 'application/pdf', kind: 'pdf' },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx' },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'xlsx' },
  // Accepted so it can be passed on, but its text can't be read.
  xls: { mimeType: XLS, kind: 'other' },
  csv: { mimeType: CSV, kind: 'text' },
  txt: { mimeType: 'text/plain', kind: 'text' },
  md: { mimeType: 'text/markdown', kind: 'text' },
  json: { mimeType: 'application/json', kind: 'text' },
};

const KINDS = new Map(Object.values(BY_EXTENSION).map(({ mimeType, kind }) => [mimeType, kind]));

// Other names clients give the same types.
const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'text/x-markdown': 'text/markdown',
  'application/csv': CSV,
  'text/x-csv': CSV,
  'text/comma-separated-values': CSV,
};

/** A media type without its parameters, lower-cased: "Text/CSV; charset=utf-8" is "text/csv". */
export function baseType(contentType: string | undefined): string {
  return contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * The type an attached file is stored as, or undefined when that kind of file isn't accepted. A client that can't
 * tell sends application/octet-stream, and Windows browsers label CSV files as Excel ones, so those go by the extension.
 */
export function acceptedType(contentType: string | undefined, filename: string): string | undefined {
  const given = baseType(contentType);
  const type = ALIASES[given] ?? given;
  const byExtension = BY_EXTENSION[filename.split('.').pop()?.toLowerCase() ?? '']?.mimeType;
  if (type === OCTET_STREAM || (type === XLS && byExtension === CSV)) return byExtension;
  return KINDS.has(type) ? type : undefined;
}

export function kindOf(mimeType: string): FileKind {
  return KINDS.get(baseType(mimeType)) ?? 'other';
}

/** A file size as a person would say it: "512 bytes", "245 KB", "1.2 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
