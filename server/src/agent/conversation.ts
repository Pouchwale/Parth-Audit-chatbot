import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { ChatMessage } from '@shared/api.ts';
import { one, type Db } from '../db/index.ts';
import { conversations, type PendingConfirmation } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { Message } from './model.ts';

const LOCK_MS = 10 * 60_000;

/** A conversation locked by the request working on it. */
export interface WorkingConversation {
  id: string;
  title: string | null;
  /** The history sent to the model. */
  messages: Message[];
  /** What the person sees. */
  transcript: ChatMessage[];
  pending: PendingConfirmation | null;
  /** Saves the history, transcript and pending changes together; `unlock` also ends the request's hold. */
  save(options?: { unlock?: boolean }): Promise<void>;
  /** Ends the request's hold without saving anything. */
  release(): Promise<void>;
}

export interface Owner {
  userId: string;
  sessionId: string;
}

/** Locks one of the person's conversations for this request, or starts a new one when there is no id. */
export async function openConversation(db: Db, owner: Owner, conversationId: string | undefined): Promise<WorkingConversation> {
  const row = conversationId ? await lock(db, owner.userId, conversationId) : await create(db, owner);
  return working(db, row, owner.sessionId);
}

/**
 * The conversations requests were still working on when the server last stopped, such as in a crash or a forced
 * restart. Only for startup, before any request comes in: with one server per database, every lease left by then
 * belongs to a request that no longer exists.
 */
export async function openInterrupted(db: Db): Promise<WorkingConversation[]> {
  const rows = await db.select().from(conversations).where(isNotNull(conversations.lockedUntil));
  return rows.map((row) => working(db, row, row.sessionId));
}

function working(db: Db, row: typeof conversations.$inferSelect, sessionId: string | null): WorkingConversation {
  const conv: WorkingConversation = {
    id: row.id,
    title: row.title,
    messages: row.messages,
    transcript: row.transcript,
    pending: row.pending,
    save: async ({ unlock = false } = {}) => {
      await db
        .update(conversations)
        .set({
          messages: conv.messages,
          transcript: conv.transcript,
          pending: conv.pending,
          sessionId,
          updatedAt: new Date(),
          ...(unlock ? { lockedUntil: null } : {}),
        })
        .where(eq(conversations.id, conv.id));
    },
    release: async () => {
      await db.update(conversations).set({ lockedUntil: null }).where(eq(conversations.id, conv.id));
    },
  };
  return conv;
}

export function mine(userId: string, conversationId: string) {
  return and(eq(conversations.id, conversationId), eq(conversations.userId, userId));
}

/** No request is working on the conversation. */
export function idle(now: Date) {
  return or(isNull(conversations.lockedUntil), lt(conversations.lockedUntil, now));
}

export const busy = () => new HttpError(409, 'conversation_busy', "I'm still working on your last request.");

export const notFound = () => new HttpError(404, 'conversation_not_found', 'That conversation no longer exists. Start a new one.');

/** Why one of the person's conversations couldn't be used: a request is working on it, or it isn't there. */
export async function unavailable(db: Db, userId: string, conversationId: string): Promise<HttpError> {
  const [exists] = await db.select({ id: conversations.id }).from(conversations).where(mine(userId, conversationId));
  return exists ? busy() : notFound();
}

// A lease rather than a transaction: one request at a time per conversation, without holding a
// database connection open while the model thinks.
async function lock(db: Db, userId: string, conversationId: string) {
  const now = new Date();
  const [row] = await db
    .update(conversations)
    .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
    .where(and(mine(userId, conversationId), idle(now)))
    .returning();
  if (row) return row;
  throw await unavailable(db, userId, conversationId);
}

async function create(db: Db, owner: Owner) {
  return one(
    await db
      .insert(conversations)
      .values({ userId: owner.userId, sessionId: owner.sessionId, messages: [], lockedUntil: new Date(Date.now() + LOCK_MS) })
      .returning(),
  );
}
