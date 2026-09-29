import { canAttach, fileType, isHidden, MAX_FILE_BYTES, readableName, typeFromName } from './file-types';

/** Where the person picks files from. The camera is on phones only. */
export type PickSource = 'photos' | 'camera' | 'files' | 'folder';

/** A file the person picked, ready to upload. */
export interface PickedFile {
  name: string;
  /** Its path inside a picked folder, starting with the folder's name. */
  path: string | null;
  mimeType: string;
  sizeBytes: number;
  /** Phones: the file's address (file:// or content://). Browsers: the file itself. */
  source: string | Blob;
}

/** The files a pick found that can be attached, and how many were left out, by why. */
export interface PickResult {
  files: PickedFile[];
  unsupported: number;
  tooLarge: number;
  empty: number;
  /** The pick held more than the message can still carry, and the rest of it was left out unread. */
  overLimit: boolean;
}

export const NOTHING_PICKED: PickResult = { files: [], unsupported: 0, tooLarge: 0, empty: 0, overLimit: false };

/**
 * A file as a platform describes it. Its reported type and size are asked for only when needed: on phones, each costs
 * a call to the system for every file of a picked folder.
 */
export interface Candidate {
  name: string;
  /** The folders it is in, inside a picked folder, e.g. "Site A/photos/". */
  folder: string | null;
  reportedType(): string | null;
  sizeBytes(): number;
  source: string | Blob;
}

/**
 * Sorts picked files into those to attach, at most `room` of them, and those left out. Hidden and system files are
 * skipped without a word. Once `room` files are in, the candidates stop being read: a folder on a phone can hold
 * thousands of files, and reading each takes calls to the system while the app waits.
 */
export function sortPicked(candidates: Iterable<Candidate>, room: number): PickResult {
  const result: PickResult = { ...NOTHING_PICKED, files: [] };
  for (const candidate of candidates) {
    if (isHidden(candidate.name)) continue;
    if (result.files.length >= room) {
      result.overLimit = true;
      break;
    }
    const named = typeFromName(candidate.name) !== null;
    const reported = named ? null : candidate.reportedType();
    const name = named ? candidate.name : readableName(candidate.name, reported);
    const mimeType = fileType(name, reported);
    if (!canAttach(mimeType)) {
      result.unsupported++;
      continue;
    }
    const sizeBytes = candidate.sizeBytes();
    if (sizeBytes > MAX_FILE_BYTES) result.tooLarge++;
    else if (sizeBytes === 0) result.empty++;
    else result.files.push({ name, path: candidate.folder === null ? null : candidate.folder + name, mimeType, sizeBytes, source: candidate.source });
  }
  return result;
}
