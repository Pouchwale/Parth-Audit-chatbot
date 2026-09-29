import type { FilePurpose } from '@shared/api';
import { browserShows } from './file-types';
import type { FetchFile, Handout, Handover } from './handout';

// Browsers open the file in a new tab, save it to the person's downloads, or share it with the system's share sheet
// where they can. A new tab and sharing are allowed only straight from a click, and the file is fetched only after
// the click, because fetching it is recorded with what the person chose to do.

// The browser may still be reading a download just after the link is clicked, so its address is freed a little later.
const RELEASE_DOWNLOAD_MS = 10_000;
// A tab reads the file again when it is reloaded, or saved from.
const RELEASE_TAB_MS = 5 * 60_000;

/** Browsers open files in a tab of their own, so the in-app viewer has nothing to show. */
export function viewedFile(): null {
  return null;
}

/** Hands the file over: opens, downloads or shares it. Call it straight from the click. */
export function handOver(action: FilePurpose, file: Handout, fetchFile: FetchFile): Promise<Handover> {
  switch (action) {
    case 'open':
      return open(file, fetchFile);
    case 'download':
      return download(file, fetchFile, `Downloaded “${file.filename}”.`);
    case 'share':
      return share(file, fetchFile);
  }
}

async function open(file: Handout, fetchFile: FetchFile): Promise<Handover> {
  if (!browserShows(file.mimeType)) {
    return download(file, fetchFile, `Your browser can't show “${file.filename}”, so it was downloaded.`);
  }
  // Opened before the file arrives: only the click itself may open a tab.
  const tab = window.open('', '_blank');
  if (!tab) return download(file, fetchFile, `Your browser blocked the new tab, so “${file.filename}” was downloaded.`);
  tab.document.title = file.filename;
  let content: Blob;
  try {
    content = await fetchBlob(file, fetchFile, 'open');
  } catch (error) {
    tab.close();
    throw error;
  }
  const url = URL.createObjectURL(content);
  tab.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), RELEASE_TAB_MS);
  return { status: 'done', message: `Opened “${file.filename}”.` };
}

async function download(file: Handout, fetchFile: FetchFile, message: string): Promise<Handover> {
  save(await fetchBlob(file, fetchFile, 'download'), file.filename);
  return { status: 'done', message };
}

async function share(file: Handout, fetchFile: FetchFile): Promise<Handover> {
  // Checked first, with an empty file of the same name and type: what can't be shared is downloaded, and recorded so.
  const probe = new File([], file.filename, { type: file.mimeType });
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [probe] })) {
    return download(file, fetchFile, `This browser can't share files, so “${file.filename}” was downloaded.`);
  }
  const content = await fetchBlob(file, fetchFile, 'share');
  return sendOn(new File([content], file.filename, { type: file.mimeType }), true);
}

/** Opens the system's share sheet. A browser that says the click was too long ago gets one more tap, then a download. */
async function sendOn(shared: File, firstTry: boolean): Promise<Handover> {
  try {
    await navigator.share({ files: [shared] });
    return { status: 'done', message: `Shared “${shared.name}”.` };
  } catch (error) {
    // Cancelled, or there was nowhere to share it.
    if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled' };
    if (!(error instanceof DOMException && error.name === 'NotAllowedError')) throw error;
    if (firstTry) {
      return { status: 'ready', message: `“${shared.name}” is ready. Tap Share again to send it.`, finish: () => sendOn(shared, false) };
    }
    save(shared, shared.name);
    return { status: 'done', message: `This browser didn't allow sharing, so “${shared.name}” was downloaded.` };
  }
}

async function fetchBlob(file: Handout, fetchFile: FetchFile, purpose: FilePurpose): Promise<Blob> {
  return new Blob([await fetchFile(purpose)], { type: file.mimeType });
}

/** Saves the file to the person's downloads. */
function save(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), RELEASE_DOWNLOAD_MS);
}
