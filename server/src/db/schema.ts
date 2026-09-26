import type Anthropic from '@anthropic-ai/sdk';
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ActionStatus, DeviceInfo } from '@shared/api.ts';

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
  toolUseId: string;
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
  // Results for the other tool calls in the same assistant turn; the API needs them all in one message.
  results: Anthropic.Beta.BetaToolResultBlockParam[];
  calls: PendingCall[];
}

// Working state for the agent: the full message history it sends to the model.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    messages: jsonb('messages').$type<Anthropic.Beta.BetaMessageParam[]>().notNull(),
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
