import { sql, type SQL } from 'drizzle-orm';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether `zone` is an IANA time zone name, such as "Asia/Kolkata" or "UTC". Offsets such as "+05:30" are refused:
 * Postgres reads their sign the opposite way round to JavaScript.
 */
export function isTimeZone(zone: string): boolean {
  if (!/^[A-Za-z][\w+-]*(\/[\w+-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of `instant` in `zone`, as YYYY-MM-DD. */
export function localDate(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** A YYYY-MM-DD date `days` later (or earlier, when negative). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The instant a YYYY-MM-DD date begins in `zone`, worked out by Postgres with the zone's rules, summer time included. */
export function startOfDay(date: string, zone: string): SQL {
  return sql`(${date}::date)::timestamp at time zone ${zone}::text`;
}
