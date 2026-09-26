import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantReply } from '@shared/api.ts';
import { actions, sessions } from '../src/db/schema.ts';
import { callsTool, fails, says, setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

async function ask(token: string, text: string, conversationId?: string) {
  return t.as(token).post('/assistant/messages', { text, ...(conversationId ? { conversationId } : {}) });
}

async function answer(token: string, reply: AssistantReply, decision: 'confirm' | 'cancel') {
  return t.as(token).post(`/assistant/conversations/${reply.conversationId}/decision`, {
    confirmationId: reply.confirmation!.id,
    decision,
  });
}

async function statuses() {
  return (await t.db.select({ status: actions.status }).from(actions)).map((row) => row.status);
}

it('runs a lookup straight away and reports back', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__list_items', { status: 'open' }), says('You have two open items.'));

  const response = await ask(alice, 'What is still open?');
  expect(response.statusCode).toBe(200);
  expect(response.json<AssistantReply>()).toMatchObject({ reply: 'You have two open items.', confirmation: null });

  expect(t.system.calls).toEqual([{ action: 'list_items', credentials: { token: 'token-alice' }, input: { status: 'open' } }]);
  expect(await t.db.select().from(actions)).toMatchObject([
    { action: 'list_items', kind: 'read', status: 'succeeded', summary: 'List open items', request: 'What is still open?' },
  ]);
  expect(JSON.stringify(t.model.requests[1]!.messages.at(-1))).toContain('Fire exit blocked');
});

it('asks before changing anything, then runs exactly what was confirmed, once', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'Exit cleared' }, 'I can close item 12.'));

  const proposed = (await ask(alice, 'Close the fire exit finding, it is cleared')).json<AssistantReply>();
  expect(proposed.reply).toBe('I can close item 12.');
  expect(proposed.confirmation?.changes).toEqual([{ system: 'Fake Records', summary: 'Close item 12 with the note "Exit cleared"' }]);
  expect(t.system.calls).toEqual([]);
  expect(await statuses()).toEqual(['awaiting_confirmation']);

  t.model.queue(says('Done. Item 12 is closed.'));
  const confirmed = await answer(alice, proposed, 'confirm');
  expect(confirmed.json<AssistantReply>()).toMatchObject({ reply: 'Done. Item 12 is closed.', confirmation: null });
  expect(t.system.calls).toEqual([{ action: 'close_item', credentials: { token: 'token-alice' }, input: { id: '12', note: 'Exit cleared' } }]);
  expect(t.system.items.get('12')?.status).toBe('closed');
  expect(await statuses()).toEqual(['succeeded']);

  expect((await answer(alice, proposed, 'confirm')).statusCode).toBe(409);
  expect(t.system.calls).toHaveLength(1);
});

it('changes nothing when the person cancels, and tells the model so', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  const cancelled = await answer(alice, proposed, 'cancel');
  expect(cancelled.json<AssistantReply>().reply).toBe("Okay, I didn't change anything.");
  expect(t.system.calls).toEqual([]);
  expect(await statuses()).toEqual(['cancelled']);
  expect(t.model.requests).toHaveLength(1);

  t.model.queue(says('Anything else?'));
  await ask(alice, 'Thanks', proposed.conversationId);
  const history = t.model.requests[1]!.messages;
  expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
  expect(history[2]!.content).toMatchObject([{ type: 'tool_result', is_error: true }]);
});

it('drops a waiting change when the person moves on to something else', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  t.model.queue(says('Okay.'));
  await ask(alice, 'Actually, never mind', proposed.conversationId);
  expect(t.model.requests[1]!.messages.at(-1)!.content).toMatchObject([
    { type: 'tool_result', is_error: true },
    { type: 'text', text: 'Actually, never mind' },
  ]);
  expect(t.system.calls).toEqual([]);
  expect(await statuses()).toEqual(['cancelled']);
  expect((await answer(alice, proposed, 'confirm')).statusCode).toBe(409);
});

it('never runs a change confirmed after it expired', async () => {
  await t.close();
  t = await setup({ confirmationTtlMs: 1 });
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();
  await new Promise((resolve) => setTimeout(resolve, 10));

  const late = await answer(alice, proposed, 'confirm');
  expect(late.json<AssistantReply>().reply).toContain('expired');
  expect(t.system.calls).toEqual([]);
  expect(await statuses()).toEqual(['cancelled']);
});

it('sends invalid tool input back to the model instead of running it', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: 12 }), says('Which item did you mean?'));

  const response = (await ask(alice, 'Close it')).json<AssistantReply>();
  expect(response).toMatchObject({ reply: 'Which item did you mean?', confirmation: null });
  expect(t.model.requests[1]!.messages.at(-1)!.content).toMatchObject([{ type: 'tool_result', is_error: true }]);
  expect(await statuses()).toEqual([]);
});

it('only offers and runs the actions on the connector list', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__delete_everything', {}), says("I can't do that."));
  const response = (await ask(alice, 'Delete everything')).json<AssistantReply>();

  expect(response.reply).toBe("I can't do that.");
  expect(t.model.requests[0]!.tools.map((tool) => tool.name)).toEqual(['fake__list_items', 'fake__close_item']);
  expect(t.model.requests[1]!.messages.at(-1)!.content).toMatchObject([{ type: 'tool_result', is_error: true }]);
  expect(t.system.calls).toEqual([]);
});

it("won't let one person answer another person's confirmation", async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  expect((await answer(bob, proposed, 'confirm')).statusCode).toBe(404);
  expect(t.system.calls).toEqual([]);
});

it('reports a failed change and records why', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '99', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 99')).json<AssistantReply>();

  t.model.queue(says("Item 99 doesn't exist, so nothing was closed."));
  const response = (await answer(alice, proposed, 'confirm')).json<AssistantReply>();
  expect(response.reply).toBe("Item 99 doesn't exist, so nothing was closed.");
  expect(await t.db.select().from(actions)).toMatchObject([{ status: 'failed', error: "Item 99 doesn't exist." }]);
  expect(t.model.requests[1]!.messages.at(-1)!.content).toMatchObject([
    { type: 'tool_result', is_error: true, content: "Item 99 doesn't exist." },
  ]);
});

it('still reports a confirmed change when the model is unavailable afterwards', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  t.model.queue(fails(new Anthropic.APIConnectionError({ message: 'network down' })));
  const response = await answer(alice, proposed, 'confirm');
  expect(response.statusCode).toBe(200);
  expect(response.json<AssistantReply>().reply).toBe('Done: Close item 12 with the note "done".');
  expect((await answer(alice, proposed, 'confirm')).statusCode).toBe(409);
  expect(t.system.calls).toHaveLength(1);
});

it('signs the person out when the connected system stops accepting their sign-in', async () => {
  const alice = await t.signIn('alice');
  t.system.state.acceptsSignIn = false;
  t.model.queue(callsTool('fake__list_items', {}));

  const response = await ask(alice, 'What is open?');
  expect(response.statusCode).toBe(401);
  expect(response.json()).toMatchObject({ error: 'session_expired' });
  expect((await t.as(alice).get('/me')).statusCode).toBe(401);
  const [session] = await t.db.select().from(sessions).where(eq(sessions.endReason, 'upstream_signed_out'));
  expect(session).toBeDefined();
});
