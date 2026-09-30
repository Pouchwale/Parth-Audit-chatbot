import { z } from 'zod';
import { withFiles } from '../types.ts';
import type { DcrsFile } from './client.ts';

// The pieces the actions' inputs share. Every schema goes to the model with each request, and its words count against
// the Groq key's 8,000 tokens a minute, so the checks that need no explaining are refinements, which the schema sent to
// the model leaves out: z.iso.date() alone would add a 300-character pattern, and each length limit 30 characters.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written YYYY-MM-DD. */
export function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Text of 1 to `max` characters once trimmed. */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .refine((value) => value.length >= 1 && value.length <= max, `Write 1 to ${max} characters`);

export const isoDate = z.string().trim().refine(isRealDate, 'Write a real date as YYYY-MM-DD');
export const recordId = text(200);
export const documentId = text(200);
export const searchWords = text(200);
export const limit = (most: number) => z.number().int().min(1).max(most).optional();

/** A path segment, such as a record's id, made safe for a URL. */
export const segment = (value: string) => encodeURIComponent(value.trim());

/** A value as the confirmation card says it: text in quotes, blank for nothing. */
export function spoken(value: unknown, max = 80): string {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'string') return `"${value.length > max ? `${value.slice(0, max)}…` : value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value);
  return json.length > max ? `${json.slice(0, max)}…` : json;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pairs(value: unknown): string {
  return isObject(value)
    ? Object.entries(value)
        .map(([key, item]) => `${key} ${spoken(item, 40)}`)
        .join(', ')
    : spoken(value, 60);
}

/**
 * A patch in words, for the confirmation card: every change it asks for, in the shape DCRS's Mitra takes —
 * {field: value}; a log sheet's {header: {...}, itemEdits: [{collection, match, set}]}; F/HR/17's {checkpoints: {n: value}}.
 */
export function patchInWords(patch: Record<string, unknown>, max = 420): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'header' && isObject(value)) {
      for (const [field, item] of Object.entries(value)) parts.push(`${field} to ${spoken(item)}`);
    } else if (key === 'checkpoints' && isObject(value)) {
      for (const [number, item] of Object.entries(value)) parts.push(`check point ${number} to ${spoken(isObject(item) && 'value' in item ? item.value : item)}`);
    } else if (key === 'itemEdits' && Array.isArray(value)) {
      for (const edit of value) {
        if (!isObject(edit)) continue;
        const where = edit.match === undefined ? '' : ` where ${pairs(edit.match)}`;
        const what = edit.set === undefined ? 'change the row' : `set ${pairs(edit.set)}`;
        parts.push(`in ${typeof edit.collection === 'string' ? edit.collection : 'the rows'}${where}: ${what}`);
      }
    } else {
      parts.push(`${key} to ${spoken(value)}`);
    }
  }
  let words = '';
  for (const [index, part] of parts.entries()) {
    const next = words ? `${words}; ${part}` : part;
    if (next.length > max) {
      const more = parts.length - index - (words ? 0 : 1);
      const said = words || `${part.slice(0, max)}…`;
      return more > 0 ? `${said}; and ${more} more` : said;
    }
    words = next;
  }
  return words || 'nothing';
}

/** Hands a PDF DCRS printed to the person, as a file card to open, download or share. */
export function pdfForPerson(pdf: DcrsFile, fallbackName: string, result: Record<string, unknown>) {
  const filename = pdf.filename?.trim() || fallbackName;
  const what = filename.replace(/\.pdf$/i, '');
  return withFiles({ ...result, filename, pdfBytes: pdf.data.byteLength }, [
    { filename, mimeType: 'application/pdf', data: pdf.data, description: `${what}, printed by DCRS as a PDF` },
  ]);
}
