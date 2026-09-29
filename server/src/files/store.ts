import { createHash } from 'node:crypto';
import { and, eq, getTableColumns } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { FileInfo } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { connectorName, type Registry } from '../connectors/registry.ts';
import { ConnectorError, type ConversationFiles } from '../connectors/types.ts';
import { one } from '../db/index.ts';
import { files } from '../db/schema.ts';
import { kindOf } from './formats.ts';
import { imageSize } from './image-size.ts';
import { readContent } from './reading.ts';

/** A stored file without its bytes, which only downloads and the file reader need. */
export type FileRow = Omit<typeof files.$inferSelect, 'data'>;

const { data: _, ...columns } = getTableColumns(files);
/** Every column but the bytes. */
export const fileFields = columns;

type FileDeps = Pick<AppDeps, 'db' | 'imageReader' | 'registry'>;

export interface NewFile {
  userId: string;
  conversationId: string | null;
  origin: FileRow['origin'];
  connectorId?: string;
  actionId?: string;
  filename: string;
  relativePath?: string | null;
  mimeType: string;
  data: Uint8Array;
}

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Stores a file, then reads what the model is given for it: a document's text, or a description of a picture. */
export async function storeFile(deps: FileDeps, file: NewFile, log: FastifyBaseLogger): Promise<FileRow> {
  const size = kindOf(file.mimeType) === 'image' ? imageSize(file.data) : null;
  // Stored before it is read, which can take a while, so a file the server never finished reading stays pending.
  const stored = one(
    await deps.db
      .insert(files)
      .values({
        ...file,
        sizeBytes: file.data.byteLength,
        sha256: sha256(file.data),
        width: size?.width ?? null,
        height: size?.height ?? null,
        textStatus: 'pending',
      })
      .returning(fileFields),
  );
  return saveReading(deps, stored, file.data, log);
}

/** Reads a stored file again, such as a photo the image reader was too busy for when it was uploaded. */
export async function readAgain(deps: FileDeps, row: FileRow, log: FastifyBaseLogger): Promise<FileRow> {
  const { data } = one(await deps.db.select({ data: files.data }).from(files).where(eq(files.id, row.id)));
  return saveReading(deps, row, data, log);
}

async function saveReading(deps: FileDeps, row: FileRow, data: Uint8Array, log: FastifyBaseLogger): Promise<FileRow> {
  const reading = await readContent({ ...row, data }, deps.imageReader, log);
  return one(await deps.db.update(files).set(reading).where(eq(files.id, row.id)).returning(fileFields));
}

export function fileInfo(row: FileRow, registry: Registry): FileInfo {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    origin: row.origin,
    system: row.connectorId ? connectorName(registry, row.connectorId) : null,
    relativePath: row.relativePath,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  };
}

const FileId = z.uuid();

/** The files in one of a person's conversations, as connector actions may use them. */
export function conversationFiles(deps: FileDeps, userId: string, conversationId: string): ConversationFiles {
  return {
    async get(fileId) {
      const [row] = FileId.safeParse(fileId).success
        ? await deps.db
            .select()
            .from(files)
            .where(and(eq(files.id, fileId), eq(files.userId, userId), eq(files.conversationId, conversationId)))
        : [];
      if (!row) throw new ConnectorError('not_found', `There is no file ${fileId} in this conversation.`);
      const { data, ...info } = row;
      return { info: fileInfo(info, deps.registry), data };
    },
  };
}
