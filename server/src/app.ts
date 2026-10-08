import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerExportAuditRoutes } from './admin/exports.ts';
import { registerReportRoutes } from './admin/reports.ts';
import { registerAdminRoutes } from './admin/routes.ts';
import { registerHistoryRoutes } from './agent/history.ts';
import type { Model } from './agent/model.ts';
import { registerAssistantRoutes } from './agent/routes.ts';
import type { Titler } from './agent/titles.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';
import type { Registry } from './connectors/registry.ts';
import type { Db } from './db/index.ts';
import { registerExportRoutes } from './exports/routes.ts';
import { registerFileRoutes } from './files/routes.ts';
import type { ImageReader } from './files/vision.ts';
import { errorResponse } from './http.ts';
import { registerPhoneRoutes } from './phone/routes.ts';
import { registerVoiceRoutes } from './voice/routes.ts';
import type { Transcriber } from './voice/transcriber.ts';

export interface AppDeps {
  config: Config;
  db: Db;
  registry: Registry;
  model: Model;
  /** Names new conversations. Without it, a conversation is named after the start of its first message. */
  titler?: Titler;
  transcriber: Transcriber;
  /** Describes the photos people attach, for the model. */
  imageReader: ImageReader;
}

export async function buildApp(deps: AppDeps, options: { logger?: FastifyServerOptions['logger'] } = {}) {
  const app = Fastify({ logger: options.logger ?? true, trustProxy: deps.config.trustProxy });
  app.decorateRequest('auth', null);

  // "*" allows any web origin. Safe enough here because requests carry a bearer token, not cookies.
  await app.register(cors, {
    origin: deps.config.corsOrigins.includes('*') ? true : deps.config.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    const { status, body, unexpected } = errorResponse(error);
    if (unexpected) request.log.error({ err: error }, 'unhandled error');
    return reply.code(status).send(body);
  });

  app.get('/health', async () => ({ ok: true }));
  registerAuthRoutes(app, deps);
  registerAssistantRoutes(app, deps);
  registerHistoryRoutes(app, deps);
  registerExportRoutes(app, deps);
  registerFileRoutes(app, deps);
  registerVoiceRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerExportAuditRoutes(app, deps);
  registerReportRoutes(app, deps);
  registerPhoneRoutes(app, deps);
  return app;
}
