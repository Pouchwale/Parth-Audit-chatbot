import { toFile, type Groq } from 'groq-sdk';
import type { Config } from '../config.ts';
import type { Connector } from '../connectors/types.ts';

export interface Recording {
  data: Buffer;
  /** Its extension tells Groq the audio format. */
  filename: string;
  mimeType: string;
}

/** Turns a voice recording into text. Tests swap in a fake. */
export type Transcriber = (audio: Recording) => Promise<string>;

/** The languages people speak to Mitra, and a short request in each, in its own script. */
const LANGUAGES = "English, Gujarati, Hindi: Open today's record. આજનો રેકોર્ડ ખોલો. आज का रिकॉर्ड खोलो.";

/**
 * The words Whisper is shown before it hears a recording: the assistant's name, each connected system with the words
 * people say about it (DCRS's short name, the plant, its format numbers), then the three languages, named and each
 * shown by a short request in its own script. Groq's docs (console.groq.com/docs/speech-to-text): the prompt is to
 * "guide the model's style or specify how to spell unfamiliar words", it is "limited to 224 tokens", and it should "use
 * the same language as the language of the audio file". A recording may be in any of the three, so all three are
 * there. With the DCRS connector it is 123 tokens in Whisper's own tokenizer (multilingual.tiktoken), where a Gujarati
 * letter can take two or three.
 */
export function transcriptionPrompt(connectors: readonly Connector[]): string {
  const systems = connectors.map((c) => [c.name, ...(c.spokenTerms ?? [])].join(', ')).join('; ');
  return `Mitra; ${systems}. ${LANGUAGES}`;
}

/**
 * Whisper on Groq. No language is set: Whisper tells it from the audio, as people speak English, Gujarati or Hindi, and
 * often mix them. Which Whisper (GROQ_TRANSCRIPTION_MODEL) is set in config.ts.
 */
export function groqTranscriber(config: Config, groq: () => Groq, connectors: readonly Connector[]): Transcriber {
  const prompt = transcriptionPrompt(connectors);
  return async ({ data, filename, mimeType }) => {
    const transcription = await groq().audio.transcriptions.create(
      {
        file: await toFile(data, filename, { type: mimeType }),
        model: config.transcriptionModel,
        prompt,
        response_format: 'json',
        temperature: 0,
      },
      { timeout: 30_000 },
    );
    return transcription.text.trim();
  };
}
