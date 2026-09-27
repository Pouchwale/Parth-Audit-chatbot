import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantReply, Capabilities, ConversationDetail, ConversationSummary } from '@shared/api.ts';
import type { Titler } from '../src/agent/titles.ts';
import { actions, conversations } from '../src/db/schema.ts';
import { callsTool, says, setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

async function ask(token: string, text: string, reply: string) {
  t.model.queue(says(reply));
  return (await t.as(token).post('/assistant/messages', { text })).json<AssistantReply>();
}

async function list(token: string) {
  return (await t.as(token).get('/assistant/conversations')).json<ConversationSummary[]>();
}

it("lists a person's own conversations, newest first, with a preview of the latest message", async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const first = await ask(alice, 'What is still open?', 'Two items are open:\n- **12** Fire exit\n- **13** Label');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const second = (await t.as(alice).post('/assistant/messages', { text: 'Close item 12' })).json<AssistantReply>();

  expect(await list(alice)).toMatchObject([
    { id: second.conversationId, title: 'Close item 12', preview: 'Close item 12' },
    { id: first.conversationId, title: 'What is still open?', preview: 'Two items are open: 12 Fire exit 13 Label' },
  ]);
  expect(await list(bob)).toEqual([]);
});

it('shows a conversation in full to its owner only', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const reply = await ask(alice, 'Hi', 'Hello.');

  const detail = (await t.as(alice).get(`/assistant/conversations/${reply.conversationId}`)).json<ConversationDetail>();
  expect(detail).toMatchObject({ id: reply.conversationId, title: 'Hi', messages: [{ role: 'user', text: 'Hi' }, reply.message] });
  const other = await t.as(bob).get(`/assistant/conversations/${reply.conversationId}`);
  expect(other.statusCode).toBe(404);
  expect(other.json()).toMatchObject({ error: 'conversation_not_found' });
});

it('renames a conversation', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const reply = await ask(alice, 'Hi', 'Hello.');
  const url = `/assistant/conversations/${reply.conversationId}`;

  const renamed = await t.as(alice).patch(url, { title: '  Greetings  ' });
  expect(renamed.json<ConversationSummary>()).toMatchObject({ id: reply.conversationId, title: 'Greetings', preview: 'Hello.' });
  expect((await list(alice))[0]!.title).toBe('Greetings');
  expect((await t.as(alice).patch(url, { title: ' ' })).statusCode).toBe(400);
  expect((await t.as(alice).patch(url, { title: 'x'.repeat(101) })).statusCode).toBe(400);
  expect((await t.as(bob).patch(url, { title: 'Mine now' })).statusCode).toBe(404);
});

it('deletes conversations but keeps what was done in the audit log', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  t.model.queue(callsTool('fake__list_items', {}), says('Two items.'));
  const looked = (await t.as(alice).post('/assistant/messages', { text: 'What is there?' })).json<AssistantReply>();
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await t.as(alice).post('/assistant/messages', { text: 'Close item 12' })).json<AssistantReply>();
  const bobs = await ask(bob, 'Hi', 'Hello.');

  expect((await t.as(bob).delete(`/assistant/conversations/${looked.conversationId}`)).statusCode).toBe(404);
  expect((await t.as(alice).delete(`/assistant/conversations/${looked.conversationId}`)).statusCode).toBe(204);
  expect((await t.as(alice).get(`/assistant/conversations/${looked.conversationId}`)).statusCode).toBe(404);
  expect((await list(alice)).map((c) => c.id)).toEqual([proposed.conversationId]);

  expect((await t.as(alice).delete('/assistant/conversations')).statusCode).toBe(204);
  expect(await list(alice)).toEqual([]);
  expect((await list(bob)).map((c) => c.id)).toEqual([bobs.conversationId]);

  const log = await t.db.select({ action: actions.action, status: actions.status }).from(actions).orderBy(actions.createdAt);
  expect(log).toEqual([
    { action: 'list_items', status: 'succeeded' },
    { action: 'close_item', status: 'cancelled' },
  ]);
  expect((await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/decision`, {
    confirmationId: proposed.confirmation!.id,
    decision: 'confirm',
  })).statusCode).toBe(404);
  expect(t.system.calls).toHaveLength(1);
});

it('refuses to rename or delete a conversation while a request is working on it', async () => {
  const alice = await t.signIn('alice');
  const reply = await ask(alice, 'Hi', 'Hello.');
  await t.db.update(conversations).set({ lockedUntil: new Date(Date.now() + 60_000) });
  const url = `/assistant/conversations/${reply.conversationId}`;

  for (const response of [await t.as(alice).patch(url, { title: 'New' }), await t.as(alice).delete(url), await t.as(alice).delete('/assistant/conversations')]) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'conversation_busy' });
  }
  expect(await list(alice)).toMatchObject([{ id: reply.conversationId, title: 'Hi' }]);
});

it('names a new conversation once, with the generated title cleaned up', async () => {
  const requests: string[] = [];
  const titler: Titler = async (firstMessage) => {
    requests.push(firstMessage);
    return '"Open audit items."';
  };
  await t.close();
  t = await setup({}, { titler });
  const alice = await t.signIn('alice');

  const first = await ask(alice, 'What is still open?', 'Two items.');
  expect(first.title).toBe('Open audit items');
  t.model.queue(says('Anything else?'));
  const second = (await t.as(alice).post('/assistant/messages', { text: 'Thanks', conversationId: first.conversationId })).json<AssistantReply>();
  expect(second.title).toBe('Open audit items');
  expect((await list(alice))[0]!.title).toBe('Open audit items');
  expect(requests).toEqual(['What is still open?']);
  expect(t.model.requests).toHaveLength(2);
});

it('falls back to the start of the first message when naming fails', async () => {
  await t.close();
  t = await setup({}, { titler: async () => Promise.reject(new Error('Groq is down')) });
  const alice = await t.signIn('alice');

  const reply = await ask(alice, 'Please close every finding in warehouse B that was fixed last week', 'Which ones?');
  expect(reply.reply).toBe('Which ones?');
  expect(reply.title).toBe('Please close every finding in warehouse…');
  expect((await list(alice))[0]!.title).toBe('Please close every finding in warehouse…');
});

it('lists what each connected system can do', async () => {
  const alice = await t.signIn('alice');
  const response = await t.as(alice).get('/assistant/capabilities');
  expect(response.json<Capabilities>()).toEqual({
    systems: [{ name: 'Fake Records', description: 'A test system with items.', examples: ['What is open?', 'Close item 12'] }],
  });
  expect((await t.app.inject({ method: 'GET', url: '/assistant/capabilities' })).statusCode).toBe(401);
});

it('lets the web app rename and delete from another origin', async () => {
  await t.close();
  t = await setup({ corsOrigins: ['http://localhost:8081'] });
  const preflight = await t.app.inject({
    method: 'OPTIONS',
    url: '/assistant/conversations/00000000-0000-4000-8000-000000000000',
    headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'DELETE' },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers['access-control-allow-methods']).toContain('PATCH');
  expect(preflight.headers['access-control-allow-methods']).toContain('DELETE');
});
