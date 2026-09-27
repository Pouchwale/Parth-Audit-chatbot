import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ConversationExport } from '@shared/api';

// Phones write the file to the app's cache and open the share sheet, where the person saves it to their files or
// sends it on. The web version of this module downloads it instead.

/** Whether this device can hand a file over. */
export function canSaveExports(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/** Hands the exported file to the person. Resolves once they have closed the share sheet. */
export async function saveExport(file: ConversationExport): Promise<void> {
  const folder = new Directory(Paths.cache, 'exports');
  // Only the file being shared is kept: an earlier one has been saved or sent on by now.
  if (folder.exists) folder.delete();
  folder.create();
  // The name becomes part of a path, so it must stay a single file inside that folder.
  const saved = new File(folder, file.filename.replace(/[\\/]/g, '-'));
  saved.write(file.content);
  await Sharing.shareAsync(saved.uri, { mimeType: file.mimeType, dialogTitle: 'Share conversation' });
}
