import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ConversationExport, ExportRequest } from '@shared/api.ts';
import { mine, notFound } from '../agent/conversation.ts';
import { ConversationParams } from '../agent/routes.ts';
import type { AppDeps } from '../app.ts';
import { authOf, requireSession } from '../auth/sessions.ts';
import { conversationExports, conversations } from '../db/schema.ts';
import { sha256 } from '../files/store.ts';
import { HttpError, noStore, parseBody } from '../http.ts';
import { isTimeZone } from '../time.ts';
import { downloadedBy, UNTITLED } from './audit.ts';
import { EXPORT_MIME_TYPE, exportFile } from './document.ts';

const EXPORTS_PER_MINUTE = 30;

const ExportBody = z.object({
  timeZone: z.string().max(100).optional(),
  purpose: z.enum(['download', 'share']).default('download'),
}) satisfies z.ZodType<ExportRequest>;

/** The Share button: a person downloads one of their own conversations, and every download is recorded. */
export function registerExportRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = requireSession(deps);
  const limit = app.rateLimit({ max: EXPORTS_PER_MINUTE, timeWindow: '1 minute', keyGenerator: (request) => authOf(request).user.id });

  app.post(
    '/assistant/conversations/:conversationId/export',
    { onRequest: noStore, preHandler: [session, limit] },
    async (request): Promise<ConversationExport> => {
      const { conversationId } = parseBody(ConversationParams, request.params);
      const body = parseBody(ExportBody, request.body ?? {});
      const { user } = authOf(request);

      // The saved conversation, so a reply that is still being written doesn't hold this up.
      const [conversation] = await deps.db.select().from(conversations).where(mine(user.id, conversationId));
      if (!conversation) throw notFound();
      if (conversation.transcript.length === 0) throw new HttpError(409, 'nothing_to_export', 'This conversation has nothing to share yet.');

      const id = randomUUID();
      const at = new Date();
      const timeZone = body.timeZone && isTimeZone(body.timeZone) ? body.timeZone : null;
      const title = conversation.title ?? UNTITLED;
      const { filename, content } = exportFile({
        id,
        conversationId,
        title,
        messages: conversation.transcript,
        exportedBy: user,
        signInSystem: deps.registry.signIn.name,
        at,
        timeZone: timeZone ?? 'UTC',
      });
      const fingerprint = sha256(content);

      await deps.db.insert(conversationExports).values({
        ...downloadedBy(request),
        id,
        kind: 'conversation',
        purpose: body.purpose,
        conversationId,
        conversationTitle: title,
        filename,
        mimeType: EXPORT_MIME_TYPE,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        messageCount: conversation.transcript.length,
        sha256: fingerprint,
        content,
        timeZone,
        createdAt: at,
      });
      return { id, filename, mimeType: EXPORT_MIME_TYPE, content, sha256: fingerprint, createdAt: at.toISOString() };
    },
  );
}
