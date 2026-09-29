import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { isAttached, type HistoryMessage } from '../agent/messages.ts';
import type { Message } from '../agent/model.ts';
import type { AppDeps } from '../app.ts';
import type { Db } from '../db/index.ts';
import { files } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { kindOf, sizeLabel } from './formats.ts';
import { imageProblem } from './reading.ts';
import { fileFields, readAgain, type FileRow } from './store.ts';
import { cut } from './text.ts';

/** The most files one message can carry. */
export const MAX_ATTACHMENTS = 20;
/** The most of one file's text the model is given. */
const MAX_CHARS_PER_FILE = 20_000;

const NO_ROOM = "(Not shown: there is no room for this file's text now. If it matters, ask the person to send it again on its own.)";

/**
 * Attaches files the person uploaded to their message in a conversation, in the order given. Each must be their own
 * upload and not attached in another conversation, or none is attached. A file that couldn't be read when it was
 * uploaded, such as a photo the image reader was too busy for, is read once more first.
 */
export async function attachFiles(
  deps: Pick<AppDeps, 'db' | 'imageReader' | 'registry'>,
  log: FastifyBaseLogger,
  userId: string,
  conversationId: string,
  requested: readonly string[],
): Promise<FileRow[]> {
  const ids = [...new Set(requested)];
  if (ids.length === 0) return [];
  const attachable = and(
    inArray(files.id, ids),
    eq(files.userId, userId),
    eq(files.origin, 'upload'),
    or(isNull(files.conversationId), eq(files.conversationId, conversationId)),
  );
  const unavailable = () => new HttpError(400, 'invalid_attachments', "One of the attached files isn't available any more. Attach it again.");

  const found = new Map((await deps.db.select(fileFields).from(files).where(attachable)).map((row) => [row.id, row]));
  const attached: FileRow[] = [];
  for (const id of ids) {
    const row = found.get(id);
    if (!row) throw unavailable();
    const unread = row.textStatus === 'pending' || (row.textStatus === 'failed' && kindOf(row.mimeType) === 'image');
    attached.push(unread ? await readAgain(deps, row, log) : row);
  }
  // Linked last, and all or none, in case another message took one of them meanwhile.
  await deps.db.transaction(async (tx) => {
    const linked = await tx.update(files).set({ conversationId }).where(attachable).returning({ id: files.id });
    if (linked.length !== ids.length) throw unavailable();
  });
  return attached.map((row) => ({ ...row, conversationId }));
}

/** The person's message as it is saved in the history: their words, with the ids of the files attached to it. */
export function historyMessage(text: string, attached: readonly FileRow[]): HistoryMessage {
  return attached.length > 0 ? { role: 'user', content: text, attachments: attached.map((file) => file.id) } : { role: 'user', content: text };
}

/**
 * The files attached to the messages in a history, by id: the person's own files in this conversation, with as much of
 * their text as the model can be given, so a long conversation doesn't load every file in full for each call.
 */
export async function attachedFiles(db: Db, userId: string, conversationId: string, history: readonly HistoryMessage[]): Promise<Map<string, FileRow>> {
  const ids = [...new Set(history.flatMap((message) => (isAttached(message) ? message.attachments : [])))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ ...fileFields, text: sql<string | null>`left(${files.text}, ${MAX_CHARS_PER_FILE + 1})` })
    .from(files)
    .where(and(inArray(files.id, ids), eq(files.userId, userId), eq(files.conversationId, conversationId)));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The history as the model gets it. A person's message is followed by each attached file in <attachment> tags with its
 * id, name and type, holding the text read from it or why nothing could be read. The text is filled in newest message
 * first until `budget` characters are used up, so the files just sent are always readable and older ones make way.
 */
export function modelMessages(history: readonly HistoryMessage[], attached: ReadonlyMap<string, FileRow>, budget: number): Message[] {
  let room = budget;
  const content = (file: FileRow): string => {
    if (file.textStatus !== 'ok' || !file.text) return `(Nothing could be read from this file: ${unreadable(file)}.)`;
    const shown = cut(file.text, Math.min(MAX_CHARS_PER_FILE, room));
    if (!shown) return NO_ROOM;
    room -= shown.length;
    // The file can't close its own tags and pass what follows off as something else.
    const safe = shown.replace(/<\/?attachment/gi, (tag) => tag.replace('<', '&lt;'));
    return shown.length < file.text.length ? `${safe}\n(Cut short: the rest of this file is not shown.)` : safe;
  };
  const block = (id: string): string => {
    const file = attached.get(id);
    if (!file) return `<attachment id="${id}">\n(This file is no longer available.)\n</attachment>`;
    const attributes = { id: file.id, name: file.filename, type: file.mimeType, size: sizeLabel(file.sizeBytes), path: file.relativePath };
    const tag = Object.entries(attributes)
      .flatMap(([name, value]) => (value ? [`${name}="${escapeAttribute(value)}"`] : []))
      .join(' ');
    return `<attachment ${tag}>\n${content(file)}\n</attachment>`;
  };

  const messages: Message[] = [];
  for (const message of history.toReversed()) {
    messages.push(isAttached(message) ? { role: 'user', content: [message.content, ...message.attachments.map(block)].join('\n\n') } : message);
  }
  return messages.reverse();
}

function unreadable(file: FileRow): string {
  const image = kindOf(file.mimeType) === 'image';
  switch (file.textStatus) {
    case 'none':
      return image ? 'the image reader found nothing in it' : 'it has no text in it, so it may be a scan or a picture';
    case 'unsupported':
      if (!image) return 'this kind of file cannot be read';
      return imageProblem(file) ?? 'the image reader could not make sense of it, so it may be damaged or not really a photo';
    case 'failed':
      return image ? 'the image reader is busy or unavailable; it can be sent again in a minute' : 'it may be damaged or protected with a password';
    default:
      return 'it has not been read yet';
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}
