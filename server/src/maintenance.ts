import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { storeCompletedWeeks } from './admin/weekly.ts';
import { NOT_CONFIRMED_IN_TIME } from './agent/transcript.ts';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { actions, conversations } from './db/schema.ts';

const EVERY_MS = 15 * 60_000;

/**
 * Periodically closes out stale confirmations, deletes old conversations and stores the reports of weeks that have
 * ended. Returns a stop function.
 */
export function startMaintenance(db: Db, config: Config, log: FastifyBaseLogger): () => void {
  const run = () => {
    expireStaleWork(db, config).catch((err: unknown) => log.error({ err }, 'maintenance failed'));
    storeCompletedWeeks(db, config.reportTimeZone).catch((err: unknown) => log.error({ err }, 'could not store the weekly reports'));
  };
  run();
  const timer = setInterval(run, EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export async function expireStaleWork(db: Db, config: Config, now = new Date()) {
  await db
    .update(actions)
    .set({ status: 'cancelled', error: NOT_CONFIRMED_IN_TIME, finishedAt: now })
    .where(and(eq(actions.status, 'awaiting_confirmation'), lt(actions.createdAt, new Date(now.getTime() - config.confirmationTtlMs))));

  // Conversations hold copies of data read from connected systems, so they are deleted after the
  // retention period (CONVERSATION_RETENTION_DAYS). The action log, message counts and downloads are the lasting
  // audit trail, and none of them depend on the conversation.
  await db
    .delete(conversations)
    .where(
      and(
        lt(conversations.updatedAt, new Date(now.getTime() - config.conversationRetentionMs)),
        or(isNull(conversations.lockedUntil), lt(conversations.lockedUntil, now)),
      ),
    );
}
