import { randomUUID } from 'node:crypto';
import Groq from 'groq-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssistantMessage, AssistantReply, ConversationDetail, StreamEvent } from '@shared/api.ts';
import { actions, conversations } from '../src/db/schema.ts';
import { callsTool, cutOff, fails, findEvent, parseEvents, says, setup, streams } from './helpers.ts';

const ORIGIN = 'http://localhost:8081';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup({ corsOrigins: [ORIGIN] });
});
afterEach(async () => {
  await t.close();
});

function stream(token: string | null, url: string, payload: object) {
  return t.app.inject({
    method: 'POST',
    url,
    headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: { ...payload, stream: true },
  });
}

/** Rebuilds the assistant message from the stream, the way the app applies the events. */
function replay(events: StreamEvent[]): AssistantMessage {
  let message: AssistantMessage | undefined;
  for (const event of events) {
    if (event.type === 'start') message = structuredClone(event.message);
    else if (event.type === 'part') message!.parts[event.index] = event.part;
    else if (event.type === 'delta') {
      const last = message!.parts.at(-1);
      if (last?.type === 'text') last.text += event.text;
      else message!.parts.push({ type: 'text', text: event.text });
    }
  }
  return message!;
}

it('streams a reply as it is written: start, lookups, text, then done', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__list_items', { status: 'open' }), streams('You have ', 'two open items.'));

  const response = await stream(alice, '/assistant/messages', { text: 'What is still open?' });
  expect(response.statusCode).toBe(200);
  expect(response.headers).toMatchObject({ 'content-type': 'text/event-stream; charset=utf-8', 'access-control-allow-origin': ORIGIN });

  const events = parseEvents(response.payload);
  expect(events.map((e) => e.type).filter((type) => type !== 'title')).toEqual(['start', 'part', 'part', 'delta', 'delta', 'done']);
  const start = findEvent(events, 'start');
  expect(start).toMatchObject({ title: null, userMessage: { role: 'user', text: 'What is still open?' }, message: { status: 'streaming', parts: [] } });
  expect(events.filter((e) => e.type === 'part').map((e) => e.part)).toMatchObject([
    { type: 'activity', summary: 'List open items', status: 'running' },
    { type: 'activity', summary: 'List open items', status: 'succeeded' },
  ]);

  const done = findEvent(events, 'done').reply;
  const [action] = await t.db.select().from(actions);
  expect(done).toMatchObject({ reply: 'You have two open items.', confirmation: null });
  expect(done.message).toEqual({
    id: start.message.id,
    role: 'assistant',
    status: 'complete',
    error: null,
    createdAt: start.message.createdAt,
    parts: [
      { type: 'activity', id: action!.id, system: 'Fake Records', summary: 'List open items', kind: 'read', status: 'succeeded', error: null },
      { type: 'text', text: 'You have two open items.' },
    ],
  });
  expect(replay(events)).toEqual({ ...done.message, status: 'streaming' });

  const saved = (await t.as(alice).get(`/assistant/conversations/${done.conversationId}`)).json<ConversationDetail>();
  expect(saved.messages).toEqual([start.userMessage, done.message]);
});

it('starts a new text part for each model response', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__no_such_tool', {}, 'Let me look.'), streams("I can't do that."));

  const events = parseEvents((await stream(alice, '/assistant/messages', { text: 'Do something odd' })).payload);
  const { message } = findEvent(events, 'done').reply;
  expect(message.parts).toEqual([
    { type: 'text', text: 'Let me look.' },
    { type: 'text', text: "I can't do that." },
  ]);
  expect(replay(events).parts).toEqual(message.parts);
});

it('drops a response cut off by the length limit, its text too, and tells both the person and the model why', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(cutOff('Here is a very long answer ', 'that was cut'));

  const events = parseEvents((await stream(alice, '/assistant/messages', { text: 'Tell me everything' })).payload);
  const sorry = "Sorry, I couldn't work that out. Could you say it more simply?";
  const { message } = findEvent(events, 'done').reply;
  expect(message).toMatchObject({ status: 'complete', parts: [{ type: 'text', text: sorry }] });
  expect(message.parts).toHaveLength(1);
  expect(replay(events).parts).toEqual(message.parts);

  const [conv] = await t.db.select().from(conversations);
  expect(conv!.messages).toEqual([
    { role: 'user', content: 'Tell me everything' },
    { role: 'assistant', content: sorry },
  ]);
});

it('sends the generated title while the reply is written', async () => {
  await t.close();
  t = await setup({ corsOrigins: [ORIGIN] }, { titler: async () => 'Open items' });
  const alice = await t.signIn('alice');
  t.model.queue(says('Two are open.'));

  const events = parseEvents((await stream(alice, '/assistant/messages', { text: 'What is still open?' })).payload);
  expect(findEvent(events, 'title').title).toBe('Open items');
  expect(findEvent(events, 'done').reply.title).toBe('Open items');
});

it('answers problems found before the stream starts as ordinary JSON errors', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await t.as(alice).post('/assistant/messages', { text: 'Close item 12' })).json<AssistantReply>();

  const cases = [
    { response: await stream(null, '/assistant/messages', { text: 'Hi' }), status: 401, error: 'unauthenticated' },
    { response: await stream(alice, '/assistant/messages', { text: '' }), status: 400, error: 'invalid_request' },
    {
      response: await stream(bob, '/assistant/messages', { text: 'Hi', conversationId: proposed.conversationId }),
      status: 404,
      error: 'conversation_not_found',
    },
    {
      response: await stream(alice, `/assistant/conversations/${proposed.conversationId}/decision`, {
        confirmationId: randomUUID(),
        decision: 'confirm',
      }),
      status: 409,
      error: 'confirmation_not_pending',
    },
  ];
  for (const { response, status, error } of cases) {
    expect(response.statusCode).toBe(status);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.json()).toMatchObject({ error });
  }
});

it('reports a failure after the stream started as an error event, and saves the message as failed', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(fails(new Groq.APIConnectionError({ message: 'network down' })));

  const events = parseEvents((await stream(alice, '/assistant/messages', { text: 'What is open?' })).payload);
  expect(events.map((e) => e.type).filter((type) => type !== 'title')).toEqual(['start', 'error']);
  const message = 'The assistant is unavailable right now. Try again in a moment.';
  expect(findEvent(events, 'error')).toEqual({ type: 'error', error: 'assistant_unavailable', message });

  const [conv] = await t.db.select().from(conversations);
  expect(conv!.lockedUntil).toBeNull();
  expect(conv!.transcript).toMatchObject([
    { role: 'user', text: 'What is open?' },
    { role: 'assistant', status: 'error', error: message, parts: [] },
  ]);
  expect(conv!.messages).toEqual([{ role: 'user', content: 'What is open?' }]);
});

it('streams a decision into the message that proposed the change', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'Exit cleared' }, 'I can close item 12.'));
  const proposed = (await t.as(alice).post('/assistant/messages', { text: 'Close item 12' })).json<AssistantReply>();

  t.model.queue(streams('Done. ', 'Item 12 is closed.'));
  const events = parseEvents(
    (
      await stream(alice, `/assistant/conversations/${proposed.conversationId}/decision`, {
        confirmationId: proposed.confirmation!.id,
        decision: 'confirm',
      })
    ).payload,
  );
  expect(events.map((e) => e.type)).toEqual(['start', 'part', 'part', 'part', 'delta', 'delta', 'done']);
  expect(findEvent(events, 'start')).toMatchObject({ userMessage: null, message: { id: proposed.message.id, status: 'streaming' } });
  expect(events.filter((e) => e.type === 'part').map((e) => e.part)).toMatchObject([
    { type: 'confirmation', status: 'confirmed', changes: [{ status: 'awaiting_confirmation' }] },
    { type: 'confirmation', status: 'confirmed', changes: [{ status: 'running' }] },
    { type: 'confirmation', status: 'confirmed', changes: [{ status: 'succeeded' }] },
  ]);
  const done = findEvent(events, 'done').reply;
  expect(done.message.parts.map((part) => part.type)).toEqual(['text', 'confirmation', 'text']);
  expect(replay(events).parts).toEqual(done.message.parts);
});

async function listen() {
  return t.app.listen({ port: 0, host: '127.0.0.1' });
}

/** Starts a streamed message over real HTTP and reads until `until` has arrived. */
async function streamUntil(address: string, token: string, text: string, until: string) {
  const client = new AbortController();
  const response = await fetch(`${address}/assistant/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, stream: true }),
    signal: client.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes(until)) received += decoder.decode((await reader.read()).value, { stream: true });
  return client;
}

async function settled() {
  let conv: typeof conversations.$inferSelect | undefined;
  await vi.waitFor(async () => {
    [conv] = await t.db.select().from(conversations);
    expect(conv!.lockedUntil).toBeNull();
  });
  return conv!;
}

it('stops when the person stops the reply, keeping the text written so far', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(async (_request, { onText, signal }) => {
    onText?.('Here are the');
    await new Promise((resolve) => signal?.addEventListener('abort', resolve));
    throw new Groq.APIUserAbortError();
  });

  const client = await streamUntil(await listen(), alice, 'List everything', 'event: delta');
  client.abort();

  const conv = await settled();
  const stoppedMessage = conv.transcript[1] as AssistantMessage;
  expect(stoppedMessage).toMatchObject({ status: 'stopped', error: null, parts: [{ type: 'text', text: 'Here are the' }] });
  expect(conv.messages).toEqual([
    { role: 'user', content: 'List everything' },
    { role: 'assistant', content: 'Here are the' },
  ]);

  // Trying again writes the answer afresh, in the same message.
  t.model.queue(says('Here are the open items.'));
  const retried = (await t.as(alice).post(`/assistant/conversations/${conv.id}/retry`, {})).json<AssistantReply>();
  expect(retried.message).toMatchObject({ id: stoppedMessage.id, status: 'complete', parts: [{ type: 'text', text: 'Here are the open items.' }] });
  expect(t.model.requests[1]!.messages.at(-1)).toEqual({ role: 'user', content: 'List everything' });
});

it('lets a lookup that is already running finish when the person stops, and records it', async () => {
  const alice = await t.signIn('alice');
  let finishLookup = () => {};
  t.system.state.lookupRunning = new Promise((resolve) => (finishLookup = resolve));
  t.model.queue(callsTool('fake__list_items', {}));

  const client = await streamUntil(await listen(), alice, 'What is there?', '"status":"running"');
  client.abort();
  await vi.waitFor(
    () =>
      new Promise<void>((resolve, reject) =>
        t.app.server.getConnections((_error, open) => (open === 0 ? resolve() : reject(new Error(`${open} open`)))),
      ),
  );
  finishLookup();

  const conv = await settled();
  expect(await t.db.select({ status: actions.status }).from(actions)).toEqual([{ status: 'succeeded' }]);
  expect(conv.transcript[1]).toMatchObject({ status: 'stopped', parts: [{ type: 'activity', status: 'succeeded' }] });
  expect(conv.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Fire exit blocked') });
  expect(t.model.requests).toHaveLength(1);
});
