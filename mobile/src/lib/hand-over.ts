import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { FilePurpose } from '@shared/api';
import { readableName, uniformType, viewerShows } from './file-types';
import { HandoverError, type FetchFile, type Handout, type Handover } from './handout';
import { getItem, setItem } from './storage';

// Phones keep the file in the app's cache and hand it on from there: to an app that opens it (Android) or the in-app
// viewer (iPhone), a folder the person picks (Android), or the share sheet with WhatsApp, Gmail, Save to Files and
// the rest. The web version of this module uses the browser instead.

const VIEW = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 0x1;

// Android's folder picker can't choose the Download folder itself, but opens there, where making a folder is a tap.
const DOWNLOAD_FOLDER = 'content://com.android.externalstorage.documents/document/primary%3ADownload';
const SAVE_FOLDER_KEY = 'saveFolder';

/** A file for the in-app viewer: its address, the folder it may read, and its name. */
export interface Viewed {
  uri: string;
  folder: string;
  name: string;
}

// Kept here rather than put in the viewer's address, so that a link into the app can't make it show anything else.
let viewed: Viewed | null = null;

/** The file the in-app viewer shows: the one opened last. */
export function viewedFile(): Viewed | null {
  return viewed;
}

/** Hands the file over: opens, saves or shares it. Call it straight from the press. */
export async function handOver(action: FilePurpose, file: Handout, fetchFile: FetchFile): Promise<Handover> {
  if (action === 'download' && Platform.OS === 'android') return saveInFolder(file, fetchFile);
  if (action === 'open' && Platform.OS === 'ios' && viewerShows(file.mimeType)) return showInViewer(file, fetchFile);
  // Checked first: a file this device can't take must not be recorded as handed out. The share sheet is also where a
  // file goes when nothing on the phone opens it.
  if (!(await Sharing.isAvailableAsync())) throw new HandoverError("This device can't share files.");
  if (action !== 'open') {
    await share(inCache(file, await fetchFile(action)), file);
    return { status: 'done', message: `Exported “${file.filename}”.` };
  }
  if (Platform.OS === 'android' && (await view(inCache(file, await fetchFile('open')), file.mimeType))) {
    return { status: 'done', message: `Opened “${file.filename}”.` };
  }
  // Fetched for the share sheet, even when Android has fetched it to open already, so that it is recorded as shared.
  await share(inCache(file, await fetchFile('share')), file);
  return { status: 'done', message: `Nothing here opens “${file.filename}”, so it went to the share sheet, where another app can.` };
}

/** Shows the file in the in-app viewer (iPhones). */
async function showInViewer(file: Handout, fetchFile: FetchFile): Promise<Handover> {
  const cached = inCache(file, await fetchFile('open'));
  viewed = { uri: cached.uri, folder: cached.parentDirectory.uri, name: file.filename };
  router.push('/viewer');
  return { status: 'done', message: `Opened “${file.filename}”.` };
}

/** Writes the file to the app's cache, where the viewer and other apps can read it. */
function inCache(file: Handout, content: ArrayBuffer): File {
  const folder = new Directory(Paths.cache, 'files');
  // Only the file being handed over is kept: an earlier one has been opened, saved or sent on by now.
  if (folder.exists) folder.delete();
  folder.create();
  // The name becomes part of a path, so it must stay a single file inside that folder.
  const cached = new File(folder, file.filename.replace(/[\\/]/g, '-'));
  cached.write(new Uint8Array(content));
  return cached;
}

/** Opens the file in an app that shows its type. False when the phone has none. */
async function view(cached: File, mimeType: string): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync(VIEW, { data: cached.contentUri, type: mimeType, flags: FLAG_GRANT_READ_URI_PERMISSION });
    return true;
  } catch {
    return false;
  }
}

/** Opens the share sheet. Resolves once the person has closed it, whatever they chose. */
function share(cached: File, file: Handout): Promise<void> {
  return Sharing.shareAsync(cached.uri, { mimeType: file.mimeType, UTI: uniformType(file.mimeType), dialogTitle: file.filename });
}

/** Saves the file in a folder the person picks, starting from the one they picked last time. */
async function saveInFolder(file: Handout, fetchFile: FetchFile): Promise<Handover> {
  const last = await getItem(SAVE_FOLDER_KEY).catch(() => null);
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync(last ?? DOWNLOAD_FOLDER);
  } catch {
    // Cancelling rejects too, and phones name the error differently.
    return { status: 'cancelled' };
  }
  // Fetched only once there is somewhere to put it, as fetching it is recorded as a download.
  const content = await fetchFile('download');
  folder.createFile(file.filename, file.mimeType).write(new Uint8Array(content));
  await setItem(SAVE_FOLDER_KEY, folder.uri).catch(() => undefined);
  return { status: 'done', message: `Saved “${file.filename}” in ${readableName(folder.name, null) || 'the folder you chose'}.` };
}
