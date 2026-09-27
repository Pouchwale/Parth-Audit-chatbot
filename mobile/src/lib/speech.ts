import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';
import { stripMarkdown } from './markdown';

// Android refuses text longer than its limit (about 4000 characters), so long replies are read in pieces.
const MAX_CHUNK = Math.min(Speech.maxSpeechInputLength || 4000, 3000);

let reading: string | null = null;
// Each reading gets a number, so that the end of one that was replaced can't clear the next.
let generation = 0;
const listeners = new Set<() => void>();

function setReading(id: string | null) {
  reading = id;
  for (const listener of listeners) listener();
}

/** Reads markdown aloud in place of whatever was being read. `id` names what is read, for useReading. */
export function speak(markdown: string, id: string): void {
  void Speech.stop();
  const current = ++generation;
  const chunks = chunk(stripMarkdown(markdown));
  if (chunks.length === 0) return setReading(null);
  // On web, stopping ends an utterance through any of these, so each one counts as finished.
  const finished = () => {
    if (generation === current) setReading(null);
  };
  chunks.forEach((text, index) =>
    Speech.speak(text, {
      language: 'en-US',
      ...(index === chunks.length - 1 ? { onDone: finished, onStopped: finished, onError: finished } : null),
    }),
  );
  setReading(id);
}

export function stopSpeaking(): void {
  generation++;
  void Speech.stop();
  setReading(null);
}

/** The id of what is being read aloud, or null. */
export function useReading(): string | null {
  return useSyncExternalStore(subscribe, () => reading);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Splits text at sentence ends into pieces the speech engine accepts. */
function chunk(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + sentence).length > MAX_CHUNK) {
      chunks.push(current.trim());
      current = '';
    }
    if (sentence.length > MAX_CHUNK) {
      for (let i = 0; i < sentence.length; i += MAX_CHUNK) chunks.push(sentence.slice(i, i + MAX_CHUNK));
      continue;
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
