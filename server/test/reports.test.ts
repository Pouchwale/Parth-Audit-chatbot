import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import Groq from 'groq-sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ActionStatus, AssistantReply, CurrentUser, WeeklyReport, WeeklyReportSummary } from '@shared/api.ts';
import { storeCompletedWeeks, weekStartOf } from '../src/admin/weekly.ts';
import { loadConfig } from '../src/config.ts';
import { actions, conversationExports, loginEvents, messageEvents, weeklyReports } from '../src/db/schema.ts';
import { expireStaleWork } from '../src/maintenance.ts';
import { addDays } from '../src/time.ts';
import { callsTool, fails, says, setup, testConfig } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.close();
});

// A Monday long past, so the week is complete whenever the tests run.
const WEEK = '2026-03-02';

async function account(username: string) {
  const token = await t.signIn(username);
  const { user } = (await t.as(token).get('/me')).json<{ user: CurrentUser }>();
  return { token, ...user };
}

async function report(token: string, weekStart: string) {
  const response = await t.as(token).get(`/admin/reports/weekly/${weekStart}`);
  expect(response.statusCode).toBe(200);
  return response.json<WeeklyReport>();
}

// Audit rows at exact times, as the app would have written them then.
const record = {
  signIn: (userId: string, at: string, deviceId: string, success = true) =>
    t.db.insert(loginEvents).values({ userId, username: 'x', success, device: { deviceId }, createdAt: new Date(at) }),
  message: (userId: string, at: string) =>
    t.db.insert(messageEvents).values({ userId, conversationId: randomUUID(), chars: 12, createdAt: new Date(at) }),
  action: (userId: string, at: string, kind: 'read' | 'write', status: ActionStatus, finishedAt: string | null = at) =>
    t.db
      .insert(actions)
      .values({
        userId,
        connectorId: 'fake',
        action: kind === 'read' ? 'list_items' : 'close_item',
        kind,
        input: {},
        summary: 'Something',
        status,
        createdAt: new Date(at),
        finishedAt: finishedAt === null ? null : new Date(finishedAt),
      })
      .returning({ id: actions.id }),
  download: (user: { id: string; username: string; displayName: string }, at: string, title: string, sizeBytes: number) =>
    t.db.insert(conversationExports).values({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      conversationId: randomUUID(),
      conversationTitle: title,
      filename: 'file.md',
      mimeType: 'text/markdown; charset=utf-8',
      sizeBytes,
      messageCount: 2,
      sha256: 'f'.repeat(64),
      content: 'x',
      createdAt: new Date(at),
    }),
};

it("sums up each person's week from the audit trail, busiest first", async () => {
  const alice = await account('alice');
  const bob = await account('bob');
  const admin = await account('admin');
  await record.signIn(alice.id, '2026-03-02T08:00:00Z', 'phone');
  await record.signIn(alice.id, '2026-03-03T08:00:00Z', 'phone');
  await record.signIn(alice.id, '2026-03-04T08:00:00Z', 'laptop');
  await record.signIn(alice.id, '2026-03-04T07:59:00Z', 'unknown', false);
  for (const day of ['02', '03', '05']) await record.message(alice.id, `2026-03-${day}T09:00:00Z`);
  await record.action(alice.id, '2026-03-02T09:00:01Z', 'read', 'succeeded');
  await record.action(alice.id, '2026-03-03T09:00:01Z', 'read', 'succeeded');
  await record.action(alice.id, '2026-03-03T09:00:02Z', 'read', 'failed');
  await record.action(alice.id, '2026-03-05T09:00:01Z', 'write', 'succeeded');
  await record.action(alice.id, '2026-03-05T09:00:02Z', 'write', 'cancelled');
  await record.action(alice.id, '2026-03-05T09:00:03Z', 'write', 'failed');
  await record.download(alice, '2026-03-06T10:00:00Z', 'Open items', 100);
  await record.download(alice, '2026-03-07T10:00:00Z', 'Close item 12', 50);
  await record.download(alice, '2026-03-08T23:59:59Z', 'Open items', 150);
  await record.message(bob.id, '2026-03-04T12:00:00Z');
  // The weeks either side.
  await record.message(alice.id, '2026-03-01T23:59:59Z');
  await record.message(bob.id, '2026-03-09T00:00:00Z');
  await record.download(alice, '2026-03-09T00:00:00Z', 'Next week', 999);

  const week = await report(admin.token, WEEK);
  expect(week).toEqual({
    weekStart: '2026-03-02',
    weekEnd: '2026-03-08',
    timeZone: 'UTC',
    complete: true,
    generatedAt: expect.any(String),
    totals: { activeUsers: 2, signIns: 3, failedSignIns: 1, messages: 4, lookups: 2, changesConfirmed: 1, exports: 3, exportedBytes: 300 },
    users: [
      {
        user: { id: alice.id, username: 'alice', displayName: 'Alice' },
        signIns: 3,
        failedSignIns: 1,
        devices: 2,
        messages: 3,
        lookups: 2,
        changesConfirmed: 1,
        changesCancelled: 1,
        changesFailed: 1,
        exports: 3,
        exportedBytes: 300,
        exportedConversations: ['Open items', 'Close item 12'],
        lastActiveAt: '2026-03-08T23:59:59.000Z',
      },
      {
        user: { id: bob.id, username: 'bob', displayName: 'Bob' },
        signIns: 0,
        failedSignIns: 0,
        devices: 0,
        messages: 1,
        lookups: 0,
        changesConfirmed: 0,
        changesCancelled: 0,
        changesFailed: 0,
        exports: 0,
        exportedBytes: 0,
        exportedConversations: [],
        lastActiveAt: '2026-03-04T12:00:00.000Z',
      },
    ],
  });
});

it('stores a completed week once and never changes it', async () => {
  const alice = await account('alice');
  const admin = await account('admin');
  await record.message(alice.id, '2026-03-03T09:00:00Z');

  const first = await report(admin.token, WEEK);
  expect(first.users.map((u) => u.messages)).toEqual([1]);
  await record.message(alice.id, '2026-03-04T09:00:00Z');
  await storeCompletedWeeks(t.db, 'UTC');

  expect(await report(admin.token, WEEK)).toEqual(first);
  const stored = await t.db.select().from(weeklyReports);
  expect(stored.find((row) => row.weekStart === WEEK)).toMatchObject({ timeZone: 'UTC', report: first });
});

it('counts each lookup and change in the week it finished, even when the week it began in was stored first', async () => {
  const alice = await account('alice');
  const admin = await account('admin');
  await record.message(alice.id, '2026-03-08T23:57:00Z');
  // Still open when the week ended at midnight on Sunday.
  const [unanswered] = await record.action(alice.id, '2026-03-08T23:57:30Z', 'write', 'awaiting_confirmation', null);
  const [confirmed] = await record.action(alice.id, '2026-03-08T23:58:00Z', 'write', 'awaiting_confirmation', null);
  const [lookup] = await record.action(alice.id, '2026-03-08T23:59:59Z', 'read', 'running', null);

  await storeCompletedWeeks(t.db, 'UTC', new Date('2026-03-09T00:00:30Z'));
  await t.db.update(actions).set({ status: 'succeeded', finishedAt: new Date('2026-03-09T00:00:02Z') }).where(eq(actions.id, lookup!.id));
  await t.db.update(actions).set({ status: 'succeeded', finishedAt: new Date('2026-03-09T00:01:00Z') }).where(eq(actions.id, confirmed!.id));
  await expireStaleWork(t.db, testConfig(), new Date('2026-03-09T00:15:00Z'));
  expect((await t.db.select({ status: actions.status }).from(actions).where(eq(actions.id, unanswered!.id)))[0]).toEqual({ status: 'cancelled' });

  const week = await report(admin.token, WEEK);
  expect(week.generatedAt).toBe('2026-03-09T00:00:30.000Z');
  expect(week.users).toMatchObject([{ user: { id: alice.id }, messages: 1, lookups: 0, changesConfirmed: 0, changesCancelled: 0 }]);
  expect((await report(admin.token, addDays(WEEK, 7))).users).toMatchObject([
    { user: { id: alice.id }, messages: 0, lookups: 1, changesConfirmed: 1, changesCancelled: 1 },
  ]);
});

it('stores every completed week from the first activity on, and lists them after the week in progress', async () => {
  const alice = await account('alice');
  const admin = await account('admin');
  await record.message(alice.id, '2026-03-04T09:00:00Z');

  const current = weekStartOf(new Date(), 'UTC');
  const completed = Math.round((Date.parse(current) - Date.parse(WEEK)) / (7 * 24 * 3600_000));
  await storeCompletedWeeks(t.db, 'UTC');
  const stored = (await t.db.select({ weekStart: weeklyReports.weekStart }).from(weeklyReports)).map((row) => row.weekStart).sort();
  expect(stored).toHaveLength(completed);
  expect(stored[0]).toBe(WEEK);
  expect(stored.at(-1)).toBe(addDays(current, -7));

  const response = await t.as(admin.token).get('/admin/reports/weekly');
  expect(response.headers['cache-control']).toBe('no-store');
  const list = response.json<WeeklyReportSummary[]>();
  expect(list).toHaveLength(Math.min(completed, 52) + 1);
  // Both people signed in just now.
  expect(list[0]).toMatchObject({ weekStart: current, weekEnd: addDays(current, 6), complete: false, totals: { activeUsers: 2, signIns: 2 } });
  expect(list.slice(1).map((week) => week.weekStart)).toEqual(stored.toReversed().slice(0, 52));
  expect(list.every((week) => !('users' in week))).toBe(true);
  expect(list.at(-1)!.complete).toBe(true);
  if (completed <= 52) expect(list.at(-1)).toMatchObject({ weekStart: WEEK, totals: { activeUsers: 1, messages: 1 } });
});

it('shows the week in progress live, from records that outlast deleted conversations', async () => {
  const alice = await account('alice');
  const admin = await account('admin');
  const current = weekStartOf(new Date(), 'UTC');
  expect((await report(admin.token, current)).users.find((u) => u.user.id === alice.id)).toMatchObject({ signIns: 1, messages: 0 });

  t.model.queue(says('Hello.'));
  const { conversationId } = (await t.as(alice.token).post('/assistant/messages', { text: 'Hi' })).json<AssistantReply>();
  await t.as(alice.token).post(`/assistant/conversations/${conversationId}/export`, {});
  await t.as(alice.token).delete('/assistant/conversations');

  const live = await report(admin.token, current);
  expect(live).toMatchObject({ complete: false, weekStart: current });
  expect(live.users.find((u) => u.user.id === alice.id)).toMatchObject({ signIns: 1, messages: 1, exports: 1, exportedConversations: ['Hi'] });
  expect(await t.db.$count(weeklyReports)).toBe(0);
});

it('has reports only for Mondays from the first activity up to this week, and only for super admins', async () => {
  const alice = await account('alice');
  const admin = await account('admin');
  await record.message(alice.id, '2026-03-04T09:00:00Z');
  const current = weekStartOf(new Date(), 'UTC');

  for (const week of ['2026-03-03', '2026-02-30', 'last-week']) {
    const response = await t.as(admin.token).get(`/admin/reports/weekly/${week}`);
    expect(response.statusCode, week).toBe(400);
  }
  for (const week of ['2026-02-23', addDays(current, 7)]) {
    const response = await t.as(admin.token).get(`/admin/reports/weekly/${week}`);
    expect(response.statusCode, week).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  }
  for (const url of ['/admin/reports/weekly', `/admin/reports/weekly/${WEEK}`]) {
    expect((await t.as(alice.token).get(url)).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  }
  expect(await t.db.$count(weeklyReports)).toBe(0);
});

it('runs weeks from Monday to Sunday in REPORT_TIME_ZONE', async () => {
  await t.close();
  t = await setup({ reportTimeZone: 'Asia/Kolkata' });
  const alice = await account('alice');
  const admin = await account('admin');
  // Monday 2 March 2026 starts at 18:30 UTC on Sunday 1 March in India, and the week ends at 18:30 UTC on 8 March.
  for (const at of ['2026-03-01T18:29:59Z', '2026-03-01T18:30:00Z', '2026-03-08T18:29:59Z', '2026-03-08T18:30:00Z']) await record.message(alice.id, at);

  const messages = async (week: string) => (await report(admin.token, week)).users.map((u) => u.messages);
  expect(await report(admin.token, WEEK)).toMatchObject({ weekStart: WEEK, weekEnd: '2026-03-08', timeZone: 'Asia/Kolkata' });
  expect(await messages('2026-02-23')).toEqual([1]);
  expect(await messages(WEEK)).toEqual([2]);
  expect(await messages('2026-03-09')).toEqual([1]);
  expect(weekStartOf(new Date('2026-03-01T18:30:00Z'), 'Asia/Kolkata')).toBe(WEEK);
  expect(weekStartOf(new Date('2026-03-01T18:30:00Z'), 'UTC')).toBe('2026-02-23');
});

it('counts each message a person sends, without its text, but not decisions or retries', async () => {
  const alice = await account('alice');
  t.model.queue(callsTool('fake__close_item', { id: '12', note: 'done' }));
  const proposed = (await t.as(alice.token).post('/assistant/messages', { text: 'Close item 12' })).json<AssistantReply>();
  t.model.queue(says('Done.'), fails(new Groq.APIConnectionError({ message: 'network down' })), says('Two items.'));
  await t.as(alice.token).post(`/assistant/conversations/${proposed.conversationId}/decision`, { confirmationId: proposed.confirmation!.id, decision: 'confirm' });
  const failed = await t.as(alice.token).post('/assistant/messages', { text: 'What is open?', conversationId: proposed.conversationId });
  expect(failed.statusCode).toBe(503);
  expect((await t.as(alice.token).post(`/assistant/conversations/${proposed.conversationId}/retry`, {})).statusCode).toBe(200);

  const events = await t.db.select().from(messageEvents).orderBy(messageEvents.createdAt);
  expect(events).toMatchObject([
    { userId: alice.id, conversationId: proposed.conversationId, chars: 'Close item 12'.length },
    { userId: alice.id, conversationId: proposed.conversationId, chars: 'What is open?'.length },
  ]);
  expect(events[0]!.sessionId).not.toBeNull();
});

it('accepts only an IANA time zone for REPORT_TIME_ZONE', () => {
  const env = { CREDENTIALS_KEY: randomBytes(32).toString('base64') };
  expect(loadConfig(env).reportTimeZone).toBe('UTC');
  expect(loadConfig({ ...env, REPORT_TIME_ZONE: 'Asia/Kolkata' }).reportTimeZone).toBe('Asia/Kolkata');
  for (const zone of ['+05:30', 'Mars/Olympus_Mons', 'Asia/Kolkata; drop table users']) {
    expect(() => loadConfig({ ...env, REPORT_TIME_ZONE: zone })).toThrow(/REPORT_TIME_ZONE must be an IANA time zone/);
  }
});
