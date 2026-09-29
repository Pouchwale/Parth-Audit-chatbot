import type { AudioRecorder } from 'expo-audio';
import { File } from 'expo-file-system';
import type { FileData } from './api';

// Phones record AAC in an .m4a file (see voice.ts). The web version of this module reads the browser's recording.

/** Where a prepared recorder writes the take. Phones name the file up front. */
export function recordingFile(recorder: AudioRecorder): string | null {
  return recorder.uri || null;
}

/** A finished recording's bytes and type, ready to upload. */
export async function readRecording(uri: string): Promise<{ data: FileData; contentType: string }> {
  return { data: await new File(uri).bytes(), contentType: 'audio/mp4' };
}

/** Removes a recording once it has been sent or thrown away. */
export function discardRecording(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Already gone: a take that failed to start may not have written a file.
  }
}
