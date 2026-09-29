import Groq from 'groq-sdk';
import type { Config } from '../config.ts';

export interface Image {
  data: Uint8Array;
  /** image/png, image/jpeg, image/gif or image/webp. */
  mimeType: string;
}

/** Describes an image in words, which the chat model can read. Tests swap in a fake. */
export type ImageReader = (image: Image) => Promise<string>;

const INSTRUCTIONS =
  'Describe this image for an audit assistant: transcribe any visible text exactly, then list what it shows (objects, labels, damage, readings) in plain sentences.';

// Groq may show the model one image as an overview plus zoomed-in crops, which makes it repeat text.
const ONE_PICTURE = 'Each image is one picture, even if it reaches you as an overview plus zoomed-in crops. Describe it once, without repeating text.';

// Groq answers 400 for an image it can't decode, 413 for one too large and 422 for one it won't take. Every other
// failure, such as being busy (429), is about the reader rather than the picture.
const TURNS_DOWN = new Set([400, 413, 422]);

/** Whether the image reader turned the picture itself down, for good, rather than being busy or unavailable. */
export function turnedDown(error: unknown): boolean {
  return error instanceof Groq.APIError && error.status !== undefined && TURNS_DOWN.has(error.status);
}

export function groqImageReader(config: Config, groq: () => Groq): ImageReader {
  return async ({ data, mimeType }) => {
    const base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
    const completion = await groq().chat.completions.create(
      {
        model: config.visionModel,
        messages: [
          { role: 'system', content: ONE_PICTURE },
          {
            role: 'user',
            content: [
              { type: 'text', text: INSTRUCTIONS },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.2,
        max_completion_tokens: 1500,
      },
      // The free tier reads only about three images a minute. A refusal is recorded and the image read again when
      // it is sent, rather than holding up the upload with the SDK's quiet retries.
      { timeout: 60_000, maxRetries: 0 },
    );
    return completion.choices[0]?.message.content?.trim() ?? '';
  };
}
