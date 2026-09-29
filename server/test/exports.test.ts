import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantReply, ChatMessage, ConversationExport, CurrentUser, ExportDetail, ExportPage, FileInfo } from '@shared/api.ts';
import { conversationExports, conversations } from '../src/db/schema.ts';
import { exportFile } from '../src/exports/document.ts';
import { expireStaleWork } from '../src/maintenance.ts';
import { callsTool, says, setup, testConfig } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

const PHONE = { deviceId: 'alice-phone', name: 'Work phone', model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.2.0' };

function share(token: string, conversationId: string, payload?: object) {
  return t.app.inject({
    method: 'POST',
    url: `/assistant/conversations/${conversationId}/export`,
    remoteAddress: '198.51.100.9',
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'AuditAssistant/1.2 (Android 16)' },
    ...(payload ? { payload } : {}),
  });
}

async function ask(token: string, text: string, reply: string, conversationId?: string) {
  t.model.queue(says(reply));
  return (await t.as(token).post('/assistant/messages', { text, ...(conversationId ? { conversationId } : {}) })).json<AssistantReply>();
}

async function shared(token: string, conversationId: string) {
  const response = await share(token, conversationId, { timeZone: 'Asia/Kolkata' });
  expect(response.statusCode).toBe(200);
  return response.json<ConversationExport>();
}

async function userId(token: string) {
  return (await t.as(token).get('/me')).json<{ user: CurrentUser }>().user.id;
}

it('downloads a conversation as a Markdown file saying who exported it, when, and everything in it', async () => {
  const alice = await t.signIn('alice', { device: PHONE });
  t.model.queue(callsTool('fake__list_items', { status: 'open' }), says('Two items are **open**.'));
  const { conversationId } = (await t.as(alice).post('/assistant/messages', { text: 'What is still open?' })).json<AssistantReply>();
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const close = (await t.as(alice).post('/assistant/messages', { text: 'Close item 12', conversationId })).json<AssistantReply>();
  t.model.queue(says('Done. Item 12 is closed.'));
  await t.as(alice).post(`/assistant/conversations/${conversationId}/decision`, { confirmationId: close.confirmation!.id, decision: 'confirm' });
  t.model.queue(callsTool('fake__close_item', { id: '13', note: 'done' }));
  const other = (await t.as(alice).post('/assistant/messages', { text: 'And item 13', conversationId })).json<AssistantReply>();
  await t.as(alice).post(`/assistant/conversations/${conversationId}/decision`, { confirmationId: other.confirmation!.id, decision: 'cancel' });

  const response = await share(alice, conversationId, { timeZone: 'Asia/Kolkata' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const file = response.json<ConversationExport>();
  expect(file).toMatchObject({ mimeType: 'text/markdown; charset=utf-8', filename: expect.stringMatching(/^what-is-still-open-\d{4}-\d{2}-\d{2}\.md$/) });
  expect(file.sha256).toBe(createHash('sha256').update(file.content, 'utf8').digest('hex'));

  const { content, id } = file;
  const exportedOn = /\w+day, \d{1,2} \w+ \d{4}, \d{2}:\d{2}:\d{2} \(Asia\/Kolkata\)/.source;
  expect(content).toMatch(/^# What is still open\?\n\n- Exported by Alice \(alice\)\n/);
  expect(content).toMatch(new RegExp(`\\n- Exported on ${exportedOn} · UTC ${file.createdAt.replace(/\./g, '\\.')}\\n`));
  expect(content).toContain(`\n- Export ID: ${id}\n- Conversation ID: ${conversationId}\n- Signed in to Fake Records\n`);
  expect(content).toMatch(/\n## Alice · \w+day, \d{1,2} \w+ \d{4}, \d{2}:\d{2}:\d{2}\n\n> What is still open\?\n/);
  expect(content).toContain('\nLookup: List open items (Fake Records) — succeeded\n\nTwo items are **open**.\n');
  expect(content).toContain(
    '\nChanges proposed for confirmation — confirmed\n- Close item 12 with the note "done" (Fake Records) — succeeded\n\nDone. Item 12 is closed.\n',
  );
  expect(content).toContain(
    '\nChanges proposed for confirmation — cancelled\n' +
      '- Close item 13 with the note "done" (Fake Records) — cancelled: The person cancelled this change, so it was not made.\n',
  );
  expect(content).toMatch(new RegExp(`\\nThis file was exported from Audit Assistant by alice on ${exportedOn}\\. Export ID ${id}\\. Every export is recorded\\.\\n$`));

  const [row] = await t.db.select().from(conversationExports);
  expect(row).toMatchObject({
    id,
    userId: await userId(alice),
    username: 'alice',
    displayName: 'Alice',
    conversationId,
    conversationTitle: 'What is still open?',
    filename: file.filename,
    mimeType: 'text/markdown; charset=utf-8',
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    messageCount: 6,
    sha256: file.sha256,
    content,
    ip: '198.51.100.9',
    userAgent: 'AuditAssistant/1.2 (Android 16)',
    device: { name: 'Work phone', model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.2.0' },
    timeZone: 'Asia/Kolkata',
  });
  expect(row!.sessionId).not.toBeNull();
  expect(row!.createdAt.toISOString()).toBe(file.createdAt);
});

const baseInput = {
  id: 'e',
  conversationId: 'c',
  title: 't',
  messages: [],
  exportedBy: { username: 'alice', displayName: 'Alice' },
  signInSystem: 'Fake Records',
  at: new Date('2026-09-27T06:00:00.000Z'),
  timeZone: 'UTC',
};

it('writes every date in the chosen time zone, with the weekday and year, and names the file after the title', () => {
  const file = exportFile({
    id: 'export-1',
    conversationId: 'conversation-1',
    title: 'Café réunion: Q3 / audit — "final"',
    messages: [
      { id: 'u1', role: 'user', text: 'Hi\n# not a heading', createdAt: '2026-09-27T06:20:00.000Z' },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }], status: 'stopped', error: null, createdAt: '2026-09-27T06:20:01.000Z' },
      { id: 'u2', role: 'user', text: 'Again', createdAt: '2026-09-27T06:21:00.000Z' },
      { id: 'a2', role: 'assistant', parts: [], status: 'error', error: 'The assistant is busy.', createdAt: '2026-09-27T06:21:01.000Z' },
    ],
    exportedBy: { username: 'alice', displayName: 'Alice' },
    signInSystem: 'Fake Records',
    // Just after midnight on Monday in India, still Sunday in UTC.
    at: new Date('2026-09-27T18:52:03.000Z'),
    timeZone: 'Asia/Kolkata',
  });

  expect(file.filename).toBe('cafe-reunion-q3-audit-final-2026-09-28.md');
  expect(file.content).toBe(`# Café réunion: Q3 / audit — "final"

- Exported by Alice (alice)
- Exported on Monday, 28 September 2026, 00:22:03 (Asia/Kolkata) · UTC 2026-09-27T18:52:03.000Z
- Export ID: export-1
- Conversation ID: conversation-1
- Signed in to Fake Records

---

## Alice · Sunday, 27 September 2026, 11:50:00

> Hi
> # not a heading

## Audit Assistant · Sunday, 27 September 2026, 11:50:01

Hello

_Stopped before it finished._

## Alice · Sunday, 27 September 2026, 11:51:00

> Again

## Audit Assistant · Sunday, 27 September 2026, 11:51:01

_Error: The assistant is busy._

---

This file was exported from Audit Assistant by alice on Monday, 28 September 2026, 00:22:03 (Asia/Kolkata). Export ID export-1. Every export is recorded.
`);

  const named = (title: string) => exportFile({ ...baseInput, title }).filename;
  expect(named('नमस्ते')).toBe('conversation-2026-09-27.md');
  const long = named('Very long title '.repeat(10));
  expect(long).toMatch(/^very-long-title(-[a-z]+)+-2026-09-27\.md$/);
  expect(long.length).toBeLessThanOrEqual(60 + '-2026-09-27.md'.length);
});

it('lists the files attached to a message and the files systems handed over', () => {
  const file = (filename: string, mimeType: string, sizeBytes: number, more: Partial<FileInfo> = {}): FileInfo => ({
    id: filename,
    filename,
    mimeType,
    sizeBytes,
    origin: 'upload',
    system: null,
    relativePath: null,
    width: null,
    height: null,
    createdAt: '2026-09-27T05:50:00.000Z',
    ...more,
  });
  const { content } = exportFile({
    ...baseInput,
    messages: [
      {
        id: 'u1',
        role: 'user',
        text: 'Here they are',
        attachments: [file('photo-1.jpg', 'image/jpeg', 250_000, { relativePath: 'site-a/photo-1.jpg' }), file('notes.txt', 'text/plain', 120)],
        createdAt: '2026-09-27T05:50:00.000Z',
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'file', file: file('report.pdf', 'application/pdf', 1_500_000, { origin: 'system', system: 'Fake Records' }) },
          { type: 'text', text: 'Your report is ready.' },
        ],
        status: 'complete',
        error: null,
        createdAt: '2026-09-27T05:50:01.000Z',
      },
    ],
  });
  expect(content).toContain('\n> Here they are\n\nAttached:\n- site-a/photo-1.jpg (image/jpeg, 244 KB)\n- notes.txt (text/plain, 120 bytes)\n\n');
  expect(content).toContain('\nFile from Fake Records: report.pdf (application/pdf, 1.4 MB)\n\nYour report is ready.\n');
});

it('shows a confirmation nobody answered before it expired as expired, with none of its changes made', () => {
  const proposal = (expiresAt: string): ChatMessage => ({
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'confirmation',
        id: 'c1',
        expiresAt,
        status: 'pending',
        changes: [{ id: 'x1', system: 'Fake Records', summary: 'Close item 12', status: 'awaiting_confirmation', error: null }],
      },
    ],
    status: 'complete',
    error: null,
    createdAt: '2026-09-27T05:50:00.000Z',
  });
  const content = (expiresAt: string) => exportFile({ ...baseInput, messages: [proposal(expiresAt)] }).content;

  expect(content(baseInput.at.toISOString())).toContain(
    '\nChanges proposed for confirmation — expired before a decision\n' +
      '- Close item 12 (Fake Records) — cancelled: The person did not confirm in time, so this change was not made.\n',
  );
  expect(content('2026-09-27T06:00:01.000Z')).toContain(
    '\nChanges proposed for confirmation — waiting for a decision\n- Close item 12 (Fake Records) — awaiting confirmation\n',
  );
});

it('records whether the conversation was downloaded or went to the share sheet', async () => {
  const alice = await t.signIn('alice');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');

  expect((await share(alice, conversationId, { purpose: 'share' })).statusCode).toBe(200);
  expect((await share(alice, conversationId, {})).statusCode).toBe(200);
  const refused = await share(alice, conversationId, { purpose: 'open' });
  expect(refused.statusCode).toBe(400);
  expect(refused.json()).toMatchObject({ error: 'invalid_request' });
  const rows = await t.db.select({ kind: conversationExports.kind, purpose: conversationExports.purpose }).from(conversationExports).orderBy(conversationExports.createdAt);
  expect(rows).toEqual([
    { kind: 'conversation', purpose: 'share' },
    { kind: 'conversation', purpose: 'download' },
  ]);
});

it("dates the file in UTC when the device's time zone is missing or unknown", async () => {
  const alice = await t.signIn('alice');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');

  for (const payload of [undefined, {}, { timeZone: 'Mars/Olympus_Mons' }, { timeZone: '+05:30' }]) {
    const response = await share(alice, conversationId, payload);
    expect(response.statusCode).toBe(200);
    expect(response.json<ConversationExport>().content).toMatch(/\n- Exported on \w+day, .+ \(UTC\) · UTC /);
  }
  const rows = await t.db.select({ timeZone: conversationExports.timeZone }).from(conversationExports);
  expect(rows).toEqual(Array.from({ length: 4 }, () => ({ timeZone: null })));
});

it('only lets people download their own conversations, once there is something in them', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');

  const others = await share(bob, conversationId);
  expect(others.statusCode).toBe(404);
  expect(others.json()).toMatchObject({ error: 'conversation_not_found' });
  expect((await share(alice, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  expect((await share(alice, 'not-an-id')).statusCode).toBe(400);
  expect((await t.app.inject({ method: 'POST', url: `/assistant/conversations/${conversationId}/export` })).statusCode).toBe(401);

  const [empty] = await t.db.insert(conversations).values({ userId: await userId(alice), messages: [] }).returning();
  const nothing = await share(alice, empty!.id);
  expect(nothing.statusCode).toBe(409);
  expect(nothing.json()).toEqual({ error: 'nothing_to_export', message: 'This conversation has nothing to share yet.' });
  expect(await t.db.$count(conversationExports)).toBe(0);
});

it('downloads the saved conversation while a reply is still being written', async () => {
  const alice = await t.signIn('alice');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');
  await t.db.update(conversations).set({ lockedUntil: new Date(Date.now() + 60_000) });

  const file = await shared(alice, conversationId);
  expect(file.content).toContain('\nHello.\n');
});

it('keeps every download on record after its conversation is deleted, however that happens', async () => {
  await t.close();
  t = await setup({ conversationRetentionMs: 60_000 });
  const alice = await t.signIn('alice');
  const one = await ask(alice, 'One', 'First.');
  const two = await ask(alice, 'Two', 'Second.');
  const three = await ask(alice, 'Three', 'Third.');
  const files = [await shared(alice, one.conversationId), await shared(alice, two.conversationId), await shared(alice, three.conversationId)];

  expect((await t.as(alice).delete(`/assistant/conversations/${one.conversationId}`)).statusCode).toBe(204);
  await t.db.update(conversations).set({ updatedAt: new Date(Date.now() - 120_000) }).where(eq(conversations.id, two.conversationId));
  await expireStaleWork(t.db, testConfig({ conversationRetentionMs: 60_000 }));
  expect((await t.as(alice).delete('/assistant/conversations')).statusCode).toBe(204);
  expect(await t.db.$count(conversations)).toBe(0);

  const admin = await t.signIn('admin');
  const page = (await t.as(admin).get('/admin/exports')).json<ExportPage>();
  expect(page.exports.map((e) => e.id).sort()).toEqual(files.map((f) => f.id).sort());
  const detail = (await t.as(admin).get(`/admin/exports/${files[0]!.id}`)).json<ExportDetail>();
  expect(detail).toMatchObject({ conversationId: one.conversationId, conversationTitle: 'One', content: files[0]!.content });
});

it('limits each person to 30 downloads a minute', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');
  const bobs = await ask(bob, 'Hi', 'Hello.');

  for (let i = 0; i < 30; i++) expect((await share(alice, conversationId)).statusCode).toBe(200);
  const limited = await share(alice, conversationId);
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toMatchObject({ error: 'rate_limited' });
  expect((await share(bob, bobs.conversationId)).statusCode).toBe(200);
});

// ── Super admins: every download ──────────────────────────────────────────────────────────────────

async function list(token: string, query = '') {
  const response = await t.as(token).get(`/admin/exports${query}`);
  expect(response.statusCode).toBe(200);
  return response.json<ExportPage>();
}

async function setTime(exportId: string, at: string) {
  await t.db.update(conversationExports).set({ createdAt: new Date(at) }).where(eq(conversationExports.id, exportId));
}

it('shows downloads only to super admins', async () => {
  const alice = await t.signIn('alice');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');
  const file = await shared(alice, conversationId);

  for (const url of ['/admin/exports', `/admin/exports/${file.id}`]) {
    const response = await t.as(alice).get(url);
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(file.id);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  }
});

it('lists downloads newest first, and finds them by person, period, export ID, fingerprint, title and name', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const admin = await t.signIn('admin');
  const open = await shared(alice, (await ask(alice, 'What is still open?', 'Two.')).conversationId);
  const close = await shared(bob, (await ask(bob, 'Close item 12', 'Done.')).conversationId);
  const report = await shared(alice, (await ask(alice, 'Weekly 100% report', 'Here.')).conversationId);
  await setTime(open.id, '2026-03-01T10:00:00Z');
  await setTime(close.id, '2026-03-05T23:30:00Z');
  await setTime(report.id, '2026-03-10T00:00:00Z');
  const ids = async (query: string) => (await list(admin, query)).exports.map((e) => e.id);

  const all = await list(admin);
  expect(all.exports.map((e) => e.id)).toEqual([report.id, close.id, open.id]);
  expect(all.nextBefore).toBeNull();
  expect(all.exports[1]).toMatchObject({
    user: { id: await userId(bob), username: 'bob', displayName: 'Bob' },
    conversationTitle: 'Close item 12',
    filename: close.filename,
    sha256: close.sha256,
    messageCount: 2,
    ip: '198.51.100.9',
    device: { name: "bob's phone", model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.0.0' },
    at: '2026-03-05T23:30:00.000Z',
  });
  expect(all.exports[1]).not.toHaveProperty('content');

  expect(await ids(`?userId=${await userId(alice)}`)).toEqual([report.id, open.id]);
  // A date alone is the whole day, in the report time zone.
  expect(await ids('?from=2026-03-02&to=2026-03-05')).toEqual([close.id]);
  expect(await ids('?to=2026-03-05T23:00:00Z')).toEqual([open.id]);
  expect(await ids(`?from=${encodeURIComponent('2026-03-06T04:00:00+05:30')}`)).toEqual([report.id, close.id]);
  expect(await ids(`?to=${encodeURIComponent('2026-03-05T23:30:00Z')}&from=2026-03-05T23:30:00Z`)).toEqual([close.id]);

  expect(await ids(`?q=${open.id}`)).toEqual([open.id]);
  expect(await ids(`?q=${close.sha256.toUpperCase()}`)).toEqual([close.id]);
  expect(await ids(`?q=${report.sha256.slice(0, 12)}`)).toEqual([report.id]);
  expect(await ids('?q=STILL%20open')).toEqual([open.id]);
  expect(await ids('?q=bob')).toEqual([close.id]);
  expect(await ids('?q=0%25')).toEqual([report.id]);
  expect(await ids(`?q=still&userId=${await userId(bob)}`)).toEqual([]);
  // The widest period and the furthest time zones there are.
  expect(await ids('?from=0001-01-01&to=9998-12-31')).toEqual([report.id, close.id, open.id]);
  expect(await ids(`?to=${encodeURIComponent('2026-03-06T13:30:00+14:00')}`)).toEqual([close.id, open.id]);
  expect(await ids(`?from=${encodeURIComponent('2026-03-05T11:30:00-12:00')}`)).toEqual([report.id, close.id]);

  const cursorAt = (at: string) => Buffer.from(JSON.stringify([at, open.id])).toString('base64url');
  for (const query of [
    '?limit=0',
    '?limit=201',
    '?from=yesterday',
    '?to=2026-03-05T23:00:00',
    '?from=0000-01-01',
    '?to=9999-12-31',
    '?from=0000-06-01T00:00:00Z',
    `?to=${encodeURIComponent('2026-03-05T23:00:00+16:00')}`,
    '?from=2026-03-05T23:00:00-15:00',
    '?before=nonsense',
    `?before=${cursorAt('0000-01-01T00:00:00.000000Z')}`,
    '?userId=nope',
    '?q=',
    '?q=%00',
    '?q=a%00b',
  ]) {
    const response = await t.as(admin).get(`/admin/exports${query}`);
    expect(response.statusCode, query).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  }
});

it('pages through downloads with a cursor, even when several happened at the same moment', async () => {
  const alice = await t.signIn('alice');
  const admin = await t.signIn('admin');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');
  for (let i = 0; i < 5; i++) await shared(alice, conversationId);
  await t.db.update(conversationExports).set({ createdAt: new Date('2026-03-05T12:00:00.123Z') });
  const newestFirst = (await list(admin)).exports.map((e) => e.id);

  const seen: string[] = [];
  let before: string | null = null;
  const sizes: number[] = [];
  do {
    const page: ExportPage = await list(admin, `?limit=2${before ? `&before=${before}` : ''}`);
    sizes.push(page.exports.length);
    seen.push(...page.exports.map((e) => e.id));
    before = page.nextBefore;
  } while (before);
  expect(sizes).toEqual([2, 2, 1]);
  expect(seen).toEqual(newestFirst);
  expect(new Set(seen).size).toBe(5);
});

it('shows everything about one download, including exactly what was downloaded', async () => {
  const alice = await t.signIn('alice', { device: PHONE });
  const admin = await t.signIn('admin');
  const { conversationId } = await ask(alice, 'Hi', 'Hello.');
  const file = await shared(alice, conversationId);

  const response = await t.as(admin).get(`/admin/exports/${file.id}`);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json<ExportDetail>()).toEqual({
    id: file.id,
    kind: 'conversation',
    purpose: 'download',
    user: { id: await userId(alice), username: 'alice', displayName: 'Alice' },
    conversationId,
    conversationTitle: 'Hi',
    source: null,
    fileId: null,
    filename: file.filename,
    mimeType: 'text/markdown; charset=utf-8',
    sizeBytes: Buffer.byteLength(file.content, 'utf8'),
    messageCount: 2,
    sha256: file.sha256,
    ip: '198.51.100.9',
    device: { name: 'Work phone', model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.2.0' },
    at: file.createdAt,
    content: file.content,
    userAgent: 'AuditAssistant/1.2 (Android 16)',
    timeZone: 'Asia/Kolkata',
  });
  expect(response.body).not.toContain(alice);
  expect(response.body).not.toContain(admin);

  expect((await t.as(admin).get('/admin/exports/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  expect((await t.as(admin).get('/admin/exports/nope')).statusCode).toBe(400);
});
