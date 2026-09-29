import type { FileData } from './api';
import { ATTACHABLE_EXTENSIONS, isHidden } from './file-types';
import { sortPicked, type Candidate, type PickedFile, type PickResult, type PickSource } from './picked-files';

// Browsers pick with their own file dialog, which also takes a whole folder. It opens only straight from a click, so
// nothing may be awaited before it.

/** A pick that couldn't happen, with why in words for the person. */
export class PickError extends Error {}

const FILE_TYPES = ATTACHABLE_EXTENSIONS.map((extension) => `.${extension}`).join(',');

/**
 * Lets the person pick up to `room` files to attach. Resolves with null when they cancel; a browser without the
 * dialog's cancel event (older ones) never resolves then. Browsers have read a folder by the time they hand it over,
 * so there is no reading to report.
 */
export function pickFiles(source: PickSource, room: number, _onReading: () => void): Promise<PickResult | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = source !== 'camera';
  if (source === 'files') input.accept = FILE_TYPES;
  if (source === 'photos' || source === 'camera') input.accept = 'image/*';
  // Phones' browsers open the camera for this; computers' offer their files.
  if (source === 'camera') input.capture = 'environment';
  input.webkitdirectory = source === 'folder';
  input.style.display = 'none';
  return new Promise((resolve) => {
    const finish = (result: PickResult | null) => {
      input.remove();
      resolve(result);
    };
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      finish(sortPicked(files.filter(outsideHiddenFolders).map(candidate), room));
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

function candidate(file: File): Candidate {
  // "Folder/inside/name.pdf" for a file of a picked folder, and empty otherwise.
  const path = file.webkitRelativePath;
  return {
    name: file.name,
    folder: path ? path.slice(0, path.length - file.name.length) : null,
    reportedType: () => file.type || null,
    sizeBytes: () => file.size,
    source: file,
  };
}

/** Whether the file isn't inside a hidden folder of the picked one, such as ".git". */
function outsideHiddenFolders(file: File): boolean {
  return !file.webkitRelativePath.split('/').slice(1, -1).some(isHidden);
}

/** The file's content, to upload. */
export async function readPicked(file: PickedFile): Promise<FileData> {
  return typeof file.source === 'string' ? (await fetch(file.source)).blob() : file.source;
}

/** Browsers keep picked files in memory only, so there is nothing to delete. */
export function discardPicked(_file: Pick<PickedFile, 'source'>): void {}
