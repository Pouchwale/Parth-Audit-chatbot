import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { planSpeech, PROSODY, replan, type SpeechLanguage, type SpokenPiece, type VoiceInfo } from './speech-voice';

// Reading replies aloud, like a person (speech-voice.ts says how): each part of a reply in the voice of its own
// language, the best one the device has, a touch slower than the engines' default, and as a person would read it out.

/**
 * The longest piece given to the engine at once. A browser's voice (Chrome's especially) stops part-way through a
 * long one; a phone takes a few sentences at a time, and Android refuses more than about 4,000 characters.
 */
const PIECE_CHARS = Platform.OS === 'web' ? 220 : Math.min(Speech.maxSpeechInputLength || 4000, 600);

/** How long the first reading waits for the device to list its voices before it speaks with the engine's own choice. */
const VOICES_WAIT_MS = 2500;

let reading: string | null = null;
// Each reading gets a number, so that the end of one that was replaced can't clear the next.
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setReading(id: string | null) {
  reading = id;
  emit();
}

// The device's voices, listed once a session. An empty list (a browser still loading its voices) is asked for again
// at the next reading. Only the first reading waits for it; later ones speak with what is known by then.
let voices: VoiceInfo[] | null = null;
let asking: Promise<VoiceInfo[]> | null = null;
let waited = false;
/** Voices that failed to speak this session, so they are not chosen again. */
const failedVoices = new Set<string>();

async function deviceVoices(): Promise<VoiceInfo[] | null> {
  if (voices) return voices;
  asking ??= Speech.getAvailableVoicesAsync().then(
    (list) => {
      if (list.length > 0) voices = list;
      else asking = null;
      return list;
    },
    () => {
      asking = null;
      return [];
    },
  );
  if (waited) return voices;
  waited = true;
  const list = await Promise.race([asking, new Promise<null>((resolve) => setTimeout(() => resolve(null), VOICES_WAIT_MS))]);
  return list && list.length > 0 ? list : null;
}

/**
 * Reads markdown aloud in place of whatever was being read. `id` names what is read, for useReading. `asked` is true
 * when the person asked for it (Read aloud): then a language with no voice is pointed out again, under this reply.
 */
export function speak(markdown: string, id: string, { asked = false }: { asked?: boolean } = {}): void {
  void Speech.stop();
  const run: Reading = { current: ++generation, id };
  setReading(id);
  void deviceVoices().then((known) => {
    if (generation !== run.current) return;
    const usable = known ? known.filter((voice) => !failedVoices.has(voice.identifier)) : null;
    const { pieces, unspoken } = planSpeech(markdown, usable, PIECE_CHARS);
    const missing = unspoken[0];
    if (missing) noteMissingVoice(id, missing, asked);
    say(run, pieces, 0);
  });
}

/** One run of reading aloud: its number (see generation) and the reply it reads. */
interface Reading {
  current: number;
  id: string;
}

/** Says the pieces one after another, each when the last has ended, so each can have its own language's voice. */
function say(run: Reading, pieces: readonly SpokenPiece[], index: number): void {
  if (generation !== run.current) return;
  const piece = pieces[index];
  if (!piece) {
    setReading(null);
    return;
  }
  const next = () => say(run, pieces, index + 1);
  Speech.speak(piece.text, {
    language: piece.tag,
    ...(piece.voice ? { voice: piece.voice } : null),
    rate: PROSODY.rate,
    pitch: PROSODY.pitch,
    onDone: next,
    // Stopped by stopSpeaking (which already moved on) or by the system: nothing more is said.
    onStopped: () => {
      if (generation === run.current) setReading(null);
    },
    // A browser also ends an utterance this way when it is stopped (the reading has moved on by then). A voice that
    // fails on its own (on Android, one listed before its data is on the phone) is not chosen again this session:
    // this piece, and the rest it was to say, go to the next best voice of their language (speech-voice.ts replan).
    onError: () => {
      if (generation !== run.current) return;
      if (piece.voice === null) return next();
      failedVoices.add(piece.voice);
      const rest = replan(pieces.slice(index), voices, failedVoices);
      const missing = rest.unspoken[0];
      if (missing) noteMissingVoice(run.id, missing, false);
      say(run, rest.pieces, 0);
    },
  });
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

// ── A language with no voice ─────────────────────────────────────────────────────────────────────

/** The reply under which to say that a language had no voice to read it, and which language. */
export interface VoiceNote {
  messageId: string;
  language: SpeechLanguage;
}

let voiceNote: VoiceNote | null = null;
const noted = new Set<SpeechLanguage>();

/**
 * Points out once a session, under the reply, that the device has no voice for a language, so its words were shown and
 * not said; and again whenever the person asks for a reply in it to be read.
 */
function noteMissingVoice(messageId: string, language: SpeechLanguage, asked: boolean) {
  if (noted.has(language) && !asked) return;
  noted.add(language);
  voiceNote = { messageId, language };
  emit();
}

/** The reply that has a note about a missing voice under it, and the language, or null. */
export function useVoiceNote(): VoiceNote | null {
  return useSyncExternalStore(subscribe, () => voiceNote);
}
