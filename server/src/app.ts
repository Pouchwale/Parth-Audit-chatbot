import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerAdminRoutes } from './admin/routes.ts';
import { registerAssistantRoutes } from './agent/routes.ts';
import type { Model } from './agent/model.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';
import type { Registry } from './connectors/registry.ts';
import type { Db } from './db/index.ts';
import { HttpError } from './http.ts';

export interface AppDeps {
  config: Config;
  db: Db;
  registry: Registry;
  model: Model;
}

export async function buildApp(deps: AppDeps, options: { logger?: FastifyServerOptions['logger'] } = {}) {
  const app = Fastify({ logger: options.logger ?? true, trustProxy: deps.config.trustProxy });
  app.decorateRequest('auth', null);

  // "*" allows any web origin. Safe enough here because requests carry a bearer token, not cookies.
  await app.register(cors, { origin: deps.config.corsOrigins.includes('*') ? true : deps.config.corsOrigins });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'invalid_request', message: (error as Error).message });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong on the server.' });
  });

  app.get('/health', async () => ({ ok: true }));
  registerAuthRoutes(app, deps);
  registerAssistantRoutes(app, deps);
  registerAdminRoutes(app, deps);
  return app;
}
