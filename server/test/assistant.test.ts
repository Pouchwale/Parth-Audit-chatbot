import { eq } from 'drizzle-orm';
import Groq from 'groq-sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantMessage, AssistantReply, ConfirmationPart, ConversationDetail } from '@shared/api.ts';
import { recoverAfterRestart } from '../src/agent/agent.ts';
import { ModelNotConfigured } from '../src/agent/model.ts';
import { actions, conversations, sessions } from '../src/db/schema.ts';
import { callsTool, callsTools, fails, says, setup } from './helpers.ts';

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

/** The messages the model was given on its nth call. */
function sentToModel(call: number) {
  return t.model.requests[call]!.messages;
}

const error = (message: string) => JSON.stringify({ error: message });

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
  expect(sentToModel(1).at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Fire exit blocked') });
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
  const history = sentToModel(1);
  expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
  expect(history[2]).toMatchObject({ role: 'tool', content: error('The person cancelled this change, so it was not made.') });
});

it('drops a waiting change when the person moves on to something else', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  t.model.queue(says('Okay.'));
  await ask(alice, 'Actually, never mind', proposed.conversationId);
  expect(sentToModel(1).slice(-2)).toMatchObject([
    { role: 'tool', content: error('The person moved on without confirming, so this change was not made.') },
    { role: 'user', content: 'Actually, never mind' },
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
  expect(sentToModel(1).at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Invalid input') });
  expect(await statuses()).toEqual([]);
});

it('only offers and runs the actions on the connector list', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__delete_everything', {}), says("I can't do that."));
  const response = (await ask(alice, 'Delete everything')).json<AssistantReply>();

  expect(response.reply).toBe("I can't do that.");
  expect(t.model.requests[0]!.tools.map((tool) => tool.function?.name)).toEqual(['fake__list_items', 'fake__close_item']);
  expect(sentToModel(1).at(-1)).toMatchObject({ role: 'tool', content: error('There is no tool called fake__delete_everything.') });
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
  expect(sentToModel(1).at(-1)).toMatchObject({ role: 'tool', content: error("Item 99 doesn't exist.") });
});

it('still reports a confirmed change when the model is unavailable afterwards', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  t.model.queue(fails(new Groq.APIConnectionError({ message: 'network down' })));
  const response = await answer(alice, proposed, 'confirm');
  expect(response.statusCode).toBe(200);
  expect(response.json<AssistantReply>().reply).toBe('Done: Close item 12 with the note "done".');
  expect((await answer(alice, proposed, 'confirm')).statusCode).toBe(409);
  expect(t.system.calls).toHaveLength(1);
});

it('reports what happened after an interrupted confirmed run, and never runs it again', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();

  // As if the server restarted after the change ran but before the conversation was saved.
  const [conv] = await t.db.select().from(conversations);
  await t.db.update(conversations).set({ pending: { ...conv!.pending!, claimed: true } });
  await t.db.update(actions).set({ status: 'succeeded' });

  expect((await answer(alice, proposed, 'confirm')).statusCode).toBe(409);
  t.model.queue(says('Item 12 was closed.'));
  await ask(alice, 'Did that work?', proposed.conversationId);
  expect(sentToModel(1).slice(-2)).toMatchObject([
    { role: 'tool', content: 'This change was made.' },
    { role: 'user', content: 'Did that work?' },
  ]);
  expect(t.system.calls).toEqual([]);
});

/** Leaves the conversation as a restart part-way through a request would: changed by it, and still locked. */
async function leftByRestart(change: (conv: typeof conversations.$inferSelect) => void) {
  const [conv] = await t.db.select().from(conversations);
  change(conv!);
  await t.db.update(conversations).set({ ...conv!, lockedUntil: new Date(Date.now() + 60_000) });
}

async function savedMessages(token: string, conversationId: string) {
  return (await t.as(token).get(`/assistant/conversations/${conversationId}`)).json<ConversationDetail>().messages;
}

it('settles a reply cut off by a restart, so it can be retried straight away', async () => {
  const alice = await t.signIn('alice');
  let midReply: typeof conversations.$inferSelect | undefined;
  t.model.queue(async (request, options) => {
    [midReply] = await t.db.select().from(conversations);
    return says('Two items are open.')(request, options);
  });
  const { conversationId } = (await ask(alice, 'What is still open?')).json<AssistantReply>();
  // As if the server stopped while the model was answering.
  await t.db.update(conversations).set(midReply!);
  expect((await ask(alice, 'Hello?', conversationId)).json()).toMatchObject({ error: 'conversation_busy' });

  expect(await recoverAfterRestart(t.db)).toBe(1);
  const [, interrupted] = await savedMessages(alice, conversationId);
  expect(interrupted).toMatchObject({ role: 'assistant', status: 'error', error: 'This reply was interrupted. Try again.', parts: [] });

  t.model.queue(says('Two items are open.'));
  const retried = await t.as(alice).post(`/assistant/conversations/${conversationId}/retry`, {});
  expect(retried.json<AssistantReply>().message).toMatchObject({ id: interrupted!.id, status: 'complete' });
  expect(sentToModel(1)).toEqual([{ role: 'user', content: 'What is still open?' }]);
  expect(await recoverAfterRestart(t.db)).toBe(0);
});

it('after a restart part-way through confirmed changes, tells a change that never started from one that was running', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTools([['fake__close_item', { id: '12', note: 'done' }], ['fake__close_item', { id: '13', note: 'done' }]]));
  const proposed = (await ask(alice, 'Close items 12 and 13')).json<AssistantReply>();
  const card = (message: AssistantMessage) => message.parts.find((part): part is ConfirmationPart => part.type === 'confirmation')!;
  const [first, second] = card(proposed.message).changes.map((change) => change.id);

  // The confirmation was claimed and the first change was being made.
  await leftByRestart((conv) => {
    const message = conv.transcript[1] as AssistantMessage;
    message.status = 'streaming';
    card(message).status = 'confirmed';
    conv.pending!.claimed = true;
  });
  await t.db.update(actions).set({ status: 'running' }).where(eq(actions.id, first!));

  expect(await recoverAfterRestart(t.db)).toBe(1);
  const unknown = 'The run was interrupted, so it is not known whether this change was made. Check the system before trying again.';
  const notMade = 'The run was interrupted before this change started, so it was not made.';
  const log = await t.db.select({ id: actions.id, status: actions.status, error: actions.error }).from(actions);
  expect(log).toEqual(
    expect.arrayContaining([
      { id: first, status: 'failed', error: unknown },
      { id: second, status: 'cancelled', error: notMade },
    ]),
  );
  const [, message] = (await savedMessages(alice, proposed.conversationId)) as AssistantMessage[];
  expect(message).toMatchObject({ status: 'error' });
  expect(card(message!)).toMatchObject({
    status: 'confirmed',
    changes: [
      { id: first, status: 'failed', error: unknown },
      { id: second, status: 'cancelled', error: notMade },
    ],
  });

  t.model.queue(says('Item 12 may have been closed. Item 13 was not.'));
  expect((await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/retry`, {})).statusCode).toBe(200);
  expect(sentToModel(1).slice(-2)).toMatchObject([
    { role: 'tool', content: error(unknown) },
    { role: 'tool', content: error(notMade) },
  ]);
  expect(t.system.calls).toEqual([]);
});

it('keeps a confirmation open when a restart cut off the answer to it before it took effect', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }, 'I can close item 12.'));
  const proposed = (await ask(alice, 'Close item 12')).json<AssistantReply>();
  await leftByRestart((conv) => {
    (conv.transcript[1] as AssistantMessage).status = 'streaming';
  });

  expect(await recoverAfterRestart(t.db)).toBe(1);
  expect((await savedMessages(alice, proposed.conversationId))[1]).toEqual(proposed.message);
  const retried = await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/retry`, {});
  expect(retried.statusCode).toBe(409);
  expect(retried.json()).toMatchObject({ error: 'nothing_to_retry' });

  t.model.queue(says('Item 12 is closed.'));
  expect((await answer(alice, proposed, 'confirm')).json<AssistantReply>().reply).toBe('Item 12 is closed.');
  expect(sentToModel(1).map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  expect(t.system.calls).toHaveLength(1);
});

it('explains when the assistant has no API key yet', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(fails(new ModelNotConfigured('GROQ_API_KEY is not set')));

  const response = await ask(alice, 'What is open?');
  expect(response.statusCode).toBe(503);
  expect(response.json()).toMatchObject({ error: 'assistant_not_configured' });
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
