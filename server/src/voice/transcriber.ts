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

export function groqTranscriber(config: Config, groq: () => Groq, connectors: readonly Connector[]): Transcriber {
  // Whisper spells names it has been shown more reliably, such as the connected systems'.
  const prompt = `A request to a work assistant about the ${connectors.map((c) => c.name).join(', ')}.`;
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
