// The HTTP contract between the mobile app and the server.
// Types only: both sides import this file with `import type`, so it never ships as runtime code.

export interface DeviceInfo {
  /** Random ID the app generates once per install and keeps. */
  deviceId: string;
  /** Name the owner gave the device, e.g. "Parth's Pixel". */
  name?: string | null;
  /** Hardware model, e.g. "Pixel 8" or "iPhone 15". */
  model?: string | null;
  /** e.g. "Android", "iOS", "Web". */
  os?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
}

export type Role = 'user' | 'super_admin';

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

/** Which system people sign in with, e.g. "Digital Controlled Record System". */
export interface SignInInfo {
  system: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  device: DeviceInfo;
}

export interface LoginResponse {
  token: string;
  user: CurrentUser;
}

/**
 * The language Mitra answers in, from the app's settings ("Mitra replies in"). Every request that runs a turn
 * (message, edit, decision, retry) carries it.
 * - auto, the default when it is left out: the language and script of the person's latest message. People write
 *   English, Gujarati in Gujarati script or in Latin letters ("aaje nu record kholo"), Hindi in Devanagari or in Latin
 *   letters ("aaj ka record kholo"), or a mix. A bare yes or no, or a tap on a card, keeps the conversation's language.
 * - en, gu, hi: always English, Gujarati in Gujarati script, or Hindi in Devanagari, whatever the person writes in.
 * In every language, numbers and dates keep the digits 0-9, and format numbers (F/QC/30), record ids, field keys and
 * values stay exactly as the connected system writes them. Any other value is refused with 400 invalid_request.
 */
export type ReplyLanguage = 'auto' | 'en' | 'gu' | 'hi';

export interface MessageRequest {
  /** Omit to start a new conversation. */
  conversationId?: string;
  text: string;
  /** IANA time zone of the device (e.g. "Asia/Kolkata"), so "tomorrow" means the person's tomorrow. */
  timeZone?: string;
  /** Answer with Server-Sent Events (see StreamEvent) instead of one JSON AssistantReply. */
  stream?: boolean;
  /** Ids of files uploaded with POST /assistant/files for this message (at most 20). */
  attachments?: string[];
  /** The language to answer in (see ReplyLanguage). */
  replyLanguage?: ReplyLanguage;
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────
// Upload: POST /assistant/files with the raw bytes as the body, the file's type as Content-Type, and query
// parameters `name` (the file name) and optionally `path` (its path inside a picked folder). Answers FileInfo.
// Download: GET /assistant/files/:fileId?purpose=open|download|share answers the bytes. Getting a file that a
// connected system returned is recorded in the download audit, with the purpose.

export interface FileInfo {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** upload: the person attached it. system: a connected system returned it, e.g. a report. */
  origin: 'upload' | 'system';
  /** The connected system that returned it, for origin "system". */
  system: string | null;
  /** For a file attached from a folder, its path inside that folder, e.g. "site-a/photo-1.jpg". */
  relativePath: string | null;
  /** Pixel size, for images. */
  width: number | null;
  height: number | null;
  createdAt: string;
}

export type FilePurpose = 'open' | 'download' | 'share';

/**
 * Changes a message the person sent, and answers it again:
 * POST /assistant/conversations/:conversationId/messages/:messageId/edit
 *
 * Only in the person's own conversation, and only for a message they wrote. Everything after that message leaves
 * the conversation: the replies, the later messages, their lookups, files and confirmation cards. A confirmation
 * still waiting there is cancelled, so it can never be confirmed afterwards. The message keeps its id and gets the
 * new words; then the turn runs and answers exactly as POST /assistant/messages does (one AssistantReply, or the
 * same stream, whose start event carries the edited message as saved).
 *
 * What was already done is not undone: a change made in a connected system stays made, and the action log, the
 * download records and the weekly reports keep every action with the words that asked for it at the time. The
 * conversation keeps its title, even when its first message is the one changed: the person can rename it.
 *
 * Refused with 404 message_not_found (no such message of the person's in that conversation; someone else's
 * conversation is 404 conversation_not_found, as everywhere), 409 conversation_busy (a reply in it is still being
 * written), and 400 invalid_request (no words, or more than 4,000 characters).
 */
export interface EditMessageRequest {
  text: string;
  /** IANA time zone of the device, as in MessageRequest. */
  timeZone?: string;
  /** Answer with Server-Sent Events (see StreamEvent) instead of one JSON AssistantReply. */
  stream?: boolean;
  /**
   * Ids of the files the edited message carries (at most 20): files it already had, or new uploads. Leave it out to
   * keep the message's files as they are; send [] to take them all off.
   */
  attachments?: string[];
  /** The language to answer in (see ReplyLanguage). */
  replyLanguage?: ReplyLanguage;
}

/**
 * Confirms or cancels the changes on a confirmation card:
 * POST /assistant/conversations/:conversationId/decision
 *
 * Confirmed, the changes run one after another, in order, and none runs after one that fails. Stopping the reply
 * (the request ending early, as when Stop is pressed or the phone loses its connection, which the server can't tell
 * apart) ends only the reply's words: the confirmed changes still run, and the card says how each one went.
 */
export interface DecisionRequest {
  confirmationId: string;
  decision: 'confirm' | 'cancel';
  timeZone?: string;
  stream?: boolean;
  /** The language to answer in (see ReplyLanguage). A cancelled card's "I didn't change anything" is said in it too. */
  replyLanguage?: ReplyLanguage;
}

/** Continues a turn that ended in an error, from where it stopped. */
export interface RetryRequest {
  timeZone?: string;
  stream?: boolean;
  /** The language to answer in (see ReplyLanguage). */
  replyLanguage?: ReplyLanguage;
}

export interface PendingChange {
  /** Name of the connected system, e.g. "Digital Controlled Record System". */
  system: string;
  /** Plain-language description of exactly what will be done if the person confirms. */
  summary: string;
}

export interface Confirmation {
  id: string;
  changes: PendingChange[];
  expiresAt: string;
}

export interface AssistantReply {
  conversationId: string;
  /** What the assistant said last in this request (for reading aloud). Can be empty when it is only asking for confirmation. */
  reply: string;
  /** Changes waiting for the person to confirm or cancel. Nothing is changed until they confirm. */
  confirmation: Confirmation | null;
  /** The assistant message this request created or continued, as it now stands. */
  message: AssistantMessage;
  title: string | null;
}

export type ActionStatus = 'awaiting_confirmation' | 'running' | 'succeeded' | 'failed' | 'cancelled';

// ── Chat transcript ──────────────────────────────────────────────────────────────────────────────
// An assistant message is an ordered list of parts: text, lookups/changes it ran, and changes waiting
// for confirmation, the way a Claude reply interleaves text with tool use.

export interface TextPart {
  type: 'text';
  text: string;
}

/** One call to a connected system that ran (or is running) without needing confirmation: a lookup. */
export interface ActivityPart {
  type: 'activity';
  /** The action's id in the audit log. */
  id: string;
  system: string;
  summary: string;
  kind: 'read' | 'write';
  status: ActionStatus;
  error: string | null;
}

export interface ConfirmationChange extends PendingChange {
  /** The action's id in the audit log. */
  id: string;
  status: ActionStatus;
  error: string | null;
}

/** Changes the assistant proposed. While pending, nothing has changed; the status records the decision. */
export interface ConfirmationPart {
  type: 'confirmation';
  id: string;
  expiresAt: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  changes: ConfirmationChange[];
}

/** A file a connected system returned, such as a report, for the person to open, download or share. */
export interface FilePart {
  type: 'file';
  file: FileInfo;
}

export type MessagePart = TextPart | ActivityPart | ConfirmationPart | FilePart;

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  /** Files the person attached. Missing on messages saved before attachments existed. */
  attachments?: FileInfo[];
  createdAt: string;
  /** When the person last changed the words (see EditMessageRequest). Missing on a message never edited. */
  editedAt?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  parts: MessagePart[];
  /** streaming: still being written. stopped: the person pressed stop. error: see `error`; it can be retried. */
  status: 'streaming' | 'complete' | 'stopped' | 'error';
  error: string | null;
  createdAt: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface ConversationSummary {
  id: string;
  /** Short generated title; null until the first reply. */
  title: string | null;
  /** Start of the latest message, for the history list. */
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface RenameConversationRequest {
  title: string;
}

/**
 * With `stream: true`, message, edit, decision and retry requests answer with Server-Sent Events. Each event's
 * `data:` line is one StreamEvent as JSON, and its `event:` line repeats the type. Apply them in order:
 * - start: the conversation, the user message (the new one; for an edit, the edited one as saved, with the id it
 *   had: everything after it has left the conversation; null when continuing), and the assistant message being
 *   written (new, or the existing one being continued, with its current parts).
 * - delta: append text to the last part if it is a text part, otherwise append a new text part.
 * - part: set parts[index] to this part (append when index equals parts.length). Activity and
 *   confirmation parts are re-sent whenever their status changes. Several lookups can be running at once.
 * - status: what the reply is waiting on while nothing else arrives. "waiting_for_model": the assistant's model is
 *   busy and the server will try again in `retryInMs` milliseconds; say so, counting down, until a status event with
 *   `status: null` arrives, which clears it (so does done or error). The reply so far is unchanged meanwhile.
 * - title: the conversation got its generated title.
 * - done: the final result; `reply.message` is authoritative and replaces the streamed copy.
 * - error: the request failed; the assistant message is saved with status "error" when it got that far. Retry
 *   continues it, also after "assistant_busy", which says when to try again.
 */
export type StreamEvent =
  | { type: 'start'; conversationId: string; title: string | null; userMessage: UserMessage | null; message: AssistantMessage }
  | { type: 'delta'; text: string }
  | { type: 'part'; index: number; part: MessagePart }
  | { type: 'status'; status: 'waiting_for_model'; retryInMs: number }
  | { type: 'status'; status: null }
  | { type: 'title'; title: string }
  | { type: 'done'; reply: AssistantReply }
  | { type: 'error'; error: string; message: string };

/** What the assistant can do, for the welcome screen. */
export interface Capabilities {
  systems: Array<{ name: string; description: string; examples: string[] }>;
}

export interface TranscriptionResponse {
  text: string;
}

export interface ActionEntry {
  id: string;
  system: string;
  action: string;
  kind: 'read' | 'write';
  summary: string;
  status: ActionStatus;
  error: string | null;
  /** What the person said that led to this action. */
  request: string | null;
  at: string;
}

export interface SessionEntry {
  id: string;
  deviceName: string | null;
  deviceModel: string | null;
  os: string | null;
  osVersion: string | null;
  appVersion: string | null;
  signInIp: string | null;
  lastIp: string | null;
  signedInAt: string;
  lastSeenAt: string;
}

export interface LoginEntry {
  id: string;
  success: boolean;
  failureReason: string | null;
  ip: string | null;
  device: DeviceInfo | null;
  at: string;
}

export interface AccountSummary {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** Devices where this account is signed in right now. */
  activeSessions: number;
  lastSeenAt: string | null;
  lastAction: ActionEntry | null;
}

export interface AccountDetail {
  account: AccountSummary;
  /** Signed-in devices, most recently used first. */
  sessions: SessionEntry[];
  recentActions: ActionEntry[];
  recentLogins: LoginEntry[];
}

export interface ApiError {
  error: string;
  message: string;
}

// ── Conversation export (the Share button) ──────────────────────────────────────────────────────
// The server builds the file, so the audit log holds exactly what was handed out. Every export is recorded.

export interface ExportRequest {
  /** IANA time zone used for the dates written in the file. */
  timeZone?: string;
  /** How the app hands the file over: a download (web) or the share sheet (phones). Defaults to download. */
  purpose?: Exclude<FilePurpose, 'open'>;
}

export interface ConversationExport {
  /** Printed in the file, so a copy that turns up somewhere can be traced to this export. */
  id: string;
  filename: string;
  mimeType: string;
  /** The file's full text. */
  content: string;
  /** SHA-256 of the UTF-8 content, hex: the file's fingerprint. */
  sha256: string;
  createdAt: string;
}

// ── Security dashboard (super admins only) ──────────────────────────────────────────────────────

export interface PersonRef {
  id: string;
  username: string;
  displayName: string;
}

export interface ExportDevice {
  name: string | null;
  model: string | null;
  os: string | null;
  osVersion: string | null;
  appVersion: string | null;
}

/**
 * One time data left the server for someone's device: a conversation they exported, or a file a connected
 * system returned that they opened, downloaded or shared.
 */
export interface ExportEntry {
  id: string;
  kind: 'conversation' | 'file';
  purpose: FilePurpose;
  user: PersonRef;
  conversationId: string;
  /** The title when it was exported (the conversation may since have been renamed or deleted). */
  conversationTitle: string;
  /** For kind "file": the connected system the file came from. */
  source: string | null;
  /** For kind "file": the file's id. */
  fileId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** For kind "conversation": how many messages it held. */
  messageCount: number | null;
  sha256: string;
  ip: string | null;
  device: ExportDevice | null;
  at: string;
}

export interface ExportDetail extends ExportEntry {
  /**
   * Exactly what was downloaded, for text (conversation exports). For other files it is null: the copy kept
   * with the record is served by GET /admin/exports/:exportId/file, and that access is recorded too.
   */
  content: string | null;
  userAgent: string | null;
  /** The time zone the person's device reported. */
  timeZone: string | null;
}

export interface ExportPage {
  exports: ExportEntry[];
  /** Pass as `before` to get the next (older) page; null when there are no more. */
  nextBefore: string | null;
}

export interface WeeklyUserSummary {
  user: PersonRef;
  signIns: number;
  failedSignIns: number;
  /** Distinct devices that signed in during the week. */
  devices: number;
  messages: number;
  lookups: number;
  changesConfirmed: number;
  changesCancelled: number;
  changesFailed: number;
  /** Everything that left the server for their devices: conversation exports and system files. */
  exports: number;
  exportedBytes: number;
  /** Titles of the conversations downloaded that week. */
  exportedConversations: string[];
  /** Names of the system files (such as reports) they opened, downloaded or shared that week. */
  downloadedFiles: string[];
  /** Files they attached to messages. */
  uploads: number;
  lastActiveAt: string | null;
}

export interface WeeklyTotals {
  activeUsers: number;
  signIns: number;
  failedSignIns: number;
  messages: number;
  lookups: number;
  changesConfirmed: number;
  exports: number;
  exportedBytes: number;
  uploads: number;
}

export interface WeeklyReportSummary {
  /** Monday the week starts, YYYY-MM-DD, in the server's report time zone. */
  weekStart: string;
  /** The Sunday it ends, YYYY-MM-DD. */
  weekEnd: string;
  timeZone: string;
  /** False for the week in progress, whose numbers are live. */
  complete: boolean;
  generatedAt: string;
  totals: WeeklyTotals;
}

export interface WeeklyReport extends WeeklyReportSummary {
  users: WeeklyUserSummary[];
}

// ── Notifications, tasks and the Review screen ──────────────────────────────────────────────────
// DCRS keeps the notifications (its ledger in PostgreSQL), sends the push alerts and works out every task. The Mitra
// server holds none of that: each route below is relayed to DCRS's /api/v1 as the signed-in person (DCRS's
// docs/chatbot-integration.md, "Notification contract changes"), so DCRS's access levels decide what each person sees
// and may do, and a refusal reaches the app in DCRS's own words. Routes of the Mitra server:
//
//   GET    /notifications?state=open|all&limit=50&before=<id>&lang=en|hi|gu  -> NotificationList
//   POST   /notifications/read             NotificationReadRequest      -> NotificationReadResponse
//   POST   /notifications/test                                          -> TestNotificationResponse (to the caller's own phones)
//   GET    /notification-preferences                                    -> NotificationPreferences
//   PUT    /notification-preferences       NotificationPreferences      -> NotificationPreferences
//   POST   /devices                        DeviceRegistration           -> OkResponse
//   DELETE /devices                        DeviceRemoval                -> OkResponse
//   GET    /tasks                                                       -> Tasks (DCRS's /api/v1/today)
//   POST   /records                        StartRecordRequest           -> StartedRecord
//   GET    /records/:recordId                                           -> RecordView
//   POST   /records/:recordId/changes      RecordChangeRequest          -> RecordChangeResult
//   POST   /records/:recordId/actions      RecordActionRequest          -> RecordChangeResult

export type NotificationKind =
  | 'ready'
  | 'needs_input'
  | 'due'
  | 'upcoming'
  | 'overdue'
  | 'verify'
  | 'sent_back'
  | 'boss_summary'
  | 'escalation'
  | 'access_changed';

/** The language DCRS writes a notification's words in. */
export type NotificationLanguage = 'en' | 'hi' | 'gu';

/** One module's counts in the super admin's morning and evening summary. */
export interface ModuleCounts {
  module: string;
  ready: number;
  needsInput: number;
  awaitingVerification: number;
  notSubmitted: number;
  overdue: number;
}

/** What a notification is about: ids, names and counts only (never a record's values). */
export interface NotificationData {
  documentId?: string;
  formatNo?: string;
  documentName?: string;
  module?: string;
  recordId?: string;
  dueDate?: string;
  count?: number;
  daysLate?: number;
  reason?: string;
  modules?: ModuleCounts[];
}

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  priority: 'high' | 'medium' | 'low';
  /** Written by DCRS in the language asked for, never stored as text. */
  title: string;
  body: string;
  data: NotificationData;
  createdAt: string;
  readAt: string | null;
  /** When the record moved on, so the notification no longer asks anything of the person. */
  resolvedAt: string | null;
}

export interface NotificationList {
  items: NotificationItem[];
  /** Not yet read. */
  unread: number;
  /** Still asking something of the person: the app's badge. */
  open: number;
}

/** Marks some notifications read, or all of them. */
export interface NotificationReadRequest {
  ids?: number[];
  all?: true;
}

export interface NotificationReadResponse {
  unread: number;
}

/** A phone's Expo push token, so DCRS can send it alerts, in the language chosen in the app. */
export interface DeviceRegistration {
  token: string;
  platform: 'android' | 'ios';
  language: NotificationLanguage;
  appVersion?: string;
  deviceName?: string;
}

export interface DeviceRemoval {
  token: string;
}

export interface OkResponse {
  ok: true;
}

/** Which kinds of notification are pushed to the person's phones (a kind switched off still reaches the inbox). */
export interface NotificationPreferences {
  kinds: Partial<Record<NotificationKind, boolean>>;
  reminders?: boolean;
}

export interface TestNotificationResponse {
  /** How many of the person's phones the test was sent to. */
  sent: number;
}

/** One line of the person's day, as DCRS's /api/v1/today gives it. */
export interface TaskItem {
  documentId: string;
  formatNo: string;
  document: string;
  dueDate: string;
  status: string | null;
  /** null for a sheet DCRS's calendar has but nobody has started: POST /records starts it. */
  recordId: string | null;
  started: boolean;
  module?: string;
  /** Whether the person may submit it, and verify it, at their access level. */
  canSubmit?: boolean;
  canVerify?: boolean;
  /** What still stops it being submitted, in DCRS's words. */
  problems?: string[];
  /** How many readings wait for the person, when DCRS says. */
  count?: number;
}

export interface TaskDay {
  date: string;
  weekday?: string;
  kind?: string;
  closed?: boolean;
  name?: string;
  label?: string;
}

/** The person's day (DCRS's /api/v1/today): for the super admin, every module's. */
export interface Tasks {
  date: string;
  day?: TaskDay;
  tomorrow?: TaskDay;
  weeklyOff?: { day: string; next?: string };
  overdue: TaskItem[];
  due: TaskItem[];
  upcoming: TaskItem[];
  readyToSubmit: TaskItem[];
  needsInput: TaskItem[];
  awaitingVerification: TaskItem[];
  workingHours?: { hoursText?: string; todayText?: string; forYou?: string | null };
}

/** A box, a column or a field of a record's form, as DCRS describes it. */
export interface RecordField {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
  unit?: string;
  group?: string;
  /** Printed on the form: never written. */
  printed?: boolean;
  /** Worked out from other values: never written. */
  computed?: boolean;
  /** Read from another document: never written here. */
  readFrom?: string;
  min?: number;
  max?: number;
  /** A list's keys, for a field that is a list. */
  items?: string[];
  count?: number;
  /** A group's parts, for a field that has several. */
  parts?: string[];
}

/** What a record's form is made of, in the keys a change names (DCRS's layout). */
export interface RecordLayout {
  kind: string;
  header?: RecordField[];
  footer?: RecordField[];
  columns?: RecordField[];
  rows?: { mode: string; slotKey?: string; slots?: string[]; fixed?: number; count?: number };
  checkpoints?: { number: number; question: string; answer: string; noteAsks?: string; findingWhen?: string }[];
  fields?: RecordField[];
  lists?: { key: string; label: string; items: string[] }[];
}

/** A record, as DCRS's GET /api/v1/records/:id answers it. */
export interface RecordView {
  recordId: string;
  documentId: string;
  document: { id: string; formatNo: string; name: string; kind: string; module?: string; department?: { code: string; name: string } | string | null };
  date: string;
  status: string;
  editable: boolean;
  canReopen?: boolean;
  /** What can be done to it now, such as submit, verify, send_back. */
  actions: string[];
  submittedBy?: string;
  submittedAt?: string | null;
  verifiedBy?: string;
  sentBackBy?: string | null;
  sentBackBecause?: string | null;
  /** What the assistant filled before anybody opened it, and what to check. */
  prepared: { at: string; notes: string[]; basedOn?: string | null } | null;
  layout: RecordLayout | null;
  inWords: { where?: string; label: string; value: string }[];
  data: unknown;
  history?: { at: string; by: string; action: string; note?: string }[];
  /** What still stops a submit, in DCRS's words, when DCRS says. */
  problems?: string[];
  canSubmit?: boolean;
  canVerify?: boolean;
}

/** Starts a document's record for a day (today when left out), or opens the one already started. */
export interface StartRecordRequest {
  documentId: string;
  date?: string;
}

export interface StartedRecord {
  created: boolean;
  record: RecordView;
}

/** Values the person entered, in DCRS's patch shape (see RecordView's layout). */
export interface RecordChangeRequest {
  patch: Record<string, unknown>;
  note?: string;
}

/** What the Review screen can do to a record. */
export type ReviewAction = 'submit' | 'verify' | 'send_back' | 'resume';

/**
 * Submit, verify or send back after the person ticked "Reviewed and correct" (reviewed: true is required for these
 * three), or resume a record that was sent back. send_back needs the reason.
 */
export interface RecordActionRequest {
  action: ReviewAction;
  reason?: string;
  reviewed?: boolean;
}

export interface RecordChangeResult {
  recordId: string;
  status: string;
  editable: boolean;
  actions: string[];
  changes?: { label: string; before: string; after: string }[];
  /** What DCRS left out of the change, and why. */
  problems?: string[];
}
