import { performance } from 'node:perf_hooks';
import type { FastifyBaseLogger } from 'fastify';
import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsStreaming } from 'groq-sdk/resources/chat/completions';
import type { Config } from '../config.ts';
import { HttpError } from '../http.ts';

export type Message = Groq.Chat.ChatCompletionMessageParam;
export type ToolMessage = Groq.Chat.ChatCompletionToolMessageParam;
export type Tool = Groq.Chat.ChatCompletionTool;
type ToolCall = Groq.Chat.ChatCompletionMessageToolCall;
type Chunk = Groq.Chat.ChatCompletionChunk;
type FinishReason = Chunk['choices'][number]['finish_reason'];
type Usage = NonNullable<Groq.Chat.ChatCompletion['usage']>;

export interface ModelRequest {
  /**
   * The standing instructions. They and the tools are the same for every person and every turn, to the byte, so
   * Groq can reuse its work on them (prompt caching), and what it reuses does not count against the key's limits.
   */
  system: string;
  tools: Tool[];
  /** What differs between people and days: who is asking, and today's date. It follows the instructions and tools. */
  context?: string | undefined;
  messages: Message[];
}

/** How long a turn may still wait for a busy model, in all. Every wait is taken from it. */
export interface WaitBudget {
  leftMs: number;
}

export interface ModelOptions {
  /** Aborts the call when the person stops the reply. */
  signal?: AbortSignal | undefined;
  /** Receives the reply's text as it is written. */
  onText?: ((delta: string) => void) | undefined;
  /** Told how long the call will wait when the model is busy, and null when it goes on. */
  onWait?: ((retryInMs: number | null) => void) | undefined;
  /** What the turn may still wait. Without it, the call may wait as long as a whole turn may. */
  wait?: WaitBudget | undefined;
  /** Gets one line for every call made to the model: names and numbers, never the key or anybody's words. */
  log?: FastifyBaseLogger | undefined;
}

/** One call to the model. Tests swap in a scripted fake. */
export type Model = (request: ModelRequest, options?: ModelOptions) => Promise<Groq.Chat.ChatCompletion>;

/** Thrown when no Groq API key is configured. */
export class ModelNotConfigured extends Error {}

/** Thrown when Groq's limits keep the model from answering sooner than a person should be kept waiting. */
export class ModelBusy extends Error {
  /** When Groq said to try again, from now. */
  readonly retryInMs: number;

  constructor(retryInMs: number) {
    super('The model is busy');
    this.name = 'ModelBusy';
    this.retryInMs = retryInMs;
  }
}

/** A wait this short is just waited: nobody is told. */
export const SHORT_WAIT_MS = 2_000;
/** The longest one wait for the model's limits that is worth making. Past it, the person retries when they choose. */
export const MAX_WAIT_MS = 30_000;
/** All the waiting for the model's limits that one turn may do. Groq's per-minute limits clear within a minute. */
export const TURN_WAIT_MS = 60_000;
/** Added to the wait Groq asks for, which it rounds. */
const WAIT_MARGIN_MS = 250;
/** How often one call asks Groq at most, whatever the reasons. */
const MAX_ATTEMPTS = 6;
/** A dropped connection or a server error is tried again this often, after 0.5 and 1 second. */
const TRANSIENT_RETRIES = 2;

/** The Groq client, created on first use so the server can start (and people can sign in) before a key is configured. */
export function groqClient(config: Config): () => Groq {
  let client: Groq | undefined;
  return () => {
    if (!config.groqApiKey) throw new ModelNotConfigured('GROQ_API_KEY is not set');
    client ??= new Groq({ apiKey: config.groqApiKey, timeout: 60_000 });
    return client;
  };
}

/** The messages as Groq is sent them: the standing instructions, then what differs, then the conversation. */
export function wireMessages(request: ModelRequest): Message[] {
  return [
    { role: 'system', content: request.system },
    // A message of its own after the instructions and the tools, never part of them: see ModelRequest.system.
    ...(request.context ? [{ role: 'user' as const, content: request.context }] : []),
    ...request.messages,
  ];
}

/**
 * The model on Groq. It takes the retries over from the SDK, which waits out a 429 in silence: every call is logged,
 * a short wait is just waited, a longer one goes to the fallback model when there is one or is waited with the
 * person told (onWait), and a wait too long ends as ModelBusy, for the person to retry.
 */
export function groqModel(config: Config, groq: () => Groq): Model {
  const models = config.fallbackModel && config.fallbackModel !== config.model ? [config.model, config.fallbackModel] : [config.model];
  // When each model's allowance is back, as Groq last said. The limits are the whole key's, so this is shared by
  // everyone's calls: a model that has just turned a call away is not asked again until then.
  const busyUntil = new Map<string, number>();

  return async (request, { signal, onText, onWait, wait = { leftMs: TURN_WAIT_MS }, log } = {}) => {
    const client = groq();
    const messages = wireMessages(request);
    const size = { messages: messages.length, requestChars: JSON.stringify(messages).length + JSON.stringify(request.tools).length };
    let streamed = false;
    const forward = (delta: string) => {
      streamed = true;
      onText?.(delta);
    };
    // The models that turned this very request down. A model busy for someone else's larger request is still asked.
    const turnedDown = new Set<string>();
    let temperature = 0.3;
    let transient = 0;

    for (let attempt = 1; ; attempt++) {
      const model = await nextModel(models, busyUntil, turnedDown, wait, onWait, signal);
      const params: ChatCompletionCreateParamsStreaming = {
        model,
        messages,
        tools: request.tools,
        tool_choice: 'auto',
        // Groq recommends a low temperature for reliable tool calls.
        temperature,
        max_completion_tokens: 8192,
        stream: true,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      };
      const started = performance.now();
      const took = () => Math.round(performance.now() - started);
      try {
        const { completion, headers, firstByteMs } = await streamCompletion(client, params, signal, forward);
        const choice = completion.choices[0];
        log?.info(
          {
            model,
            attempt,
            ms: took(),
            firstByteMs,
            ...size,
            finishReason: choice?.finish_reason,
            toolCalls: choice?.message.tool_calls?.length ?? 0,
            ...usageNumbers(completion.usage),
            ...limitNumbers(headers),
          },
          'model call',
        );
        return completion;
      } catch (error) {
        const status = error instanceof Groq.APIError ? error.status : undefined;
        const retryInMs = error instanceof Groq.RateLimitError ? retryAfterMs(error) : undefined;
        log?.warn(
          {
            model,
            attempt,
            ms: took(),
            ...size,
            failed: failureName(error, signal),
            ...(status ? { status } : {}),
            ...(error instanceof Groq.APIError ? { ...refusalNumbers(error), ...limitNumbers(error.headers) } : {}),
            ...(retryInMs === undefined ? {} : { retryInMs }),
          },
          'model call',
        );
        // Not once the person has stopped the reply or seen part of it: what they saw can't be taken back here.
        if (signal?.aborted || streamed || attempt >= MAX_ATTEMPTS) throw error;
        if (retryInMs !== undefined) {
          busyUntil.set(model, Date.now() + retryInMs);
          turnedDown.add(model);
          continue;
        }
        // Groq rejects a response whose tool call it can't parse; a second, colder try usually works.
        if (isFailedToolCall(error) && temperature > 0) {
          temperature = 0;
          continue;
        }
        if (isTransient(error) && transient < TRANSIENT_RETRIES) {
          await sleep(500 * 2 ** transient++, signal);
          continue;
        }
        throw error;
      }
    }
  };
}

/**
 * The model to ask now: the first whose allowance is back, or back in a moment. When every model is busy, the one
 * that is back soonest, after waiting for it (the person is told of any wait they would notice), or at once when it
 * has not yet turned this request down. Throws ModelBusy when the wait is longer than the person should be kept.
 */
async function nextModel(
  models: readonly string[],
  busyUntil: ReadonlyMap<string, number>,
  turnedDown: ReadonlySet<string>,
  wait: WaitBudget,
  onWait: ModelOptions['onWait'],
  signal: AbortSignal | undefined,
): Promise<string> {
  const now = Date.now();
  const waits = models.map((model) => ({ model, ms: Math.max(0, (busyUntil.get(model) ?? 0) - now) }));
  const soon = waits.find(({ ms }) => ms <= SHORT_WAIT_MS);
  const { model, ms } = soon ?? waits.reduce((best, next) => (next.ms < best.ms ? next : best));
  if (ms === 0) return model;

  const pause = ms + WAIT_MARGIN_MS;
  if (pause > MAX_WAIT_MS || pause > wait.leftMs) {
    // Busy with someone else's request, which may have been larger: this one is still worth asking once.
    if (!turnedDown.has(model)) return model;
    throw new ModelBusy(ms);
  }
  const told = ms > SHORT_WAIT_MS;
  if (told) onWait?.(pause);
  wait.leftMs -= pause;
  try {
    await sleep(pause, signal);
  } finally {
    if (told) onWait?.(null);
  }
  return model;
}

/** Waits, unless the person stops the reply first. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Groq.APIUserAbortError());
    const stop = () => {
      clearTimeout(timer);
      reject(new Groq.APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

// The client's timeout only covers the wait for a response to start, so a stream that stalls is cut off here.
const STALLED_MS = 60_000;

interface Streamed {
  completion: Groq.Chat.ChatCompletion;
  /** The response's headers, which carry what is left of the key's limits. */
  headers: Headers | undefined;
  /** How long Groq took to start answering. */
  firstByteMs: number;
}

/** Streams one completion, passing its text on as it arrives, and assembles what a non-streaming call returns. */
async function streamCompletion(
  client: Groq,
  params: ChatCompletionCreateParamsStreaming,
  signal: AbortSignal | undefined,
  onText: (delta: string) => void,
): Promise<Streamed> {
  const stalled = new AbortController();
  const started = performance.now();
  const { data: stream, response } = await client.chat.completions
    .create(params, {
      signal: signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal,
      // Retries are made in groqModel, where each one is logged and a long wait is told to the person.
      maxRetries: 0,
    })
    .withResponse();
  const firstByteMs = Math.round(performance.now() - started);
  const watchdog = setTimeout(() => stalled.abort(), STALLED_MS);

  let id = '';
  let created = 0;
  let content = '';
  let reasoning = '';
  let finishReason: FinishReason = null;
  let usage: Usage | undefined;
  const toolCalls = new Map<number, ToolCall>();
  try {
    for await (const chunk of stream) {
      watchdog.refresh();
      id ||= chunk.id;
      created ||= chunk.created;
      // Groq reports the tokens used in the last chunk.
      usage = chunk.x_groq?.usage ?? (chunk as { usage?: Usage | null }).usage ?? usage;
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
    headers: response?.headers,
    firstByteMs,
    completion: {
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
      ...(usage ? { usage } : {}),
    },
  };
}

const present = <T extends Record<string, unknown>>(values: T): Partial<T> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null)) as Partial<T>;

const milliseconds = (seconds: number | undefined) => (seconds === undefined ? undefined : Math.round(seconds * 1000));

/** The tokens a call used and where its time went, from Groq's usage block. */
function usageNumbers(usage: Usage | undefined) {
  if (!usage) return {};
  return present({
    promptTokens: usage.prompt_tokens,
    // The part of the prompt Groq had kept from an earlier call. It does not count against the key's limits.
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    queueMs: milliseconds(usage.queue_time),
    promptMs: milliseconds(usage.prompt_time),
    completionMs: milliseconds(usage.completion_time),
  });
}

/** What is left of the key's limits, from the headers Groq answers with (requests are per day, tokens per minute). */
function limitNumbers(headers: Headers | undefined) {
  if (!headers) return {};
  const number = (name: string) => {
    const value = headers.get(name);
    return value === null || value === '' || Number.isNaN(Number(value)) ? undefined : Number(value);
  };
  return present({
    limitRequests: number('x-ratelimit-limit-requests'),
    remainingRequests: number('x-ratelimit-remaining-requests'),
    resetRequests: headers.get('x-ratelimit-reset-requests'),
    limitTokens: number('x-ratelimit-limit-tokens'),
    remainingTokens: number('x-ratelimit-remaining-tokens'),
    resetTokens: headers.get('x-ratelimit-reset-tokens'),
    retryAfter: number('retry-after'),
  });
}

function groqErrorBody(error: InstanceType<typeof Groq.APIError>): { code?: string; type?: string; message?: string } {
  const body = error.error as { code?: string; type?: string; message?: string; error?: { code?: string; type?: string; message?: string } } | undefined;
  return body?.error ?? body ?? {};
}

/**
 * Why Groq turned a call down, as names and numbers: its code, and for a limit which one it was (such as TPM) with
 * how much of it was used and asked for. Groq's own sentence names the organization, so it is not kept.
 */
function refusalNumbers(error: InstanceType<typeof Groq.APIError>) {
  const { code, type, message = '' } = groqErrorBody(error);
  const limit = /\((TPM|TPD|RPM|RPD|ITPM|OTPM)\)[^0-9]*Limit (\d+), Used (\d+), Requested (\d+)/.exec(message);
  return present({
    code,
    type,
    limit: limit?.[1],
    limitSize: limit ? Number(limit[2]) : undefined,
    limitUsed: limit ? Number(limit[3]) : undefined,
    requested: limit ? Number(limit[4]) : undefined,
  });
}

function failureName(error: unknown, signal: AbortSignal | undefined): string {
  if (signal?.aborted) return 'stopped';
  if (error instanceof Groq.RateLimitError) return 'rate_limited';
  if (error instanceof Groq.APIConnectionTimeoutError) return 'timed_out';
  if (error instanceof Groq.APIConnectionError) return 'connection';
  if (error instanceof Groq.APIError) return groqErrorBody(error).code ?? 'refused';
  return 'error';
}

/** A length of time as Groq writes it, such as "7.66s", "2m59.56s" or "120ms", in milliseconds. */
export function durationMs(text: string | null | undefined): number | undefined {
  const written = text?.trim();
  if (!written) return undefined;
  const parts = [...written.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)];
  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== written) return undefined;
  const unit: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  return Math.round(parts.reduce((sum, part) => sum + Number(part[1]) * (unit[part[2]!] ?? 0), 0));
}

/** How long Groq asked to wait before trying again: its retry-after header, else what its message or limits say. */
export function retryAfterMs(error: InstanceType<typeof Groq.APIError>): number {
  const headers = error.headers;
  const header = (name: string) => {
    const value = headers?.get(name);
    return value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? undefined : Number(value);
  };
  // Groq's own sentence ("Please try again in 7.66s.") is exact; its retry-after header is rounded to whole seconds.
  const asked =
    header('retry-after-ms') ??
    durationMs(/try again in ([0-9.hms]+?)\.?(?:\s|$)/i.exec(groqErrorBody(error).message ?? '')?.[1]) ??
    (header('retry-after') === undefined ? undefined : header('retry-after')! * 1000) ??
    durationMs(headers?.get('x-ratelimit-reset-tokens')) ??
    5_000;
  return Math.max(0, Math.round(asked));
}

/** A dropped connection, or an error on Groq's side: worth another try. A timeout is not: it already took a minute. */
function isTransient(error: unknown): boolean {
  if (error instanceof Groq.APIConnectionTimeoutError) return false;
  if (error instanceof Groq.APIConnectionError) return true;
  return error instanceof Groq.APIError && error.status !== undefined && (error.status === 408 || error.status === 409 || error.status >= 500);
}

/** Groq rejected a tool call it couldn't parse: before the response (400) or part-way through a stream. */
export function isFailedToolCall(error: unknown): boolean {
  return error instanceof Groq.APIError && groqErrorBody(error).code === 'tool_use_failed';
}

/** Groq turned the request down for its size: more tokens than the model, or the key's tier, takes in one request. */
export function isRequestTooLarge(error: unknown): boolean {
  return error instanceof Groq.APIError && (error.status === 413 || groqErrorBody(error).code === 'context_length_exceeded');
}

/** "Try again in a minute", or in about how many minutes or hours. */
export function busyMessage(retryInMs: number | undefined): string {
  const busy = 'The assistant is busy right now.';
  if (retryInMs === undefined || retryInMs <= 90_000) return `${busy} Try again in a minute.`;
  const minutes = Math.ceil(retryInMs / 60_000);
  if (minutes <= 90) return `${busy} Try again in about ${minutes} minutes.`;
  const hours = Math.round(minutes / 60);
  return `${busy} Try again in about ${hours} ${hours === 1 ? 'hour' : 'hours'}.`;
}

/** Turns a failed Groq call into an error that is safe to show the person. Other errors are returned unchanged. */
export function explainGroqError(error: unknown, log: FastifyBaseLogger): unknown {
  if (error instanceof ModelNotConfigured) {
    return new HttpError(503, 'assistant_not_configured', "The assistant isn't set up yet. Ask an administrator to add its Groq API key.");
  }
  if (error instanceof ModelBusy) return new HttpError(503, 'assistant_busy', busyMessage(error.retryInMs));
  if (!(error instanceof Groq.GroqError)) return error;
  log.error({ err: error }, 'Groq call failed');
  if (error instanceof Groq.AuthenticationError || error instanceof Groq.PermissionDeniedError) {
    return new HttpError(503, 'assistant_not_configured', "The assistant isn't set up correctly. Ask an administrator to check its Groq API key.");
  }
  if (error instanceof Groq.RateLimitError) return new HttpError(503, 'assistant_busy', busyMessage(retryAfterMs(error)));
  if (isFailedToolCall(error)) {
    return new HttpError(422, 'not_understood', "Sorry, I couldn't work that out. Could you say it another way?");
  }
  return new HttpError(503, 'assistant_unavailable', 'The assistant is unavailable right now. Try again in a moment.');
}
