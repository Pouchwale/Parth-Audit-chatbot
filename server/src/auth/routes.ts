import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DeviceInfo, LoginRequest, LoginResponse, SignInInfo } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { ConnectorError, type ConnectorAccount } from '../connectors/types.ts';
import { one } from '../db/index.ts';
import { connectorCredentials, loginEvents, sessions, users } from '../db/schema.ts';
import { clientIp, HttpError, parseBody, userAgent } from '../http.ts';
import { hashToken, newSessionToken, seal } from './crypto.ts';
import { activeSession, authOf, currentUser, endSession, requireSession } from './sessions.ts';

const Device = z.object({
  deviceId: z.string().trim().min(1).max(100),
  name: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  os: z.string().max(50).nullish(),
  osVersion: z.string().max(50).nullish(),
  appVersion: z.string().max(50).nullish(),
}) satisfies z.ZodType<DeviceInfo>;

const LoginBody = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
  device: Device,
}) satisfies z.ZodType<LoginRequest>;

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = requireSession(deps);
  const connector = deps.registry.signIn;

  app.get('/auth/provider', async (): Promise<SignInInfo> => ({ system: connector.name }));

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const body = parseBody(LoginBody, request.body);
    const attempt = { username: body.username, ip: clientIp(request), userAgent: userAgent(request), device: body.device };

    let account: ConnectorAccount;
    try {
      account = await connector.authenticate(body.username, body.password);
    } catch (error) {
      const kind = error instanceof ConnectorError ? error.kind : 'error';
      const [known] = await deps.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.provider, connector.id), sql`lower(${users.username}) = lower(${body.username})`))
        .limit(1);
      await deps.db.insert(loginEvents).values({ ...attempt, userId: known?.id ?? null, success: false, failureReason: kind });

      if (kind === 'invalid_credentials') throw new HttpError(401, 'invalid_credentials', 'Wrong username or password.');
      if (error instanceof ConnectorError && error.kind === 'forbidden') throw new HttpError(403, 'forbidden', error.message);
      request.log.error({ err: error }, 'sign-in connector failed');
      throw new HttpError(503, 'upstream_unavailable', `Couldn't reach ${connector.name}. Try again in a moment.`);
    }

    const now = new Date();
    const token = newSessionToken();
    const expiresAt = new Date(Math.min(now.getTime() + deps.config.sessionTtlMs, account.expiresAt?.getTime() ?? Infinity));

    const { user, replaced } = await deps.db.transaction(async (tx) => {
      const user = one(
        await tx
          .insert(users)
          .values({ provider: connector.id, externalId: account.externalId, username: account.username, displayName: account.displayName, lastLoginAt: now })
          .onConflictDoUpdate({
            target: [users.provider, users.externalId],
            set: { username: account.username, displayName: account.displayName, lastLoginAt: now },
          })
          .returning(),
      );
      // A device signing in again replaces its previous session, so the device list stays accurate.
      const replaced = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), eq(sessions.deviceId, body.device.deviceId), activeSession(now)));
      const session = one(
        await tx
          .insert(sessions)
          .values({
            userId: user.id,
            tokenHash: hashToken(token),
            deviceId: body.device.deviceId,
            deviceName: body.device.name ?? null,
            deviceModel: body.device.model ?? null,
            os: body.device.os ?? null,
            osVersion: body.device.osVersion ?? null,
            appVersion: body.device.appVersion ?? null,
            userAgent: attempt.userAgent,
            signInIp: attempt.ip,
            lastIp: attempt.ip,
            createdAt: now,
            lastSeenAt: now,
            expiresAt,
          })
          .returning(),
      );
      await tx.insert(connectorCredentials).values({
        sessionId: session.id,
        connectorId: connector.id,
        sealed: seal(deps.config.credentialsKey, account.credentials),
        expiresAt: account.expiresAt ?? null,
      });
      await tx.insert(loginEvents).values({ ...attempt, userId: user.id, sessionId: session.id, success: true });
      return { user, replaced };
    });

    for (const old of replaced) await endSession(deps, old.id, 'replaced', request.log);
    return { token, user: currentUser(deps.config, user) } satisfies LoginResponse;
  });

  app.post('/auth/logout', { preHandler: session }, async (request, reply) => {
    await endSession(deps, authOf(request).session.id, 'signed_out', request.log);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: session }, async (request) => {
    return { user: currentUser(deps.config, authOf(request).user) };
  });
}
