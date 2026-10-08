// The phone's inbox, tasks and Review screen through the real server (src/phone/routes.ts): each route checks what the
// app sent, then relays it to DCRS's /api/v1 as the signed-in person, with DCRS's own words for a refusal. DCRS is the
// stand-in; nothing here keeps or works out a notification of its own.
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import type { LoginResponse, NotificationList, RecordView, Tasks } from '@shared/api.ts';
import { buildApp } from '../src/app.ts';
import { createDcrsConnector } from '../src/connectors/dcrs/index.ts';
import { createRegistry } from '../src/connectors/registry.ts';
import { openDatabase, type Database } from '../src/db/index.ts';
import { actions, sessions } from '../src/db/schema.ts';
import { BASE, CHANGED, json, RECORD, refusal, standInDcrs, TOKEN, type Route } from './dcrs-standin.ts';
import { scriptedModel, setup, testConfig } from './helpers.ts';

let database: Database;
beforeAll(async () => {
  database = await openDatabase('memory://');
});
afterAll(async () => {
  await database.close();
});

let running: Awaited<ReturnType<typeof buildApp>> | undefined;
beforeEach(async () => {
  await database.db.execute(sql`truncate users, sessions, connector_credentials, login_events, conversations, actions, message_events, files, conversation_exports, weekly_reports cascade`);
});
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const PUSH_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

const NOTIFICATION = {
  id: 41,
  kind: 'needs_input',
  priority: 'high',
  title: 'ડેઇલી પેસ્ટ કંટ્રોલ મોનિટરિંગ રેકોર્ડ',
  body: '12 રીડિંગ ભરવાના બાકી છે, પછી સબમિટ કરો.',
  data: { documentId: 'daily-pest-monitoring', formatNo: 'F/HR/17', recordId: 'rec-1', count: 12, module: 'HR' },
  createdAt: '2026-10-08T03:00:00.000Z',
  readAt: null,
  resolvedAt: null,
};

const TODAY: Tasks = {
  date: '2026-10-08',
  overdue: [],
  due: [],
  upcoming: [{ documentId: 'qc-viscosity', formatNo: 'F-QC-30', document: 'Lamination Adhesive Viscosity Record', dueDate: '2026-10-09', status: null, recordId: null, started: false, module: 'QC' }],
  readyToSubmit: [],
  needsInput: [{ documentId: 'daily-pest-monitoring', formatNo: 'F/HR/17', document: 'Daily Pest Control Monitoring Record', dueDate: '2026-10-08', status: 'In Progress', recordId: 'rec-1', started: true, module: 'HR', canSubmit: true, canVerify: true, problems: ['Check point 1 is required.'] }],
  awaitingVerification: [],
};

async function start(routes: Record<string, Route> = {}) {
  const dcrs = standInDcrs(routes);
  const connector = createDcrsConnector({ baseUrl: BASE, fetch: dcrs.fetch });
  const app = await buildApp(
    {
      config: testConfig({ dcrsBaseUrl: BASE }),
      db: database.db,
      registry: createRegistry([connector], 'dcrs'),
      model: scriptedModel().model,
      transcriber: async () => '',
      imageReader: async () => '',
    },
    { logger: false },
  );
  running = app;
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username: 'kapila.barad@gpp.local', password: 'right', device: { deviceId: 'kapila-phone', name: 'Kapila phone', os: 'Android' } },
  });
  const token = login.json<LoginResponse>().token;
  const headers = { authorization: `Bearer ${token}` };
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  /** What DCRS was asked, after the sign-in. */
  const asked = () => dcrs.seen.filter((r) => !r.path.startsWith('/api/auth') && r.path !== '/api/v1/me');
  return { app, dcrs, send, asked };
}

it('relays the inbox as the person, in the language asked, and marks notifications read', async () => {
  const { send, asked } = await start({
    'GET /api/v1/notifications': () => json(200, { items: [NOTIFICATION], unread: 3, open: 5 }),
    'POST /api/v1/notifications/read': () => json(200, { unread: 1 }),
  });

  const list = await send('GET', '/notifications?state=open&limit=20&lang=gu');
  expect(list.statusCode).toBe(200);
  expect(list.json<NotificationList>()).toEqual({ items: [NOTIFICATION], unread: 3, open: 5 });
  expect(asked()).toMatchObject([
    { method: 'GET', path: '/api/v1/notifications', query: { state: 'open', limit: '20', lang: 'gu' }, headers: { authorization: `Bearer ${TOKEN}`, 'x-client-name': 'Mitra mobile app' } },
  ]);

  // Left out: every notification, 50 of them, in English. An older page: before the last one shown.
  await send('GET', '/notifications?before=41');
  expect(asked()[1]).toMatchObject({ query: { state: 'all', limit: '50', lang: 'en', before: '41' } });

  // A language DCRS does not write in, or a limit out of range, is turned down before DCRS is asked.
  for (const url of ['/notifications?lang=fr', '/notifications?limit=500', '/notifications?state=new']) {
    expect((await send('GET', url)).statusCode, url).toBe(400);
  }
  expect(asked()).toHaveLength(2);

  expect((await send('POST', '/notifications/read', { ids: [41, 42] })).json()).toEqual({ unread: 1 });
  expect((await send('POST', '/notifications/read', { all: true })).json()).toEqual({ unread: 1 });
  expect((await send('POST', '/notifications/read', {})).statusCode).toBe(400);
  expect((await send('POST', '/notifications/read', { ids: ['41'] })).statusCode).toBe(400);
  expect(asked().slice(2)).toMatchObject([{ method: 'POST', path: '/api/v1/notifications/read', body: { ids: [41, 42] } }, { body: { all: true } }]);
});

it("registers the phone's push token with its language, and removes it at sign-out", async () => {
  const { send, asked } = await start({
    'POST /api/v1/devices': () => json(200, { ok: true }),
    'DELETE /api/v1/devices': () => json(200, { ok: true }),
  });
  const device = { token: PUSH_TOKEN, platform: 'android', language: 'hi', appVersion: '1.1.0', deviceName: 'Kapila phone' };
  const added = await send('POST', '/devices', device);
  expect(added.statusCode).toBe(200);
  expect(added.json()).toEqual({ ok: true });

  for (const wrong of [
    { ...device, token: 'fcm-token-123' },
    { ...device, platform: 'windows' },
    { ...device, language: 'auto' },
    { platform: 'android', language: 'en' },
  ]) {
    expect((await send('POST', '/devices', wrong)).statusCode, JSON.stringify(wrong)).toBe(400);
  }

  const removed = await send('DELETE', '/devices', { token: PUSH_TOKEN });
  expect(removed.json()).toEqual({ ok: true });
  expect(asked()).toMatchObject([
    { method: 'POST', path: '/api/v1/devices', body: device, headers: { authorization: `Bearer ${TOKEN}` } },
    { method: 'DELETE', path: '/api/v1/devices', body: { token: PUSH_TOKEN }, headers: { authorization: `Bearer ${TOKEN}` } },
  ]);
});

it("keeps the person's choices of what is pushed in DCRS, and sends a test to the person's own phones", async () => {
  let saved: unknown = { kinds: { ready: true, upcoming: true }, reminders: false };
  const { send, asked } = await start({
    'GET /api/v1/notification-preferences': () => json(200, saved),
    'PUT /api/v1/notification-preferences': (r) => {
      saved = r.body;
      return json(200, saved);
    },
    'POST /api/v1/notifications/test': () => json(200, { sent: 2 }),
  });
  expect((await send('GET', '/notification-preferences')).json()).toEqual({ kinds: { ready: true, upcoming: true }, reminders: false });
  const put = await send('PUT', '/notification-preferences', { kinds: { upcoming: false, boss_summary: true } });
  expect(put.json()).toEqual({ kinds: { upcoming: false, boss_summary: true } });
  expect((await send('PUT', '/notification-preferences', { kinds: { gossip: true } })).statusCode).toBe(400);
  expect((await send('PUT', '/notification-preferences', { kinds: { ready: 'yes' } })).statusCode).toBe(400);
  expect((await send('POST', '/notifications/test')).json()).toEqual({ sent: 2 });
  expect(asked().map((r) => `${r.method} ${r.path}`)).toEqual([
    'GET /api/v1/notification-preferences',
    'PUT /api/v1/notification-preferences',
    'POST /api/v1/notifications/test',
  ]);
});

it('reads the day and a record, saves what the person enters, and submits only once it is ticked as reviewed', async () => {
  const { send, asked } = await start({
    'GET /api/v1/today': () => json(200, TODAY),
    'GET /api/v1/records/rec-1': () => json(200, RECORD),
    'POST /api/v1/records': () => json(201, { created: true, record: { ...RECORD, recordId: 'rec-2' } }),
    'POST /api/v1/records/rec-1/changes': () => json(200, CHANGED),
    'POST /api/v1/records/rec-1/actions': (r) => json(200, { done: (r.body as { action: string }).action, recordId: 'rec-1', status: 'Pending Verification', editable: false, actions: ['verify', 'send_back', 'reopen', 'delete'] }),
  });

  const tasks = await send('GET', '/tasks');
  expect(tasks.json<Tasks>()).toEqual(TODAY);
  const record = await send('GET', '/records/rec-1');
  expect(record.json<RecordView>()).toEqual(RECORD);
  const started = await send('POST', '/records', { documentId: 'qc-viscosity', date: '2026-10-09' });
  expect(started.statusCode).toBe(200);
  expect(started.json()).toMatchObject({ created: true, record: { recordId: 'rec-2' } });

  const patch = { itemEdits: [{ collection: 'rows', match: { row: 2 }, set: { status: 'OK' } }] };
  const changed = await send('POST', '/records/rec-1/changes', { patch, note: 'Entered on the phone' });
  expect(changed.json()).toEqual(CHANGED);
  expect((await send('POST', '/records/rec-1/changes', { patch: {} })).statusCode).toBe(400);

  // Not ticked as reviewed: refused here, and DCRS is never asked.
  const unticked = await send('POST', '/records/rec-1/actions', { action: 'submit' });
  expect(unticked.statusCode).toBe(400);
  expect(unticked.json().message).toContain('Reviewed and correct');
  expect((await send('POST', '/records/rec-1/actions', { action: 'send_back', reviewed: true })).statusCode).toBe(400);
  expect((await send('POST', '/records/rec-1/actions', { action: 'delete', reviewed: true })).statusCode).toBe(400);

  const submitted = await send('POST', '/records/rec-1/actions', { action: 'submit', reviewed: true });
  expect(submitted.json()).toMatchObject({ recordId: 'rec-1', status: 'Pending Verification', editable: false });

  expect(asked().map((r) => [`${r.method} ${r.path}`, r.body])).toEqual([
    ['GET /api/v1/today', undefined],
    ['GET /api/v1/records/rec-1', undefined],
    ['POST /api/v1/records', { documentId: 'qc-viscosity', date: '2026-10-09' }],
    ['POST /api/v1/records/rec-1/changes', { patch, note: 'Entered on the phone' }],
    ['POST /api/v1/records/rec-1/actions', { action: 'submit', reviewed: true }],
  ]);

  // The changes are in the server's action log, as the chat's are, for the super admin's view.
  const logged = await database.db.select({ action: actions.action, status: actions.status, summary: actions.summary }).from(actions).orderBy(actions.createdAt);
  expect(logged).toEqual([
    { action: 'open_record', status: 'succeeded', summary: 'Open the record of qc-viscosity for 2026-10-09, starting it if there is none yet (from the Tasks screen)' },
    { action: 'edit_record', status: 'succeeded', summary: 'In record rec-1, set in rows where row 2: set status "OK" (entered on the Review screen)' },
    { action: 'record_action', status: 'succeeded', summary: 'Submit record rec-1, ticked as reviewed and correct on the Review screen' },
  ]);
});

it("passes DCRS's refusals on in its own words, and ends the session when DCRS's sign-in has ended", async () => {
  const readOnly = 'This document is Read only for you. Ask the super admin for Write access.';
  let signedIn = true;
  const { send, app } = await start({
    'POST /api/v1/records/rec-1/actions': () => refusal(403, 'level-needed', readOnly),
    'POST /api/v1/records/rec-1/changes': () => refusal(409, 'needs-reopen', 'The record is Pending Verification and cannot be changed as it stands. Reopen it for correction first.'),
    'GET /api/v1/today': () => (signedIn ? json(200, { date: 'not a list of anything', overdue: 'x' }) : refusal(401, 'not-signed-in', 'Not signed in.')),
  });

  const refused = await send('POST', '/records/rec-1/actions', { action: 'verify', reviewed: true });
  expect(refused.statusCode).toBe(403);
  expect(refused.json()).toEqual({ error: 'forbidden', message: readOnly });
  const failed = await database.db.select({ status: actions.status, error: actions.error }).from(actions);
  expect(failed).toEqual([{ status: 'failed', error: readOnly }]);

  const reopen = await send('POST', '/records/rec-1/changes', { patch: { remarks: 'OK' } });
  expect(reopen.statusCode).toBe(409);
  expect(reopen.json().message).toContain('Reopen it for correction');

  // An older DCRS without the notification routes: said plainly.
  const older = await send('GET', '/notifications');
  expect(older.statusCode).toBe(503);
  expect(older.json().message).toContain("doesn't offer that yet");

  // An answer that is not the shape the app reads is not passed on. DCRS's lists that are not lists are left empty.
  const odd = await send('GET', '/tasks');
  expect(odd.statusCode).toBe(200);
  expect(odd.json()).toMatchObject({ overdue: [], due: [] });

  signedIn = false;
  const ended = await send('GET', '/tasks');
  expect(ended.statusCode).toBe(401);
  expect(ended.json()).toMatchObject({ error: 'session_expired' });
  const [session] = await database.db.select().from(sessions).where(eq(sessions.endReason, 'upstream_signed_out'));
  expect(session).toBeDefined();
  expect((await send('GET', '/notifications')).statusCode).toBe(401);
  void app;
});

it('says a connected system that keeps no notifications offers none, and that the routes need a sign-in', async () => {
  const fake = await setup();
  try {
    const token = await fake.signIn('alice');
    const inbox = await fake.as(token).get('/notifications');
    expect(inbox.statusCode).toBe(501);
    expect(inbox.json()).toMatchObject({ error: 'not_offered' });
    expect((await fake.app.inject({ method: 'GET', url: '/tasks' })).statusCode).toBe(401);
  } finally {
    await fake.close();
  }
});

it("answers 502 when DCRS's answer is not one the app can read", async () => {
  const { send } = await start({ 'GET /api/v1/records/rec-9': () => json(200, { recordId: 'rec-9' }) });
  const record = await send('GET', '/records/rec-9');
  expect(record.statusCode).toBe(502);
  expect(record.json()).toMatchObject({ error: 'upstream_unavailable' });
});
