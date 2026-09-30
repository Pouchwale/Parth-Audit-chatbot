import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import type { AssistantReply, CurrentUser, ExportDetail, ExportPage, FileInfo, FilePart } from '@shared/api.ts';
import { defineAction, withFiles } from '../src/connectors/types.ts';
import { actions, conversationExports, files } from '../src/db/schema.ts';
import { png } from './fixtures.ts';
import { callsTool, findEvent, parseEvents, says, setup, streams } from './helpers.ts';

const CSV = 'id,title\n12,Fire exit blocked\n13,Missing calibration label\n';

// Actions of the fake system that hand over a file, and that use the files in the conversation.
const fileActions = [
  defineAction({
    name: 'export_items',
    description: 'Exports the items as a CSV file.',
    kind: 'read',
    input: z.object({}),
    describe: () => 'Export the items',
    run: async () => withFiles({ items: 2 }, [{ filename: '../items export.csv', mimeType: 'text/csv; charset=utf-8', data: Buffer.from(CSV), description: 'Every item' }]),
  }),
  defineAction({
    name: 'read_file',
    description: 'Reads one of the files in the conversation.',
    kind: 'read',
    input: z.object({ fileId: z.string() }),
    describe: (input) => `Read file ${input.fileId}`,
    run: async (ctx, input) => {
      const { info, data } = await ctx.files.get(input.fileId);
      return { filename: info.filename, origin: info.origin, bytes: data.byteLength };
    },
  }),
  defineAction({
    name: 'attach_to_item',
    description: 'Attaches a file to an item.',
    kind: 'write',
    input: z.object({ id: z.string(), fileId: z.string() }),
    describe: async (input, { files }) => `Attach "${(await files.get(input.fileId)).info.filename}" to item ${input.id}`,
    run: async (ctx, input) => ({ item: input.id, attached: (await ctx.files.get(input.fileId)).info.filename }),
  }),
];

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup({}, { actions: fileActions });
});
afterEach(async () => {
  await t.close();
});

const PHONE = { deviceId: 'alice-phone', name: 'Work phone', model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.3.0' };

/** Asks for the export, and answers with the reply and the file it handed over. */
async function exported(token: string) {
  t.model.queue(callsTool('fake__export_items', {}), says('Your export is ready.'));
  const reply = (await t.as(token).post('/assistant/messages', { text: 'Export the items' })).json<AssistantReply>();
  const part = reply.message.parts.find((p): p is FilePart => p.type === 'file');
  return { reply, file: part!.file };
}

function download(token: string, fileId: string, query = '', headers: Record<string, string> = {}) {
  return t.app.inject({
    method: 'GET',
    url: `/assistant/files/${fileId}${query}`,
    remoteAddress: '198.51.100.23',
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'Mitra/1.3 (Android 16)', ...headers },
  });
}

async function userId(token: string) {
  return (await t.as(token).get('/me')).json<{ user: CurrentUser }>().user.id;
}

async function upload(token: string, name: string) {
  const response = await t.app.inject({
    method: 'POST',
    url: `/assistant/files?name=${name}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
    payload: png(1, 1),
  });
  return response.json<FileInfo>();
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

it("hands the person a file a system returned, in the message and as it streams, and tells the model its id", async () => {
  const alice = await t.signIn('alice');
  t.model.queue(callsTool('fake__export_items', {}), streams('Your export ', 'is ready.'));

  const response = await t.app.inject({
    method: 'POST',
    url: '/assistant/messages',
    headers: { authorization: `Bearer ${alice}` },
    payload: { text: 'Export the items', stream: true },
  });
  const events = parseEvents(response.payload);
  expect(events.filter((e) => e.type === 'part').map((e) => e.part.type)).toEqual(['activity', 'activity', 'file']);
  const done = findEvent(events, 'done').reply;
  const [action] = await t.db.select().from(actions);
  const [row] = await t.db.select().from(files);
  const file: FileInfo = {
    id: row!.id,
    filename: 'items export.csv',
    mimeType: 'text/csv',
    sizeBytes: CSV.length,
    origin: 'system',
    system: 'Fake Records',
    relativePath: null,
    width: null,
    height: null,
    createdAt: row!.createdAt.toISOString(),
  };
  expect(done.message.parts).toEqual([
    expect.objectContaining({ type: 'activity', id: action!.id, status: 'succeeded' }),
    { type: 'file', file },
    { type: 'text', text: 'Your export is ready.' },
  ]);
  expect(row).toMatchObject({
    userId: await userId(alice),
    conversationId: done.conversationId,
    origin: 'system',
    connectorId: 'fake',
    actionId: action!.id,
    sha256: sha256(CSV),
    text: CSV.trim(),
    textStatus: 'ok',
  });

  const result = JSON.parse(String(t.model.requests[1]!.messages.at(-1)!.content));
  expect(result).toEqual({
    result: { items: 2 },
    files: [{ id: row!.id, filename: 'items export.csv', mimeType: 'text/csv', sizeBytes: CSV.length, description: 'Every item' }],
    note: expect.stringContaining('Open, Download and Share buttons'),
  });
});

it('lets actions use the files in the conversation, and no others', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const { reply, file: report } = await exported(alice);
  const photo = await upload(alice, 'photo.png');
  const unsent = await upload(alice, 'unsent.png');
  const bobs = await upload(bob, 'bobs.png');
  t.model.queue(says('Thanks.'));
  await t.as(alice).post('/assistant/messages', { text: 'A photo', conversationId: reply.conversationId, attachments: [photo.id] });

  const tries = [photo.id, report.id, unsent.id, bobs.id, '00000000-0000-4000-8000-000000000000', 'not-an-id'];
  t.model.queue(...tries.map((fileId) => callsTool('fake__read_file', { fileId })), says('Done.'));
  // One message runs the model once per try, and once more to answer.
  await t.as(alice).post('/assistant/messages', { text: 'Read them', conversationId: reply.conversationId });
  const results = t.model.requests.slice(-tries.length).map((request) => JSON.parse(String(request.messages.at(-1)!.content)));
  expect(results).toEqual([
    { filename: 'photo.png', origin: 'upload', bytes: photo.sizeBytes },
    { filename: 'items export.csv', origin: 'system', bytes: CSV.length },
    ...tries.slice(2).map((fileId) => ({ error: `There is no file ${fileId} in this conversation.` })),
  ]);
});

it('turns down a change that names a file not in the conversation, and shows the file name on one that does', async () => {
  const alice = await t.signIn('alice');
  const { reply, file } = await exported(alice);

  t.model.queue(callsTool('fake__attach_to_item', { id: '12', fileId: '00000000-0000-4000-8000-000000000000' }), says('That file is not here.'));
  const refused = (await t.as(alice).post('/assistant/messages', { text: 'Attach it', conversationId: reply.conversationId })).json<AssistantReply>();
  expect(refused).toMatchObject({ confirmation: null, reply: 'That file is not here.' });
  expect(t.model.requests.at(-1)!.messages.at(-1)).toMatchObject({
    role: 'tool',
    content: JSON.stringify({ error: 'There is no file 00000000-0000-4000-8000-000000000000 in this conversation.' }),
  });

  t.model.queue(callsTool('fake__attach_to_item', { id: '12', fileId: file.id }));
  const proposed = (await t.as(alice).post('/assistant/messages', { text: 'Attach the export', conversationId: reply.conversationId })).json<AssistantReply>();
  expect(proposed.confirmation?.changes).toEqual([{ system: 'Fake Records', summary: 'Attach "items export.csv" to item 12' }]);
  t.model.queue(says('Attached.'));
  await t.as(alice).post(`/assistant/conversations/${reply.conversationId}/decision`, { confirmationId: proposed.confirmation!.id, decision: 'confirm' });
  expect(t.model.requests.at(-1)!.messages.at(-1)).toMatchObject({ role: 'tool', content: JSON.stringify({ item: '12', attached: 'items export.csv' }) });
  expect((await t.db.select({ action: actions.action, status: actions.status }).from(actions)).map((row) => `${row.action} ${row.status}`).sort()).toEqual([
    'attach_to_item succeeded',
    'export_items succeeded',
  ]);
});

it('records each time a file from a system leaves for a device, with a copy of it', async () => {
  const alice = await t.signIn('alice', { device: PHONE });
  const bob = await t.signIn('bob');
  const { reply, file } = await exported(alice);

  const shared = await download(alice, file.id, '?purpose=share', { 'x-time-zone': 'Asia/Kolkata' });
  expect(shared.statusCode).toBe(200);
  expect(shared.payload).toBe(CSV);
  expect(shared.headers).toMatchObject({
    'content-type': 'text/csv',
    'content-length': String(CSV.length),
    'content-disposition': `attachment; filename="items export.csv"; filename*=UTF-8''items%20export.csv`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  expect((await download(alice, file.id, '', { 'x-time-zone': '+05:30' })).headers['content-disposition']).toMatch(/^inline; /);
  expect((await download(alice, file.id, '?purpose=download')).statusCode).toBe(200);
  expect((await download(bob, file.id)).statusCode).toBe(404);
  // A HEAD request never gets the file, so it isn't served (or recorded) at all.
  expect((await t.app.inject({ method: 'HEAD', url: `/assistant/files/${file.id}`, headers: { authorization: `Bearer ${alice}` } })).statusCode).toBe(404);

  const rows = await t.db.select().from(conversationExports).orderBy(conversationExports.createdAt);
  expect(rows.map((row) => row.purpose)).toEqual(['share', 'open', 'download']);
  expect(rows[0]).toMatchObject({
    kind: 'file',
    userId: await userId(alice),
    username: 'alice',
    displayName: 'Alice',
    conversationId: reply.conversationId,
    conversationTitle: 'Export the items',
    source: 'Fake Records',
    fileId: file.id,
    filename: 'items export.csv',
    mimeType: 'text/csv',
    sizeBytes: CSV.length,
    messageCount: null,
    sha256: sha256(CSV),
    content: null,
    ip: '198.51.100.23',
    userAgent: 'Mitra/1.3 (Android 16)',
    device: { name: 'Work phone', model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.3.0' },
    timeZone: 'Asia/Kolkata',
  });
  expect(Buffer.from(rows[0]!.contentBytes!).toString()).toBe(CSV);
  expect(rows[1]!.timeZone).toBeNull();

  // The record and its copy outlast the conversation and the file.
  await t.as(alice).delete(`/assistant/conversations/${reply.conversationId}`);
  expect(await t.db.$count(files)).toBe(0);
  expect((await download(alice, file.id)).statusCode).toBe(404);
  expect(await t.db.$count(conversationExports)).toBe(3);
});

it("limits fetching files from systems to 60 a minute, apart from a person's own uploads, which their messages show as thumbnails", async () => {
  const alice = await t.signIn('alice');
  const { file: report } = await exported(alice);
  const photo = await upload(alice, 'photo.png');
  for (let i = 0; i < 60; i++) expect((await download(alice, photo.id)).statusCode).toBe(200);
  for (let i = 0; i < 60; i++) expect((await download(alice, report.id)).statusCode).toBe(200);

  const limited = await download(alice, report.id, '?purpose=share');
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toMatchObject({ error: 'rate_limited' });
  const own = await download(alice, photo.id);
  expect(own.statusCode).toBe(200);
  expect(own.headers['cache-control']).toBe('private, max-age=3600');
  expect(await t.db.$count(conversationExports)).toBe(60);
});

it('lists file downloads for super admins, and records an admin opening the kept copy', async () => {
  const alice = await t.signIn('alice', { device: PHONE });
  const admin = await t.signIn('admin');
  const { reply, file } = await exported(alice);
  await download(alice, file.id, '?purpose=share', { 'x-time-zone': 'Asia/Kolkata' });
  const conversation = (await t.as(alice).post(`/assistant/conversations/${reply.conversationId}/export`, { purpose: 'share' })).json<{ id: string }>();

  const page = (await t.as(admin).get('/admin/exports')).json<ExportPage>();
  const [entry] = page.exports.filter((e) => e.kind === 'file');
  expect(entry).toEqual({
    id: expect.any(String),
    kind: 'file',
    purpose: 'share',
    user: { id: await userId(alice), username: 'alice', displayName: 'Alice' },
    conversationId: reply.conversationId,
    conversationTitle: 'Export the items',
    source: 'Fake Records',
    fileId: file.id,
    filename: 'items export.csv',
    mimeType: 'text/csv',
    sizeBytes: CSV.length,
    messageCount: null,
    sha256: sha256(CSV),
    ip: '198.51.100.23',
    device: { name: 'Work phone', model: 'Pixel 8', os: 'Android', osVersion: '16', appVersion: '1.3.0' },
    at: expect.any(String),
  });
  expect(page.exports.find((e) => e.kind === 'conversation')).toMatchObject({ purpose: 'share', source: null, fileId: null, messageCount: 2 });
  const found = async (q: string) => (await t.as(admin).get(`/admin/exports?q=${encodeURIComponent(q)}`)).json<ExportPage>().exports.map((e) => e.id);
  expect(await found('fake rec')).toEqual([entry!.id]);
  expect(await found('items export')).toEqual([entry!.id]);

  const detail = (await t.as(admin).get(`/admin/exports/${entry!.id}`)).json<ExportDetail>();
  expect(detail).toMatchObject({ ...entry, content: null, userAgent: 'Mitra/1.3 (Android 16)', timeZone: 'Asia/Kolkata' });

  const copy = await t.app.inject({
    method: 'GET',
    url: `/admin/exports/${entry!.id}/file`,
    remoteAddress: '192.0.2.50',
    headers: { authorization: `Bearer ${admin}` },
  });
  expect(copy.statusCode).toBe(200);
  expect(copy.payload).toBe(CSV);
  expect(copy.headers).toMatchObject({ 'content-type': 'text/csv', 'content-disposition': expect.stringMatching(/^inline; /), 'cache-control': 'no-store' });
  const [opened] = await t.db.select().from(conversationExports).where(eq(conversationExports.userId, await userId(admin)));
  expect(opened).toMatchObject({
    kind: 'file',
    purpose: 'open',
    username: 'admin',
    conversationId: reply.conversationId,
    conversationTitle: 'Export the items',
    source: 'Fake Records',
    fileId: file.id,
    sha256: sha256(CSV),
    ip: '192.0.2.50',
  });

  const noFile = await t.as(admin).get(`/admin/exports/${conversation.id}/file`);
  expect(noFile.statusCode).toBe(404);
  expect(noFile.json()).toMatchObject({ error: 'no_file' });
  expect((await t.as(admin).get('/admin/exports/00000000-0000-4000-8000-000000000000/file')).statusCode).toBe(404);
  expect((await t.as(alice).get(`/admin/exports/${entry!.id}/file`)).statusCode).toBe(403);
  expect((await t.app.inject({ method: 'GET', url: `/admin/exports/${entry!.id}/file` })).statusCode).toBe(401);
  expect(await t.db.$count(conversationExports)).toBe(3);
});
