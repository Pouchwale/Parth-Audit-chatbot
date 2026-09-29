import { HttpError } from '../http.ts';

const MAX_NAME_CHARS = 255;
const MAX_PATH_CHARS = 500;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

const invalid = (message: string) => new HttpError(400, 'invalid_request', message);

/** A file name without any folders in front of it or control characters in it. Empty when nothing usable is left. */
export function baseName(name: string): string {
  const base = name.normalize('NFC').replace(CONTROL_CHARACTERS, '').replace(/^.*[\\/]/, '').trim();
  return /^\.*$/.test(base) ? '' : base;
}

/** The name of an uploaded file, as the `name` query parameter gave it: 1 to 255 characters, without folders. */
export function uploadName(name: string | undefined): string {
  const base = name && name.length <= MAX_NAME_CHARS ? baseName(name) : '';
  if (!base) throw invalid('Give the file a name of 1 to 255 characters.');
  return base;
}

/** Where an uploaded file sits in a folder the person attached, such as "site-a/photo-1.jpg"; null when it doesn't. */
export function uploadPath(path: string | undefined): string | null {
  if (!path) return null;
  if (path.length > MAX_PATH_CHARS) throw invalid('The folder path must be at most 500 characters.');
  const segments = path
    .normalize('NFC')
    .replace(CONTROL_CHARACTERS, '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.');
  if (segments.includes('..')) throw invalid('The folder path cannot contain "..".');
  return segments.join('/') || null;
}
