// On iOS and Android this is Expo's fetch, which streams response bodies; on web it is the browser's own.
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import type { AssistantReply, DecisionRequest, MessageRequest, RetryRequest, StreamEvent } from '@shared/api';
import { ApiError, conversationPath, requestFailed, SERVER_URL, unreachable } from './api';
import { timeZone } from './device';
import { readSse } from './sse';

/** Something the person asked for: a new message, an answer to a confirmation, or another try at a failed reply. */
export type ChatRequest =
  | { kind: 'message'; conversationId?: string; text: string }
  | { kind: 'decision'; conversationId: string; confirmationId: string; decision: 'confirm' | 'cancel' }
  | { kind: 'retry'; conversationId: string };

/** The longest message the server accepts, once trimmed. */
export const MAX_MESSAGE_LENGTH = 4000;

/** The events that write the reply. `done` and `error` end the stream instead: see streamChat's result. */
export type ProgressEvent = Exclude<StreamEvent, { type: 'done' | 'error' }>;

type LastEvent = Extract<StreamEvent, { type: 'done' | 'error' }>;

// Error codes that mean the person's sign-in has ended. A stream can't change its HTTP status once it has
// started, so these come back as 401s, which sign the person out.
const SIGNED_OUT = new Set(['unauthenticated', 'session_expired']);

/**
 * Sends a request and reports the reply as it is written. Resolves with the finished reply. Rejects with an
 * ApiError when the request fails, or with whatever fetch threw once `signal` has aborted it.
 */
export async function streamChat(
  token: string,
  request: ChatRequest,
  onProgress: (event: ProgressEvent) => void,
  signal: AbortSignal,
): Promise<AssistantReply> {
  const { path, body } = endpoint(request);
  // Owned here so that a reply that didn't finish also ends the request itself: cancelling only the reader
  // leaves iOS downloading.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort);

  let last = undefined as LastEvent | undefined;
  try {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${SERVER_URL}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          // Android otherwise accepts brotli, which it decodes only once the whole reply has arrived.
          ...(Platform.OS === 'web' ? null : { 'accept-encoding': 'identity' }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw unreachable();
    }
    if (!response.ok) throw await requestFailed(response);

    try {
      await readSse(
        response.body,
        ({ data }) => {
          const event = JSON.parse(data) as StreamEvent;
          if (event.type === 'done' || event.type === 'error') last = event;
          else onProgress(event);
        },
        ({ event }) => event === 'done' || event === 'error',
      );
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw interrupted();
    }
  } finally {
    signal.removeEventListener('abort', abort);
    if (!last) controller.abort();
  }

  if (!last) throw interrupted();
  if (last.type === 'error') throw new ApiError(SIGNED_OUT.has(last.error) ? 401 : 500, last.error, last.message);
  return last.reply;
}

function endpoint(request: ChatRequest): { path: string; body: MessageRequest | DecisionRequest | RetryRequest } {
  const zone = timeZone();
  switch (request.kind) {
    case 'message':
      return {
        path: '/assistant/messages',
        body: { conversationId: request.conversationId, text: request.text, timeZone: zone, stream: true },
      };
    case 'decision':
      return {
        path: `${conversationPath(request.conversationId)}/decision`,
        body: { confirmationId: request.confirmationId, decision: request.decision, timeZone: zone, stream: true },
      };
    case 'retry':
      return { path: `${conversationPath(request.conversationId)}/retry`, body: { timeZone: zone, stream: true } };
  }
}

function interrupted(): ApiError {
  return new ApiError(0, 'interrupted', 'The connection was lost before the reply finished.');
}
