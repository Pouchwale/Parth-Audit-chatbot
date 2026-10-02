import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import type { FileData } from './api';
import { nameInSettings } from './device';
import { IMAGE_SIGNATURE_BYTES, imageTypeOf, isHidden, readableName, withType } from './file-types';
import { sortPicked, type Candidate, type PickedFile, type PickResult, type PickSource } from './picked-files';

// Phones pick with the system's pickers, which copy photos and files into the app's cache; a folder is read where it
// is. The web version of this module uses the browser's file dialog.

// A phone's full-quality photo is several megabytes, far more than reading it needs.
const PHOTO_QUALITY = 0.8;

/** A pick that couldn't happen, with why in words for the person. */
export class PickError extends Error {}

/**
 * Lets the person pick up to `room` files to attach. Resolves with null when they cancel. `onReading` is called once
 * they have picked a folder, as reading it can take a while.
 */
export async function pickFiles(source: PickSource, room: number, onReading: () => void): Promise<PickResult | null> {
  switch (source) {
    case 'photos':
      return sortPhotos(
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          allowsMultipleSelection: true,
          selectionLimit: room,
          orderedSelection: true,
          quality: PHOTO_QUALITY,
          // iPhones otherwise hand over HEIC photos as they are, which the assistant can't read, rather than as JPEG.
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        }),
        room,
      );
    case 'camera':
      // iPhones refuse to open the camera until the app has asked for it.
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        throw new PickError(`Allow camera access for ${nameInSettings()} in your phone's Settings, then try again.`);
      }
      return sortPhotos(await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: PHOTO_QUALITY }), room);
    case 'files': {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (picked.canceled) return null;
      return sortCopies(
        picked.assets.map((asset) => ({
          name: asset.name,
          folder: null,
          reportedType: () => asset.mimeType ?? null,
          sizeBytes: () => asset.size ?? new File(asset.uri).size,
          source: asset.uri,
        })),
        room,
      );
    }
    case 'folder':
      return pickFolder(room, onReading);
  }
}

function sortPhotos(picked: ImagePicker.ImagePickerResult, room: number): PickResult | null {
  if (picked.canceled) return null;
  return sortCopies(
    picked.assets.map((asset) => {
      const written = new File(asset.uri);
      return {
        name: photoName(asset.fileName ?? written.name, written),
        folder: null,
        reportedType: () => asset.mimeType ?? null,
        // The size the picker reports can be the photo's before it was compressed.
        sizeBytes: () => written.size,
        source: asset.uri,
      };
    }),
    room,
  );
}

/**
 * The photo's name, with the extension of the format the picker wrote it in. Android's picker turns photos into JPEG
 * but reports the original's name and type, e.g. "IMG_1.heic".
 */
function photoName(name: string, written: File): string {
  const handle = written.open(FileMode.ReadOnly);
  try {
    const type = imageTypeOf(handle.readBytes(IMAGE_SIGNATURE_BYTES));
    return type ? withType(name, type) : name;
  } finally {
    handle.close();
  }
}

/** Sorts files a picker copied into the app's cache, and deletes the copies of those left out. */
function sortCopies(candidates: Candidate[], room: number): PickResult {
  const result = sortPicked(candidates, room);
  const kept = new Set(result.files.map((file) => file.source));
  for (const candidate of candidates) if (!kept.has(candidate.source)) discardPicked(candidate);
  return result;
}

async function pickFolder(room: number, onReading: () => void): Promise<PickResult | null> {
  let root: Directory;
  try {
    root = await Directory.pickDirectoryAsync();
  } catch {
    // Cancelling rejects too, and phones name the error differently.
    return null;
  }
  onReading();
  // The app waits while the folder is read, so saying that it is being read gets a frame to show first.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    return sortPicked(walk(root, `${readableName(root.name, null)}/`), room);
  } catch {
    throw new PickError("That folder couldn't be read. Try another one.");
  }
}

/** Every file in the folder and the folders inside it, except hidden ones, read only as far as they are asked for. */
function* walk(folder: Directory, path: string): Generator<Candidate> {
  for (const item of folder.list()) {
    if (item instanceof Directory) {
      if (!isHidden(item.name)) yield* walk(item, `${path}${item.name}/`);
    } else {
      yield { name: item.name, folder: path, reportedType: () => item.type || null, sizeBytes: () => item.size, source: item.uri };
    }
  }
}

/** The file's content, to upload. */
export function readPicked(file: PickedFile): Promise<FileData> {
  return typeof file.source === 'string' ? new File(file.source).bytes() : Promise.resolve(file.source);
}

/** Deletes the copy a picker made in the app's cache, once it is no longer needed. Files in a picked folder stay. */
export function discardPicked({ source }: Pick<PickedFile, 'source'>): void {
  if (typeof source !== 'string' || !source.startsWith(Paths.cache.uri)) return;
  try {
    new File(source).delete();
  } catch {
    // Already gone.
  }
}
