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
}

/** Continues a turn that ended in an error, from where it stopped. */
export interface RetryRequest {
  timeZone?: string;
  stream?: boolean;
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
