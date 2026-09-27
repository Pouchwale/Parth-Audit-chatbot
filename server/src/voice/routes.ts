import type { FastifyInstance } from 'fastify';
import type { TranscriptionResponse } from '@shared/api.ts';
import { explainGroqError } from '../agent/model.ts';
import type { AppDeps } from '../app.ts';
import { requireSession } from '../auth/sessions.ts';
import { HttpError } from '../http.ts';

const MAX_BYTES = 15 * 1024 * 1024;
// Too short to hold a spoken request, and Whisper tends to invent words for near-silence.
const MIN_BYTES = 1024;

// The file extension Groq needs for each kind of recording the apps send.
const EXTENSIONS = new Map([
  ['audio/mp4', 'm4a'],
  ['audio/m4a', 'm4a'],
  ['audio/x-m4a', 'm4a'],
  ['audio/aac', 'm4a'],
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/wave', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
]);

const noSpeech = () => new HttpError(422, 'no_speech', "I didn't catch that. Try again.");

export function registerVoiceRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = requireSession(deps);

  // In a scope of its own, so no other route accepts audio.
  app.register(async (scope) => {
    // Recordings arrive as the raw bytes: the phone app's fetch can't send a file from disk as form data.
    // No "$" at the end, so types with parameters such as "audio/webm;codecs=opus" match too.
    scope.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

    scope.post(
      '/assistant/transcribe',
      {
        // The session is checked, and the limit counted per signed-in device, before the upload is read, so
        // no one else can make the server take in a recording.
        onRequest: session,
        bodyLimit: MAX_BYTES,
        config: { rateLimit: { max: 30, timeWindow: '1 minute', hook: 'preParsing', keyGenerator: (request) => request.auth?.session.id ?? request.ip } },
      },
      async (request): Promise<TranscriptionResponse> => {
        const mimeType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
        const extension = EXTENSIONS.get(mimeType);
        if (!Buffer.isBuffer(request.body) || !extension) {
          throw new HttpError(415, 'unsupported_media_type', 'Send the recording as m4a, webm, ogg, wav or mp3 audio.');
        }
        if (request.body.length < MIN_BYTES) throw noSpeech();

        let text: string;
        try {
          text = await deps.transcriber({ data: request.body, filename: `audio.${extension}`, mimeType });
        } catch (error) {
          throw explainGroqError(error, request.log);
        }
        if (!text.trim()) throw noSpeech();
        return { text: text.trim() };
      },
    );
  });
}
