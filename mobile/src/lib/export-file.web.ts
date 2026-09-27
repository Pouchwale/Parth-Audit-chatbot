import type { ConversationExport } from '@shared/api';

// Browsers save the file straight to the person's downloads.

// The browser may still be reading the file just after the link is clicked, so its address is freed a little later.
const RELEASE_AFTER_MS = 10_000;

/** Whether this device can hand a file over: every browser can download one. */
export async function canSaveExports(): Promise<boolean> {
  return true;
}

/** Hands the exported file to the person as a download. */
export async function saveExport(file: ConversationExport): Promise<void> {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS);
}
