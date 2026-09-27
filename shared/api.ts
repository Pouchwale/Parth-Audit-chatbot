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
}

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

export type MessagePart = TextPart | ActivityPart | ConfirmationPart;

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  createdAt: string;
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
 * With `stream: true`, message, decision and retry requests answer with Server-Sent Events. Each event's
 * `data:` line is one StreamEvent as JSON, and its `event:` line repeats the type. Apply them in order:
 * - start: the conversation, the new user message (null when continuing), and the assistant message
 *   being written (new, or the existing one being continued, with its current parts).
 * - delta: append text to the last part if it is a text part, otherwise append a new text part.
 * - part: set parts[index] to this part (append when index equals parts.length). Activity and
 *   confirmation parts are re-sent whenever their status changes.
 * - title: the conversation got its generated title.
 * - done: the final result; `reply.message` is authoritative and replaces the streamed copy.
 * - error: the request failed; the assistant message is saved with status "error" when it got that far.
 */
export type StreamEvent =
  | { type: 'start'; conversationId: string; title: string | null; userMessage: UserMessage | null; message: AssistantMessage }
  | { type: 'delta'; text: string }
  | { type: 'part'; index: number; part: MessagePart }
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
