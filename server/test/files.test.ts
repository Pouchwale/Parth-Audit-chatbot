import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import Groq from 'groq-sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AssistantReply, FileInfo } from '@shared/api.ts';
import { conversationExports, conversations, files } from '../src/db/schema.ts';
import { extractText } from '../src/files/extract.ts';
import { imageSize } from '../src/files/image-size.ts';
import { expireStaleWork } from '../src/maintenance.ts';
import { docx, pdf, png, xlsx } from './fixtures.ts';
import { says, setup, testConfig } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

interface Upload {
  name?: string;
  path?: string;
  type?: string;
}

function upload(token: string | null, body: Buffer | string, { name, path, type }: Upload = {}) {
  const query = new URLSearchParams({ ...(name !== undefined ? { name } : {}), ...(path !== undefined ? { path } : {}) });
  return t.app.inject({
    method: 'POST',
    url: `/assistant/files?${query}`,
    headers: { ...(type ? { 'content-type': type } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: body,
  });
}

async function uploaded(token: string, body: Buffer | string, options: Upload) {
  const response = await upload(token, body, options);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<FileInfo>();
}

async function stored(id: string) {
  const [row] = await t.db.select().from(files).where(eq(files.id, id));
  return row!;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Each document is read in a worker thread of its own, which takes up to a second to start.
const READS_DOCUMENTS = 30_000;

/** Makes a ZIP archive claim `size` bytes for every part, whatever they really unpack to, as a hostile one would. */
function claimingSize(zip: Buffer, size: number): Buffer {
  const lying = Buffer.from(zip);
  const end = lying.length - 22;
  expect(lying.readUInt32LE(end)).toBe(0x06054b50);
  let at = lying.readUInt32LE(end + 16);
  for (let n = lying.readUInt16LE(end + 10); n > 0; n--) {
    expect(lying.readUInt32LE(at)).toBe(0x02014b50);
    lying.writeUInt32LE(size, at + 24);
    lying.writeUInt32LE(size, lying.readUInt32LE(at + 42) + 22);
    at += 46 + lying.readUInt16LE(at + 28) + lying.readUInt16LE(at + 30) + lying.readUInt16LE(at + 32);
  }
  return lying;
}

it('stores a photo sent as raw bytes, with its size, fingerprint and what the image reader saw', async () => {
  const alice = await t.signIn('alice');
  const photo = png(3, 2);

  const info = await uploaded(alice, photo, { name: 'exit.png', path: 'site-a/exit.png', type: 'image/png' });
  expect(info).toEqual({
    id: expect.any(String),
    filename: 'exit.png',
    mimeType: 'image/png',
    sizeBytes: photo.length,
    origin: 'upload',
    system: null,
    relativePath: 'site-a/exit.png',
    width: 3,
    height: 2,
    createdAt: expect.any(String),
  });
  expect(await stored(info.id)).toMatchObject({
    sha256: sha256(photo),
    conversationId: null,
    text: 'A fire exit blocked by two pallets.',
    textStatus: 'ok',
  });
  expect(Buffer.from((await stored(info.id)).data).equals(photo)).toBe(true);
  expect(t.vision.images).toEqual([{ data: photo, mimeType: 'image/png' }]);
});

it('reads the text of PDF, Word, Excel, CSV, text, Markdown and JSON files', async () => {
  const alice = await t.signIn('alice');
  const cases: [Upload, Buffer | string, string][] = [
    [{ name: 'report.pdf', type: 'application/pdf' }, await pdf('Bait station 4 was empty'), 'Bait station 4 was empty'],
    [{ name: 'notes.docx', type: DOCX }, docx(['Findings', 'Drain cover broken']), 'Findings\n\nDrain cover broken'],
    [
      { name: 'stations.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      xlsx('Stations', [['Station', 'Count'], ['RB-01', 3]]),
      '# Sheet: Stations\nStation,Count\nRB-01,3',
    ],
    [{ name: 'readings.csv', type: 'text/csv' }, '﻿station,reading\nRB-01,3\n', 'station,reading\nRB-01,3'],
    [{ name: 'note.txt', type: 'text/plain; charset=utf-8' }, 'नमस्ते, the exit is clear.', 'नमस्ते, the exit is clear.'],
    [{ name: 'plan.md', type: 'text/markdown' }, '# Plan\n\n- Fix the drain', '# Plan\n\n- Fix the drain'],
    [{ name: 'data.json', type: 'application/json' }, '{"station":"RB-01"}', '{"station":"RB-01"}'],
  ];
  for (const [options, body, text] of cases) {
    const info = await uploaded(alice, typeof body === 'string' ? Buffer.from(body) : body, options);
    expect(await stored(info.id), options.name).toMatchObject({ textStatus: 'ok', text });
  }
  expect(t.vision.images).toEqual([]);
}, READS_DOCUMENTS);

it('reads UTF-16 text files, and keeps control characters out of what it stores', async () => {
  const alice = await t.signIn('alice');
  const utf16 = (text: string) => Buffer.from(text, 'utf16le');
  const cases: [Upload, Buffer | string, string][] = [
    // Excel's "Unicode Text" and PowerShell write a byte order mark; the second file has none.
    [{ name: 'readings.txt', type: 'text/plain' }, Buffer.concat([Buffer.from([0xff, 0xfe]), utf16('station,reading\r\nRB-01,3\r\n')]), 'station,reading\nRB-01,3'],
    [{ name: 'readings.csv', type: 'application/octet-stream' }, utf16('id,note\n1,ok\n'), 'id,note\n1,ok'],
    [{ name: 'big-endian.txt', type: 'text/plain' }, Buffer.concat([Buffer.from([0xfe, 0xff]), utf16('नमस्ते').swap16()]), 'नमस्ते'],
    [{ name: 'odd.csv', type: 'text/csv' }, 'a\u0000b\u0007c\n\u001b[0m', 'abc\n[0m'],
  ];
  for (const [options, body, text] of cases) {
    const info = await uploaded(alice, typeof body === 'string' ? Buffer.from(body) : body, options);
    expect(await stored(info.id), options.name).toMatchObject({ textStatus: 'ok', text });
  }
  t.vision.state.text = 'Sign reads\u0000 EXIT.\u001b';
  const photo = await uploaded(alice, png(1, 1), { name: 'sign.png', type: 'image/png' });
  expect(await stored(photo.id)).toMatchObject({ textStatus: 'ok', text: 'Sign reads EXIT.' });
});

it('refuses a Word file whose parts unpack to far more than they claim, before the whole of it is unpacked', async () => {
  // 51 MiB of spaces deflate to about 50 KB, and the archive claims each part is 1,000 bytes.
  const bomb = claimingSize(docx([' '.repeat(51 * 1024 * 1024)]), 1000);
  expect(bomb.length).toBeLessThan(200_000);
  await expect(extractText(bomb, 'docx', 100_000)).rejects.toThrow('too large to open');

  const alice = await t.signIn('alice');
  const info = await uploaded(alice, bomb, { name: 'bomb.docx', type: DOCX });
  expect(await stored(info.id)).toMatchObject({ textStatus: 'failed', text: null });
}, READS_DOCUMENTS);

it('goes by the extension when the app sends a generic type, or Excel for a CSV file', async () => {
  const alice = await t.signIn('alice');
  const type = async (options: Upload, body: Buffer | string = 'a,b\n1,2') => (await uploaded(alice, Buffer.from(body), options)).mimeType;

  expect(await type({ name: 'report.pdf', type: 'application/octet-stream' }, await pdf('Hello'))).toBe('application/pdf');
  expect(await type({ name: 'readings.csv', type: 'application/vnd.ms-excel' })).toBe('text/csv');
  expect(await type({ name: 'photo.JPG', type: 'image/jpg' }, png(1, 1))).toBe('image/jpeg');
  expect(await type({ name: 'old.xls', type: 'application/vnd.ms-excel' })).toBe('application/vnd.ms-excel');
});

it('turns away kinds of files it does not take, before reading them', async () => {
  const alice = await t.signIn('alice');
  for (const options of [
    { name: 'page.html', type: 'text/html' },
    { name: 'archive.zip', type: 'application/zip' },
    { name: 'setup.exe', type: 'application/octet-stream' },
    { name: 'form', type: 'multipart/form-data; boundary=x' },
    { name: 'no-type.txt' },
  ]) {
    const response = await upload(alice, 'hello', options);
    expect(response.statusCode, options.name).toBe(415);
    expect(response.json()).toMatchObject({ error: 'unsupported_media_type' });
  }
  expect(await t.db.$count(files)).toBe(0);
});

it('refuses an empty file and one over the size limit', async () => {
  await t.close();
  t = await setup({ fileMaxBytes: 1024 });
  const alice = await t.signIn('alice');

  const empty = await upload(alice, '', { name: 'empty.txt', type: 'text/plain' });
  expect(empty.statusCode).toBe(400);
  expect(empty.json()).toEqual({ error: 'empty_file', message: 'That file is empty.' });
  const large = await upload(alice, Buffer.alloc(1025, 'a'), { name: 'large.txt', type: 'text/plain' });
  expect(large.statusCode).toBe(413);
  expect(large.json()).toMatchObject({ error: 'too_large' });
  expect((await upload(alice, Buffer.alloc(1024, 'a'), { name: 'fits.txt', type: 'text/plain' })).statusCode).toBe(200);
});

it('keeps only the name of a file, and checks its name and folder path', async () => {
  const alice = await t.signIn('alice');
  const send = (options: Omit<Upload, 'type'>) => upload(alice, 'hello', { ...options, type: 'text/plain' });

  expect((await uploaded(alice, 'hello', { name: '..\\..\\etc/passwd.txt', type: 'text/plain' })).filename).toBe('passwd.txt');
  expect((await uploaded(alice, 'hello', { name: 'Ränge\u0007.txt', type: 'text/plain' })).filename).toBe('Ränge.txt');
  const nested = await uploaded(alice, 'hello', { name: 'a.txt', path: 'Site A\\photos//./a.txt', type: 'text/plain' });
  expect(nested.relativePath).toBe('Site A/photos/a.txt');

  for (const options of [{}, { name: '' }, { name: 'x'.repeat(252) + '.txt' }, { name: 'folder/' }, { name: '..' }, { name: 'a.txt', path: 'site/../../a.txt' }, { name: 'a.txt', path: 'p/'.repeat(251) }]) {
    const response = await send(options);
    expect(response.statusCode, JSON.stringify(options)).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  }
  expect((await send({ name: `${'x'.repeat(251)}.txt` })).statusCode).toBe(200);
});

it('keeps a photo the image reader could not take, and says why', async () => {
  const alice = await t.signIn('alice');
  t.vision.state.error = new Groq.RateLimitError(429, undefined, 'Rate limit reached', new Headers());
  const busy = await uploaded(alice, png(2, 2), { name: 'busy.png', type: 'image/png' });
  expect(await stored(busy.id)).toMatchObject({ textStatus: 'failed', text: null });

  const heic = await uploaded(alice, Buffer.from('not really heic'), { name: 'IMG_0001.HEIC', type: 'image/heic' });
  expect(await stored(heic.id)).toMatchObject({ textStatus: 'unsupported', width: null, height: null });
  expect(t.vision.images).toHaveLength(1);
});

it('needs a session, checked before the upload is read', async () => {
  expect((await upload(null, 'hello', { name: 'a.txt', type: 'text/plain' })).statusCode).toBe(401);
  // Reading an upload over the size limit would have answered 413.
  expect((await upload(null, Buffer.alloc(21 * 1024 * 1024), { name: 'a.txt', type: 'text/plain' })).statusCode).toBe(401);
  expect(await t.db.$count(files)).toBe(0);
});

it('limits each person to 60 uploads a minute across their devices', async () => {
  const phone = await t.signIn('alice');
  const laptop = await t.signIn('alice', { device: { deviceId: 'alice-laptop' } });
  const bob = await t.signIn('bob');
  const photo = png(1, 1);
  for (let i = 0; i < 60; i++) expect((await upload(i % 2 ? phone : laptop, photo, { name: 'p.png', type: 'image/png' })).statusCode).toBe(200);
  const limited = await upload(phone, photo, { name: 'p.png', type: 'image/png' });
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toMatchObject({ error: 'rate_limited' });
  expect((await upload(bob, photo, { name: 'p.png', type: 'image/png' })).statusCode).toBe(200);
});

it('gives people their own uploads back, unrecorded and reusable by their device, and nobody else', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  const photo = png(2, 1);
  const info = await uploaded(alice, photo, { name: 'Façade photo.png', type: 'image/png' });

  const opened = await t.as(alice).get(`/assistant/files/${info.id}`);
  expect(opened.statusCode).toBe(200);
  expect(opened.rawPayload.equals(photo)).toBe(true);
  expect(opened.headers).toMatchObject({
    'content-type': 'image/png',
    'content-length': String(photo.length),
    'content-disposition': `inline; filename="Facade photo.png"; filename*=UTF-8''Fa%C3%A7ade%20photo.png`,
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  const saved = await t.as(alice).get(`/assistant/files/${info.id}?purpose=download`);
  expect(saved.headers['content-disposition']).toMatch(/^attachment; /);

  const other = await t.as(bob).get(`/assistant/files/${info.id}`);
  expect(other.statusCode).toBe(404);
  expect(other.json()).toMatchObject({ error: 'file_not_found' });
  expect((await t.as(alice).get('/assistant/files/not-an-id')).statusCode).toBe(400);
  expect((await t.as(alice).get(`/assistant/files/${info.id}?purpose=print`)).statusCode).toBe(400);
  expect((await t.app.inject({ method: 'GET', url: `/assistant/files/${info.id}` })).statusCode).toBe(401);
  expect(await t.db.$count(conversationExports)).toBe(0);
});

it('deletes uploads never sent after a day, and files with their conversation, but never the download records', async () => {
  const alice = await t.signIn('alice');
  const old = await uploaded(alice, 'old', { name: 'old.txt', type: 'text/plain' });
  const recent = await uploaded(alice, 'recent', { name: 'recent.txt', type: 'text/plain' });
  const sent = await uploaded(alice, 'sent', { name: 'sent.txt', type: 'text/plain' });
  await t.db.update(files).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(files.id, old.id));
  t.model.queue(says('Got it.'));
  const reply = (await t.as(alice).post('/assistant/messages', { text: 'Here', attachments: [sent.id] })).json<AssistantReply>();
  expect((await t.as(alice).post(`/assistant/conversations/${reply.conversationId}/export`, {})).statusCode).toBe(200);

  await expireStaleWork(t.db, testConfig());
  expect((await t.db.select({ id: files.id }).from(files)).map((row) => row.id).sort()).toEqual([recent.id, sent.id].sort());

  // Deleting the conversation takes its files with it; retention clean-up deletes conversations the same way.
  await t.db.update(conversations).set({ updatedAt: new Date(Date.now() - 2 * 24 * 3600_000) }).where(eq(conversations.id, reply.conversationId));
  await expireStaleWork(t.db, testConfig());
  expect((await t.db.select({ id: files.id }).from(files)).map((row) => row.id)).toEqual([recent.id]);
  expect(await t.db.$count(conversationExports)).toBe(1);
});

it('reads the pixel size of PNG, GIF, WebP and JPEG images, turned the way a phone camera took them', () => {
  expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  expect(imageSize(Buffer.from('474946383961' + '4001' + 'f000', 'hex'))).toEqual({ width: 320, height: 240 });
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0);
  webp.write('WEBPVP8X', 8);
  webp.writeUIntLE(1919, 24, 3);
  webp.writeUIntLE(1079, 27, 3);
  expect(imageSize(webp)).toEqual({ width: 1920, height: 1080 });

  // A JPEG taken sideways: stored 4032 x 3024, with EXIF orientation 6 (a quarter turn).
  const exif = Buffer.from('45786966000049492a00080000000100120103000100000006000000', 'hex');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif]);
  const sof = Buffer.from('ffc0001108' + '0bd0' + '0fc0' + '03012200021101031101', 'hex');
  expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof]))).toEqual({ width: 3024, height: 4032 });
  expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), sof]))).toEqual({ width: 4032, height: 3024 });

  expect(imageSize(Buffer.from('not an image'))).toBeNull();
  expect(imageSize(png(10, 10).subarray(0, 18))).toBeNull();
});
