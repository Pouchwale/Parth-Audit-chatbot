import Groq from 'groq-sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { TranscriptionResponse } from '@shared/api.ts';
import { setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

const RECORDING = Buffer.alloc(4096, 7);

function upload(token: string | null, contentType: string, payload: Buffer | string = RECORDING) {
  return t.app.inject({
    method: 'POST',
    url: '/assistant/transcribe',
    headers: { 'content-type': contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload,
  });
}

it('turns a recording sent as raw audio into text', async () => {
  const alice = await t.signIn('alice');

  const phone = await upload(alice, 'audio/mp4');
  expect(phone.statusCode).toBe(200);
  expect(phone.json<TranscriptionResponse>()).toEqual({ text: 'What is still open?' });
  const browser = await upload(alice, 'audio/webm;codecs=opus');
  expect(browser.statusCode).toBe(200);

  expect(t.voice.recordings).toEqual([
    { data: RECORDING, filename: 'audio.m4a', mimeType: 'audio/mp4' },
    { data: RECORDING, filename: 'audio.webm', mimeType: 'audio/webm' },
  ]);
});

it('only accepts audio it can transcribe', async () => {
  const alice = await t.signIn('alice');
  for (const response of [
    await upload(alice, 'application/octet-stream'),
    await upload(alice, 'application/json', JSON.stringify({ audio: 'x' })),
    await upload(alice, 'audio/x-unknown'),
  ]) {
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ error: 'unsupported_media_type' });
  }
  expect(t.voice.recordings).toEqual([]);
});

it('refuses recordings that are too large', async () => {
  const alice = await t.signIn('alice');
  const response = await upload(alice, 'audio/mp4', Buffer.alloc(15 * 1024 * 1024 + 1));
  expect(response.statusCode).toBe(413);
  expect(response.json()).toMatchObject({ error: 'too_large' });
});

it("says it didn't catch anything for a tiny recording or an empty transcript", async () => {
  const alice = await t.signIn('alice');
  const noSpeech = { error: 'no_speech', message: "I didn't catch that. Try again." };

  const tiny = await upload(alice, 'audio/mp4', Buffer.alloc(100));
  expect(tiny.statusCode).toBe(422);
  expect(tiny.json()).toEqual(noSpeech);
  expect(t.voice.recordings).toEqual([]);

  t.voice.state.text = '  ';
  const silent = await upload(alice, 'audio/mp4');
  expect(silent.statusCode).toBe(422);
  expect(silent.json()).toEqual(noSpeech);
});

it('needs a session, checked before the upload is read', async () => {
  expect((await upload(null, 'audio/mp4')).statusCode).toBe(401);
  // Reading an upload over the size limit would have answered 413.
  expect((await upload(null, 'audio/mp4', Buffer.alloc(15 * 1024 * 1024 + 1))).statusCode).toBe(401);
  expect((await upload('not-a-session', 'audio/mp4', Buffer.alloc(15 * 1024 * 1024 + 1))).statusCode).toBe(401);
  expect(t.voice.recordings).toEqual([]);
});

it('limits each device to 30 recordings a minute', async () => {
  const alice = await t.signIn('alice');
  const bob = await t.signIn('bob');
  for (let i = 0; i < 30; i++) expect((await upload(alice, 'audio/mp4')).statusCode).toBe(200);
  expect((await upload(alice, 'audio/mp4')).statusCode).toBe(429);
  expect((await upload(bob, 'audio/mp4')).statusCode).toBe(200);
});

it('explains when transcription is unavailable', async () => {
  const alice = await t.signIn('alice');
  t.voice.state.error = new Groq.APIConnectionError({ message: 'network down' });
  const response = await upload(alice, 'audio/mp4');
  expect(response.statusCode).toBe(503);
  expect(response.json()).toMatchObject({ error: 'assistant_unavailable' });
});
