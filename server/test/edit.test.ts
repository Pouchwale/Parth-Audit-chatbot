// Editing a message the person sent: the words change, everything after it leaves the conversation, and the turn runs
// again. What was already done stays on record.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantReply, ConversationDetail, ConversationExport, FileInfo, UserMessage, WeeklyReport } from '@shared/api.ts';
import { weekStartOf } from '../src/admin/weekly.ts';
import { actions, conversationExports, conversations, messageEvents } from '../src/db/schema.ts';
import { callsTool, findEvent, parseEvents, says, setup, streams } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

const EDITED = 'The person changed their message, so this change was not made.';

async function ask(token: string, text: string, conversationId?: string, attachments?: string[]) {
  const response = await t.as(token).post('/assistant/messages', { text, ...(conversationId ? { conversationId } : {}), ...(attachments ? { attachments } : {}) });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<AssistantReply>();
}

function edit(token: string, conversationId: string, messageId: string, body: object) {
  return t.as(token).post(`/assistant/conversations/${conversationId}/messages/${messageId}/edit`, body);
}

async function saved(token: string, conversationId: string) {
  return (await t.as(token).get(`/assistant/conversations/${conversationId}`)).json<ConversationDetail>().messages;
}

/** The person's message that a reply answered: the one before it in the saved conversation. */
async function askedBy(token: string, reply: AssistantReply): Promise<UserMessage> {
  const messages = await saved(token, reply.conversationId);
  const index = messages.findIndex((m) => m.id === reply.message.id);
  return messages[index - 1] as UserMessage;
}

async function upload(token: string, name: string, body: string): Promise<FileInfo> {
  const response = await t.app.inject({
    method: 'POST',
    url: `/assistant/files?${new URLSearchParams({ name })}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    payload: body,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<FileInfo>();
}

async function log() {
  return t.db.select({ action: actions.action, status: actions.status, error: actions.error, request: actions.request, summary: actions.summary }).from(actions).orderBy(actions.createdAt);
}

it('changes the words of a message and answers it again, with everything after it gone', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__list_items', { status: 'open' }), says('Two items are open.'));
  const first = await ask(alice, 'What is open?');
  t.model.queue(says('You are welcome.'));
  const second = await ask(alice, 'Thanks', first.conversationId);
  const asked = await askedBy(alice, first);
  expect(await saved(alice, first.conversationId)).toHaveLength(4);

  t.model.queue(callsTool('fake__list_items', { status: 'closed' }), says('Nothing is closed.'));
  const response = await edit(alice, first.conversationId, asked.id, { text: 'What is closed?' });
  expect(response.statusCode, response.body).toBe(200);
  const reply = response.json<AssistantReply>();
  expect(reply).toMatchObject({ conversationId: first.conversationId, reply: 'Nothing is closed.', confirmation: null });
  expect(reply.message.id).not.toBe(first.message.id);

  // The message kept its id and place, with the new words; the old reply and the later exchange are gone.
  const messages = await saved(alice, first.conversationId);
  expect(messages.map((m) => m.id)).toEqual([asked.id, reply.message.id]);
  expect(messages[0]).toMatchObject({ role: 'user', text: 'What is closed?', createdAt: asked.createdAt, editedAt: expect.stringMatching(/^\d{4}-/) });
  expect(messages.map((m) => m.id)).not.toContain(second.message.id);
  // The model was given the edited message as the whole conversation, and the lookup it asked for ran.
  expect(t.model.requests.at(-2)!.messages).toEqual([{ role: 'user', content: 'What is closed?' }]);
  expect(t.system.calls.map((call) => call.input)).toEqual([{ status: 'open' }, { status: 'closed' }]);
  // Every message the person sent is counted, the edit too.
  expect(await t.db.$count(messageEvents)).toBe(3);
  // The lookups made before the edit stay on record, with the words that asked for them then.
  expect(await log()).toMatchObject([
    { action: 'list_items', status: 'succeeded', request: 'What is open?' },
    { action: 'list_items', status: 'succeeded', request: 'What is closed?' },
  ]);
});

it('streams an edit like a message, with the start event carrying the edited message as saved', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(says('Hello Alice.'));
  const first = await ask(alice, 'Hello');
  const asked = await askedBy(alice, first);

  t.model.queue(callsTool('fake__list_items', {}), streams('Two items ', 'are open.'));
  const response = await edit(alice, first.conversationId, asked.id, { text: 'What is open?', stream: true });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
  const events = parseEvents(response.payload);
  expect(events.map((e) => e.type)).toEqual(['start', 'part', 'part', 'delta', 'delta', 'done']);
  const start = findEvent(events, 'start');
  expect(start.userMessage).toMatchObject({ id: asked.id, role: 'user', text: 'What is open?', createdAt: asked.createdAt, editedAt: expect.any(String) });
  expect(start.message).toMatchObject({ role: 'assistant', status: 'streaming', parts: [] });
  const done = findEvent(events, 'done').reply;
  expect(done.reply).toBe('Two items are open.');
  expect(await saved(alice, first.conversationId)).toEqual([start.userMessage, done.message]);
});

it('keeps the files on the message unless the edit says which files it carries', async () => {
  const alice = await t.signIn('alice');
  const readings = await upload(alice, 'readings.txt', 'Viscosity 19, 20, 21');
  const photo = await upload(alice, 'notes.txt', 'Line 3 clear');
  t.model.queue(says('Noted.'));
  const first = await ask(alice, 'Here are the readings', undefined, [readings.id]);
  const asked = await askedBy(alice, first);
  expect(asked.attachments?.map((f) => f.id)).toEqual([readings.id]);

  // Not saying anything about files keeps them, and the model still reads them.
  t.model.queue(says('Three readings.'));
  const kept = (await edit(alice, first.conversationId, asked.id, { text: 'How many readings are there?' })).json<AssistantReply>();
  expect((await askedBy(alice, kept)).attachments?.map((f) => f.id)).toEqual([readings.id]);
  expect(t.model.requests.at(-1)!.messages[0]!.content).toContain('Viscosity 19, 20, 21');

  // Naming the files replaces them: another upload, or none at all.
  t.model.queue(says('Line 3 is clear.'));
  const swapped = (await edit(alice, first.conversationId, asked.id, { text: 'What do the notes say?', attachments: [photo.id] })).json<AssistantReply>();
  expect((await askedBy(alice, swapped)).attachments?.map((f) => f.id)).toEqual([photo.id]);
  expect(t.model.requests.at(-1)!.messages[0]!.content).toContain('Line 3 clear');
  expect(t.model.requests.at(-1)!.messages[0]!.content).not.toContain('Viscosity');
  t.model.queue(says('Okay.'));
  const none = (await edit(alice, first.conversationId, asked.id, { text: 'Never mind', attachments: [] })).json<AssistantReply>();
  expect((await askedBy(alice, none)).attachments).toEqual([]);
  expect(t.model.requests.at(-1)!.messages).toEqual([{ role: 'user', content: 'Never mind' }]);
});

it('cancels a confirmation still waiting after the edited message, so it can never be confirmed', async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }, 'I can close item 12.'));
  const proposed = await ask(alice, 'Close item 12');
  const asked = await askedBy(alice, proposed);

  t.model.queue(callsTool('fake__close_item', { id: '13', note: 'done' }, 'I can close item 13.'));
  const edited = (await edit(alice, proposed.conversationId, asked.id, { text: 'Close item 13' })).json<AssistantReply>();
  expect(edited.confirmation?.changes).toEqual([{ system: 'Fake Records', summary: 'Close item 13 with the note "done"' }]);

  // The old card is gone from the conversation, and its change is on record as not made.
  const old = await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/decision`, { confirmationId: proposed.confirmation!.id, decision: 'confirm' });
  expect(old.statusCode).toBe(409);
  expect(await log()).toMatchObject([
    { action: 'close_item', status: 'cancelled', error: EDITED, request: 'Close item 12', summary: 'Close item 12 with the note "done"' },
    { action: 'close_item', status: 'awaiting_confirmation', request: 'Close item 13' },
  ]);
  expect(t.system.calls).toEqual([]);
  expect(t.system.items.get('12')?.status).toBe('open');

  // The new card works as any other.
  t.model.queue(says('Done. Item 13 is closed.'));
  await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/decision`, { confirmationId: edited.confirmation!.id, decision: 'confirm' });
  expect(t.system.items.get('13')?.status).toBe('closed');
});

it("refuses someone else's conversation or message, a busy conversation, and empty or too long words", async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  t.model.queue(says('Hello Alice.'));
  const first = await ask(alice, 'Hello');
  const asked = await askedBy(alice, first);

  const cases: [response: Awaited<ReturnType<typeof edit>>, status: number, error: string][] = [
    [await edit(bob, first.conversationId, asked.id, { text: 'Hi' }), 404, 'conversation_not_found'],
    [await edit(alice, first.conversationId, randomUUID(), { text: 'Hi' }), 404, 'message_not_found'],
    // Only a message the person wrote.
    [await edit(alice, first.conversationId, first.message.id, { text: 'Hi' }), 404, 'message_not_found'],
    [await edit(alice, first.conversationId, asked.id, { text: '   ' }), 400, 'invalid_request'],
    [await edit(alice, first.conversationId, asked.id, { text: 'x'.repeat(4001) }), 400, 'invalid_request'],
    [await edit(alice, first.conversationId, 'not-a-uuid', { text: 'Hi' }), 400, 'invalid_request'],
  ];
  for (const [response, status, error] of cases) {
    expect(response.statusCode, response.body).toBe(status);
    expect(response.json()).toMatchObject({ error });
  }

  // While a reply in the conversation is still being written.
  await t.db.update(conversations).set({ lockedUntil: new Date(Date.now() + 60_000) }).where(eq(conversations.id, first.conversationId));
  const busy = await edit(alice, first.conversationId, asked.id, { text: 'Hi again' });
  expect(busy.statusCode).toBe(409);
  expect(busy.json()).toMatchObject({ error: 'conversation_busy' });

  // Nothing changed.
  expect((await saved(alice, first.conversationId))[0]).toMatchObject({ text: 'Hello' });
  expect(t.model.requests).toHaveLength(1);
});

it('never changes the record of what was done: the action log, the download record and the weekly report', async () => {
  const alice = await t.signIn('alice');
  const admin = await t.signIn('admin');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'Exit cleared' }));
  const proposed = await ask(alice, 'Close the fire exit finding');
  t.model.queue(says('Done. Item 12 is closed.'));
  await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/decision`, { confirmationId: proposed.confirmation!.id, decision: 'confirm' });
  const asked = await askedBy(alice, proposed);
  const download = (await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/export`, { timeZone: 'UTC' })).json<ConversationExport>();
  expect(download.content).toContain('> Close the fire exit finding');
  expect(download.content).toContain('Close item 12 with the note "Exit cleared" (Fake Records) — succeeded');
  const week = weekStartOf(new Date(), 'UTC');
  const reportBefore = (await t.as(admin).get(`/admin/reports/weekly/${week}`)).json<WeeklyReport>();
  const aliceBefore = reportBefore.users.find((u) => u.user.username === 'alice')!;
  expect(aliceBefore).toMatchObject({ messages: 1, changesConfirmed: 1, exports: 1 });
  const logBefore = await t.db.select().from(actions);
  const exportsBefore = await t.db.select().from(conversationExports);

  t.model.queue(says('Item 12 is closed already.'));
  const edited = (await edit(alice, proposed.conversationId, asked.id, { text: 'Is the fire exit finding closed?' })).json<AssistantReply>();
  expect(edited.reply).toBe('Item 12 is closed already.');

  // The change stays made, and every record of it stays as it was, with the words that asked for it then.
  expect(t.system.items.get('12')?.status).toBe('closed');
  expect(await t.db.select().from(actions)).toEqual(logBefore);
  expect(logBefore).toMatchObject([{ action: 'close_item', status: 'succeeded', request: 'Close the fire exit finding' }]);
  expect(await t.db.select().from(conversationExports)).toEqual(exportsBefore);
  const reportAfter = (await t.as(admin).get(`/admin/reports/weekly/${week}`)).json<WeeklyReport>();
  const aliceAfter = reportAfter.users.find((u) => u.user.username === 'alice')!;
  expect(aliceAfter).toMatchObject({ messages: 2, changesConfirmed: 1, changesCancelled: 0, exports: 1 });
  // The conversation itself now reads as edited, and a new download says so.
  const messages = await saved(alice, proposed.conversationId);
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({ text: 'Is the fire exit finding closed?', editedAt: expect.any(String) });
  const again = (await t.as(alice).post(`/assistant/conversations/${proposed.conversationId}/export`, { timeZone: 'UTC' })).json<ConversationExport>();
  expect(again.content).toContain('> Is the fire exit finding closed?');
  expect(again.content).not.toContain('Close item 12 with the note');
  expect(again.id).not.toBe(download.id);
  expect(await t.db.$count(conversationExports)).toBe(2);
});
