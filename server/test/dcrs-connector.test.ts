import { describe as group, expect, it } from 'vitest';
import { z } from 'zod';
import { CLIENT_NAME, filenameOf, sessionCookie } from '../src/connectors/dcrs/client.ts';
import { fit, SHORTENED, table, WEB_ONLY_IN_LISTS, without } from '../src/connectors/dcrs/fit.ts';
import { createDcrsConnector } from '../src/connectors/dcrs/index.ts';
import { patchInWords } from '../src/connectors/dcrs/inputs.ts';
import { equipmentForModel, escalationsForModel, insightsForModel, recordForModel, todayForModel } from '../src/connectors/dcrs/shape.ts';
import { createRegistry } from '../src/connectors/registry.ts';
import { ConnectorError, splitResult, type Described } from '../src/connectors/types.ts';
import {
  actionOf,
  BASE,
  CHANGED,
  CHANGED_FOR_MODEL,
  ctx,
  DOC_BRIEF,
  EQUIPMENT,
  ESCALATIONS,
  INSIGHTS,
  json,
  LAYOUT_FOR_MODEL,
  LIST_ITEM,
  ME,
  NOW,
  pdfResponse,
  PHOTO,
  PHOTO_BYTES,
  RECORD,
  RECORD_FOR_MODEL,
  refusal,
  SHEET,
  signedIn,
  standInDcrs,
  TOKEN,
  type Route,
} from './dcrs-standin.ts';

const READS = [
  'find_documents',
  'get_document',
  'todays_facts',
  'list_records',
  'search_records',
  'get_record',
  'record_pdf',
  'history_figures',
  'hr_master_lookup',
  'list_findings',
  'get_finding',
  'list_complaints',
  'get_pest_control_report',
  'get_pest_control_report_summary',
  'equipment_lookup',
  'insights',
  'escalations',
];
/** The most the tool definitions may take, in characters of JSON. */
const TOOLS_BUDGET = 8_800;

/** A describe() answer's sentence, whether it came alone or with the input as resolved. */
const summaryOf = (said: string | Described<unknown>) => (typeof said === 'string' ? said : said.summary);

/** F/HR/17 as GET /api/v1/documents/daily-pest-monitoring answers. */
const PEST_DOC = { id: 'daily-pest-monitoring', formatNo: 'F/HR/17', name: 'Daily Pest Control Monitoring Record', kind: 'daily-pest-monitoring' };

const WRITES = ['open_record', 'edit_record', 'record_action', 'add_photo_to_record', 'fill_record_with_sample_data', 'close_finding'];

function expectSentAsThePerson(request: { headers: Record<string, string> }) {
  expect(request.headers['x-client-name']).toBe('Mitra mobile app');
  expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`);
}

group('the connector', () => {
  it('offers exactly the actions the hand-off names, reads running at once and changes waiting for confirmation', () => {
    const { connector } = standInDcrs();
    expect(connector.id).toBe('dcrs');
    expect(CLIENT_NAME).toBe('Mitra mobile app');
    expect(connector.actions.map((a) => a.name).sort()).toEqual([...READS, ...WRITES].sort());
    for (const name of READS) expect(actionOf(connector.actions, name).kind, name).toBe('read');
    for (const name of WRITES) expect(actionOf(connector.actions, name).kind, name).toBe('write');
    // Registered as the server registers it: every input a z.object(), every tool name valid.
    const registry = createRegistry([connector], 'dcrs');
    expect(registry.bindings).toHaveLength(23);
    expect(connector.examples?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the input names DCRS reads back in its database overview', () => {
    const { connector } = standInDcrs();
    const keys = (name: string) => Object.keys((z.toJSONSchema(actionOf(connector.actions, name).input) as { properties: object }).properties);
    for (const name of ['get_record', 'record_pdf', 'edit_record', 'record_action', 'add_photo_to_record', 'fill_record_with_sample_data']) {
      expect(keys(name), name).toContain('recordId');
    }
    expect(keys('close_finding')).toEqual(['id', 'note']);
    expect(keys('get_finding')).toEqual(['id']);
    expect(keys('get_pest_control_report')).toEqual(['date']);
    expect(keys('open_record')).toEqual(['documentId', 'date']);
  });

  it('describes every action well enough to use, within the model budget', () => {
    const { connector } = standInDcrs();
    const tools = connector.actions.map((a) => JSON.stringify({ name: `dcrs__${a.name}`, description: a.description, parameters: z.toJSONSchema(a.input, { io: 'input' }) }));
    // The Groq key allows 8,000 tokens a minute, and every call carries every tool; about four characters make a token.
    expect(tools.join('').length).toBeLessThan(TOOLS_BUDGET);
    const edit = actionOf(connector.actions, 'edit_record').description;
    for (const words of ['get_record', '{fieldKey: value}', 'itemEdits', 'checkpoints', 'reopen']) expect(edit).toContain(words);
    expect(actionOf(connector.actions, 'record_action').description).toMatch(/send_back, reopen and delete need/);
    expect(actionOf(connector.actions, 'get_pest_control_report').description).toMatch(/ask/);
    expect(connector.description).toMatch(/get_record or open_record .*edit_record, then record_action submit/);
    expect(connector.description).toMatch(/format number/);
  });
});

group('signing in', () => {
  it("signs in with DCRS's own sign-in, reads the person from /api/v1/me, and keeps the session until the cookie ends", async () => {
    const { connector, seen } = standInDcrs();
    const account = await connector.authenticate(' kapila.barad@gpp.local ', 'SeedQA@2026');
    expect(account).toEqual({
      externalId: ME.id,
      username: 'kapila.barad@gpp.local',
      displayName: 'Kapila Barad',
      credentials: { token: TOKEN },
      expiresAt: new Date(NOW + 30_600_000),
    });
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/auth/login', 'GET /api/v1/me']);
    expect(seen[0]!.body).toEqual({ email: 'kapila.barad@gpp.local', password: 'SeedQA@2026' });
    expect(seen[0]!.headers['x-client-name']).toBe('Mitra mobile app');
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expectSentAsThePerson(seen[1]!);
  });

  it("takes the session's end from the cookie's Expires, or the earlier of the cookie and DCRS's endsAt", async () => {
    const at = async (answer: Response) => {
      const { connector } = standInDcrs({ 'POST /api/auth/login': () => answer });
      return (await connector.authenticate('kapila.barad@gpp.local', 'pw')).expiresAt;
    };
    expect(await at(signedIn({ expires: 'Wed, 30 Sep 2026 12:50:00 GMT' }))).toEqual(new Date('2026-09-30T12:50:00.000Z'));
    // Max-Age wins over Expires, as in a browser.
    expect(await at(signedIn({ maxAge: 3_600, expires: 'Wed, 30 Sep 2026 12:50:00 GMT' }))).toEqual(new Date(NOW + 3_600_000));
    expect(await at(signedIn({ maxAge: 30_600, endsAt: '2026-09-30T10:00:00.000Z' }))).toEqual(new Date('2026-09-30T10:00:00.000Z'));
    expect(await at(signedIn({ endsAt: '2026-09-30T12:50:00.000Z' }))).toEqual(new Date('2026-09-30T12:50:00.000Z'));
    expect(await at(signedIn({}))).toBeNull();
  });

  const refusedWith = async (answer: Route | (() => Promise<Response>), kind: string, message: string | RegExp) => {
    const { connector } = standInDcrs({ 'POST /api/auth/login': answer });
    const error = await connector.authenticate('kapila.barad@gpp.local', 'pw').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).kind).toBe(kind);
    if (typeof message === 'string') expect((error as ConnectorError).message).toBe(message);
    else expect((error as ConnectorError).message).toMatch(message);
  };

  it('maps a wrong or missing email or password to invalid_credentials', async () => {
    await refusedWith(() => json(401, { error: 'Invalid email or password.' }), 'invalid_credentials', 'Wrong email or password.');
    await refusedWith(() => json(400, { error: 'Email and password are required.' }), 'invalid_credentials', 'Wrong email or password.');
  });

  it("refuses in DCRS's own words outside working hours, for a switched-off account and after too many attempts", async () => {
    const closed = 'DCRS is open 8:40 am to 6:20 pm on working days. Today is Thursday, the weekly off — it opens again on Friday 2 October at 8:40 am.';
    await refusedWith(() => refusal(403, 'outside-working-hours', closed, { opensAt: '2026-10-02T03:10:00.000Z' }), 'forbidden', closed);
    await refusedWith(() => json(403, { error: 'This account has been switched off. Ask the administrator.' }), 'forbidden', 'This account has been switched off. Ask the administrator.');
    await refusedWith(() => json(429, { error: 'Too many failed attempts. Try again in a few minutes.' }), 'forbidden', 'Too many failed attempts. Try again in a few minutes.');
  });

  it('refuses an account still on the password the administrator gave it', async () => {
    await refusedWith(() => signedIn({ maxAge: 30_600, mustChangePassword: true }), 'forbidden', 'Sign in to DCRS in a browser and choose your own password first.');
  });

  it('says DCRS could not be reached for anything else', async () => {
    await refusedWith(() => json(500, { error: 'boom' }), 'unavailable', /couldn't be reached/);
    await refusedWith(() => new Response('<html>Bad gateway</html>', { status: 502 }), 'unavailable', /couldn't be reached/);
    await refusedWith(() => Promise.reject(new TypeError('fetch failed')), 'unavailable', /couldn't be reached/);
    await refusedWith(() => signedIn({ cookie: null }), 'unavailable', 'DCRS did not start a session. Try again in a moment.');
    await refusedWith(() => signedIn({ cookie: 'dcrs_session=; Max-Age=0; Path=/' }), 'unavailable', 'DCRS did not start a session. Try again in a moment.');
    await refusedWith(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere/' } }), 'unavailable', /DCRS_BASE_URL/);
  });

  it('says so when DCRS_BASE_URL is not set', async () => {
    const connector = createDcrsConnector({ baseUrl: undefined });
    await expect(connector.authenticate('a@b.c', 'pw')).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('DCRS_BASE_URL is not set') });
  });

  it("signs out with DCRS's sign-out, which reads the token from the cookie", async () => {
    const { connector, seen } = standInDcrs();
    await connector.signOut!({ token: TOKEN });
    expect(seen).toMatchObject([{ method: 'POST', path: '/api/auth/logout', headers: { cookie: `dcrs_session=${TOKEN}`, 'x-client-name': 'Mitra mobile app' } }]);
  });

  it('reads the cookie and the file name of an answer', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'other=1; Path=/');
    headers.append('set-cookie', `dcrs_session=${TOKEN}; Max-Age=60; Path=/; HttpOnly`);
    expect(sessionCookie(headers, NOW)).toEqual({ token: TOKEN, expiresAt: new Date(NOW + 60_000) });
    expect(sessionCookie(new Headers(), NOW)).toBeNull();
    expect(filenameOf('attachment; filename="F-HR-17 Daily Pest Control Monitoring Record 2026-09-28.pdf"')).toBe('F-HR-17 Daily Pest Control Monitoring Record 2026-09-28.pdf');
    expect(filenameOf("attachment; filename=\"plain.pdf\"; filename*=UTF-8''F%2FQC%2F05%20%E2%80%93%20Line.pdf")).toBe('F/QC/05 – Line.pdf');
    expect(filenameOf('attachment; filename=bare.pdf')).toBe('bare.pdf');
    expect(filenameOf(null)).toBeNull();
  });
});

interface Case {
  action: string;
  input: Record<string, unknown>;
  route: string;
  query?: Record<string, string>;
  body?: unknown;
  /** DCRS's answer, shaped as its engine writes it. */
  answer: unknown;
  /** What the model is given of it, when that is not the answer itself. */
  model?: unknown;
}

const TODAY = {
  date: '2026-09-30',
  day: { date: '2026-09-30', weekday: 'Wednesday', kind: 'working', closed: false, label: 'Working day' },
  tomorrow: { date: '2026-10-01', weekday: 'Thursday', kind: 'weekly-off', closed: true, label: 'Weekly off' },
  weeklyOff: { day: 'Thursday', next: '2026-10-01' },
  nextHolidays: [1, 2, 3, 4, 5, 6].map((n) => ({ date: `2026-10-0${n}`, weekday: 'Thursday', kind: 'holiday', closed: true, name: `Holiday ${n}`, label: `Holiday ${n}` })),
  overdue: [],
  due: [{ documentId: 'daily-pest-monitoring', formatNo: 'F/HR/17', document: 'Daily Pest Control Monitoring Record', dueDate: '2026-09-30', status: 'Due', recordId: null, started: false }],
  upcoming: [],
  readyToSubmit: [],
  needsInput: [{ ...LIST_ITEM, problems: ['Line No. is required'] }],
  awaitingVerification: [],
  facts: 'Today is Wednesday 30 September 2026, a working day.',
  workingHours: { enforced: true, start: '08:40', end: '18:20', hoursText: 'DCRS is open 8:40 am to 6:20 pm on working days.', todayText: 'Today is a working day — open now, until 6:20 pm.' },
};

// Every action but the ones that hand over files or take a photo: what it sends, and what the model is given.
const CASES: Case[] = [
  {
    action: 'find_documents',
    input: { q: 'line clearance' },
    route: 'GET /api/v1/documents',
    query: { q: 'line clearance', limit: '20' },
    answer: { query: 'line clearance', documents: [DOC_BRIEF], total: 1, kept: [], notInDcrs: [{ formatNo: 'F/QC/15-G', name: 'Line Clearance – Slitting', department: 'Quality Control', note: 'Not in DCRS yet' }] },
    model: {
      query: 'line clearance',
      total: 1,
      documents: [{ id: DOC_BRIEF.id, formatNo: 'F/QC/15-A', name: DOC_BRIEF.name, module: 'Quality Control', schedule: 'Every working day', department: 'Quality Control' }],
      notInDcrs: [{ formatNo: 'F/QC/15-G', name: 'Line Clearance – Slitting', department: 'Quality Control', note: 'Not in DCRS yet' }],
    },
  },
  { action: 'find_documents', input: { limit: 50 }, route: 'GET /api/v1/documents', query: { limit: '50' }, answer: { query: '', documents: [], total: 0, kept: [], notInDcrs: [] }, model: { total: 0, documents: [] } },
  {
    action: 'get_document',
    input: { documentId: 'F/QC/15-A' },
    route: 'GET /api/v1/documents/F%2FQC%2F15-A',
    answer: { ...DOC_BRIEF, description: 'Checked before each job', sourceFile: 'x.pdf', what: 'The line is clear', who: { label: 'QC', people: [] }, when: 'Before each job', how: 'Tick each point', layout: RECORD.layout, patchShape: RECORD.patchShape, records: { count: 1, latest: [] } },
    model: {
      id: DOC_BRIEF.id,
      formatNo: 'F/QC/15-A',
      name: DOC_BRIEF.name,
      module: 'Quality Control',
      schedule: 'Every working day',
      department: 'Quality Control',
      kind: 'log-sheet',
      revisionNo: '00',
      description: 'Checked before each job',
      what: 'The line is clear',
      who: { label: 'QC', people: [] },
      when: 'Before each job',
      how: 'Tick each point',
      patchShape: RECORD.patchShape,
      records: { count: 1, latest: [] },
      layout: LAYOUT_FOR_MODEL,
    },
  },
  {
    action: 'todays_facts',
    input: {},
    route: 'GET /api/v1/today',
    answer: TODAY,
    model: {
      date: '2026-09-30',
      day: { date: '2026-09-30', weekday: 'Wednesday', kind: 'working', label: 'Working day' },
      workingHours: { hoursText: TODAY.workingHours.hoursText, todayText: TODAY.workingHours.todayText },
      due: [{ recordId: null, documentId: 'daily-pest-monitoring', formatNo: 'F/HR/17', document: 'Daily Pest Control Monitoring Record', dueDate: '2026-09-30', status: 'Due' }],
      needsInput: [{ recordId: 'rec-1', documentId: DOC_BRIEF.id, formatNo: 'F/QC/15-A', document: DOC_BRIEF.name, dueDate: '2026-09-30', status: 'In Progress', problems: ['Line No. is required'] }],
      tomorrow: { date: '2026-10-01', weekday: 'Thursday', kind: 'weekly-off', label: 'Weekly off' },
      weeklyOff: { day: 'Thursday', next: '2026-10-01' },
      nextHolidays: table([1, 2, 3, 4].map((n) => ({ date: `2026-10-0${n}`, weekday: 'Thursday', kind: 'holiday', name: `Holiday ${n}`, label: `Holiday ${n}` }))),
      facts: TODAY.facts,
    },
  },
  {
    action: 'list_records',
    input: { documentId: DOC_BRIEF.id, from: '2026-09-01', to: '2026-09-30', status: 'In Progress' },
    route: 'GET /api/v1/records',
    query: { documentId: DOC_BRIEF.id, from: '2026-09-01', to: '2026-09-30', status: 'In Progress', limit: '20' },
    answer: { document: DOC_BRIEF, from: '2026-09-01', to: '2026-09-30', status: 'In Progress', total: 1, records: [LIST_ITEM] },
    model: {
      document: { id: DOC_BRIEF.id, formatNo: 'F/QC/15-A', name: DOC_BRIEF.name, module: 'Quality Control', schedule: 'Every working day', department: 'Quality Control' },
      from: '2026-09-01',
      to: '2026-09-30',
      status: 'In Progress',
      total: 1,
      records: [{ recordId: 'rec-1', dueDate: '2026-09-30', status: 'In Progress' }],
    },
  },
  {
    action: 'list_records',
    input: {},
    route: 'GET /api/v1/records',
    query: { limit: '20' },
    answer: { from: '2026-08-30', to: '2026-09-30', total: 2, records: [LIST_ITEM, { ...LIST_ITEM, recordId: null, started: false, documentId: 'daily-pest-monitoring', formatNo: 'F/HR/17', document: 'Daily Pest Control Monitoring Record', status: 'Due' }] },
    model: {
      from: '2026-08-30',
      to: '2026-09-30',
      total: 2,
      records: table([
        { recordId: 'rec-1', documentId: DOC_BRIEF.id, formatNo: 'F/QC/15-A', document: DOC_BRIEF.name, dueDate: '2026-09-30', status: 'In Progress' },
        { recordId: null, documentId: 'daily-pest-monitoring', formatNo: 'F/HR/17', document: 'Daily Pest Control Monitoring Record', dueDate: '2026-09-30', status: 'Due' },
      ]),
    },
  },
  {
    action: 'search_records',
    input: { q: 'Roshni', documentId: 'daily-pest-monitoring', limit: 5 },
    route: 'GET /api/v1/records/search',
    query: { q: 'Roshni', documentId: 'daily-pest-monitoring', limit: '5' },
    answer: { query: 'Roshni', kind: 'words', total: 1, complete: true, hits: [{ ...LIST_ITEM, snippet: 'checked by Roshni' }] },
    model: {
      document: { documentId: DOC_BRIEF.id, formatNo: 'F/QC/15-A', document: DOC_BRIEF.name },
      query: 'Roshni',
      total: 1,
      complete: true,
      hits: [{ recordId: 'rec-1', dueDate: '2026-09-30', status: 'In Progress', snippet: 'checked by Roshni' }],
    },
  },
  { action: 'get_record', input: { recordId: 'rec 1/2' }, route: 'GET /api/v1/records/rec%201%2F2', answer: RECORD, model: RECORD_FOR_MODEL },
  {
    action: 'history_figures',
    input: { question: 'Which machine broke down most this year?', from: '2026-01-01' },
    route: 'GET /api/v1/figures',
    query: { question: 'Which machine broke down most this year?', from: '2026-01-01' },
    answer: { question: 'Which machine broke down most this year?', period: '1 January 2026 to 30 September 2026', from: '2026-01-01', to: '2026-09-30', topics: ['breakdowns'], evidence: ['Machine 4: 3 breakdowns'], sections: [{ heading: 'Breakdowns', facts: [] }], recordIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] },
    model: { question: 'Which machine broke down most this year?', period: '1 January 2026 to 30 September 2026', from: '2026-01-01', to: '2026-09-30', topics: ['breakdowns'], evidence: ['Machine 4: 3 breakdowns'], recordIds: ['r1', 'r2', 'r3', 'r4', 'r5'] },
  },
  { action: 'hr_master_lookup', input: { q: 'Roshni' }, route: 'GET /api/v1/people', query: { q: 'Roshni' }, answer: { query: 'Roshni', people: [{ gp3: 'GP3-101', name: 'Roshni Patel', department: 'HR', designation: 'Officer', joiningDate: null }] } },
  {
    action: 'list_findings',
    input: { status: 'all', q: 'rodent', from: '2023-01-01', to: '2023-12-31' },
    route: 'GET /api/v1/findings',
    query: { status: 'all', q: 'rodent', from: '2023-01-01', to: '2023-12-31', limit: '30' },
    answer: { findings: [{ id: 'CAPA-2023-12-13-2', ref: 'gap-2023-12-13:f-2', status: 'Overdue', link: 'http://dcrs/index.html#/gap/gap-2023-12-13' }], total: 1 },
    model: { findings: [{ id: 'CAPA-2023-12-13-2', ref: 'gap-2023-12-13:f-2', status: 'Overdue' }], total: 1 },
  },
  { action: 'get_finding', input: { id: 'gap-2023-12-13:f-2' }, route: 'GET /api/v1/findings/gap-2023-12-13%3Af-2', answer: { id: 'CAPA-2023-12-13-2', link: 'http://dcrs/index.html#/gap/gap-2023-12-13' } },
  { action: 'list_complaints', input: { q: '26-27/001' }, route: 'GET /api/v1/complaints', query: { q: '26-27/001' }, answer: { complaints: [{ complaintNumber: '26-27/001' }] } },
  {
    action: 'get_pest_control_report_summary',
    input: { date: '2026-09-28' },
    route: 'GET /api/v1/pest-control/daily-report/summary',
    query: { date: '2026-09-28' },
    answer: { date: '2026-09-28', recordId: 'rec-p', rodentsCaught: 0 },
  },
  {
    action: 'equipment_lookup',
    input: { q: 'M-47' },
    route: 'GET /api/v1/equipment',
    query: { q: 'M-47', limit: '8' },
    answer: EQUIPMENT,
    model: {
      query: 'M-47',
      answer: EQUIPMENT.answer,
      exact: 'M-47',
      total: 1,
      list: { formatNo: 'F/MNT/01', name: 'List of Equipments & Utilities', status: 'Verified', machines: 68, numbered: { first: 'M-01', last: 'M-86', count: 68 }, gaps: ['M-05', 'M-22 to M-32', 'M-37 to M-42'] },
      machines: [
        {
          machineNo: 'M-47',
          description: 'UV Flexo Printing Machine',
          model: 'Delta 330',
          manufacturer: 'Lombardi',
          location: 'Lombardi Printing',
          section: 'Flexo',
          size: '330 mm',
          made: 'November 2021',
          serialNo: '88562',
          countryOfOrigin: 'Itlay',
        },
      ],
    },
  },
  {
    action: 'equipment_lookup',
    input: {},
    route: 'GET /api/v1/equipment',
    query: { limit: '8' },
    answer: { ...EQUIPMENT, query: '', answer: null, exact: null, total: 68, machines: [{ ...EQUIPMENT.machines[0], serialNo: null, note: 'F/MNT/01 prints this line one column out of step.' }] },
    model: {
      total: 68,
      list: { formatNo: 'F/MNT/01', name: 'List of Equipments & Utilities', status: 'Verified', machines: 68, numbered: { first: 'M-01', last: 'M-86', count: 68 }, gaps: ['M-05', 'M-22 to M-32', 'M-37 to M-42'] },
      machines: [
        {
          machineNo: 'M-47',
          description: 'UV Flexo Printing Machine',
          model: 'Delta 330',
          manufacturer: 'Lombardi',
          location: 'Lombardi Printing',
          section: 'Flexo',
          size: '330 mm',
          made: 'November 2021',
          countryOfOrigin: 'Itlay',
          note: 'F/MNT/01 prints this line one column out of step.',
        },
      ],
    },
  },
  {
    action: 'insights',
    input: {},
    route: 'GET /api/v1/insights',
    query: { limit: '5' },
    answer: INSIGHTS,
    model: {
      date: '2026-10-02',
      headline: INSIGHTS.headline,
      counts: { high: 1, medium: 0, low: 0 },
      total: 1,
      insights: [
        {
          severity: 'high',
          formatNo: 'F/QC/12',
          title: INSIGHTS.insights[0]!.title,
          detail: INSIGHTS.insights[0]!.detail,
          metric: 'Expired: 766 days ago',
          evidence: [
            { recordId: 'qc-scale-2024-03', dueDate: '2024-03-27', value: '27-Aug-2024' },
            { dueDate: '2024-03-20', value: '27-Aug-2024' },
          ],
          suggestedAction: 'Calibrate QC-76 and write the new expiry on its next sheet.',
        },
      ],
    },
  },
  {
    action: 'escalations',
    input: {},
    route: 'GET /api/v1/escalations',
    query: { open: '1' },
    answer: ESCALATIONS,
    model: {
      summary: ESCALATIONS.summary,
      waiting: 1,
      total: 1,
      week: '2026-W40',
      escalations: [
        {
          subjectName: 'Kapila Barad',
          kind: 'person',
          departmentName: 'Quality Control',
          late: 3,
          neverDone: 0,
          sentence: '3 late in the 30 days to 02-Oct-2026 — F-QC-30: 3 late',
          records: table([1, 2, 3].map((n) => ({ what: 'F-QC-30', dueDate: `2026-09-2${n}`, outcome: 'late', daysLate: n }))),
        },
      ],
    },
  },
  {
    action: 'escalations',
    input: { status: 'all' },
    route: 'GET /api/v1/escalations',
    query: { open: '0' },
    answer: {
      ...ESCALATIONS,
      open: false,
      summary: 'Nothing is escalated to the super admin and waiting to be acknowledged.',
      waiting: 0,
      escalations: [{ ...ESCALATIONS.escalations[0], acknowledged: true, acknowledgedBy: 'Super Admin', acknowledgedAt: '2026-10-02T05:00:00.000Z', records: [] }],
    },
    model: {
      summary: 'Nothing is escalated to the super admin and waiting to be acknowledged.',
      waiting: 0,
      total: 1,
      week: '2026-W40',
      escalations: [
        {
          subjectName: 'Kapila Barad',
          kind: 'person',
          departmentName: 'Quality Control',
          late: 3,
          neverDone: 0,
          sentence: '3 late in the 30 days to 02-Oct-2026 — F-QC-30: 3 late',
          acknowledgedBy: 'Super Admin',
          acknowledgedAt: '2026-10-02T05:00:00.000Z',
        },
      ],
    },
  },
  {
    action: 'open_record',
    input: { documentId: 'F/QC/15-A' },
    route: 'POST /api/v1/records',
    body: { documentId: 'F/QC/15-A' },
    answer: { created: true, record: RECORD },
    model: { created: true, record: RECORD_FOR_MODEL },
  },
  {
    action: 'open_record',
    input: { documentId: DOC_BRIEF.id, date: '2026-09-29' },
    route: 'POST /api/v1/records',
    body: { documentId: DOC_BRIEF.id, date: '2026-09-29' },
    answer: { created: false, record: RECORD },
    model: { created: false, record: RECORD_FOR_MODEL },
  },
  {
    action: 'edit_record',
    input: { recordId: 'rec-1', patch: { itemEdits: [{ collection: 'rows', match: { row: 2 }, set: { status: 'OK' } }] }, note: 'Checked at 9' },
    route: 'POST /api/v1/records/rec-1/changes',
    body: { patch: { itemEdits: [{ collection: 'rows', match: { row: 2 }, set: { status: 'OK' } }] }, note: 'Checked at 9' },
    answer: CHANGED,
    model: CHANGED_FOR_MODEL,
  },
  {
    action: 'record_action',
    input: { recordId: 'rec-1', action: 'submit' },
    route: 'POST /api/v1/records/rec-1/actions',
    body: { action: 'submit' },
    answer: { done: 'submit', did: 'Submitted for verification', ...CHANGED, status: 'Submitted', changes: undefined, problems: undefined },
    model: { done: 'submit', did: 'Submitted for verification', ...CHANGED_FOR_MODEL, status: 'Submitted', changes: undefined, problems: undefined },
  },
  {
    action: 'record_action',
    input: { recordId: 'rec-1', action: 'reopen', reason: 'Wrong time written' },
    route: 'POST /api/v1/records/rec-1/actions',
    body: { action: 'reopen', reason: 'Wrong time written' },
    answer: { done: 'reopen', did: 'Reopened for correction', recordId: 'rec-1', status: 'In Progress' },
  },
  {
    action: 'fill_record_with_sample_data',
    input: { recordId: 'rec-1' },
    route: 'POST /api/v1/records/rec-1/sample-fill',
    answer: { ...CHANGED, summary: ['Line No. 3'], changed: 12, madeUp: true, note: 'Sample values — realistic but made up.' },
    model: { ...CHANGED_FOR_MODEL, summary: ['Line No. 3'], changed: 12, madeUp: true, note: 'Sample values — realistic but made up.' },
  },
  {
    action: 'close_finding',
    input: { id: 'CAPA-2023-12-13-2', note: 'Numbers painted on the walls' },
    route: 'POST /api/v1/findings/CAPA-2023-12-13-2/close',
    body: { note: 'Numbers painted on the walls' },
    answer: { finding: { id: 'CAPA-2023-12-13-2', status: 'Closed' }, history: { note: 'Through Mitra mobile app: Numbers painted on the walls' } },
  },
];

group('the actions', () => {
  it.each(CASES)('$action calls $route as the signed-in person', async (c) => {
    const { connector, seen } = standInDcrs({ [c.route]: () => json(200, c.answer) });
    const action = actionOf(connector.actions, c.action);
    const input = action.input.parse(c.input);
    expect(await action.run(ctx, input)).toEqual(c.model ?? c.answer);
    expect(seen).toHaveLength(1);
    const [method, path] = c.route.split(' ');
    expect(seen[0]).toMatchObject({ method, path, query: c.query ?? {} });
    expect(seen[0]!.body).toEqual(c.body);
    expectSentAsThePerson(seen[0]!);
    if (c.body !== undefined) expect(seen[0]!.headers['content-type']).toBe('application/json');
  });

  it('covers every action in these tests', () => {
    const tested = new Set([...CASES.map((c) => c.action), 'record_pdf', 'get_pest_control_report', 'add_photo_to_record']);
    expect([...tested].sort()).toEqual([...READS, ...WRITES].sort());
  });

  it("hands a record over as the PDF DCRS printed, named as DCRS named it", async () => {
    const name = 'F-QC-05 Line clearance 2026-09-30.pdf';
    const { connector, seen } = standInDcrs({ 'GET /api/v1/records/rec-1/pdf': () => pdfResponse(name) });
    const { result, files } = splitResult(await actionOf(connector.actions, 'record_pdf').run(ctx, { recordId: 'rec-1' }));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: name, mimeType: 'application/pdf', description: 'F-QC-05 Line clearance 2026-09-30, printed by DCRS as a PDF' });
    expect(Buffer.from(files[0]!.data.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(result).toEqual({ recordId: 'rec-1', filename: name, pdfBytes: files[0]!.data.byteLength });
    expectSentAsThePerson(seen[0]!);
    expect(seen[0]!.headers.accept).toContain('application/pdf');
  });

  it("hands over the day's pest control report as a PDF, with a name of its own when DCRS gives none", async () => {
    const { connector, seen } = standInDcrs({
      'GET /api/v1/pest-control/daily-report': () => new Response(Buffer.from('%PDF-1.7'), { headers: { 'content-type': 'application/pdf' } }),
    });
    const { result, files } = splitResult(await actionOf(connector.actions, 'get_pest_control_report').run(ctx, { date: '2026-09-28' }));
    expect(seen[0]).toMatchObject({ path: '/api/v1/pest-control/daily-report', query: { date: '2026-09-28' } });
    expect(files[0]).toMatchObject({ filename: 'F-HR-17 Daily Pest Control Monitoring Record 2026-09-28.pdf', mimeType: 'application/pdf' });
    expect(result).toMatchObject({ date: '2026-09-28' });
  });

  it('refuses a PDF answer that is not a PDF', async () => {
    const { connector } = standInDcrs({ 'GET /api/v1/records/rec-1/pdf': () => json(200, { not: 'a pdf' }) });
    await expect(actionOf(connector.actions, 'record_pdf').run(ctx, { recordId: 'rec-1' })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it("adds a photo from the conversation to a record, as DCRS's photo route takes it", async () => {
    const { connector, seen } = standInDcrs({ 'POST /api/v1/records/rec-1/photos': () => json(200, { ...CHANGED, added: PHOTO.filename, list: 'photos', count: 1 }) });
    const add = actionOf(connector.actions, 'add_photo_to_record');
    expect(await add.describe({ recordId: 'rec-1', fileId: PHOTO.id }, ctx)).toEqual({
      summary: 'Add the photo "line-3 clearance.jpg" to record rec-1',
      input: { recordId: 'rec-1', fileId: PHOTO.id },
    });
    expect(summaryOf(await add.describe({ recordId: 'rec-1', fileId: PHOTO.id, note: 'Line 3 before the job' }, ctx))).toBe(
      'Add the photo "line-3 clearance.jpg" to record rec-1 (note: "Line 3 before the job")',
    );
    expect(await add.run(ctx, { recordId: 'rec-1', fileId: PHOTO.id })).toEqual({ ...CHANGED_FOR_MODEL, added: PHOTO.filename, list: 'photos', count: 1 });
    expect(seen[0]!.body).toEqual({ fileName: 'line-3 clearance.jpg', mimeType: 'image/jpeg', dataBase64: Buffer.from(PHOTO_BYTES).toString('base64') });
    expectSentAsThePerson(seen[0]!);
    await add.run(ctx, { recordId: 'rec-1', fileId: PHOTO.id, note: 'Line 3 before the job' });
    expect(seen[1]!.body).toMatchObject({ note: 'Line 3 before the job' });
  });

  it('turns down a file that is not a photo DCRS keeps, or not in the conversation, before anything is asked', async () => {
    const { connector, seen } = standInDcrs();
    const add = actionOf(connector.actions, 'add_photo_to_record');
    const big = { ...PHOTO, id: 'big', filename: 'full-size.jpg', sizeBytes: 3_000_000 };
    const gif = { ...PHOTO, id: 'gif', filename: 'moving.gif', mimeType: 'image/gif' };
    const withMore = {
      ...ctx,
      files: {
        get: async (fileId: string) =>
          fileId === 'big' ? { info: big, data: new Uint8Array(3_000_000) } : fileId === 'gif' ? { info: gif, data: new Uint8Array(4) } : ctx.files.get(fileId),
      },
    };
    await expect(add.describe({ recordId: 'rec-1', fileId: 'big' }, withMore)).rejects.toMatchObject({ kind: 'invalid_request', message: expect.stringContaining('larger than 512 KB') });
    await expect(add.describe({ recordId: 'rec-1', fileId: 'gif' }, withMore)).rejects.toMatchObject({ kind: 'invalid_request', message: expect.stringContaining('JPEG, PNG or WebP') });
    await expect(add.describe({ recordId: 'rec-1', fileId: SHEET.id }, ctx)).rejects.toMatchObject({ kind: 'invalid_request', message: expect.stringContaining('readings.xlsx') });
    await expect(add.describe({ recordId: 'rec-1', fileId: 'nope' }, ctx)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(add.run(ctx, { recordId: 'rec-1', fileId: SHEET.id })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(seen).toEqual([]);
  });

  it('needs a stored sign-in', async () => {
    const { connector, seen } = standInDcrs();
    await expect(actionOf(connector.actions, 'todays_facts').run({ ...ctx, credentials: undefined }, {})).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(seen).toEqual([]);
  });

  it('checks the inputs before anything runs', () => {
    const { connector } = standInDcrs();
    const parse = (name: string, input: unknown) => actionOf(connector.actions, name).input.safeParse(input).success;
    expect(parse('list_records', { documentId: 'd', from: '2026-02-30' })).toBe(false);
    expect(parse('list_records', { documentId: 'd', from: '30/09/2026' })).toBe(false);
    expect(parse('list_records', { documentId: '  ' })).toBe(false);
    expect(parse('get_pest_control_report', {})).toBe(false);
    expect(parse('get_pest_control_report', { date: '2026-09-28' })).toBe(true);
    expect(parse('record_action', { recordId: 'r', action: 'approve' })).toBe(false);
    expect(parse('close_finding', { id: 'CAPA-1', note: '' })).toBe(false);
    expect(parse('close_finding', { id: 'CAPA-1', note: 'x'.repeat(1001) })).toBe(false);
    expect(parse('find_documents', { limit: 51 })).toBe(false);
    expect(parse('edit_record', { recordId: 'r', patch: 'temperature=4' })).toBe(false);
    expect(parse('equipment_lookup', { q: '  ' })).toBe(false);
    expect(parse('equipment_lookup', {})).toBe(true);
    expect(parse('escalations', { status: 'closed' })).toBe(false);
    expect(parse('escalations', { status: 'all' })).toBe(true);
  });

  it('names the newer lookups in plain words, for the activity shown in the chat', async () => {
    const { connector } = standInDcrs();
    const words = (name: string, input: Record<string, unknown>) => {
      const action = actionOf(connector.actions, name);
      return action.describe(action.input.parse(input), ctx);
    };
    expect(await words('equipment_lookup', { q: 'M-47' })).toBe('Look up "M-47" on the equipment list (F/MNT/01)');
    expect(await words('equipment_lookup', {})).toBe('Read the equipment list (F/MNT/01)');
    expect(await words('insights', {})).toBe('Read what stands out in the records');
    expect(await words('escalations', {})).toBe('Read the escalations waiting for the super admin');
    expect(await words('escalations', { status: 'all' })).toBe('Read the escalations of the last 30 days');
  });
});

group('what the person is asked to confirm', () => {
  const words = async (name: string, input: Record<string, unknown>) => {
    const { connector } = standInDcrs({
      'GET /api/v1/documents/daily-pest-monitoring': () => json(200, PEST_DOC),
      'GET /api/v1/documents/F-QC-15-A': () => json(200, DOC_BRIEF),
    });
    const action = actionOf(connector.actions, name);
    return summaryOf(await action.describe(action.input.parse(input), ctx));
  };

  it('says each change in plain words, from the call itself, naming the document as DCRS does', async () => {
    expect(await words('open_record', { documentId: 'daily-pest-monitoring' })).toBe(
      "Open today's record of F/HR/17 Daily Pest Control Monitoring Record, starting it if there is none yet",
    );
    expect(await words('open_record', { documentId: 'F-QC-15-A', date: '2026-09-29' })).toBe(
      'Open the record of F/QC/15-A Area Line Clearance – Printing for 2026-09-29, starting it if there is none yet',
    );
    expect(await words('edit_record', { recordId: 'rec-1', patch: { temperature: 4, remarks: 'All clear' }, note: 'Reading at 9' })).toBe(
      'In record rec-1, set temperature to 4; remarks to "All clear" (note: "Reading at 9")',
    );
    expect(await words('record_action', { recordId: 'rec-1', action: 'submit' })).toBe('Submit record rec-1');
    expect(await words('record_action', { recordId: 'rec-1', action: 'verify' })).toBe('Verify (approve) record rec-1');
    expect(await words('record_action', { recordId: 'rec-1', action: 'send_back', reason: 'Sign the sheet' })).toBe('Send record rec-1 back for changes, saying "Sign the sheet"');
    expect(await words('record_action', { recordId: 'rec-1', action: 'resume' })).toMatch(/^Resume record rec-1/);
    expect(await words('record_action', { recordId: 'rec-1', action: 'reopen', reason: 'Wrong time' })).toBe('Reopen record rec-1 for correction, because "Wrong time"');
    expect(await words('record_action', { recordId: 'rec-1', action: 'cancel_correction' })).toBe('Cancel the correction of record rec-1 and put it back as it was');
    expect(await words('record_action', { recordId: 'rec-1', action: 'delete', reason: 'Started twice' })).toBe('Delete record rec-1, because "Started twice"');
    expect(await words('fill_record_with_sample_data', { recordId: 'rec-1' })).toMatch(/^Fill record rec-1 with sample data/);
    expect(await words('close_finding', { id: 'CAPA-2023-12-13-2', note: 'Painted' })).toBe('Close CAPA finding CAPA-2023-12-13-2 with the note: "Painted"');
  });

  it('asks for the reason DCRS needs before offering the change', async () => {
    for (const action of ['send_back', 'reopen', 'delete']) {
      await expect(words('record_action', { recordId: 'rec-1', action })).rejects.toMatchObject({ kind: 'invalid_request', message: expect.stringMatching(/reason is needed/) });
    }
    await expect(words('edit_record', { recordId: 'rec-1', patch: {} })).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('says every shape of patch in words', () => {
    expect(patchInWords({ header: { shift: 'A', operator: 'Kapila' }, itemEdits: [{ collection: 'rows', match: { machine: 'M-4' }, set: { status: 'OK', reading: 12 } }] })).toBe(
      'shift to "A"; operator to "Kapila"; in rows where machine "M-4": set status "OK", reading 12',
    );
    expect(patchInWords({ checkpoints: { '1': 'Yes', '4': { value: 100 } } })).toBe('check point 1 to "Yes"; check point 4 to 100');
    expect(patchInWords({ remarks: '' , signed: true, list: [1, 2] })).toBe('remarks to blank; signed to true; list to [1,2]');
    const long = patchInWords(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field${i}`, 'a value of some length'])), 200);
    expect(long.length).toBeLessThan(260);
    expect(long).toMatch(/; and \d+ more$/);
  });
});

group("DCRS's refusals", () => {
  const refusedWith = async (answer: Route, kind: string, message: string | RegExp, action = 'get_record', input: Record<string, unknown> = { recordId: 'rec-1' }) => {
    const route = action === 'get_record' ? 'GET /api/v1/records/rec-1' : action === 'edit_record' ? 'POST /api/v1/records/rec-1/changes' : 'POST /api/v1/records/rec-1/actions';
    const { connector } = standInDcrs({ [route]: answer });
    const error = await actionOf(connector.actions, action)
      .run(ctx, input)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).kind).toBe(kind);
    if (typeof message === 'string') expect((error as ConnectorError).message).toBe(message);
    else expect((error as ConnectorError).message).toMatch(message);
  };

  it('400 is a request DCRS turned down, in its words', async () => {
    await refusedWith(() => refusal(400, 'bad-request', 'from and to must be dates written YYYY-MM-DD.'), 'invalid_request', 'from and to must be dates written YYYY-MM-DD.');
    await refusedWith(() => new Response('nope', { status: 400 }), 'invalid_request', 'DCRS turned the request down.');
  });

  it('401 is a sign-in that has ended, so the person signs in again', async () => {
    await refusedWith(() => refusal(401, 'not-signed-in', 'Not signed in, or the session has ended. Sign in again with POST /api/auth/login.'), 'unauthorized', /sign-in has ended.*Sign in again/);
  });

  it("403 says why in DCRS's words: working hours, department, password", async () => {
    const closed = 'DCRS is closed now: working hours ended at 6:20 pm. It opens again tomorrow, Thursday 1 October, at 8:40 am.';
    await refusedWith(() => refusal(403, 'outside-working-hours', closed, { opensAt: '2026-10-01T03:10:00.000Z' }), 'forbidden', closed);
    await refusedWith(
      () => refusal(403, 'not-your-department', 'The daily pest control reports belong to Human Resources, and this account is not kept to it.'),
      'forbidden',
      'The daily pest control reports belong to Human Resources, and this account is not kept to it.',
    );
    await refusedWith(() => refusal(403, 'password-change-required', 'Choose a password of your own first.'), 'forbidden', 'Choose a password of your own first.');
  });

  it("the escalations are the super admin's and the equipment list is Maintenance's, in DCRS's own words", async () => {
    const adminOnly = "Escalations are the super admin's alone: they name people, so no other account is shown them.";
    const maintenance = 'F/MNT/01 List of Equipments & Utilities is kept by Maintenance, and this account is not kept to it. Ask the super admin for access.';
    const { connector } = standInDcrs({
      'GET /api/v1/escalations': () => refusal(403, 'super-admin-only', adminOnly),
      'GET /api/v1/equipment': () => refusal(403, 'not-your-department', maintenance),
    });
    await expect(actionOf(connector.actions, 'escalations').run(ctx, {})).rejects.toMatchObject({ kind: 'forbidden', message: adminOnly });
    await expect(actionOf(connector.actions, 'equipment_lookup').run(ctx, { q: 'M-47' })).rejects.toMatchObject({ kind: 'forbidden', message: maintenance });
    // A DCRS from before these routes says it has no such route: the person hears DCRS needs updating.
    const { connector: older } = standInDcrs();
    await expect(actionOf(older.actions, 'insights').run(ctx, {})).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringMatching(/needs updating/) });
  });

  it("404 is something DCRS doesn't have; a route it doesn't have means DCRS needs updating", async () => {
    await refusedWith(() => refusal(404, 'not-found', 'There is no record "rec-1".'), 'not_found', 'There is no record "rec-1".');
    await refusedWith(() => refusal(404, 'no-such-route', 'There is no such route in the DCRS API.'), 'unavailable', /needs updating/);
  });

  it('409 is a change the record refuses as it stands, with the problems and what to do', async () => {
    await refusedWith(
      () => refusal(409, 'needs-reopen', 'The Daily Pest Control Monitoring Record of 29 September is Verified and cannot be changed as it stands.'),
      'conflict',
      'The Daily Pest Control Monitoring Record of 29 September is Verified and cannot be changed as it stands. To correct it, it must first be reopened for correction, with a reason.',
      'edit_record',
      { recordId: 'rec-1', patch: { remarks: 'x' } },
    );
    await refusedWith(
      () => refusal(409, 'invalid', 'The record cannot be submitted yet.', { problems: ['Time of checking is required', { field: 'checker', label: 'Checked by', message: 'is required' }] }),
      'conflict',
      'The record cannot be submitted yet: Time of checking is required; Checked by: is required.',
      'record_action',
      { recordId: 'rec-1', action: 'submit' },
    );
    await refusedWith(() => refusal(409, 'busy', 'The records kept changing while this was being saved. Try again in a moment.'), 'conflict', /Try again in a moment/);
  });

  it('413, 429 and 5xx', async () => {
    await refusedWith(() => json(413, { error: 'That photo is too large.' }), 'invalid_request', 'That photo is too large.');
    await refusedWith(() => new Response('too big', { status: 413 }), 'invalid_request', 'That is too large for DCRS to take.');
    await refusedWith(() => json(429, { error: 'Too many requests. Try again in a minute.' }), 'unavailable', 'Too many requests. Try again in a minute.');
    await refusedWith(() => refusal(503, 'pdf-unavailable', 'This DCRS server cannot print a PDF.'), 'unavailable', 'This DCRS server cannot print a PDF.');
    await refusedWith(() => refusal(504, 'pdf-timeout', 'Printing the report took too long. Try again in a moment.'), 'unavailable', 'Printing the report took too long. Try again in a moment.');
    await refusedWith(() => json(500, { error: 'TypeError: x is undefined' }), 'unavailable', "DCRS couldn't do that just now. Try again in a moment.");
  });

  it('an answer that is not JSON, no answer, or one too slow', async () => {
    await refusedWith(() => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'unavailable', /does not understand/);
    await refusedWith(() => Promise.reject(new TypeError('fetch failed')), 'unavailable', /couldn't be reached/);
    const slow = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    await refusedWith(() => Promise.reject(slow), 'unavailable', 'DCRS took too long to answer. Try again in a moment.');
  });
});

group('keeping answers small for the model', () => {
  it('leaves a small answer as it is and shortens a long one, saying so', () => {
    const small = { records: [{ recordId: 'r1' }] };
    expect(fit(small, 1_000)).toBe(small);
    const long = { records: Array.from({ length: 300 }, (_, i) => ({ recordId: `rec-${i}`, remarks: 'x'.repeat(300) })), count: 300 };
    const shortened = fit(long, 4_000) as { records: unknown[]; count: number; shortened: string };
    expect(JSON.stringify(shortened).length).toBeLessThanOrEqual(4_000);
    expect(shortened.count).toBe(300);
    expect(shortened.shortened).toBe(SHORTENED);
    expect(shortened.records.at(-1)).toMatch(/^…and \d+ more not shown$/);
    expect(fit(Array.from({ length: 500 }, () => 'word'), 500)).toMatchObject({ shortened: SHORTENED });
  });

  it("keeps a long record's field keys and patch shape, and leaves out what does not fit, saying so", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ check: `Check point ${i + 1} on the line`, status: 'OK', remarks: 'All clear before the job started' }));
    const big = {
      ...RECORD,
      layout: { ...RECORD.layout, rows: { mode: 'fixedRows', fixed: 300, count: 300 } },
      inWords: rows.map((row, i) => ({ where: `row ${i + 1}`, label: 'Status', value: row.status })),
      data: { header: { lineNo: '3' }, rows },
    };
    const shaped = recordForModel(big) as Record<string, unknown>;
    expect(JSON.stringify(shaped).length).toBeLessThanOrEqual(4_500);
    expect(shaped).toMatchObject({ recordId: 'rec-1', status: 'In Progress', editable: true, actions: ['submit', 'delete'], patchShape: RECORD.patchShape });
    const { footer: _, ...layout } = big.layout;
    expect(shaped.layout).toEqual(layout);
    expect(shaped.data).toBeUndefined();
    expect(shaped.leftOut).toMatch(/Not shown, to keep this brief: .*data/);
    expect(JSON.stringify(shaped.values)).toMatch(/more not shown/);
    // An answer of another shape is only cut to the budget.
    expect(recordForModel('odd')).toBe('odd');
  });

  it("keeps today's overdue and due work ahead of the rest", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...LIST_ITEM, recordId: `rec-${i}`, document: `A document with a long name, number ${i}` }));
    const shaped = todayForModel({ date: '2026-09-30', day: { date: '2026-09-30', label: 'Working day' }, overdue: many, due: many, upcoming: many, facts: 'x'.repeat(2_000) }) as Record<string, unknown>;
    expect(JSON.stringify(shaped).length).toBeLessThanOrEqual(3_000);
    expect(shaped.date).toBe('2026-09-30');
    expect(JSON.stringify(shaped.overdue)).toContain('rec-0');
    expect(shaped.leftOut).toMatch(/Not shown/);
  });

  it("keeps DCRS's own reply about a machine, and as many machines as fit", () => {
    const machines = Array.from({ length: 60 }, (_, i) => ({ ...EQUIPMENT.machines[0], machineNo: `M-${i}`, description: 'A machine with a long description, '.repeat(4) }));
    const shaped = equipmentForModel({ ...EQUIPMENT, exact: null, total: 60, machines }) as Record<string, unknown>;
    expect(JSON.stringify(shaped).length).toBeLessThanOrEqual(4_500);
    expect(shaped.answer).toBe(EQUIPMENT.answer);
    expect(JSON.stringify(shaped.machines)).toContain('M-0');
    expect(shaped.cutShort).toMatch(/machines/);
    expect(JSON.stringify(shaped)).not.toContain('/document/');
    expect(equipmentForModel('odd')).toBe('odd');
  });

  it('keeps the insights headline ahead of the insights, and the escalations line ahead of the escalations', () => {
    const insights = Array.from({ length: 20 }, (_, i) => ({ ...INSIGHTS.insights[0], title: `Insight ${i}`, detail: 'x'.repeat(400) }));
    const shaped = insightsForModel({ ...INSIGHTS, total: 20, insights }) as Record<string, unknown>;
    expect(JSON.stringify(shaped).length).toBeLessThanOrEqual(3_000);
    expect(shaped.headline).toBe(INSIGHTS.headline);
    expect(JSON.stringify(shaped.insights)).toContain('Insight 0');
    const escalations = Array.from({ length: 30 }, (_, i) => ({ ...ESCALATIONS.escalations[0], subjectName: `Person ${i}` }));
    const brief = escalationsForModel({ ...ESCALATIONS, waiting: 30, total: 30, escalations }) as Record<string, unknown>;
    expect(JSON.stringify(brief).length).toBeLessThanOrEqual(3_000);
    expect(brief.summary).toBe(ESCALATIONS.summary);
    expect(JSON.stringify(brief.escalations)).toContain('Person 0');
  });

  it("drops the web app's routes, and its links from lists", () => {
    expect(without({ records: [{ recordId: 'r', route: '/record/r', link: 'http://x' }], link: 'http://y' }, WEB_ONLY_IN_LISTS)).toEqual({ records: [{ recordId: 'r' }] });
  });

  it('shortens what an action hands the model', async () => {
    const records = Array.from({ length: 200 }, (_, i) => ({ ...LIST_ITEM, recordId: `rec-${i}`, route: `/record/rec-${i}` }));
    const { connector } = standInDcrs({ 'GET /api/v1/records': () => json(200, { document: DOC_BRIEF, total: 200, records }) });
    const result = (await actionOf(connector.actions, 'list_records').run(ctx, { documentId: 'd' })) as { records: unknown[]; total: number; shortened: string };
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(3_000);
    expect(result.total).toBe(200);
    expect(JSON.stringify(result)).not.toContain('/record/');
    expect(result.shortened).toBe(SHORTENED);
  });
});

it('joins routes onto a base URL with a path of its own', async () => {
  const seen: string[] = [];
  const connector = createDcrsConnector({
    baseUrl: `${BASE}/dcrs/`,
    fetch: (async (input: string | URL | Request) => {
      seen.push(String(input));
      return json(200, { documents: [] });
    }) as typeof fetch,
  });
  await actionOf(connector.actions, 'find_documents').run(ctx, { q: 'F/HR/17' });
  expect(seen).toEqual([`${BASE}/dcrs/api/v1/documents?q=F%2FHR%2F17&limit=20`]);
});

group('naming a record by its document', () => {
  const day = (records: unknown[]) => json(200, { document: DOC_BRIEF, from: '2026-09-30', to: '2026-09-30', total: records.length, records });
  const describeOf = async (routes: Record<string, Route>, name: string, input: Record<string, unknown>) => {
    const { connector, seen } = standInDcrs(routes);
    const action = actionOf(connector.actions, name);
    const said = await action.describe(action.input.parse(input), ctx);
    return { said, seen };
  };
  const LABEL = 'F/QC/15-A Area Line Clearance – Printing';

  it("names today's record of a document by its format number, asking DCRS which record that is", async () => {
    const { said, seen } = await describeOf({ 'GET /api/v1/records': () => day([LIST_ITEM]) }, 'fill_record_with_sample_data', { documentId: 'F-QC-15-A' });
    expect(said).toEqual({ summary: `Fill today's record of ${LABEL} with sample data (made up and marked so; it stays a draft)`, input: { recordId: 'rec-1' } });
    expect(seen).toMatchObject([{ method: 'GET', path: '/api/v1/records', query: { documentId: 'F-QC-15-A', from: 'today', to: 'today', limit: '5' } }]);
    expectSentAsThePerson(seen[0]!);
  });

  it('starts a record not started yet as part of a change, says so on the card, and tells the model', async () => {
    const { said } = await describeOf({ 'GET /api/v1/records': () => day([]) }, 'fill_record_with_sample_data', { documentId: 'F-QC-15-A' });
    expect(said).toEqual({
      summary: `Start today's record of ${LABEL} and fill it with sample data (made up and marked so; it stays a draft)`,
      input: { documentId: DOC_BRIEF.id, date: '2026-09-30' },
    });
    // When it runs, the record is started first, then filled.
    const { connector, seen } = standInDcrs({
      'POST /api/v1/records': () => json(201, { created: true, record: RECORD }),
      'POST /api/v1/records/rec-1/sample-fill': () => json(200, CHANGED),
    });
    const result = await actionOf(connector.actions, 'fill_record_with_sample_data').run(ctx, { documentId: DOC_BRIEF.id, date: '2026-09-30' });
    expect(result).toEqual({ started: 'The record was started first.', ...CHANGED_FOR_MODEL });
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/v1/records', 'POST /api/v1/records/rec-1/sample-fill']);
    expect(seen[0]!.body).toEqual({ documentId: DOC_BRIEF.id, date: '2026-09-30' });
  });

  it('edits and photographs a record by its document too, and names a dated record as such', async () => {
    const { said } = await describeOf({ 'GET /api/v1/records': () => day([LIST_ITEM]) }, 'edit_record', { documentId: 'F-QC-15-A', date: '2026-09-29', patch: { lineNo: '4' } });
    expect(said).toEqual({ summary: `In the record of ${LABEL} for 2026-09-29, set lineNo to "4"`, input: { recordId: 'rec-1', patch: { lineNo: '4' } } });
    const empty = await describeOf({ 'GET /api/v1/records': () => day([]) }, 'edit_record', { documentId: 'F-QC-15-A', patch: { lineNo: '4' } });
    expect(summaryOf(empty.said)).toBe(`Start today's record of ${LABEL} and set lineNo to "4"`);
    const photo = await describeOf({ 'GET /api/v1/records': () => day([]) }, 'add_photo_to_record', { documentId: 'F-QC-15-A', fileId: PHOTO.id });
    expect(summaryOf(photo.said)).toBe(`Start today's record of ${LABEL} and add the photo "line-3 clearance.jpg" to it`);
  });

  it('reads, prints and moves on only a record that exists, and says how to start one', async () => {
    const { said, seen } = await describeOf({ 'GET /api/v1/records': () => day([LIST_ITEM]) }, 'get_record', { documentId: 'F-QC-15-A' });
    expect(said).toEqual({ summary: `Read today's record of ${LABEL}`, input: { recordId: 'rec-1' } });
    expect(seen).toHaveLength(1);
    const { connector } = standInDcrs({ 'GET /api/v1/records': () => day([]) });
    for (const [name, input] of [['get_record', {}], ['record_pdf', {}], ['record_action', { action: 'submit' }]] as const) {
      const action = actionOf(connector.actions, name);
      await expect(action.describe(action.input.parse({ documentId: 'F-QC-15-A', ...input }), ctx)).rejects.toMatchObject({
        kind: 'not_found',
        message: `There is no record of ${LABEL} for today yet. open_record starts one.`,
      });
    }
    const submit = actionOf(connector.actions, 'record_action');
    expect(summaryOf(await submit.describe({ recordId: 'rec-1', action: 'submit' }, ctx))).toBe('Submit record rec-1');
  });

  it('turns down a call that names neither a record nor a document, and a day with two records', async () => {
    const { connector } = standInDcrs({ 'GET /api/v1/records': () => day([LIST_ITEM, { ...LIST_ITEM, recordId: 'rec-2' }]) });
    const read = actionOf(connector.actions, 'get_record');
    await expect(read.describe({}, ctx)).rejects.toMatchObject({ kind: 'invalid_request', message: 'Say which record: its recordId, or its documentId with the date.' });
    await expect(read.run(ctx, {})).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(read.describe({ documentId: 'F-QC-15-A' }, ctx)).rejects.toMatchObject({
      kind: 'conflict',
      message: `${LABEL} has 2 records for that day: rec-1, rec-2. Say which one, by its recordId.`,
    });
  });

  it("passes DCRS's own answer on when a name fits several documents, with the documents it could mean", async () => {
    const { connector } = standInDcrs({
      'GET /api/v1/records': () =>
        refusal(400, 'ambiguous', 'Several documents answer "line clearance" — say which one, by its id or its format number.', {
          candidates: [DOC_BRIEF, { id: 'qc-line-clearance-slitting', formatNo: 'F/QC/15-G', name: 'Area Line Clearance – Slitting' }],
        }),
    });
    const read = actionOf(connector.actions, 'get_record');
    await expect(read.describe({ documentId: 'line clearance' }, ctx)).rejects.toMatchObject({
      kind: 'invalid_request',
      message:
        'Several documents answer "line clearance" — say which one, by its id or its format number. They are: F/QC/15-A Area Line Clearance – Printing (qc-line-clearance-printing); F/QC/15-G Area Line Clearance – Slitting (qc-line-clearance-slitting).',
    });
  });

  it("says in the assistant's own terms, not DCRS's web API's, that no document fits the words", async () => {
    // DCRS's answer points to its web API, which the model would repeat to the person.
    const none = () => refusal(404, 'not-found', 'No document matches "No Such Format XYZ". Find it with GET /api/v1/documents?q=… first.');
    const plain = { kind: 'not_found', message: 'No document matches "No Such Format XYZ". Look it up with find_documents, or say its format number.' };
    const { connector } = standInDcrs({
      'GET /api/v1/records': none,
      'GET /api/v1/records/search': none,
      'GET /api/v1/documents/No%20Such%20Format%20XYZ': none,
    });
    const named = { documentId: 'No Such Format XYZ' };
    // Changes and reads that name a record by its document, as their card or sentence is made.
    for (const [name, input] of [
      ['fill_record_with_sample_data', named],
      ['open_record', named],
      ['get_record', named],
      ['record_action', { ...named, action: 'submit' }],
    ] as const) {
      const action = actionOf(connector.actions, name);
      await expect(action.describe(action.input.parse(input), ctx), name).rejects.toMatchObject(plain);
    }
    // Reads that name a document when they run.
    for (const [name, input] of [
      ['get_document', named],
      ['list_records', named],
      ['search_records', { ...named, q: 'viscosity' }],
    ] as const) {
      const action = actionOf(connector.actions, name);
      await expect(action.run(ctx, action.input.parse(input)), name).rejects.toMatchObject(plain);
    }
    // Any other refusal stays in DCRS's words, such as a document another department keeps.
    const kept = standInDcrs({ 'GET /api/v1/records': () => refusal(403, 'forbidden', 'F/HR/17 is kept by Human Resources, not your department.') });
    const read = actionOf(kept.connector.actions, 'get_record');
    await expect(read.describe({ documentId: 'F/HR/17' }, ctx)).rejects.toMatchObject({
      kind: 'forbidden',
      message: 'F/HR/17 is kept by Human Resources, not your department.',
    });
  });
});
