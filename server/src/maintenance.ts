import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { actions, conversations } from './db/schema.ts';

const EVERY_MS = 15 * 60_000;

/** Periodically closes out stale confirmations and deletes old conversations. Returns a stop function. */
export function startMaintenance(db: Db, config: Config, log: FastifyBaseLogger): () => void {
  const run = () => expireStaleWork(db, config).catch((err: unknown) => log.error({ err }, 'maintenance failed'));
  void run();
  const timer = setInterval(run, EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export async function expireStaleWork(db: Db, config: Config, now = new Date()) {
  await db
    .update(actions)
    .set({ status: 'cancelled', error: 'The person did not confirm in time, so this change was not made.', finishedAt: now })
    .where(and(eq(actions.status, 'awaiting_confirmation'), lt(actions.createdAt, new Date(now.getTime() - config.confirmationTtlMs))));

  // Conversations hold copies of data read from connected systems, so they are kept only briefly.
  // The actions table is the lasting audit trail.
  await db
    .delete(conversations)
    .where(
      and(
        lt(conversations.updatedAt, new Date(now.getTime() - config.conversationRetentionMs)),
        or(isNull(conversations.lockedUntil), lt(conversations.lockedUntil, now)),
      ),
    );
}
