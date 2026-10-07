import { and, count, desc, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AccountDetail, AccountSummary, ActionEntry, LoginEntry, SessionEntry } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { activeSession, endSession, requireSession, requireSuperAdmin, roleOf, type SessionRow, type UserRow } from '../auth/sessions.ts';
import { connectorName } from '../connectors/registry.ts';
import { actions, loginEvents, sessions, users } from '../db/schema.ts';
import { HttpError, parseBody } from '../http.ts';

const UserParams = z.object({ userId: z.uuid() });
const SessionParams = z.object({ sessionId: z.uuid() });
const RECENT = 25;

export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps) {
  const guard = { preHandler: [requireSession(deps), requireSuperAdmin] };
  const { db } = deps;

  app.get('/admin/accounts', guard, async (): Promise<AccountSummary[]> => {
    const now = new Date();
    const people = await db.select().from(users);
    const active = await db
      .select({ userId: sessions.userId, n: count() })
      .from(sessions)
      .where(activeSession(now))
      .groupBy(sessions.userId);
    const seen = await db
      .select({ userId: sessions.userId, at: max(sessions.lastSeenAt) })
      .from(sessions)
      .groupBy(sessions.userId);
    const latest = await db.selectDistinctOn([actions.userId]).from(actions).orderBy(actions.userId, desc(actions.createdAt));

    const activeBy = new Map(active.map((r) => [r.userId, r.n]));
    const seenBy = new Map(seen.map((r) => [r.userId, r.at]));
    const latestBy = new Map(latest.map((r) => [r.userId, r]));
    return people
      .map((user) => summary(user, activeBy.get(user.id) ?? 0, seenBy.get(user.id) ?? null, latestBy.get(user.id)))
      .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
  });

  app.get('/admin/accounts/:userId', guard, async (request): Promise<AccountDetail> => {
    const { userId } = parseBody(UserParams, request.params);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new HttpError(404, 'not_found', 'No such account.');

    const now = new Date();
    const devices = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), activeSession(now)))
      .orderBy(desc(sessions.lastSeenAt));
    const [lastSeen] = await db.select({ at: max(sessions.lastSeenAt) }).from(sessions).where(eq(sessions.userId, userId));
    const recentActions = await db.select().from(actions).where(eq(actions.userId, userId)).orderBy(desc(actions.createdAt)).limit(RECENT);
    const recentLogins = await db.select().from(loginEvents).where(eq(loginEvents.userId, userId)).orderBy(desc(loginEvents.createdAt)).limit(RECENT);

    return {
      account: summary(user, devices.length, lastSeen?.at ?? null, recentActions[0]),
      sessions: devices.map(sessionEntry),
      recentActions: recentActions.map(actionEntry),
      recentLogins: recentLogins.map(loginEntry),
    };
  });

  app.post('/admin/sessions/:sessionId/revoke', guard, async (request, reply) => {
    const { sessionId } = parseBody(SessionParams, request.params);
    if (!(await endSession(deps, sessionId, 'revoked', request.log))) {
      throw new HttpError(404, 'not_found', 'That device is already signed out.');
    }
    return reply.code(204).send();
  });

  function summary(user: UserRow, activeSessions: number, lastSeen: Date | null, lastAction: ActionRow | undefined): AccountSummary {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: roleOf(deps.config, user),
      activeSessions,
      lastSeenAt: lastSeen?.toISOString() ?? null,
      lastAction: lastAction ? actionEntry(lastAction) : null,
    };
  }

  function actionEntry(row: ActionRow): ActionEntry {
    return {
      id: row.id,
      system: connectorName(deps.registry, row.connectorId),
      action: row.action,
      kind: row.kind,
      summary: row.summary,
      status: row.status,
      error: row.error,
      request: row.request,
      at: row.createdAt.toISOString(),
    };
  }
}

type ActionRow = typeof actions.$inferSelect;
type LoginRow = typeof loginEvents.$inferSelect;

function sessionEntry(row: SessionRow): SessionEntry {
  return {
    id: row.id,
    deviceName: row.deviceName,
    deviceModel: row.deviceModel,
    os: row.os,
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    signInIp: row.signInIp,
    lastIp: row.lastIp,
    signedInAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

function loginEntry(row: LoginRow): LoginEntry {
  return {
    id: row.id,
    success: row.success,
    failureReason: row.failureReason,
    ip: row.ip,
    device: row.device,
    at: row.createdAt.toISOString(),
  };
}
