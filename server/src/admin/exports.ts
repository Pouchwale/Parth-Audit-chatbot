import { and, desc, eq, gte, ilike, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ExportDetail, ExportEntry, ExportPage } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { requireSession, requireSuperAdmin } from '../auth/sessions.ts';
import { conversationExports } from '../db/schema.ts';
import { HttpError, noStore, parseBody } from '../http.ts';
import { addDays, startOfDay } from '../time.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PREFIX = /^[0-9a-f]{12,64}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Postgres has no year 0, and the day after 9999-12-31 would need a five-digit year.
const inYearRange = (iso: string) => {
  const year = Number(iso.slice(0, 4));
  return year >= 1 && year <= 9998;
};
const YEAR_RANGE = 'The year must be from 0001 to 9998';

// No time zone is more than 14 hours from UTC, and Postgres refuses offsets of 16 hours or more.
const inOffsetRange = (iso: string) => Number(/[+-](\d{2}):\d{2}$/.exec(iso)?.[1] ?? 0) <= 14;

// A date alone means that whole day in the report time zone. A date and time must say its offset.
const Moment = z
  .union([z.iso.date(), z.iso.datetime({ offset: true }).refine(inOffsetRange, 'The offset must be at most 14 hours')])
  .refine(inYearRange, YEAR_RANGE);

// Where the previous page ended: its last export's time, to the microsecond as Postgres keeps it, and id.
const CursorFields = z.tuple([z.iso.datetime().refine(inYearRange, YEAR_RANGE), z.uuid()]);
const Cursor = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    try {
      return CursorFields.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
      return z.NEVER;
    }
  });

const ListQuery = z.object({
  userId: z.uuid().optional(),
  from: Moment.optional(),
  to: Moment.optional(),
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((q) => !q.includes('\0'), 'The search cannot contain a null character')
    .optional(),
  before: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ExportParams = z.object({ exportId: z.uuid() });

// Everything but the file itself, which only the detail view returns.
const entryFields = {
  id: conversationExports.id,
  userId: conversationExports.userId,
  username: conversationExports.username,
  displayName: conversationExports.displayName,
  conversationId: conversationExports.conversationId,
  conversationTitle: conversationExports.conversationTitle,
  filename: conversationExports.filename,
  sizeBytes: conversationExports.sizeBytes,
  messageCount: conversationExports.messageCount,
  sha256: conversationExports.sha256,
  ip: conversationExports.ip,
  device: conversationExports.device,
  createdAt: conversationExports.createdAt,
};

type EntryRow = Pick<typeof conversationExports.$inferSelect, keyof typeof entryFields>;

/** Every conversation download, for super admins tracing where data went. */
export function registerExportAuditRoutes(app: FastifyInstance, deps: AppDeps) {
  const guard = { onRequest: noStore, preHandler: [requireSession(deps), requireSuperAdmin] };
  const { db } = deps;
  const zone = deps.config.reportTimeZone;

  app.get('/admin/exports', guard, async (request): Promise<ExportPage> => {
    const query = parseBody(ListQuery, request.query);
    const rows = await db
      .select({
        ...entryFields,
        cursorAt: sql<string>`to_char(${conversationExports.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(conversationExports)
      .where(
        and(
          query.userId ? eq(conversationExports.userId, query.userId) : undefined,
          query.from ? since(query.from, zone) : undefined,
          query.to ? until(query.to, zone) : undefined,
          query.q ? matching(query.q) : undefined,
          query.before ? olderThan(query.before) : undefined,
        ),
      )
      .orderBy(desc(conversationExports.createdAt), desc(conversationExports.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      exports: page.map(entry),
      nextBefore: rows.length > query.limit && last ? Buffer.from(JSON.stringify([last.cursorAt, last.id])).toString('base64url') : null,
    };
  });

  app.get('/admin/exports/:exportId', guard, async (request): Promise<ExportDetail> => {
    const { exportId } = parseBody(ExportParams, request.params);
    const [row] = await db.select().from(conversationExports).where(eq(conversationExports.id, exportId));
    if (!row) throw new HttpError(404, 'not_found', 'No such download.');
    return { ...entry(row), content: row.content, userAgent: row.userAgent, timeZone: row.timeZone };
  });
}

/** From the start of a date, or from a date and time. */
function since(value: string, zone: string) {
  return gte(conversationExports.createdAt, DATE_ONLY.test(value) ? startOfDay(value, zone) : instant(value));
}

/** To the end of a date, or up to and including a date and time. */
function until(value: string, zone: string) {
  return DATE_ONLY.test(value)
    ? lt(conversationExports.createdAt, startOfDay(addDays(value, 1), zone))
    : lte(conversationExports.createdAt, instant(value));
}

/** Exports after the cursor in newest-first order. */
function olderThan([at, id]: [string, string]): SQL {
  return sql`(${conversationExports.createdAt}, ${conversationExports.id}) < (${instant(at)}, ${id}::uuid)`;
}

/** An ISO date and time, compared at the full precision Postgres keeps. */
function instant(iso: string): SQL {
  return sql`${iso}::timestamptz`;
}

/** An export id, a fingerprint or the start of one, or part of the title, file name or person's name. */
function matching(q: string): SQL | undefined {
  const text = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const hex = q.toLowerCase();
  return or(
    UUID.test(q) ? eq(conversationExports.id, q) : undefined,
    SHA256_PREFIX.test(q) ? (hex.length === 64 ? eq(conversationExports.sha256, hex) : like(conversationExports.sha256, `${hex}%`)) : undefined,
    ilike(conversationExports.conversationTitle, text),
    ilike(conversationExports.filename, text),
    ilike(conversationExports.username, text),
    ilike(conversationExports.displayName, text),
  );
}

function entry(row: EntryRow): ExportEntry {
  return {
    id: row.id,
    // The name is kept as it was when the file was downloaded. The id is empty once the account has been deleted.
    user: { id: row.userId ?? '', username: row.username, displayName: row.displayName },
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    messageCount: row.messageCount,
    sha256: row.sha256,
    ip: row.ip,
    device: row.device,
    at: row.createdAt.toISOString(),
  };
}
