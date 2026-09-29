// Control characters other than tab and line breaks (\r is turned into \n first): they mean nothing to the model, and
// Postgres can't store U+0000.
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Text tidied for the model: no control characters, one kind of line break, no spaces at line ends, no more than one
 * blank line in a row, and at most `maxChars` characters.
 */
export function tidyText(text: string, maxChars: number): string {
  return cut(text.replace(/\r\n?/g, '\n').replace(CONTROLS, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), maxChars);
}

/** The first `maxChars` characters, with a surrogate pair cut in two at the end (or a lone one from a damaged document) made well-formed. */
export function cut(text: string, maxChars: number): string {
  return text.slice(0, maxChars).toWellFormed();
}

/**
 * Decodes a CSV, text, Markdown or JSON file: UTF-8, or UTF-16 when it starts with a byte order mark or has a zero byte
 * in every other place (Excel's "Unicode Text" and Windows PowerShell write UTF-16). Reads only as many bytes as
 * `maxChars` characters can take.
 */
export function decodeText(bytes: Uint8Array, maxChars: number): string {
  // `stream` holds back a character cut in two at the end, and the decoder drops a byte order mark.
  return new TextDecoder(encodingOf(bytes)).decode(bytes.subarray(0, maxChars * 4), { stream: true });
}

function encodingOf(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  // Without a mark: UTF-16 text that is mostly ASCII has a zero byte in every other place.
  const sample = bytes.subarray(0, 1024);
  let odd = 0;
  let even = 0;
  sample.forEach((byte, i) => {
    if (byte === 0) i % 2 ? odd++ : even++;
  });
  if (odd > sample.length / 4) return 'utf-16le';
  if (even > sample.length / 4) return 'utf-16be';
  return 'utf-8';
}
