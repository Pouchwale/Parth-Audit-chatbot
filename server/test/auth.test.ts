import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { LoginResponse } from '@shared/api.ts';
import { connectorCredentials, loginEvents, sessions } from '../src/db/schema.ts';
import { setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

it('records each sign-in with the device and IP address', async () => {
  const response = await t.login('alice', { ip: '198.51.100.7' });
  expect(response.statusCode).toBe(200);
  const body = response.json<LoginResponse>();
  expect(body.user).toMatchObject({ username: 'alice', displayName: 'Alice', role: 'user' });

  const [event] = await t.db.select().from(loginEvents);
  expect(event).toMatchObject({
    username: 'alice',
    success: true,
    ip: '198.51.100.7',
    userAgent: 'Mitra/1.0 test',
    device: { deviceId: 'device-alice', model: 'Pixel 8', os: 'Android', osVersion: '16' },
  });
  const [session] = await t.db.select().from(sessions);
  expect(session).toMatchObject({ deviceName: "alice's phone", deviceModel: 'Pixel 8', signInIp: '198.51.100.7', lastIp: '198.51.100.7', endedAt: null });
  expect(session!.tokenHash).not.toBe(body.token);
});

it('records failed sign-ins against the account without creating a session', async () => {
  await t.signIn('alice');
  const response = await t.login('alice', { password: 'wrong', ip: '192.0.2.44' });
  expect(response.statusCode).toBe(401);

  const failures = await t.db.select().from(loginEvents).where(eq(loginEvents.success, false));
  expect(failures).toMatchObject([{ username: 'alice', failureReason: 'invalid_credentials', ip: '192.0.2.44' }]);
  expect(failures[0]!.userId).not.toBeNull();
  expect(await t.db.select().from(sessions)).toHaveLength(1);
});

it('stores the connected system sign-in encrypted', async () => {
  await t.signIn('alice');
  const [row] = await t.db.select().from(connectorCredentials);
  expect(row!.sealed).not.toContain('token-alice');
});

it('ends the session and drops stored credentials on sign-out', async () => {
  const token = await t.signIn('alice');
  expect((await t.as(token).get('/me')).statusCode).toBe(200);
  expect((await t.as(token).post('/auth/logout')).statusCode).toBe(204);
  expect((await t.as(token).get('/me')).statusCode).toBe(401);

  const [session] = await t.db.select().from(sessions);
  expect(session!.endReason).toBe('signed_out');
  expect(await t.db.select().from(connectorCredentials)).toEqual([]);
});

it('replaces the old session when the same device signs in again', async () => {
  const first = await t.signIn('alice');
  const second = await t.signIn('alice');
  expect((await t.as(first).get('/me')).statusCode).toBe(401);
  expect((await t.as(second).get('/me')).statusCode).toBe(200);
  const ended = await t.db.select().from(sessions).where(eq(sessions.endReason, 'replaced'));
  expect(ended).toHaveLength(1);
});

it('tracks the address each device was last seen from', async () => {
  const token = await t.signIn('alice', { ip: '198.51.100.7' });
  await t.app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` }, remoteAddress: '198.51.100.99' });
  const [session] = await t.db.select().from(sessions);
  expect(session).toMatchObject({ signInIp: '198.51.100.7', lastIp: '198.51.100.99' });
});

it('limits repeated sign-in attempts from one address', async () => {
  for (let i = 0; i < 10; i++) await t.login('alice', { password: 'wrong' });
  expect((await t.login('alice', { password: 'wrong' })).statusCode).toBe(429);
});
