// A stand-in DCRS for the connector's tests: a fetch that answers like DCRS's API (docs/chatbot-integration.md in DCRS)
// and records every request it was sent, headers and body included.
import type { FileInfo } from '@shared/api.ts';
import { createDcrsConnector } from '../src/connectors/dcrs/index.ts';
import { ConnectorError, type Action, type ActionContext } from '../src/connectors/types.ts';

export const BASE = 'http://dcrs.test:4000';
/** The moment the tests call "now", so a cookie's Max-Age gives a known end. */
export const NOW = Date.parse('2026-09-30T04:20:00.000Z');
export const TOKEN = 'eyJ.dcrs-session.token';

export interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export type Route = (request: Seen) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** A refusal in DCRS's shape: words for the person and a code for the program. */
export function refusal(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error, code, ...extra });
}

export function pdfResponse(filename: string, bytes = Buffer.from('%PDF-1.7\n% stand-in\n')): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'content-length': String(bytes.length) },
  });
}

/** DCRS's answer to a right email and password: the account, and the session token in the dcrs_session cookie. */
export function signedIn(options: { maxAge?: number; expires?: string; endsAt?: string; mustChangePassword?: boolean; cookie?: string | null } = {}): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (options.cookie !== null) {
    headers.append(
      'set-cookie',
      options.cookie ??
        [
          `dcrs_session=${TOKEN}`,
          ...(options.maxAge === undefined ? [] : [`Max-Age=${options.maxAge}`]),
          'Path=/',
          ...(options.expires ? [`Expires=${options.expires}`] : []),
          'HttpOnly',
          'SameSite=Lax',
        ].join('; '),
    );
  }
  headers.append('set-cookie', 'unrelated=1; Path=/');
  const body = {
    user: { id: 'u-kapila', name: 'Kapila Barad', email: 'kapila.barad@gpp.local', role: 'staff', departments: ['QC'] },
    features: { demoMode: false, signup: false, assistant: false },
    mustChangePassword: options.mustChangePassword ?? false,
    ...(options.endsAt ? { session: { endsAt: options.endsAt, signOutAtEnd: true, now: new Date(NOW).toISOString() } } : {}),
  };
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export const ME = { id: '3f1c2d4e-5b6a-4c7d-8e9f-0a1b2c3d4e5f', name: 'Kapila Barad', email: 'kapila.barad@gpp.local', role: 'staff', departments: ['QC'] };

/** A fetch that answers from `routes` ("METHOD /path") and records what it was sent. Unknown routes answer as DCRS does. */
export function standInDcrs(routes: Record<string, Route> = {}) {
  const seen: Seen[] = [];
  const all: Record<string, Route> = {
    'POST /api/auth/login': () => signedIn({ maxAge: 30_600 }),
    'GET /api/v1/me': () => json(200, ME),
    'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    ...routes,
  };
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    seen.push(request);
    const route = all[`${request.method} ${request.path}`];
    if (!route) return refusal(404, 'no-such-route', 'There is no such route in the DCRS API. See /api/v1/openapi.json.');
    return route(request);
  }) as typeof fetch;
  const connector = createDcrsConnector({ baseUrl: BASE, fetch: fetchStub, now: () => NOW });
  return { connector, seen, routes: all, fetch: fetchStub };
}

export function actionOf(actions: readonly Action[], name: string): Action {
  const found = actions.find((a) => a.name === name);
  if (!found) throw new Error(`The DCRS connector has no ${name}`);
  return found;
}

// DCRS's answers, shaped as its engine writes them (frontend/src/engineHost/entry.ts in DCRS).

export const DOC_BRIEF = {
  id: 'qc-line-clearance-printing',
  formatNo: 'F/QC/15-A',
  name: 'Area Line Clearance – Printing',
  module: 'Quality Control',
  section: null,
  kind: 'log-sheet',
  schedule: { frequency: 'daily', rule: 'Every working day' },
  department: { code: 'QC', name: 'Quality Control' },
  revisionNo: '00',
  referenceOnly: false,
  route: '/document/qc-line-clearance-printing',
};

export const LIST_ITEM = {
  recordId: 'rec-1',
  started: true,
  documentId: DOC_BRIEF.id,
  formatNo: DOC_BRIEF.formatNo,
  document: DOC_BRIEF.name,
  dueDate: '2026-09-30',
  status: 'In Progress',
  updatedAt: '2026-09-30T05:00:00.000Z',
  route: '/record/rec-1',
};

const historyEntry = (n: number) => ({
  at: `2026-09-30T0${n}:00:00.000Z`,
  by: 'Kapila Barad',
  action: n === 1 ? 'created' : 'assistant-edit',
  ...(n === 1 ? {} : { note: `Through Mitra mobile app: change ${n}`, changes: [{ label: 'Status', before: '', after: 'OK' }] }),
});

export const RECORD = {
  recordId: 'rec-1',
  documentId: DOC_BRIEF.id,
  document: { id: DOC_BRIEF.id, formatNo: DOC_BRIEF.formatNo, name: DOC_BRIEF.name, kind: 'log-sheet', module: 'Quality Control', department: { code: 'QC', name: 'Quality Control' } },
  date: '2026-09-30',
  status: 'In Progress',
  editable: true,
  canReopen: false,
  actions: ['submit', 'delete'],
  correction: null,
  prepared: { at: '2026-09-30T03:10:00.000Z', notes: ['Line numbers carried from yesterday'], basedOn: 'rec-0' },
  photos: null,
  layout: {
    kind: 'log-sheet',
    header: [{ key: 'lineNo', label: 'Line No.', type: 'text', required: true }],
    footer: [],
    columns: [
      { key: 'check', label: 'Check point', type: 'text', printed: true },
      { key: 'status', label: 'Status', type: 'select', options: ['OK', 'Not OK'] },
    ],
    rows: { mode: 'fixedRows', fixed: 2, count: 2 },
  },
  patchShape: 'A box: {"header": {"<box key>": value}}. One line: {"itemEdits": [{"collection": "rows", "match": {"row": 2}, "set": {"<column key>": value}}]}.',
  inWords: [
    { label: 'Line No.', value: '3' },
    { where: 'row 1', label: 'Status', value: 'OK' },
  ],
  data: { header: { lineNo: '3' }, rows: [{ check: 'Floor clean', status: 'OK' }, { check: 'No old labels', status: '' }] },
  history: [1, 2, 3, 4, 5, 6].map(historyEntry),
  historyTotal: 6,
  route: '/record/rec-1',
  createdAt: '2026-09-30T01:00:00.000Z',
  updatedAt: '2026-09-30T06:00:00.000Z',
};

/** What the model is given of RECORD: what it is and what can be done first, the last four history entries in brief, and nothing of the web app's. */
export const RECORD_FOR_MODEL = {
  recordId: 'rec-1',
  documentId: DOC_BRIEF.id,
  document: { formatNo: 'F/QC/15-A', name: DOC_BRIEF.name, kind: 'log-sheet', department: 'Quality Control' },
  date: '2026-09-30',
  status: 'In Progress',
  editable: true,
  canReopen: false,
  actions: ['submit', 'delete'],
  prepared: { at: '2026-09-30T03:10:00.000Z', notes: ['Line numbers carried from yesterday'] },
  patchShape: RECORD.patchShape,
  layout: RECORD.layout,
  inWords: RECORD.inWords,
  history: [3, 4, 5, 6].map((n) => ({ at: `2026-09-30T0${n}:00:00.000Z`, by: 'Kapila Barad', action: 'assistant-edit', note: `Through Mitra mobile app: change ${n}`, fieldsChanged: 1 })),
  historyTotal: 6,
  data: RECORD.data,
};

/** What a change answers (changeSummary in DCRS's engine), with the fields it changed. */
export const CHANGED = {
  recordId: 'rec-1',
  status: 'In Progress',
  editable: true,
  actions: ['submit', 'delete'],
  history: [{ at: '2026-09-30T07:00:00.000Z', by: 'Kapila Barad', action: 'assistant-edit', note: 'Through Mitra mobile app: Checked at 9', changes: [{ label: 'Status', before: '', after: 'OK' }] }],
  route: '/record/rec-1',
  changes: [{ label: 'Status', before: '', after: 'OK' }],
  problems: [],
};
export const CHANGED_FOR_MODEL = {
  recordId: 'rec-1',
  status: 'In Progress',
  editable: true,
  actions: ['submit', 'delete'],
  history: [{ at: '2026-09-30T07:00:00.000Z', by: 'Kapila Barad', action: 'assistant-edit', note: 'Through Mitra mobile app: Checked at 9', fieldsChanged: 1 }],
  changes: [{ label: 'Status', before: '', after: 'OK' }],
  problems: [],
};

/** GET /api/v1/equipment?q=M-47: the equipment list, F/MNT/01, as DCRS's engine answers for a Maintenance account. */
export const MACHINE_M47 = {
  machineNo: 'M-47',
  description: 'UV Flexo Printing Machine',
  model: 'Delta 330',
  manufacturer: 'Lombardi',
  location: 'Lombardi Printing',
  section: 'Flexo',
  size: '330 mm',
  month: 'November',
  year: '2021',
  serialNo: '88562',
  countryOfOrigin: 'Itlay',
  summary: 'M-47 · UV Flexo Printing Machine · Delta 330 · Lombardi Printing',
};
export const EQUIPMENT = {
  query: 'M-47',
  list: {
    documentId: 'mnt-equipment-list',
    formatNo: 'F/MNT/01',
    name: 'List of Equipments & Utilities',
    recordId: 'seed-mnt-equipment-list-2026-09-29',
    date: '2026-09-29',
    status: 'Verified',
    machines: 68,
    numbered: { first: 'M-01', last: 'M-86', count: 68 },
    gaps: ['M-05', 'M-22 to M-32', 'M-37 to M-42'],
    route: '/document/mnt-equipment-list',
    link: `${BASE}/index.html#/document/mnt-equipment-list`,
  },
  answer: 'M-47, as F/MNT/01 (List of Equipments & Utilities) writes it:\n• Machine Description: UV Flexo Printing Machine\n• Machine Name / Model No.: Delta 330',
  exact: 'M-47',
  total: 1,
  machines: [MACHINE_M47],
};

/** GET /api/v1/insights: what stands out in a QC account's records. */
export const INSIGHTS = {
  date: '2026-10-02',
  headline: 'Insights (1 high, 0 medium, 0 low): [high] Device QC-76 (F/QC/12): calibration expired on 27-Aug-2024, 766 days ago;',
  counts: { high: 1, medium: 0, low: 0 },
  total: 1,
  insights: [
    {
      id: 'c3|qc-weight-scale-calibration|QC-76',
      rule: 'C3',
      severity: 'high',
      module: 'Quality Control — Inspection Records',
      documentId: 'qc-weight-scale-calibration',
      formatNo: 'F/QC/12',
      document: 'Weekly Internal Calibration Records - Weight Scale',
      title: 'Device QC-76 (F/QC/12): calibration expired on 27-Aug-2024, 766 days ago',
      detail: 'The latest F/QC/12 sheet for QC-76 gives Calibration Expiry 27-Aug-2024. Have it calibrated, or take it out of use.',
      metric: { label: 'Expired', value: '766 days ago' },
      evidence: [
        { recordId: 'qc-scale-2024-03', documentId: 'qc-weight-scale-calibration', dueDate: '2024-03-27', field: 'calibrationExpiry', value: '27-Aug-2024' },
        { recordId: null, documentId: 'qc-weight-scale-calibration', dueDate: '2024-03-20', field: 'calibrationExpiry', value: '27-Aug-2024' },
        { recordId: 'qc-scale-2024-02', documentId: 'qc-weight-scale-calibration', dueDate: '2024-02-14', field: 'calibrationExpiry', value: '27-Aug-2024' },
      ],
      evidenceTotal: 3,
      suggestedCapa: { finding: 'QC-76 is out of calibration.', comment: 'F/QC/12 of 27-Mar-2024.', action: 'Calibrate QC-76 and write the new expiry on its next sheet.' },
      route: '/record/qc-scale-2024-03',
      link: `${BASE}/index.html#/record/qc-scale-2024-03`,
    },
  ],
};

/** GET /api/v1/escalations: the super admin's, as DCRS's server raised them. */
export const ESCALATIONS = {
  open: true,
  today: '2026-10-02',
  week: '2026-W40',
  rule: { late: 3, neverDone: 2, windowDays: 30 },
  summary: 'Escalated to the super admin, not yet acknowledged: Kapila Barad (3 late).',
  waiting: 1,
  total: 1,
  escalations: [
    {
      id: '11',
      kind: 'person',
      subjectName: 'Kapila Barad',
      department: 'QC',
      departmentName: 'Quality Control',
      period: '2026-W40',
      late: 3,
      neverDone: 0,
      sentence: '3 late in the 30 days to 02-Oct-2026 — F-QC-30: 3 late',
      raisedAt: '2026-10-01T04:30:00.000Z',
      updatedAt: '2026-10-02T04:30:00.000Z',
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
      window: { from: '2026-09-03', to: '2026-10-02' },
      worst: [{ documentId: 'qc-viscosity', what: 'F-QC-30', late: 3, neverDone: 0 }],
      records: [1, 2, 3, 4].map((n) => ({ id: `rec-late-${n}`, documentId: 'qc-viscosity', what: 'F-QC-30', dueDate: `2026-09-2${n}`, outcome: 'late', daysLate: n })),
    },
  ],
};

export const PHOTO: FileInfo = {
  id: '9d0b5e8e-7c1b-4f7e-9a51-3f7f0c7f1a10',
  filename: 'line-3 clearance.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 4,
  origin: 'upload',
  system: null,
  relativePath: null,
  width: 640,
  height: 480,
  createdAt: '2026-09-30T05:00:00.000Z',
};
export const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

export const SHEET: FileInfo = { ...PHOTO, id: '1c9e7a1e-2f0e-4b8e-8f53-6b0a8e3f2d44', filename: 'readings.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

/** What an action gets to work with: the signed-in person's token, and a conversation holding a photo and a spreadsheet. */
export const ctx: ActionContext = {
  credentials: { token: TOKEN },
  files: {
    get: async (fileId) => {
      if (fileId === PHOTO.id) return { info: PHOTO, data: PHOTO_BYTES };
      if (fileId === SHEET.id) return { info: SHEET, data: new Uint8Array([1, 2, 3]) };
      throw new ConnectorError('not_found', `There is no file ${fileId} in this conversation.`);
    },
  },
};
