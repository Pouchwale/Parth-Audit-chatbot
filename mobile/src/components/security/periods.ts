import type { ExportFilters } from '@/lib/api';
import { daysIn, weekRange } from '@/lib/dates';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back the downloads list goes. */
export type Period =
  | { kind: 'recent'; days: 7 | 30 | 90 }
  | { kind: 'all' }
  /** The week of a weekly report, Monday to Sunday in the time zone the report was worked out in. */
  | { kind: 'week'; weekStart: string; weekEnd: string; timeZone: string };

export const ALL_TIME: Period = { kind: 'all' };

/** The choices offered in the period filter. */
export const PERIODS: readonly Period[] = [{ kind: 'recent', days: 7 }, { kind: 'recent', days: 30 }, { kind: 'recent', days: 90 }, ALL_TIME];

export function periodLabel(period: Period): string {
  switch (period.kind) {
    case 'recent':
      return `Last ${period.days} days`;
    case 'all':
      return 'All time';
    case 'week':
      return weekRange(period.weekStart, period.weekEnd);
  }
}

export function samePeriod(a: Period, b: Period): boolean {
  return periodLabel(a) === periodLabel(b);
}

/** The period as the list's date filters. Recent days count back from `now`. */
export function periodFilters(period: Period, now = Date.now()): Pick<ExportFilters, 'from' | 'to'> {
  switch (period.kind) {
    case 'recent':
      return { from: new Date(now - period.days * DAY_MS).toISOString() };
    case 'all':
      return {};
    case 'week':
      return weekFilters(period);
  }
}

/**
 * A report's week as moments, so that the list matches the report even when the server's report time zone has changed
 * since it was stored: the server reads a date alone in the zone it has now.
 */
function weekFilters({ weekStart, weekEnd, timeZone }: Extract<Period, { kind: 'week' }>): Pick<ExportFilters, 'from' | 'to'> {
  const days = daysIn(weekStart, weekEnd, timeZone);
  // This device doesn't know the zone: the server's current one, which is the report's unless it has been changed.
  if (!days) return { from: weekStart, to: weekEnd };
  // `to` is included, and the server keeps times to the microsecond, so the week ends a microsecond before the next.
  const lastSecond = new Date(days.end - 1000).toISOString().slice(0, 19);
  return { from: new Date(days.start).toISOString(), to: `${lastSecond}.999999Z` };
}
