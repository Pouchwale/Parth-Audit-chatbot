import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsStreaming } from 'groq-sdk/resources/chat/completions';
import { expect, it } from 'vitest';
import { groqClient, groqModel, ModelNotConfigured, type ModelRequest } from '../src/agent/model.ts';
import { testConfig } from './helpers.ts';

type Chunk = Groq.Chat.ChatCompletionChunk;
type Delta = Chunk['choices'][number]['delta'];

function chunk(delta: Delta, finishReason: Chunk['choices'][number]['finish_reason'] = null): Chunk {
  return { id: 'chatcmpl_1', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }] };
}

/** A response stream: chunks in order, where an Error is thrown when it is reached and a function runs then. */
type Script = (Chunk | Error | (() => void))[];

/** Stands in for the Groq client: each call streams the next script. */
function fakeGroq(...scripts: Script[]) {
  const calls: ChatCompletionCreateParamsStreaming[] = [];
  const create = async (params: ChatCompletionCreateParamsStreaming) => {
    calls.push(params);
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const step of script) {
        if (step instanceof Error) throw step;
        if (typeof step === 'function') step();
        else yield step;
      }
    })();
  };
  const client = { chat: { completions: { create } } } as unknown as Groq;
  return { calls, model: groqModel(testConfig({ groqApiKey: 'test-key' }), () => client) };
}

const request: ModelRequest = { system: 'You help.', tools: [], messages: [{ role: 'user', content: 'Hi' }] };

// How Groq reports, part-way through a stream, a tool call it couldn't parse.
const failedToolCall = () => new Groq.APIError(undefined, { code: 'tool_use_failed', message: 'Failed to call a function.' }, 'Failed', undefined);

it('passes text on as it streams and assembles the whole response, including tool calls sent in pieces', async () => {
  const { model } = fakeGroq([
    chunk({ role: 'assistant' }),
    chunk({ reasoning: 'Look it up.' }),
    chunk({ content: 'Let me ' }),
    chunk({ content: 'check.' }),
    chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'fake__list_items', arguments: '{"sta' } }] }),
    chunk({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'fake__close_item', arguments: '{}' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: 'tus":"open"}' } }] }),
    chunk({}, 'tool_calls'),
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

it('tries a failed tool call again, colder, when none of it was shown yet', async () => {
  const { model, calls } = fakeGroq([chunk({ reasoning: 'Hmm.' }), failedToolCall()], [chunk({ content: 'Done.' }), chunk({}, 'stop')]);
  const completion = await model(request);
  expect(completion.choices[0]!.message.content).toBe('Done.');
  expect(calls.map((call) => call.temperature)).toEqual([0.3, 0]);
});

it('does not try again once part of the reply was shown', async () => {
  const { model, calls } = fakeGroq([chunk({ content: 'Closing' }), failedToolCall()], [chunk({ content: 'Again' }), chunk({}, 'stop')]);
  await expect(model(request, { onText: () => {} })).rejects.toBeInstanceOf(Groq.APIError);
  expect(calls).toHaveLength(1);
});

it('never hands over a response that was stopped part-way', async () => {
  const stop = new AbortController();
  // The SDK ends the stream quietly when it is aborted after the response started.
  const { model } = fakeGroq([chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'fake__close_item', arguments: '{"id' } }] }), () => stop.abort()]);
  await expect(model(request, { signal: stop.signal })).rejects.toBeInstanceOf(Groq.APIUserAbortError);
});

it('treats a dropped connection or a stream that ends early as the assistant being unavailable', async () => {
  const dropped = fakeGroq([chunk({ content: 'Hel' }), new TypeError('terminated')]);
  await expect(dropped.model(request)).rejects.toBeInstanceOf(Groq.APIConnectionError);
  const cut = fakeGroq([chunk({ content: 'Hel' })]);
  await expect(cut.model(request)).rejects.toBeInstanceOf(Groq.APIConnectionError);
});

it('needs an API key', () => {
  expect(() => groqClient(testConfig())()).toThrow(ModelNotConfigured);
});
