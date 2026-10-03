import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, errorMessage } from './api';
import { useAuth } from './auth';
import type { Call } from './call';
import { nameInSettings } from './device';
import { tapFeedback } from './haptics';
import { discardRecording, readRecording, recordingFile } from './recording';
import { stopSpeaking } from './speech';

// The high-quality preset records AAC in an .m4a file on phones and webm in browsers, both of which Whisper
// accepts; the low-quality one records 3gp on Android, which it rejects. Speech needs far less than music, though.
// Browsers get no bitsPerSecond: they would split it between audio and (absent) video, leaving audio almost
// nothing, while without it bitRate goes to the audio alone.
const RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  web: { mimeType: 'audio/webm' },
};

const POLL_MS = 100;
/** The level (dBFS) reported for silence. */
const SILENT_DB = -160;
/** Louder than this counts as speech. Phones measure differently, so this is generous: Done always works. */
const SPEECH_DB = -45;
/** Once the person has spoken, this long without speech ends the take. */
const SILENCE_MS = 1500;
const MAX_MS = 60_000;
/** Shorter takes are taps on the mic by mistake. */
const MIN_MS = 500;
/** How many recent levels are kept for the level bars. */
export const LEVEL_COUNT = 24;
const QUIETEST_DB = -60;
const LOUDEST_DB = -10;

const NOTHING_HEARD = "I didn't catch that. Try again.";

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface VoiceInput {
  phase: VoicePhase;
  /** How long the take has been recording. */
  elapsedMs: number;
  /** Recent loudness, oldest first, each from 0 (silent) to 1. */
  levels: readonly number[];
  /** Why the last try didn't produce any text, for the person to read. */
  problem: string | null;
  start(): void;
  /** Stops recording and turns what was said into text. */
  finish(): void;
  /** Throws the take away: stops recording, or stops waiting for the microphone or for the text. */
  cancel(): void;
  dismissProblem(): void;
}

interface Take {
  /** The recording's file, when the recorder names it up front (on phones). */
  file: string | null;
  heardSpeech: boolean;
  lastSpeechAt: number;
}

/** What came of a take once it was stopped and sent to be turned into text. */
type TakeOutcome = { kind: 'nothing' } | { kind: 'text'; text: string } | { kind: 'signedOut' } | { kind: 'failed'; error: string };

/**
 * Records the person speaking and turns it into text on the server. The take ends when they tap Done, after
 * a short silence once they have said something, or at the time limit. `onText` receives the text.
 */
export function useVoiceInput(onText: (text: string) => void): VoiceInput {
  const { call } = useAuth();
  const recorder = useAudioRecorder(RECORDING);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [meter, setMeter] = useState<{ elapsedMs: number; levels: number[] }>({ elapsedMs: 0, levels: [] });
  const [problem, setProblem] = useState<string | null>(null);
  /** The take being recorded. */
  const take = useRef<Take | null>(null);
  // Each try gets a number. Cancelling, or the screen closing, moves on to the next, so that work still under way
  // for the old one (the microphone starting, or the recording being transcribed) comes to nothing.
  const tries = useRef(0);
  const deliver = useRef(onText);

  useEffect(() => {
    deliver.current = onText;
  });
  useEffect(
    () => () => {
      tries.current++;
      const current = take.current;
      take.current = null;
      if (current) void discardTake(recorder, current);
    },
    [recorder],
  );

  function stopWith(message: string | null) {
    setProblem(message);
    setPhase('idle');
  }

  async function start() {
    if (phase !== 'idle') return;
    const attempt = ++tries.current;
    stopSpeaking();
    setProblem(null);
    setPhase('starting');
    const refusal = await microphoneRefusal();
    if (attempt !== tries.current) return stopWith(null);
    if (refusal) return stopWith(refusal);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // Prepared before every take; passing the options gives each take a file of its own on iOS.
      await recorder.prepareToRecordAsync(RECORDING);
      recorder.record();
    } catch {
      await restorePlayback();
      return stopWith(attempt === tries.current ? "The microphone couldn't start. Try again, or type your message." : null);
    }
    const current: Take = { file: recordingFile(recorder), heardSpeech: false, lastSpeechAt: Date.now() };
    if (attempt !== tries.current) {
      // Cancelled while the microphone started. Browsers keep recording until the recorder is stopped.
      await discardTake(recorder, current);
      return stopWith(null);
    }
    take.current = current;
    setMeter({ elapsedMs: 0, levels: [] });
    setPhase('recording');
    tapFeedback();
  }

  async function finish() {
    const current = take.current;
    if (!current) return;
    take.current = null;
    const attempt = tries.current;
    tapFeedback();
    setPhase('transcribing');
    const outcome = await transcribeTake(recorder, current, call);
    // Cancelled, or the screen closed, meanwhile: the take has been thrown away.
    if (attempt !== tries.current) return;
    switch (outcome.kind) {
      case 'nothing':
        return stopWith(NOTHING_HEARD);
      case 'signedOut':
        return; // The sign-in screen says why.
      case 'failed':
        return stopWith(outcome.error);
      case 'text':
        stopWith(null);
        deliver.current(outcome.text);
        return;
    }
  }

  const onTick = useEffectEvent(() => {
    const current = take.current;
    if (!current) return;
    const { durationMillis, metering = SILENT_DB } = recorder.getStatus();
    const now = Date.now();
    if (metering > SPEECH_DB) {
      current.heardSpeech = true;
      current.lastSpeechAt = now;
    }
    setMeter((previous) => ({ elapsedMs: durationMillis, levels: [...previous.levels, loudness(metering)].slice(-LEVEL_COUNT) }));
    if (durationMillis >= MAX_MS || (current.heardSpeech && now - current.lastSpeechAt >= SILENCE_MS)) void finish();
  });

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => onTick(), POLL_MS);
    return () => clearInterval(timer);
  }, [phase]);

  async function cancel() {
    if (phase === 'idle') return;
    tries.current++;
    const current = take.current;
    take.current = null;
    // A take still starting ends by itself, once it has the microphone to let go of.
    if (phase === 'starting') return;
    if (current) {
      tapFeedback();
      await discardTake(recorder, current);
    }
    stopWith(null);
  }

  return {
    phase,
    elapsedMs: meter.elapsedMs,
    levels: meter.levels,
    problem,
    start: () => void start(),
    finish: () => void finish(),
    cancel: () => void cancel(),
    dismissProblem: () => setProblem(null),
  };
}

/** Why the microphone can't be used, or null when it can. Asks for permission the first time. */
async function microphoneRefusal(): Promise<string | null> {
  if (Platform.OS === 'web' && !window.isSecureContext) {
    return 'Voice input needs a secure connection. Open the app at an https:// or http://localhost address, or type your message.';
  }
  const { granted } = await requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
  if (granted) return null;
  return Platform.OS === 'web'
    ? 'Allow this site to use your microphone in your browser, then try again.'
    : `Allow microphone access for ${nameInSettings()} in your phone's Settings, then try again.`;
}

/** Stops the take, sends the recording to be turned into text, and removes the file whatever happened. */
async function transcribeTake(recorder: AudioRecorder, take: Take, call: Call): Promise<TakeOutcome> {
  const recording = await stopRecording(recorder).catch(() => null);
  const file = recording?.uri ?? take.file;
  try {
    if (!recording || recording.durationMs < MIN_MS) return { kind: 'nothing' };
    const { data, contentType } = await readRecording(recording.uri);
    const { text } = await call((token) => api.transcribe(token, data, contentType));
    return { kind: 'text', text };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { kind: 'signedOut' };
    return { kind: 'failed', error: errorMessage(error) };
  } finally {
    if (file) discardRecording(file);
  }
}

/** Stops the take and hands the audio back to playback. */
async function stopRecording(recorder: AudioRecorder): Promise<{ uri: string; durationMs: number } | null> {
  try {
    const { durationMillis } = recorder.getStatus();
    await recorder.stop();
    return recorder.uri ? { uri: recorder.uri, durationMs: durationMillis } : null;
  } finally {
    await restorePlayback();
  }
}

/** Stops a take and throws its recording away. */
async function discardTake(recorder: AudioRecorder, take: Take): Promise<void> {
  // A phone releases the recorder of a screen that closes, before this runs: then only the file it named is left.
  const recording = await stopRecording(recorder).catch(() => null);
  const file = recording?.uri ?? take.file;
  if (file) discardRecording(file);
}

// While recording is allowed, iPhones play sound through the earpiece: replies read aloud belong on the speaker.
function restorePlayback(): Promise<void> {
  return setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
}

/** A level in dBFS as 0 (quiet) to 1 (loud), for drawing. */
function loudness(db: number): number {
  return Math.min(1, Math.max(0, (db - QUIETEST_DB) / (LOUDEST_DB - QUIETEST_DB)));
}
