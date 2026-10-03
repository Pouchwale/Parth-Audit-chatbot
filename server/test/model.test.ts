import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsStreaming } from 'groq-sdk/resources/chat/completions';
import { afterEach, expect, it, vi } from 'vitest';
import {
  busyMessage,
  durationMs,
  explainGroqError,
  groqClient,
  groqModel,
  MAX_WAIT_MS,
  ModelBusy,
  ModelNotConfigured,
  retryAfterMs,
  SHORT_WAIT_MS,
  wireMessages,
  type ModelRequest,
} from '../src/agent/model.ts';
import { HttpError } from '../src/http.ts';
import { testConfig } from './helpers.ts';

type Chunk = Groq.Chat.ChatCompletionChunk;
type Delta = Chunk['choices'][number]['delta'];

function chunk(delta: Delta, finishReason: Chunk['choices'][number]['finish_reason'] = null, extra: Partial<Chunk> = {}): Chunk {
  return { id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }], ...extra };
}

/** A response stream: chunks in order, where an Error is thrown when it is reached and a function runs then. */
type Script = (Chunk | Error | (() => void))[];
/** What one call answers: a stream, or a refusal before any stream (such as a 429). */
type Answer = Script | { refuse: Error } | { script: Script; headers: Record<string, string> };

/** Stands in for the Groq client: each call streams, or refuses with, the next answer. */
function fakeGroq(answers: Answer[], config: Partial<Parameters<typeof testConfig>[0]> = {}) {
  const calls: ChatCompletionCreateParamsStreaming[] = [];
  const create = (params: ChatCompletionCreateParamsStreaming) => {
    calls.push(params);
    const answer = answers.shift() ?? [];
    const withResponse = async () => {
      if ('refuse' in answer) throw answer.refuse;
      const script = Array.isArray(answer) ? answer : answer.script;
      const headers = Array.isArray(answer) ? {} : answer.headers;
      const data = (async function* () {
        for (const step of script) {
          if (step instanceof Error) throw step;
          if (typeof step === 'function') step();
          else yield step;
        }
      })();
      return { data, response: new Response(null, { headers }) };
    };
    return { withResponse };
  };
  const client = { chat: { completions: { create } } } as unknown as Groq;
  return { calls, model: groqModel(testConfig({ groqApiKey: 'test-key', ...config }), () => client) };
}

const request: ModelRequest = { system: 'You help.', tools: [], messages: [{ role: 'user', content: 'Hi' }] };

// How Groq reports, part-way through a stream, a tool call it couldn't parse.
const failedToolCall = () => new Groq.APIError(undefined, { code: 'tool_use_failed', message: 'Failed to call a function.' }, 'Failed', undefined);

/** Groq's 429, as its SDK raises it: the headers it sent, and its own sentence saying how long to wait. */
function rateLimited(retryAfter: string, limit = 'TPM', message = `Rate limit reached for model \`openai/gpt-oss-120b\` in organization \`org_x\` service tier \`on_demand\` on tokens per minute (${limit}): Limit 8000, Used 7000, Requested 3000. Please try again in ${retryAfter}.`) {
  const headers = new Headers({ 'retry-after': String(Math.ceil((durationMs(retryAfter) ?? 0) / 1000)), 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': retryAfter });
  return new Groq.RateLimitError(429, { error: { message, type: 'tokens', code: 'rate_limit_exceeded' } }, message, headers);
}

const done = (text: string): Script => [chunk({ content: text }), chunk({}, 'stop')];

afterEach(() => {
  vi.useRealTimers();
});

it('passes text on as it streams and assembles the whole response, including tool calls sent in pieces', async () => {
  const { model } = fakeGroq([
    [
      chunk({ role: 'assistant' }),
      chunk({ reasoning: 'Look it up.' }),
      chunk({ content: 'Let me ' }),
      chunk({ content: 'check.' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'fake__list_items', arguments: '{"sta' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'fake__close_item', arguments: '{}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'tus":"open"}' } }] }),
      chunk({}, 'tool_calls'),
    ],
  ]);
  const text: string[] = [];

  const completion = await model(request, { onText: (delta) => text.push(delta) });
  expect(text).toEqual(['Let me ', 'check.']);
  expect(completion.choices).toEqual([
    {
      index: 0,
      finish_reason: 'tool_calls',
      logprobs: null,
      message: {
        role: 'assistant',
        content: 'Let me check.',
        reasoning: 'Look it up.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'fake__list_items', arguments: '{"status":"open"}' } },
          { id: 'call_2', type: 'function', function: { name: 'fake__close_item', arguments: '{}' } },
        ],
      },
    },
  ]);
});

it('sends the instructions, then what differs by person and day, then the conversation, and never retries on its own in the SDK', async () => {
  const { model, calls } = fakeGroq([done('Hello.')]);
  await model({ ...request, context: 'Signed-in person: Alice.' });
  expect(calls[0]!.messages).toEqual([
    { role: 'system', content: 'You help.' },
    { role: 'user', content: 'Signed-in person: Alice.' },
    { role: 'user', content: 'Hi' },
  ]);
  expect(wireMessages(request)).toEqual([{ role: 'system', content: 'You help.' }, { role: 'user', content: 'Hi' }]);
});

it('logs one line per call: the model, the attempt, the tokens used and cached, and what is left of the limits, never any words', async () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const usage = { prompt_tokens: 2500, completion_tokens: 40, total_tokens: 2540, prompt_tokens_details: { cached_tokens: 2048 }, queue_time: 0.012, prompt_time: 0.05, completion_time: 0.2, total_time: 0.262 };
  const { model } = fakeGroq([
    {
      script: [chunk({ content: 'Hello.' }), chunk({}, 'stop', { x_groq: { id: 'req_1', usage } as Chunk['x_groq'] })],
      headers: { 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '5460', 'x-ratelimit-reset-tokens': '7.66s', 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '999', 'x-ratelimit-reset-requests': '2m59.56s' },
    },
  ]);
  const completion = await model(request, { log: log as never });
  expect(completion.usage).toEqual(usage);
  expect(log.info).toHaveBeenCalledTimes(1);
  const [line, message] = log.info.mock.calls[0]!;
  expect(message).toBe('model call');
  expect(line).toMatchObject({
    model: 'test-model',
    attempt: 1,
    finishReason: 'stop',
    toolCalls: 0,
    promptTokens: 2500,
    cachedTokens: 2048,
    completionTokens: 40,
    limitTokens: 8000,
    remainingTokens: 5460,
    resetTokens: '7.66s',
    limitRequests: 1000,
    remainingRequests: 999,
    resetRequests: '2m59.56s',
    queueMs: 12,
    promptMs: 50,
    completionMs: 200,
  });
  expect(line.ms).toBeGreaterThanOrEqual(0);
  expect(line.requestChars).toBeGreaterThan(0);
  expect(JSON.stringify(line)).not.toContain('You help');
  expect(JSON.stringify(line)).not.toContain('Hello');
});

it('tries a failed tool call again, colder, when none of it was shown yet', async () => {
  const { model, calls } = fakeGroq([[chunk({ reasoning: 'Hmm.' }), failedToolCall()], done('Done.')]);
  const completion = await model(request);
  expect(completion.choices[0]!.message.content).toBe('Done.');
  expect(calls.map((call) => call.temperature)).toEqual([0.3, 0]);
});

it('does not try again once part of the reply was shown', async () => {
  const { model, calls } = fakeGroq([[chunk({ content: 'Closing' }), failedToolCall()], done('Again')]);
  await expect(model(request, { onText: () => {} })).rejects.toBeInstanceOf(Groq.APIError);
  expect(calls).toHaveLength(1);
});

it('never hands over a response that was stopped part-way', async () => {
  const stop = new AbortController();
  // The SDK ends the stream quietly when it is aborted after the response started.
  const { model } = fakeGroq([[chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'fake__close_item', arguments: '{"id' } }] }), () => stop.abort()]]);
  await expect(model(request, { signal: stop.signal })).rejects.toBeInstanceOf(Groq.APIUserAbortError);
});

it('tries a dropped connection or a stream that ends early twice more, then calls the assistant unavailable', async () => {
  vi.useFakeTimers();
  const dropped = fakeGroq([[chunk({ reasoning: 'Hmm' }), new TypeError('terminated')], [], []]);
  const failing = dropped.model(request);
  failing.catch(() => {});
  // After half a second, then a second.
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(failing).rejects.toBeInstanceOf(Groq.APIConnectionError);
  expect(dropped.calls).toHaveLength(3);

  // And goes on with the answer when a later try works.
  const recovered = fakeGroq([[new TypeError('terminated')], done('Hello.')]);
  const answered = recovered.model(request);
  await vi.advanceTimersByTimeAsync(600);
  expect((await answered).choices[0]!.message.content).toBe('Hello.');

  // Not once the person has seen part of the reply: what they saw can't be taken back.
  const shown = fakeGroq([[chunk({ content: 'Hel' }), new TypeError('terminated')], done('Hello.')]);
  await expect(shown.model(request, { onText: () => {} })).rejects.toBeInstanceOf(Groq.APIConnectionError);
  expect(shown.calls).toHaveLength(1);
});

it('just waits out a short wait Groq asks for, and asks again', async () => {
  vi.useFakeTimers();
  const waits: (number | null)[] = [];
  const { model, calls } = fakeGroq([{ refuse: rateLimited('1.5s') }, done('Hello.')]);
  const answered = model(request, { onWait: (ms) => waits.push(ms) });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(calls).toHaveLength(1);
  // 1.5 seconds as Groq asked, and a little over.
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await answered).choices[0]!.message.content).toBe('Hello.');
  expect(calls.map((call) => call.model)).toEqual(['test-model', 'test-model']);
  // Nobody is told of a wait this short.
  expect(waits).toEqual([]);
});

it('tells the person about a longer wait, with how long, and clears it when the model answers', async () => {
  vi.useFakeTimers();
  const waits: (number | null)[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { model, calls } = fakeGroq([{ refuse: rateLimited('7.66s') }, done('Hello.')]);
  const answered = model(request, { onWait: (ms) => waits.push(ms), log: log as never });
  await vi.advanceTimersByTimeAsync(7_000);
  expect(waits).toEqual([7_910]);
  expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await answered).choices[0]!.message.content).toBe('Hello.');
  expect(waits).toEqual([7_910, null]);
  // The refusal is logged with what Groq said about the limit, as numbers.
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.warn.mock.calls[0]![0]).toMatchObject({ model: 'test-model', attempt: 1, failed: 'rate_limited', status: 429, retryInMs: 7_660, limit: 'TPM', limitSize: 8000, limitUsed: 7000, requested: 3000 });
  expect(log.info.mock.calls[0]![0]).toMatchObject({ attempt: 2 });
  expect(SHORT_WAIT_MS).toBe(2_000);
});

it('goes to the fallback model at once when the first is busy for more than a moment, and comes back when it is free', async () => {
  vi.useFakeTimers();
  const waits: (number | null)[] = [];
  const { model, calls } = fakeGroq([{ refuse: rateLimited('20s') }, done('Hello.'), done('Again.'), done('Back.')], { fallbackModel: 'small-model' });
  const first = await model(request, { onWait: (ms) => waits.push(ms) });
  expect(first.choices[0]!.message.content).toBe('Hello.');
  expect(calls.map((call) => call.model)).toEqual(['test-model', 'small-model']);
  expect(waits).toEqual([]);

  // The first model is not asked again until Groq said its allowance is back.
  await model(request);
  expect(calls.at(-1)!.model).toBe('small-model');
  await vi.advanceTimersByTimeAsync(21_000);
  await model(request);
  expect(calls.at(-1)!.model).toBe('test-model');
});

it('gives up on a wait longer than a person should be kept, with a clear error that says when to try again', async () => {
  vi.useFakeTimers();
  const waits: (number | null)[] = [];
  const { model, calls } = fakeGroq([{ refuse: rateLimited('2m59s', 'TPD') }]);
  const failing = model(request, { onWait: (ms) => waits.push(ms) });
  await expect(failing).rejects.toBeInstanceOf(ModelBusy);
  expect(calls).toHaveLength(1);
  expect(waits).toEqual([]);
  const explained = explainGroqError(await failing.catch((error: unknown) => error), { error: vi.fn() } as never) as HttpError;
  expect(explained).toBeInstanceOf(HttpError);
  expect(explained).toMatchObject({ status: 503, code: 'assistant_busy', message: 'The assistant is busy right now. Try again in about 3 minutes.' });
  expect(MAX_WAIT_MS).toBe(30_000);
});

it("bounds a turn's waiting: a wait the turn has no room left for ends it", async () => {
  vi.useFakeTimers();
  const { model } = fakeGroq([{ refuse: rateLimited('10s') }]);
  const failing = model(request, { wait: { leftMs: 5_000 } });
  await expect(failing).rejects.toBeInstanceOf(ModelBusy);
});

it('reads how long Groq asked to wait from its headers, its sentence or its reset time, and says it as a person would', () => {
  expect(durationMs('7.66s')).toBe(7_660);
  expect(durationMs('2m59.56s')).toBe(179_560);
  expect(durationMs('120ms')).toBe(120);
  expect(durationMs('1h2m')).toBe(3_720_000);
  expect(durationMs('soon')).toBeUndefined();
  expect(retryAfterMs(new Groq.RateLimitError(429, {}, 'Busy', new Headers({ 'retry-after': '12' })))).toBe(12_000);
  expect(retryAfterMs(new Groq.RateLimitError(429, { error: { message: 'Please try again in 3.5s.' } }, 'Busy', new Headers()))).toBe(3_500);
  expect(retryAfterMs(new Groq.RateLimitError(429, {}, 'Busy', new Headers({ 'x-ratelimit-reset-tokens': '45s' })))).toBe(45_000);
  expect(retryAfterMs(new Groq.RateLimitError(429, {}, 'Busy', new Headers()))).toBe(5_000);
  expect(busyMessage(undefined)).toBe('The assistant is busy right now. Try again in a minute.');
  expect(busyMessage(60_000)).toBe('The assistant is busy right now. Try again in a minute.');
  expect(busyMessage(179_560)).toBe('The assistant is busy right now. Try again in about 3 minutes.');
  expect(busyMessage(3 * 3_600_000)).toBe('The assistant is busy right now. Try again in about 3 hours.');
});

it('needs an API key', () => {
  expect(() => groqClient(testConfig())()).toThrow(ModelNotConfigured);
});
