import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Message, ToolMessage } from '../agent/model.ts';
import type { ActionStatus, ChatMessage, DeviceInfo, ExportDevice, WeeklyReport } from '@shared/api.ts';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// One row per person, keyed by their account in the connector they sign in with.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    lastLoginAt: at('last_login_at'),
  },
  (t) => [uniqueIndex('users_provider_external_id').on(t.provider, t.externalId)],
);

// One row per signed-in device. A session is active while ended_at is null and expires_at is in the future.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    deviceId: text('device_id'),
    deviceName: text('device_name'),
    deviceModel: text('device_model'),
    os: text('os'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    userAgent: text('user_agent'),
    signInIp: text('sign_in_ip'),
    lastIp: text('last_ip'),
    createdAt: at('created_at').notNull().defaultNow(),
    lastSeenAt: at('last_seen_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
    endedAt: at('ended_at'),
    // signed_out: by the person. revoked: by a super admin. replaced: the same device signed in again.
    // upstream_signed_out: the connected system stopped accepting the stored sign-in.
    endReason: text('end_reason', { enum: ['signed_out', 'revoked', 'replaced', 'upstream_signed_out'] }),
  },
  (t) => [index('sessions_user_id').on(t.userId)],
);

// The connector sign-in behind a session (e.g. the DCRS token), encrypted with CREDENTIALS_KEY.
export const connectorCredentials = pgTable(
  'connector_credentials',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    connectorId: text('connector_id').notNull(),
    sealed: text('sealed').notNull(),
    expiresAt: at('expires_at'),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.connectorId] })],
);

// Every sign-in attempt, successful or not.
export const loginEvents = pgTable(
  'login_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    username: text('username').notNull(),
    success: boolean('success').notNull(),
    failureReason: text('failure_reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    device: jsonb('device').$type<DeviceInfo>(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('login_events_user_id').on(t.userId, t.createdAt)],
);

export interface PendingCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  actionId: string;
  system: string;
  summary: string;
}

// Changes the assistant proposed that are waiting for the person to confirm or cancel.
export interface PendingConfirmation {
  id: string;
  expiresAt: string;
  /** What the person said that led to these changes. */
  request: string;
  /** Set when the person confirmed, before anything runs, so the calls can never run twice. */
  claimed?: boolean;
  // Results for the other tool calls in the same assistant turn. Every tool call needs its result
  // right after the assistant message, so these wait until the confirmation is answered.
  results: ToolMessage[];
  calls: PendingCall[];
}

// A conversation as the person sees it (transcript) and as the model works on it (messages: the full
// history sent to the model). Every request saves the two together.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    title: text('title'),
    transcript: jsonb('transcript').$type<ChatMessage[]>().notNull().default([]),
    messages: jsonb('messages').$type<Message[]>().notNull(),
    pending: jsonb('pending').$type<PendingConfirmation>(),
    lockedUntil: at('locked_until'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('conversations_updated_at').on(t.updatedAt)],
);

// Every action taken (or proposed) against a connected system. This is the audit trail.
export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id'),
    connectorId: text('connector_id').notNull(),
    action: text('action').notNull(),
    kind: text('kind', { enum: ['read', 'write'] }).notNull(),
    input: jsonb('input').notNull(),
    summary: text('summary').notNull(),
    status: text('status').$type<ActionStatus>().notNull(),
    error: text('error'),
    request: text('request'),
    createdAt: at('created_at').notNull().defaultNow(),
    finishedAt: at('finished_at'),
  },
  (t) => [index('actions_user_id').on(t.userId, t.createdAt)],
);

// One row per message a person sent that the assistant took on, without its text. Conversations can be
// deleted, so the weekly reports count messages from here.
export const messageEvents = pgTable(
  'message_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').notNull(),
    chars: integer('chars').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('message_events_created_at').on(t.createdAt)],
);

// Every conversation download (the Share button), with exactly what was handed out. This is the audit trail for
// data leaving the system, so it outlives the conversation and even the account: nothing that deletes those
// deletes these, and each row keeps its own copy of who, what and from where.
export const conversationExports = pgTable(
  'conversation_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').notNull(),
    conversationTitle: text('conversation_title').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    messageCount: integer('message_count').notNull(),
    sha256: text('sha256').notNull(),
    content: text('content').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    device: jsonb('device').$type<ExportDevice>(),
    timeZone: text('time_zone'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('conversation_exports_user_id').on(t.userId, t.createdAt),
    index('conversation_exports_created_at').on(t.createdAt, t.id),
    index('conversation_exports_sha256').on(t.sha256),
  ],
);

// The report of each completed week, stored once and never changed.
export const weeklyReports = pgTable('weekly_reports', {
  weekStart: date('week_start', { mode: 'string' }).primaryKey(),
  timeZone: text('time_zone').notNull(),
  generatedAt: at('generated_at').notNull(),
  report: jsonb('report').$type<WeeklyReport>().notNull(),
});
