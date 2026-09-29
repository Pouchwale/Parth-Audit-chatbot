import type { AudioRecorder } from 'expo-audio';
import type { FileData } from './api';

// Browsers hand the recording over as a blob: URL, and record webm (or whatever else they support).

/** Where a prepared recorder writes the take: nowhere yet, as browsers hand it over only when it stops. */
export function recordingFile(_recorder: AudioRecorder): string | null {
  return null;
}

/** A finished recording's bytes and type, ready to upload. */
export async function readRecording(uri: string): Promise<{ data: FileData; contentType: string }> {
  const blob = await (await fetch(uri)).blob();
  return { data: blob, contentType: blob.type || 'audio/webm' };
}

/** Frees a recording once it has been sent or thrown away. */
export function discardRecording(uri: string): void {
  URL.revokeObjectURL(uri);
}
