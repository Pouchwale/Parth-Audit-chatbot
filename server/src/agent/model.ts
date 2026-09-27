import type { FastifyBaseLogger } from 'fastify';
import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsStreaming } from 'groq-sdk/resources/chat/completions';
import type { Config } from '../config.ts';
import { HttpError } from '../http.ts';

export type Message = Groq.Chat.ChatCompletionMessageParam;
export type ToolMessage = Groq.Chat.ChatCompletionToolMessageParam;
export type Tool = Groq.Chat.ChatCompletionTool;
type ToolCall = Groq.Chat.ChatCompletionMessageToolCall;
type FinishReason = Groq.Chat.ChatCompletionChunk['choices'][number]['finish_reason'];

export interface ModelRequest {
  system: string;
  tools: Tool[];
  messages: Message[];
}

export interface ModelOptions {
  /** Aborts the call when the person stops the reply. */
  signal?: AbortSignal | undefined;
  /** Receives the reply's text as it is written. */
  onText?: ((delta: string) => void) | undefined;
}

/** One call to the model. Tests swap in a scripted fake. */
export type Model = (request: ModelRequest, options?: ModelOptions) => Promise<Groq.Chat.ChatCompletion>;

/** Thrown when no Groq API key is configured. */
export class ModelNotConfigured extends Error {}

/** The Groq client, created on first use so the server can start (and people can sign in) before a key is configured. */
export function groqClient(config: Config): () => Groq {
  let client: Groq | undefined;
  return () => {
    if (!config.groqApiKey) throw new ModelNotConfigured('GROQ_API_KEY is not set');
    client ??= new Groq({ apiKey: config.groqApiKey, timeout: 60_000 });
    return client;
  };
}

export function groqModel(config: Config, groq: () => Groq): Model {
  return async (request, { signal, onText } = {}) => {
    const client = groq();
    const params: ChatCompletionCreateParamsStreaming = {
      model: config.model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      tools: request.tools,
      tool_choice: 'auto',
      // Groq recommends a low temperature for reliable tool calls.
      temperature: 0.3,
      max_completion_tokens: 8192,
      stream: true,
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    };
    let streamed = false;
    const forward = (delta: string) => {
      streamed = true;
      onText?.(delta);
    };
    try {
      return await streamCompletion(client, params, signal, forward);
    } catch (error) {
      // Groq rejects a response whose tool call it can't parse; a second, colder try usually works.
      // Not once the person has seen part of the first try, though.
      if (!isFailedToolCall(error) || streamed) throw error;
      return streamCompletion(client, { ...params, temperature: 0 }, signal, forward);
    }
  };
}

// The client's timeout only covers the wait for a response to start, so a stream that stalls is cut off here.
const STALLED_MS = 60_000;

/** Streams one completion, passing its text on as it arrives, and assembles what a non-streaming call returns. */
async function streamCompletion(
  client: Groq,
  params: ChatCompletionCreateParamsStreaming,
  signal: AbortSignal | undefined,
  onText: (delta: string) => void,
): Promise<Groq.Chat.ChatCompletion> {
  const stalled = new AbortController();
  const stream = await client.chat.completions.create(params, {
    signal: signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal,
  });
  const watchdog = setTimeout(() => stalled.abort(), STALLED_MS);

  let id = '';
  let created = 0;
  let content = '';
  let reasoning = '';
  let finishReason: FinishReason = null;
  const toolCalls = new Map<number, ToolCall>();
  try {
    for await (const chunk of stream) {
      watchdog.refresh();
      id ||= chunk.id;
      created ||= chunk.created;
      const choice = chunk.choices[0];
      if (!choice) continue;
      const { delta } = choice;
      if (delta.reasoning) reasoning += delta.reasoning;
      if (delta.content) {
        content += delta.content;
        onText(delta.content);
      }
      // A tool call can arrive in pieces: its id and name once, its arguments in fragments.
      for (const piece of delta.tool_calls ?? []) {
        const call = toolCalls.get(piece.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        toolCalls.set(piece.index, call);
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.function.name = piece.function.name;
        call.function.arguments += piece.function?.arguments ?? '';
      }
      finishReason = choice.finish_reason ?? finishReason;
    }
  } catch (error) {
    // A dropped connection surfaces as a plain TypeError from fetch rather than a Groq error.
    if (error instanceof Groq.GroqError) throw error;
    throw new Groq.APIConnectionError({ message: 'The connection to Groq was lost.', cause: error instanceof Error ? error : undefined });
  } finally {
    clearTimeout(watchdog);
  }

  // An abort ends the stream quietly, possibly part-way through a tool call, so nothing of it may be used.
  if (signal?.aborted) throw new Groq.APIUserAbortError();
  if (stalled.signal.aborted) throw new Groq.APIConnectionTimeoutError({ message: 'Groq stopped responding.' });
  if (!finishReason) throw new Groq.APIConnectionError({ message: 'The response from Groq ended early.' });

  const calls = [...toolCalls].sort(([a], [b]) => a - b).map(([, call]) => call);
  return {
    id,
    object: 'chat.completion',
    created,
    model: params.model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          ...(calls.length > 0 ? { tool_calls: calls } : {}),
          ...(reasoning ? { reasoning } : {}),
        },
      },
    ],
  };
}

/** Groq rejected a tool call it couldn't parse: before the response (400) or part-way through a stream. */
export function isFailedToolCall(error: unknown): boolean {
  if (!(error instanceof Groq.APIError)) return false;
  const body = error.error as { code?: string; error?: { code?: string } } | undefined;
  return (body?.error?.code ?? body?.code) === 'tool_use_failed';
}

/** Turns a failed Groq call into an error that is safe to show the person. Other errors are returned unchanged. */
export function explainGroqError(error: unknown, log: FastifyBaseLogger): unknown {
  if (error instanceof ModelNotConfigured) {
    return new HttpError(503, 'assistant_not_configured', "The assistant isn't set up yet. Ask an administrator to add its Groq API key.");
  }
  if (!(error instanceof Groq.GroqError)) return error;
  log.error({ err: error }, 'Groq call failed');
  if (error instanceof Groq.AuthenticationError || error instanceof Groq.PermissionDeniedError) {
    return new HttpError(503, 'assistant_not_configured', "The assistant isn't set up correctly. Ask an administrator to check its Groq API key.");
  }
  if (error instanceof Groq.RateLimitError) {
    return new HttpError(503, 'assistant_busy', 'The assistant is busy right now. Try again in a minute.');
  }
  if (isFailedToolCall(error)) {
    return new HttpError(422, 'not_understood', "Sorry, I couldn't work that out. Could you say it another way?");
  }
  return new HttpError(503, 'assistant_unavailable', 'The assistant is unavailable right now. Try again in a moment.');
}
