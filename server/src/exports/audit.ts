import type { FastifyRequest } from 'fastify';
import type { FilePurpose } from '@shared/api.ts';
import { authOf } from '../auth/sessions.ts';
import type { Db } from '../db/index.ts';
import { conversationExports } from '../db/schema.ts';
import { sha256 } from '../files/store.ts';
import { clientIp, userAgent } from '../http.ts';
import { isTimeZone } from '../time.ts';

/** What a download record calls a conversation that has no title. */
export const UNTITLED = 'Untitled conversation';

/** Who took data from the server, on which device and from where: what every download record starts with. */
export function downloadedBy(request: FastifyRequest) {
  const { user, session } = authOf(request);
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    sessionId: session.id,
    ip: clientIp(request),
    userAgent: userAgent(request),
    device: { name: session.deviceName, model: session.deviceModel, os: session.os, osVersion: session.osVersion, appVersion: session.appVersion },
  };
}

export interface FileDownload {
  purpose: FilePurpose;
  conversationId: string;
  conversationTitle: string;
  /** The connected system the file came from. */
  source: string;
  fileId: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/**
 * Records a file from a connected system leaving the server for someone's device, with a copy of exactly what was
 * handed out and the time zone the app reports in its x-time-zone header.
 */
export async function recordFileDownload(db: Db, request: FastifyRequest, download: FileDownload): Promise<void> {
  const { data, ...file } = download;
  const zone = request.headers['x-time-zone'];
  await db.insert(conversationExports).values({
    ...downloadedBy(request),
    ...file,
    kind: 'file',
    sizeBytes: data.byteLength,
    sha256: sha256(data),
    contentBytes: data,
    timeZone: typeof zone === 'string' && isTimeZone(zone) ? zone : null,
  });
}
