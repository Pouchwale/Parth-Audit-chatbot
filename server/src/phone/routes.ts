import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  ActionStatus,
  DeviceRegistration,
  NotificationKind,
  NotificationList,
  NotificationPreferences,
  NotificationReadResponse,
  OkResponse,
  RecordChangeResult,
  RecordView,
  StartedRecord,
  Tasks,
  TestNotificationResponse,
} from '@shared/api.ts';
import { signInExpired } from '../agent/agent.ts';
import type { AppDeps } from '../app.ts';
import { authOf, endSession, loadCredentials, requireSession } from '../auth/sessions.ts';
import { patchInWords, spoken } from '../connectors/dcrs/inputs.ts';
import { ConnectorError, type ConnectorErrorKind, type PhoneRelay } from '../connectors/types.ts';
import { actions } from '../db/schema.ts';
import { HttpError, parseBody } from '../http.ts';

// THE PHONE'S INBOX, TASKS AND REVIEW SCREEN (shared/api.ts, "Notifications, tasks and the Review screen"). Each route
// checks what the app sent, then relays it to the connected system as the signed-in person (connectors/dcrs/phone.ts)
// and answers what the system said, checked for shape. The notifications, the push alerts, the tasks and every rule
// about who may do what are the system's (DCRS's): nothing of them is kept or worked out here. Changes made from the
// Review screen are written in this server's action log too, like the chat's, for the super admin's view.

export const NOTIFICATION_KINDS = [
  'ready',
  'needs_input',
  'due',
  'upcoming',
  'overdue',
  'verify',
  'sent_back',
  'boss_summary',
  'escalation',
  'access_changed',
] as const satisfies readonly NotificationKind[];

const Language = z.enum(['en', 'hi', 'gu']);
const Text = (max: number) => z.string().trim().min(1).max(max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ListQuery = z.object({
  state: z.enum(['open', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
  lang: Language.default('en'),
});

const ReadBody = z
  .object({ ids: z.array(z.number().int().positive()).min(1).max(200).optional(), all: z.literal(true).optional() })
  .refine((body) => body.ids !== undefined || body.all === true, 'Say which notifications to mark read: ids, or all: true.');

const Kinds = z.record(z.string(), z.boolean()).superRefine((kinds, ctx) => {
  for (const kind of Object.keys(kinds)) {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) ctx.addIssue({ code: 'custom', message: `There is no kind of notification called "${kind}".` });
  }
});
const Preferences = z.object({ kinds: Kinds, reminders: z.boolean().optional() });

/** Expo's push tokens: ExponentPushToken[...] (or ExpoPushToken[...]). Anything else cannot be sent to. */
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;
const Token = Text(300).refine((token) => PUSH_TOKEN.test(token), 'That is not an Expo push token.');
const Device = z.object({
  token: Token,
  platform: z.enum(['android', 'ios']),
  language: Language,
  appVersion: Text(50).optional(),
  deviceName: Text(200).optional(),
}) satisfies z.ZodType<DeviceRegistration>;
const DeviceGone = z.object({ token: Token });

const RecordParams = z.object({ recordId: Text(200) });
const StartBody = z.object({ documentId: Text(200), date: z.string().trim().regex(DATE, 'Write the date as YYYY-MM-DD.').optional() });
const ChangeBody = z.object({
  patch: z.record(z.string(), z.unknown()).refine((patch) => Object.keys(patch).length > 0, 'The change is empty: say which values to set.'),
  note: Text(500).optional(),
});
const REVIEWED_ACTIONS = new Set(['submit', 'verify', 'send_back']);
const ActionBody = z
  .object({ action: z.enum(['submit', 'verify', 'send_back', 'resume']), reason: Text(500).optional(), reviewed: z.boolean().optional() })
  .refine((body) => body.action !== 'send_back' || body.reason !== undefined, { message: 'Say why it is sent back.', path: ['reason'] })
  .refine((body) => !REVIEWED_ACTIONS.has(body.action) || body.reviewed === true, {
    message: 'Tick "Reviewed and correct" first: a record is submitted, verified or sent back only after the person has reviewed it.',
    path: ['reviewed'],
  });

// What the system answers, checked for shape. Unknown keys are kept, so a newer system's extra facts reach the app.
const Priority = z.enum(['high', 'medium', 'low']).catch('medium');
const NotificationAnswer = z.looseObject({
  id: z.number(),
  kind: z.string(),
  priority: Priority,
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).catch({}),
  createdAt: z.string(),
  readAt: z.string().nullable().catch(null),
  resolvedAt: z.string().nullable().catch(null),
});
const ListAnswer = z.looseObject({ items: z.array(NotificationAnswer), unread: z.number(), open: z.number() });
const ReadAnswer = z.looseObject({ unread: z.number() });
const TestAnswer = z.looseObject({ sent: z.number() });
const PreferencesAnswer = z.looseObject({ kinds: z.record(z.string(), z.boolean()), reminders: z.boolean().optional() });
const TaskList = z.array(z.looseObject({ documentId: z.string(), dueDate: z.string() })).catch([]);
const TasksAnswer = z.looseObject({
  date: z.string(),
  overdue: TaskList,
  due: TaskList,
  upcoming: TaskList,
  readyToSubmit: TaskList,
  needsInput: TaskList,
  awaitingVerification: TaskList,
});
const RecordAnswer = z.looseObject({
  recordId: z.string(),
  documentId: z.string(),
  status: z.string(),
  editable: z.boolean(),
  actions: z.array(z.string()).catch([]),
  inWords: z.array(z.unknown()).catch([]),
  prepared: z.unknown().catch(null),
  layout: z.unknown().catch(null),
});
const StartAnswer = z.looseObject({ created: z.boolean().catch(false), record: RecordAnswer });
const ChangeAnswer = z.looseObject({ status: z.string(), editable: z.boolean(), actions: z.array(z.string()).catch([]), problems: z.array(z.unknown()).optional() });

const HTTP: Record<ConnectorErrorKind, [status: number, code: string]> = {
  invalid_credentials: [401, 'invalid_credentials'],
  unauthorized: [401, 'session_expired'],
  forbidden: [403, 'forbidden'],
  not_found: [404, 'not_found'],
  invalid_request: [400, 'invalid_request'],
  conflict: [409, 'conflict'],
  unavailable: [503, 'upstream_unavailable'],
};

export function registerPhoneRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = { preHandler: requireSession(deps) };
  const connector = deps.registry.signIn;

  /** The system's answer, checked for the shape the app reads. */
  function answer<T>(schema: z.ZodType, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new HttpError(502, 'upstream_unavailable', `${connector.name} answered in a way the app does not understand.`);
    return result.data as T;
  }

  /** Runs `ask` as the signed-in person; a sign-in the system no longer accepts ends the session, as in the chat. */
  async function relay(request: FastifyRequest, ask: (phone: PhoneRelay, credentials: unknown) => Promise<unknown>): Promise<unknown> {
    const phone = connector.phone;
    if (!phone) throw new HttpError(501, 'not_offered', `${connector.name} keeps no notifications or tasks for the app.`);
    const { session: current } = authOf(request);
    const credentials = await loadCredentials(deps, current.id, connector.id);
    try {
      if (credentials === undefined) throw new ConnectorError('unauthorized', 'No sign-in is kept for this session.');
      return await ask(phone, credentials);
    } catch (error) {
      if (!(error instanceof ConnectorError)) throw error;
      if (error.kind === 'unauthorized') {
        await endSession(deps, current.id, 'upstream_signed_out', request.log);
        throw signInExpired(deps.registry);
      }
      const [status, code] = HTTP[error.kind];
      throw new HttpError(status, code, error.message);
    }
  }

  /** A change made from the app's own screens, in the action log beside the chat's, with how it went. */
  async function logged(request: FastifyRequest, action: string, input: unknown, summary: string, run: () => Promise<unknown>): Promise<unknown> {
    const { user, session: current } = authOf(request);
    const write = async (status: ActionStatus, error: string | null) => {
      await deps.db.insert(actions).values({
        userId: user.id,
        sessionId: current.id,
        conversationId: null,
        connectorId: connector.id,
        action,
        kind: 'write',
        input: input as object,
        summary,
        status,
        error,
        request: null,
        finishedAt: new Date(),
      });
    };
    try {
      const result = await run();
      await write('succeeded', null);
      return result;
    } catch (error) {
      await write('failed', error instanceof HttpError ? error.message : 'Something went wrong on the server.');
      throw error;
    }
  }

  app.get('/notifications', session, async (request): Promise<NotificationList> => {
    const query = parseBody(ListQuery, request.query);
    const said = await relay(request, (phone, credentials) => phone.notifications(credentials, query));
    return answer<NotificationList>(ListAnswer, said);
  });

  app.post('/notifications/read', session, async (request): Promise<NotificationReadResponse> => {
    const body = parseBody(ReadBody, request.body);
    const said = await relay(request, (phone, credentials) => phone.markRead(credentials, body));
    return answer<NotificationReadResponse>(ReadAnswer, said);
  });

  app.post('/notifications/test', session, async (request): Promise<TestNotificationResponse> => {
    const said = await relay(request, (phone, credentials) => phone.testNotification(credentials));
    return answer<TestNotificationResponse>(TestAnswer, said);
  });

  app.get('/notification-preferences', session, async (request): Promise<NotificationPreferences> => {
    const said = await relay(request, (phone, credentials) => phone.preferences(credentials));
    return answer<NotificationPreferences>(PreferencesAnswer, said);
  });

  app.put('/notification-preferences', session, async (request): Promise<NotificationPreferences> => {
    const body = parseBody(Preferences, request.body);
    const said = await relay(request, (phone, credentials) => phone.savePreferences(credentials, body));
    return answer<NotificationPreferences>(PreferencesAnswer, said);
  });

  app.post('/devices', session, async (request): Promise<OkResponse> => {
    const body = parseBody(Device, request.body);
    await relay(request, (phone, credentials) => phone.registerDevice(credentials, body));
    return { ok: true };
  });

  app.delete('/devices', session, async (request): Promise<OkResponse> => {
    const body = parseBody(DeviceGone, request.body);
    await relay(request, (phone, credentials) => phone.removeDevice(credentials, body));
    return { ok: true };
  });

  app.get('/tasks', session, async (request): Promise<Tasks> => {
    const said = await relay(request, (phone, credentials) => phone.tasks(credentials));
    return answer<Tasks>(TasksAnswer, said);
  });

  app.post('/records', session, async (request): Promise<StartedRecord> => {
    const body = parseBody(StartBody, request.body);
    const summary = `Open the record of ${body.documentId} for ${body.date ?? 'today'}, starting it if there is none yet (from the Tasks screen)`;
    const said = await logged(request, 'open_record', body, summary, () => relay(request, (phone, credentials) => phone.startRecord(credentials, body)));
    return answer<StartedRecord>(StartAnswer, said);
  });

  app.get('/records/:recordId', session, async (request): Promise<RecordView> => {
    const { recordId } = parseBody(RecordParams, request.params);
    const said = await relay(request, (phone, credentials) => phone.record(credentials, recordId));
    return answer<RecordView>(RecordAnswer, said);
  });

  app.post('/records/:recordId/changes', session, async (request): Promise<RecordChangeResult> => {
    const { recordId } = parseBody(RecordParams, request.params);
    const body = parseBody(ChangeBody, request.body);
    const summary = `In record ${recordId}, set ${patchInWords(body.patch)} (entered on the Review screen)`;
    const said = await logged(request, 'edit_record', { recordId, ...body }, summary, () =>
      relay(request, (phone, credentials) => phone.changeRecord(credentials, recordId, body)),
    );
    return { recordId, ...answer<Omit<RecordChangeResult, 'recordId'>>(ChangeAnswer, said) };
  });

  app.post('/records/:recordId/actions', session, async (request): Promise<RecordChangeResult> => {
    const { recordId } = parseBody(RecordParams, request.params);
    const body = parseBody(ActionBody, request.body);
    const said = await logged(request, 'record_action', { recordId, ...body }, actionWords(recordId, body), () =>
      relay(request, (phone, credentials) => phone.actOnRecord(credentials, recordId, body)),
    );
    return { recordId, ...answer<Omit<RecordChangeResult, 'recordId'>>(ChangeAnswer, said) };
  });
}

function actionWords(recordId: string, body: z.infer<typeof ActionBody>): string {
  const reviewed = ', ticked as reviewed and correct on the Review screen';
  switch (body.action) {
    case 'submit':
      return `Submit record ${recordId}${reviewed}`;
    case 'verify':
      return `Verify (approve) record ${recordId}${reviewed}`;
    case 'send_back':
      return `Send record ${recordId} back for changes, saying ${spoken(body.reason, 200)}${reviewed}`;
    case 'resume':
      return `Resume record ${recordId}, which was sent back, so it can be changed again (on the Review screen)`;
  }
}
