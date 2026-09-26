import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AccountDetail, AccountSummary } from '@shared/api.ts';
import { callsTool, says, setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

async function accounts(token: string) {
  return (await t.as(token).get('/admin/accounts')).json<AccountSummary[]>();
}

async function detail(token: string, userId: string) {
  return (await t.as(token).get(`/admin/accounts/${userId}`)).json<AccountDetail>();
}

it('is only for super admins', async () => {
  const alice = await t.signIn('alice');
  expect((await t.as(alice).get('/admin/accounts')).statusCode).toBe(403);
  expect((await t.app.inject({ method: 'GET', url: '/admin/accounts' })).statusCode).toBe(401);
});

it("shows each account's signed-in devices and what it last did", async () => {
  const phone = await t.signIn('alice', { ip: '198.51.100.1', device: { deviceId: 'phone', name: 'Work phone', model: 'Pixel 8' } });
  await t.signIn('alice', { ip: '198.51.100.2', device: { deviceId: 'tablet', name: 'Tablet', model: 'Galaxy Tab S9' } });
  t.model.queue(callsTool('fake__list_items', { status: 'open' }), says('Two are open.'));
  await t.as(phone).post('/assistant/messages', { text: 'What is open?' });
  const admin = await t.signIn('admin');

  const list = await accounts(admin);
  const alice = list.find((a) => a.username === 'alice')!;
  expect(alice).toMatchObject({
    role: 'user',
    activeSessions: 2,
    lastAction: { system: 'Fake Records', summary: 'List open items', status: 'succeeded', request: 'What is open?' },
  });
  expect(list.find((a) => a.username === 'admin')).toMatchObject({ role: 'super_admin', activeSessions: 1, lastAction: null });

  const aliceDetail = await detail(admin, alice.id);
  expect(aliceDetail.sessions.map((s) => [s.deviceName, s.deviceModel, s.signInIp]).sort()).toEqual([
    ['Tablet', 'Galaxy Tab S9', '198.51.100.2'],
    ['Work phone', 'Pixel 8', '198.51.100.1'],
  ]);
  expect(aliceDetail.recentLogins).toHaveLength(2);
  expect(aliceDetail.recentActions).toMatchObject([{ summary: 'List open items' }]);
});

it('lets a super admin sign a device out', async () => {
  const aliceToken = await t.signIn('alice');
  const admin = await t.signIn('admin');
  const alice = (await accounts(admin)).find((a) => a.username === 'alice')!;
  const [device] = (await detail(admin, alice.id)).sessions;

  expect((await t.as(admin).post(`/admin/sessions/${device!.id}/revoke`)).statusCode).toBe(204);
  expect((await t.as(aliceToken).get('/me')).statusCode).toBe(401);
  expect((await detail(admin, alice.id)).sessions).toEqual([]);
});
