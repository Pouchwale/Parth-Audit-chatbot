import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FileInfo } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { authOf, requireSession } from '../auth/sessions.ts';
import { connectorName } from '../connectors/registry.ts';
import { conversations, files } from '../db/schema.ts';
import { recordFileDownload, UNTITLED } from '../exports/audit.ts';
import { HttpError, parseBody } from '../http.ts';
import { acceptedType } from './formats.ts';
import { baseName, uploadName, uploadPath } from './names.ts';
import { sendFile } from './send.ts';
import { fileInfo, storeFile } from './store.ts';

const FILES_PER_MINUTE = 60;
// A person's messages show their own uploads as thumbnails, so drawing one conversation can fetch hundreds of them.
const OWN_UPLOADS_PER_MINUTE = 600;

const UploadQuery = z.object({ name: z.string().optional(), path: z.string().optional() });
const FileParams = z.object({ fileId: z.uuid() });
const DownloadQuery = z.object({ purpose: z.enum(['open', 'download', 'share']).default('open') });

const unsupported = () =>
  new HttpError(
    415,
    'unsupported_media_type',
    "That kind of file can't be attached. Send photos, PDFs, Word or Excel files, or CSV, text, Markdown or JSON files.",
  );

const notFound = () => new HttpError(404, 'file_not_found', 'That file no longer exists.');

/** Files people attach to messages, and the files they get back: their own uploads, and what connected systems return. */
export function registerFileRoutes(app: FastifyInstance, deps: AppDeps) {
  const session = requireSession(deps);
  const perPerson = (request: FastifyRequest) => request.auth?.user.id ?? request.ip;

  // In a scope of its own, so no other route takes raw bytes.
  app.register(async (scope) => {
    // A file arrives as its raw bytes, whatever its type: the phone app's fetch can't send a file from disk as form data.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

    scope.post(
      '/assistant/files',
      {
        // Who is sending it, and whether that kind of file is accepted, are checked before the upload is read, and the
        // limit is counted per person, across their devices.
        onRequest: [session, checkType],
        bodyLimit: deps.config.fileMaxBytes,
        config: { rateLimit: { max: FILES_PER_MINUTE, timeWindow: '1 minute', hook: 'preParsing', keyGenerator: perPerson } },
      },
      async (request): Promise<FileInfo> => {
        const query = parseBody(UploadQuery, request.query);
        const filename = uploadName(query.name);
        const relativePath = uploadPath(query.path);
        const mimeType = acceptedFrom(request);
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new HttpError(400, 'empty_file', 'That file is empty.');

        const row = await storeFile(
          deps,
          { userId: authOf(request).user.id, conversationId: null, origin: 'upload', filename, relativePath, mimeType, data: request.body },
          request.log,
        );
        return fileInfo(row, deps.registry);
      },
    );
  });

  // Files from connected systems count against one limit and a person's own uploads against a looser one, so the
  // thumbnails in a conversation can't use up the allowance for opening, downloading and sharing reports.
  const systemFileLimit = app.rateLimit({ max: FILES_PER_MINUTE, timeWindow: '1 minute', keyGenerator: perPerson });
  const ownUploadLimit = app.rateLimit({ max: OWN_UPLOADS_PER_MINUTE, timeWindow: '1 minute', keyGenerator: perPerson });

  app.get(
    '/assistant/files/:fileId',
    // A HEAD request would run this too, and be recorded as a download that never happened.
    { preHandler: session, exposeHeadRoute: false },
    async (request, reply) => {
      const { fileId } = parseBody(FileParams, request.params);
      const { purpose } = parseBody(DownloadQuery, request.query);
      const mine = and(eq(files.id, fileId), eq(files.userId, authOf(request).user.id));
      // Which limit applies depends on where the file came from, so that is looked up before its bytes are.
      const [found] = await deps.db.select({ origin: files.origin }).from(files).where(mine);
      if (!found) throw notFound();
      await (found.origin === 'system' ? systemFileLimit : ownUploadLimit).call(app, request, reply);
      const [file] = await deps.db.select().from(files).where(mine);
      if (!file) throw notFound();
      const disposition = purpose === 'open' ? 'inline' : 'attachment';

      // A person's own uploads came from their device, and their messages show them again and again. Files from
      // connected systems are recorded each time they leave, so no device may keep a copy.
      if (file.origin !== 'system') return sendFile(reply, file, disposition, 'private');
      if (!file.conversationId || !file.connectorId) throw new Error(`File ${file.id} from a connected system lacks its origin`);
      const [conversation] = await deps.db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, file.conversationId));
      await recordFileDownload(deps.db, request, {
        purpose,
        conversationId: file.conversationId,
        conversationTitle: conversation?.title ?? UNTITLED,
        source: connectorName(deps.registry, file.connectorId),
        fileId: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        data: file.data,
      });
      return sendFile(reply, file, disposition, 'no-store');
    },
  );
}

/** The type an upload is stored as, from its Content-Type and name. */
function acceptedFrom(request: FastifyRequest): string {
  const { name = '' } = parseBody(UploadQuery, request.query);
  const type = acceptedType(request.headers['content-type'], baseName(name));
  if (!type) throw unsupported();
  return type;
}

async function checkType(request: FastifyRequest) {
  acceptedFrom(request);
}
