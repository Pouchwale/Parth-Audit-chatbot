import * as Speech from 'expo-speech';
import { useRef, useState } from 'react';
import type * as SpeechRecognitionTypes from 'expo-speech-recognition';

// Speech recognition needs a development build; Expo Go doesn't include the native module.
// Loading it lazily lets the app still run (text only) in Expo Go.
let recognition: typeof SpeechRecognitionTypes | null = null;
try {
  recognition = require('expo-speech-recognition') as typeof SpeechRecognitionTypes;
} catch {
  recognition = null;
}

const useRecognitionEvent: typeof SpeechRecognitionTypes.useSpeechRecognitionEvent =
  recognition?.useSpeechRecognitionEvent ?? (() => undefined);

interface VoiceInputHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
}

/** Speech-to-text for the composer. Handlers can change on every render. */
export function useVoiceInput(handlers: VoiceInputHandlers) {
  const [listening, setListening] = useState(false);
  const latest = useRef(handlers);
  latest.current = handlers;
  const gotFinal = useRef(false);

  useRecognitionEvent('start', () => {
    gotFinal.current = false;
    setListening(true);
  });
  useRecognitionEvent('end', () => setListening(false));
  useRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript?.trim() ?? '';
    if (!text) return;
    if (event.isFinal && !gotFinal.current) {
      gotFinal.current = true;
      latest.current.onFinal(text);
    } else if (!event.isFinal) {
      latest.current.onPartial(text);
    }
  });
  useRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error === 'aborted' || event.error === 'no-speech' || event.error === 'speech-timeout') return;
    latest.current.onError(
      event.error === 'not-allowed'
        ? 'Microphone access is off. Turn it on in your settings to talk to the assistant.'
        : "I couldn't hear that. Try again, or type your request.",
    );
  });

  const module = recognition?.ExpoSpeechRecognitionModule;
  let available = false;
  try {
    available = module?.isRecognitionAvailable() ?? false;
  } catch {
    available = false;
  }

  async function start() {
    if (!module) return;
    Speech.stop();
    const permission = await module.requestPermissionsAsync();
    if (!permission.granted) {
      latest.current.onError('Microphone access is off. Turn it on in your settings to talk to the assistant.');
      return;
    }
    module.start({ lang: 'en-US', interimResults: true, continuous: false });
  }

  function stop() {
    module?.stop();
  }

  return { available, listening, start, stop };
}

export function speak(text: string) {
  Speech.stop();
  if (text) Speech.speak(text, { language: 'en-US' });
}

export function stopSpeaking() {
  Speech.stop();
}
