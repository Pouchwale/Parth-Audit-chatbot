import { sql } from 'drizzle-orm';
import Groq from 'groq-sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantMessage, AssistantReply, ConfirmationPart, ConversationDetail } from '@shared/api.ts';
import { actions } from '../src/db/schema.ts';
import { callsTool, fails, says, setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

async function ask(token: string, text: string, conversationId?: string) {
  return (await t.as(token).post('/assistant/messages', { text, ...(conversationId ? { conversationId } : {}) })).json<AssistantReply>();
}

async function answer(token: string, reply: AssistantReply, decision: 'confirm' | 'cancel') {
  return (
    await t.as(token).post(`/assistant/conversations/${reply.conversationId}/decision`, { confirmationId: reply.confirmation!.id, decision })
  ).json<AssistantReply>();
}

async function transcript(token: string, conversationId: string) {
  return (await t.as(token).get(`/assistant/conversations/${conversationId}`)).json<ConversationDetail>().messages;
}

function card(message: AssistantMessage): ConfirmationPart {
  const part = message.parts.find((p) => p.type === 'confirmation');
  if (!part) throw new Error('The message has no confirmation card');
  return part;
}

async function propose(token: string) {
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'Exit cleared' }, 'I can close item 12.'));
  return ask(token, 'Close item 12, the exit is cleared');
}

it('shows proposed changes as a card waiting for confirmation', async () => {
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);

  const [action] = await t.db.select().from(actions);
  expect(proposed.message).toMatchObject({ status: 'complete', error: null });
  expect(proposed.message.parts).toEqual([
    { type: 'text', text: 'I can close item 12.' },
    {
      type: 'confirmation',
      id: proposed.confirmation!.id,
      expiresAt: proposed.confirmation!.expiresAt,
      status: 'pending',
      changes: [
        {
          id: action!.id,
          system: 'Fake Records',
          summary: 'Close item 12 with the note "Exit cleared"',
          status: 'awaiting_confirmation',
          error: null,
        },
      ],
    },
  ]);
});

it('continues the same message when the person confirms, without adding a message of theirs', async () => {
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);

  t.model.queue(says('Done. Item 12 is closed.'));
  const confirmed = await answer(alice, proposed, 'confirm');
  expect(confirmed.message.id).toBe(proposed.message.id);
  expect(confirmed.message.status).toBe('complete');
  expect(confirmed.message.parts).toMatchObject([
    { type: 'text', text: 'I can close item 12.' },
    { type: 'confirmation', status: 'confirmed', changes: [{ status: 'succeeded', error: null }] },
    { type: 'text', text: 'Done. Item 12 is closed.' },
  ]);
  expect(await transcript(alice, proposed.conversationId)).toEqual([expect.objectContaining({ role: 'user' }), confirmed.message]);
});

it('shows a change that failed when it ran', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '99', note: 'done' }));
  const proposed = await ask(alice, 'Close item 99');

  t.model.queue(says("Item 99 doesn't exist."));
  const confirmed = await answer(alice, proposed, 'confirm');
  expect(card(confirmed.message)).toMatchObject({ status: 'confirmed', changes: [{ status: 'failed', error: "Item 99 doesn't exist." }] });
});

it('marks the card cancelled when the person cancels, and adds nothing else', async () => {
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);

  const cancelled = await answer(alice, proposed, 'cancel');
  expect(cancelled.message.id).toBe(proposed.message.id);
  expect(cancelled.message.parts).toHaveLength(2);
  expect(card(cancelled.message)).toMatchObject({ status: 'cancelled', changes: [{ status: 'cancelled' }] });
  expect(await transcript(alice, proposed.conversationId)).toHaveLength(2);
});

it('marks the card expired when it was confirmed too late', async () => {
  await t.close();
  t = await setup({ confirmationTtlMs: 1 });
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const late = await answer(alice, proposed, 'confirm');
  expect(card(late.message)).toMatchObject({ status: 'expired', changes: [{ status: 'cancelled' }] });
  expect(t.system.calls).toEqual([]);
});

it('marks a waiting card cancelled when the person moves on', async () => {
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);

  t.model.queue(says('Okay.'));
  await ask(alice, 'Actually, never mind', proposed.conversationId);
  const [, first, , second] = (await transcript(alice, proposed.conversationId)) as AssistantMessage[];
  expect(card(first!)).toMatchObject({ status: 'cancelled', changes: [{ status: 'cancelled' }] });
  expect(second).toMatchObject({ status: 'complete', parts: [{ type: 'text', text: 'Okay.' }] });
});

it('keeps the request when the model fails, and a retry continues the same message', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__list_items', {}), fails(new Groq.APIConnectionError({ message: 'network down' })));

  const failed = await t.as(alice).post('/assistant/messages', { text: 'What is there?' });
  expect(failed.statusCode).toBe(503);
  expect(failed.json()).toMatchObject({ error: 'assistant_unavailable' });
  const [conversation] = (await t.as(alice).get('/assistant/conversations')).json<{ id: string }[]>();
  const [, broken] = (await transcript(alice, conversation!.id)) as AssistantMessage[];
  expect(broken).toMatchObject({
    status: 'error',
    error: 'The assistant is unavailable right now. Try again in a moment.',
    parts: [{ type: 'activity', status: 'succeeded' }],
  });

  t.model.queue(says('There are two items.'));
  const retried = await t.as(alice).post(`/assistant/conversations/${conversation!.id}/retry`, {});
  expect(retried.statusCode).toBe(200);
  const reply = retried.json<AssistantReply>();
  expect(reply).toMatchObject({ reply: 'There are two items.', title: 'What is there?' });
  expect(reply.message).toMatchObject({
    id: broken!.id,
    status: 'complete',
    error: null,
    parts: [{ type: 'activity', status: 'succeeded' }, { type: 'text', text: 'There are two items.' }],
  });
  expect(t.model.requests[2]!.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Fire exit blocked') });
  expect(await transcript(alice, conversation!.id)).toHaveLength(2);
});

it('drops the text of a response that failed part-way, so a retry does not repeat it', async () => {
  const alice = await t.signIn('alice');
  t.model.queue((_request, { onText }) => {
    onText?.('Two items are');
    throw new Groq.APIConnectionError({ message: 'The connection to Groq was lost.' });
  });
  expect((await t.as(alice).post('/assistant/messages', { text: 'What is there?' })).statusCode).toBe(503);
  const [conversation] = (await t.as(alice).get('/assistant/conversations')).json<{ id: string }[]>();
  expect((await transcript(alice, conversation!.id))[1]).toMatchObject({ status: 'error', parts: [] });

  t.model.queue(says('Two items are open.'));
  const retried = (await t.as(alice).post(`/assistant/conversations/${conversation!.id}/retry`, {})).json<AssistantReply>();
  expect(retried.message.parts).toEqual([{ type: 'text', text: 'Two items are open.' }]);
});

it('can retry the report after a confirmed change when the model failed', async () => {
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);

  t.model.queue(fails(new Groq.APIConnectionError({ message: 'network down' })));
  const confirmed = await answer(alice, proposed, 'confirm');
  expect(confirmed.message).toMatchObject({ status: 'error', parts: [{}, { type: 'confirmation', changes: [{ status: 'succeeded' }] }] });

  t.model.queue(says('Item 12 is closed.'));
  const retried = (await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/retry`, {})).json<AssistantReply>();
  expect(retried.message).toMatchObject({ id: proposed.message.id, status: 'complete' });
  expect(retried.message.parts.at(-1)).toEqual({ type: 'text', text: 'Item 12 is closed.' });
  expect(t.system.calls).toHaveLength(1);
});

it('keeps the card open when recording a cancellation fails, and only an answer continues it', async () => {
  const alice = await t.signIn('alice');
  const proposed = await propose(alice);

  // The action log refuses the cancellation, as a database failure part-way through would.
  await t.db.execute(sql`alter table actions add constraint refuse_cancel check (status <> 'cancelled')`);
  const failed = await t
    .as(alice)
    .post(`/assistant/conversations/${proposed.conversationId}/decision`, { confirmationId: proposed.confirmation!.id, decision: 'cancel' })
    .finally(() => t.db.execute(sql`alter table actions drop constraint refuse_cancel`));
  expect(failed.statusCode).toBe(500);
  const [, message] = (await transcript(alice, proposed.conversationId)) as AssistantMessage[];
  expect(message).toMatchObject({ id: proposed.message.id, status: 'error' });
  expect(card(message!)).toMatchObject({ status: 'pending', changes: [{ status: 'awaiting_confirmation' }] });

  const retried = await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/retry`, {});
  expect(retried.statusCode).toBe(409);
  expect(retried.json()).toEqual({ error: 'nothing_to_retry', message: 'That reply is waiting for you to confirm or cancel.' });

  t.model.queue(says('Done. Item 12 is closed.'));
  const confirmed = await answer(alice, proposed, 'confirm');
  expect(confirmed.message).toMatchObject({ id: proposed.message.id, status: 'complete', error: null });
  expect(t.model.requests[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  expect(t.system.calls).toHaveLength(1);
});

it('only retries a reply that failed or was stopped', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  t.model.queue(says('Hello.'));
  const done = await ask(alice, 'Hi');

  const again = await t.as(alice).post(`/assistant/conversations/${done.conversationId}/retry`, {});
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ error: 'nothing_to_retry' });
  expect((await t.as(bob).post(`/assistant/conversations/${done.conversationId}/retry`, {})).statusCode).toBe(404);
  expect(t.model.requests).toHaveLength(1);
});
