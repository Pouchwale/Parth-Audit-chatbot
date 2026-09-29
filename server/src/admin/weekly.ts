import { and, count, desc, eq, gte, inArray, isNotNull, lt, max, min, sql, sum, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { WeeklyReport, WeeklyReportSummary, WeeklyTotals, WeeklyUserSummary } from '@shared/api.ts';
import { one, type Db } from '../db/index.ts';
import { actions, conversationExports, loginEvents, messageEvents, users, weeklyReports } from '../db/schema.ts';
import { addDays, localDate, startOfDay } from '../time.ts';

// Weekly reports count only the audit trail (sign-ins, messages and the files attached to them, actions, downloads),
// never conversations or files, which their owners can delete. Weeks run from Monday 00:00 to Sunday 24:00 in the
// report time zone.
// Lookups and changes count in the week they finished: a change proposed on Sunday night and confirmed on Monday
// counts on Monday, because Sunday's week may already be stored by then.

export function isMonday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

/** The Monday that starts the week holding `instant` in `zone`, as YYYY-MM-DD. */
export function weekStartOf(instant: Date, zone: string): string {
  const date = localDate(instant, zone);
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** The week in progress, live, then the stored weeks, newest first. Completed weeks not stored yet are stored first. */
export async function weekSummaries(db: Db, zone: string, limit: number, now = new Date()): Promise<WeeklyReportSummary[]> {
  await storeCompletedWeeks(db, zone, now);
  const { users: _, ...current } = await compute(db, zone, weekStartOf(now, zone), now, false);
  const stored = await db
    .select({ summary: sql<WeeklyReportSummary>`${weeklyReports.report} - 'users'` })
    .from(weeklyReports)
    .where(lt(weeklyReports.weekStart, current.weekStart))
    .orderBy(desc(weeklyReports.weekStart))
    .limit(limit);
  return [current, ...stored.map(({ summary }) => ({ ...summary, totals: totalsUpToDate(summary.totals) }))];
}

/**
 * One week's report. The week in progress is computed live; a completed week comes from storage, and is stored the
 * first time it is asked for. Undefined for a week in the future or before anything was recorded.
 */
export async function weekReport(db: Db, zone: string, weekStart: string, now = new Date()): Promise<WeeklyReport | undefined> {
  const current = weekStartOf(now, zone);
  if (weekStart > current) return undefined;
  if (weekStart === current) return compute(db, zone, weekStart, now, false);
  const [stored] = await db.select({ report: weeklyReports.report }).from(weeklyReports).where(eq(weeklyReports.weekStart, weekStart));
  if (stored) return upToDate(stored.report);
  const first = await firstWeek(db, zone);
  return first && weekStart >= first ? store(db, zone, weekStart, now) : undefined;
}

/** Stores the report of each completed week, from the first one with any activity, that isn't stored yet. */
export async function storeCompletedWeeks(db: Db, zone: string, now = new Date()): Promise<void> {
  const first = await firstWeek(db, zone);
  if (!first) return;
  const current = weekStartOf(now, zone);
  const stored = new Set((await db.select({ weekStart: weeklyReports.weekStart }).from(weeklyReports)).map((row) => row.weekStart));
  for (let week = first; week < current; week = addDays(week, 7)) {
    if (!stored.has(week)) await store(db, zone, week, now);
  }
}

async function store(db: Db, zone: string, weekStart: string, now: Date): Promise<WeeklyReport> {
  const report = await compute(db, zone, weekStart, now, true);
  // Stored reports never change: when another request stored this week first, its report stands.
  const [inserted] = await db
    .insert(weeklyReports)
    .values({ weekStart, timeZone: zone, generatedAt: now, report })
    .onConflictDoNothing()
    .returning({ report: weeklyReports.report });
  if (inserted) return inserted.report;
  return upToDate(one(await db.select({ report: weeklyReports.report }).from(weeklyReports).where(eq(weeklyReports.weekStart, weekStart))).report);
}

// Weeks stored before uploads and downloaded files were counted lack them: they are served as none.

function upToDate(report: WeeklyReport): WeeklyReport {
  return {
    ...report,
    totals: totalsUpToDate(report.totals),
    users: report.users.map((user) => ({ ...user, uploads: user.uploads ?? 0, downloadedFiles: user.downloadedFiles ?? [] })),
  };
}

function totalsUpToDate(totals: WeeklyTotals): WeeklyTotals {
  return { ...totals, uploads: totals.uploads ?? 0 };
}

/** The week of the earliest activity on record, if there is any. */
async function firstWeek(db: Db, zone: string): Promise<string | undefined> {
  const earliest = await Promise.all([
    db.select({ at: min(loginEvents.createdAt) }).from(loginEvents),
    db.select({ at: min(messageEvents.createdAt) }).from(messageEvents),
    db.select({ at: min(actions.createdAt) }).from(actions),
    db.select({ at: min(conversationExports.createdAt) }).from(conversationExports),
  ]);
  const times = earliest.flatMap(([row]) => (row?.at ? [row.at.getTime()] : []));
  return times.length > 0 ? weekStartOf(new Date(Math.min(...times)), zone) : undefined;
}

const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

async function compute(db: Db, zone: string, weekStart: string, now: Date, complete: boolean): Promise<WeeklyReport> {
  const start = startOfDay(weekStart, zone);
  const end = startOfDay(addDays(weekStart, 7), zone);
  const during = (column: PgColumn) => and(gte(column, start), lt(column, end));

  const [signIns, messages, actionCounts, downloads] = await Promise.all([
    db
      .select({
        userId: loginEvents.userId,
        succeeded: countWhere(sql`${loginEvents.success}`),
        failed: countWhere(sql`not ${loginEvents.success}`),
        devices: sql<number>`count(distinct ${loginEvents.device} ->> 'deviceId') filter (where ${loginEvents.success})`.mapWith(Number),
        last: sql<Date | null>`max(${loginEvents.createdAt}) filter (where ${loginEvents.success})`.mapWith(loginEvents.createdAt),
      })
      .from(loginEvents)
      .where(and(during(loginEvents.createdAt), isNotNull(loginEvents.userId)))
      .groupBy(loginEvents.userId),
    db
      .select({
        userId: messageEvents.userId,
        count: count(),
        attachments: sum(messageEvents.attachments).mapWith(Number),
        last: max(messageEvents.createdAt),
      })
      .from(messageEvents)
      .where(and(during(messageEvents.createdAt), isNotNull(messageEvents.userId)))
      .groupBy(messageEvents.userId),
    db
      .select({
        userId: actions.userId,
        lookups: countWhere(sql`${actions.kind} = 'read' and ${actions.status} = 'succeeded'`),
        confirmed: countWhere(sql`${actions.kind} = 'write' and ${actions.status} = 'succeeded'`),
        cancelled: countWhere(sql`${actions.kind} = 'write' and ${actions.status} = 'cancelled'`),
        failed: countWhere(sql`${actions.kind} = 'write' and ${actions.status} = 'failed'`),
        last: max(actions.finishedAt),
      })
      .from(actions)
      .where(during(actions.finishedAt))
      .groupBy(actions.userId),
    db
      .select({
        userId: conversationExports.userId,
        kind: conversationExports.kind,
        title: conversationExports.conversationTitle,
        filename: conversationExports.filename,
        sizeBytes: conversationExports.sizeBytes,
        at: conversationExports.createdAt,
      })
      .from(conversationExports)
      .where(and(during(conversationExports.createdAt), isNotNull(conversationExports.userId)))
      .orderBy(conversationExports.createdAt),
  ]);

  const signInsBy = byUser(signIns);
  const messagesBy = byUser(messages);
  const actionsBy = byUser(actionCounts);
  const downloadsBy = new Map<string, { count: number; bytes: number; titles: Set<string>; files: Set<string>; last: Date }>();
  for (const row of downloads) {
    if (!row.userId) continue;
    const tally = downloadsBy.get(row.userId) ?? { count: 0, bytes: 0, titles: new Set<string>(), files: new Set<string>(), last: row.at };
    tally.count += 1;
    tally.bytes += row.sizeBytes;
    if (row.kind === 'conversation') tally.titles.add(row.title);
    else tally.files.add(row.filename);
    tally.last = row.at;
    downloadsBy.set(row.userId, tally);
  }

  const ids = [...new Set([...signInsBy.keys(), ...messagesBy.keys(), ...actionsBy.keys(), ...downloadsBy.keys()])];
  const people = ids.length > 0 ? await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : [];

  const summaries = people
    .map((user): WeeklyUserSummary => {
      const signIn = signInsBy.get(user.id);
      const message = messagesBy.get(user.id);
      const action = actionsBy.get(user.id);
      const download = downloadsBy.get(user.id);
      const times = [signIn?.last, message?.last, action?.last, download?.last].flatMap((at) => (at ? [at.getTime()] : []));
      return {
        user,
        signIns: signIn?.succeeded ?? 0,
        failedSignIns: signIn?.failed ?? 0,
        devices: signIn?.devices ?? 0,
        messages: message?.count ?? 0,
        lookups: action?.lookups ?? 0,
        changesConfirmed: action?.confirmed ?? 0,
        changesCancelled: action?.cancelled ?? 0,
        changesFailed: action?.failed ?? 0,
        exports: download?.count ?? 0,
        exportedBytes: download?.bytes ?? 0,
        exportedConversations: [...(download?.titles ?? [])],
        downloadedFiles: [...(download?.files ?? [])],
        uploads: message?.attachments ?? 0,
        lastActiveAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
      };
    })
    .filter((summary) => activity(summary) > 0)
    .sort(
      (a, b) =>
        activity(b) - activity(a) || (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') || a.user.username.localeCompare(b.user.username),
    );

  const total = (pick: (summary: WeeklyUserSummary) => number) => summaries.reduce((sum, summary) => sum + pick(summary), 0);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    timeZone: zone,
    complete,
    generatedAt: now.toISOString(),
    totals: {
      activeUsers: summaries.length,
      signIns: total((s) => s.signIns),
      failedSignIns: total((s) => s.failedSignIns),
      messages: total((s) => s.messages),
      lookups: total((s) => s.lookups),
      changesConfirmed: total((s) => s.changesConfirmed),
      exports: total((s) => s.exports),
      exportedBytes: total((s) => s.exportedBytes),
      uploads: total((s) => s.uploads),
    },
    users: summaries,
  };
}

/** How much a person did in the week, which orders the report. */
function activity(s: WeeklyUserSummary): number {
  return (
    s.signIns + s.failedSignIns + s.messages + s.uploads + s.lookups + s.changesConfirmed + s.changesCancelled + s.changesFailed + s.exports
  );
}

function byUser<Row extends { userId: string | null }>(rows: Row[]): Map<string, Row> {
  return new Map(rows.flatMap((row) => (row.userId ? [[row.userId, row] as const] : [])));
}
