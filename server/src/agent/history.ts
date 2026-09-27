import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChatMessage, ConversationDetail, ConversationSummary, RenameConversationRequest } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { authOf, requireSession } from '../auth/sessions.ts';
import { one, type Db } from '../db/index.ts';
import { actions, conversations } from '../db/schema.ts';
import { parseBody } from '../http.ts';
import { busy, idle, mine, notFound, unavailable } from './conversation.ts';
import { ConversationParams } from './routes.ts';
import { previewOf } from './transcript.ts';

const LIST_LIMIT = 100;

const RenameBody = z.object({ title: z.string().trim().min(1).max(100) }) satisfies z.ZodType<RenameConversationRequest>;

const summaryFields = {
  id: conversations.id,
  title: conversations.title,
  createdAt: conversations.createdAt,
  updatedAt: conversations.updatedAt,
  // The preview needs only the last two messages, not the whole transcript.
  last: sql<ChatMessage | null>`${conversations.transcript} -> -1`,
  previous: sql<ChatMessage | null>`${conversations.transcript} -> -2`,
};

/** The person's own conversations. Anyone else's answer 404, as if they didn't exist. */
export function registerHistoryRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = { preHandler: requireSession(deps) };
  const { db } = deps;

  app.get('/assistant/conversations', session, async (request): Promise<ConversationSummary[]> => {
    const rows = await db
      .select(summaryFields)
      .from(conversations)
      .where(eq(conversations.userId, authOf(request).user.id))
      .orderBy(desc(conversations.updatedAt))
      .limit(LIST_LIMIT);
    return rows.map(summary);
  });

  app.get('/assistant/conversations/:conversationId', session, async (request): Promise<ConversationDetail> => {
    const { conversationId } = parseBody(ConversationParams, request.params);
    const [row] = await db.select().from(conversations).where(mine(authOf(request).user.id, conversationId));
    if (!row) throw notFound();
    return {
      id: row.id,
      title: row.title,
      messages: row.transcript,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  app.patch('/assistant/conversations/:conversationId', session, async (request): Promise<ConversationSummary> => {
    const { conversationId } = parseBody(ConversationParams, request.params);
    const { title } = parseBody(RenameBody, request.body);
    const userId = authOf(request).user.id;
    const renamed = await db
      .update(conversations)
      .set({ title })
      .where(and(mine(userId, conversationId), idle(new Date())))
      .returning({ id: conversations.id });
    if (renamed.length === 0) throw await unavailable(db, userId, conversationId);
    return summary(one(await db.select(summaryFields).from(conversations).where(eq(conversations.id, conversationId))));
  });

  app.delete('/assistant/conversations/:conversationId', session, async (request, reply) => {
    const { conversationId } = parseBody(ConversationParams, request.params);
    const userId = authOf(request).user.id;
    const deleted = await db
      .delete(conversations)
      .where(and(mine(userId, conversationId), idle(new Date())))
      .returning({ id: conversations.id });
    if (deleted.length === 0) throw await unavailable(db, userId, conversationId);
    await cancelWaitingChanges(db, deleted);
    return reply.code(204).send();
  });

  app.delete('/assistant/conversations', session, async (request, reply) => {
    const userId = authOf(request).user.id;
    const now = new Date();
    const [working] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.userId, userId), gte(conversations.lockedUntil, now)))
      .limit(1);
    if (working) throw busy();
    const deleted = await db
      .delete(conversations)
      .where(and(eq(conversations.userId, userId), idle(now)))
      .returning({ id: conversations.id });
    await cancelWaitingChanges(db, deleted);
    return reply.code(204).send();
  });
}

interface SummaryRow {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  last: ChatMessage | null;
  previous: ChatMessage | null;
}

function summary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    preview: previewOf([row.last, row.previous]),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Deleting a conversation keeps its actions (the audit trail), but changes it was waiting on can no longer
// be confirmed, so the log records them as not made.
async function cancelWaitingChanges(db: Db, deleted: { id: string }[]) {
  if (deleted.length === 0) return;
  await db
    .update(actions)
    .set({ status: 'cancelled', error: 'The conversation was deleted, so this change was not made.', finishedAt: new Date() })
    .where(and(inArray(actions.conversationId, deleted.map((row) => row.id)), eq(actions.status, 'awaiting_confirmation')));
}
