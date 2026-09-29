import type { FastifyReply } from 'fastify';

export interface Sendable {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/**
 * Whether a device may keep the file: `private` lets the person's own device reuse it, such as for the thumbnails in
 * their messages; `no-store` makes every fetch reach the server, for files whose every fetch is recorded.
 */
export type FileCache = 'no-store' | 'private';

const CACHE_CONTROL: Record<FileCache, string> = { 'no-store': 'no-store', private: 'private, max-age=3600' };

/** Answers with a file's bytes: `inline` to open it in place, `attachment` to save or share it. */
export function sendFile(reply: FastifyReply, file: Sendable, disposition: 'inline' | 'attachment', cache: FileCache) {
  return (
    reply
      .header('content-type', file.mimeType)
      .header('content-disposition', contentDisposition(disposition, file.filename))
      .header('cache-control', CACHE_CONTROL[cache])
      // Browsers must go by the stored type, never one they guess from the bytes.
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength))
  );
}

/**
 * A Content-Disposition header: an ASCII name for old clients, then the exact name in UTF-8 (RFC 6266 and RFC 8187),
 * so a report named in Hindi keeps its name.
 */
function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(filename)?.[0] ?? '';
  let ascii = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\%]/g, '_')
    .trim();
  if (!ascii.slice(0, ascii.length - extension.length).replace(/[\s._-]/g, '')) ascii = `download${extension}`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
