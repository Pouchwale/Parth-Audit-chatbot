// Dates for the security dashboard, spelled out in full (weekday, day, month, year, time to the second and the offset
// from UTC) so that nobody has to guess the format or the time zone, and built from numbers rather than a locale's own
// format, which differs between phones and browsers.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CalendarDate {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

/** What a clock shows: a date and a time of day. */
interface WallClock extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function weekday({ year, month, day }: CalendarDate): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** e.g. "Sat 27 Sep 2026". */
function longDate(date: CalendarDate): string {
  return `${weekday(date)} ${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/**
 * What a clock in `timeZone`, or in this device's time zone when there is none, shows at `instant` (epoch
 * milliseconds). Throws a RangeError for a time zone this device doesn't know.
 */
function wallClock(instant: number, timeZone: string | undefined): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((candidate) => candidate.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    // Some engines write midnight as 24 when told not to use a 12-hour clock.
    hour: part('hour') % 24,
    minute: part('minute'),
    second: part('second'),
  };
}

/**
 * The time of day of a moment, e.g. "12:00 am" or "6:20 pm", in `timeZone`, or in this device's time zone when there is
 * none (the factory's, on the plant's phones).
 */
export function clockTime(iso: string, timeZone?: string): string {
  const { hour, minute } = wallClock(Date.parse(iso), timeZone);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${twoDigits(minute)} ${hour < 12 ? 'am' : 'pm'}`;
}

/** The clock's reading as if it were UTC, in epoch milliseconds. */
function asUtc(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
}

/** e.g. "UTC", "UTC+5:30" or "UTC-4", for a clock `offsetMs` ahead of UTC. */
function utcOffset(offsetMs: number): string {
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  if (minutes === 0) return 'UTC';
  const rest = minutes % 60;
  return `UTC${offsetMs < 0 ? '-' : '+'}${Math.floor(minutes / 60)}${rest ? `:${twoDigits(rest)}` : ''}`;
}

/**
 * e.g. "Sat 27 Sep 2026 · 11:52:03 UTC+5:30", in `timeZone`, or in this device's time zone when there is none.
 * Throws a RangeError for a time zone this device doesn't know.
 */
function dateTimeIn(iso: string, timeZone: string | undefined): string {
  const instant = Date.parse(iso);
  const clock = wallClock(instant, timeZone);
  const time = [clock.hour, clock.minute, clock.second].map(twoDigits).join(':');
  // The clock shows whole seconds, so the offset is measured from the start of the second.
  return `${longDate(clock)} · ${time} ${utcOffset(asUtc(clock) - Math.floor(instant / 1000) * 1000)}`;
}

/** The moment in this device's time zone, e.g. "Sat 27 Sep 2026 · 11:52:03 UTC+5:30". */
export function fullDateTime(iso: string): string {
  return dateTimeIn(iso, undefined);
}

/** The moment in another time zone, or null when this device doesn't know that zone. */
export function fullDateTimeIn(iso: string, timeZone: string): string | null {
  try {
    return dateTimeIn(iso, timeZone);
  } catch {
    return null;
  }
}

function calendarDate(isoDate: string): CalendarDate {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

/**
 * When `date` begins in `timeZone`, in epoch milliseconds. As in Postgres, which sets the server's week boundaries,
 * a midnight that happens twice is the later one, and a midnight the clocks skip is the moment they skip it.
 */
function startOfDayIn(date: CalendarDate, timeZone: string): number {
  const midnight = Date.UTC(date.year, date.month - 1, date.day);
  // The clocks change at most once around a midnight, so the offsets a day either side are the only ones it can have.
  const candidates = [midnight - DAY_MS, midnight + DAY_MS].map((near) => midnight - (asUtc(wallClock(near, timeZone)) - near));
  const shown = candidates.filter((instant) => asUtc(wallClock(instant, timeZone)) === midnight);
  return Math.max(...(shown.length > 0 ? shown : candidates));
}

/**
 * When the days from `first` to `last` (YYYY-MM-DD) begin and end in `timeZone`, in epoch milliseconds: they end when
 * the day after `last` begins. Null when this device doesn't know that zone.
 */
export function daysIn(first: string, last: string, timeZone: string): { start: number; end: number } | null {
  const lastDay = calendarDate(last);
  try {
    return { start: startOfDayIn(calendarDate(first), timeZone), end: startOfDayIn({ ...lastDay, day: lastDay.day + 1 }, timeZone) };
  } catch {
    return null;
  }
}

/** A week from its first to its last YYYY-MM-DD date, e.g. "22–28 Sep 2026" or "29 Sep – 5 Oct 2026". */
export function weekRange(start: string, end: string): string {
  const first = calendarDate(start);
  const last = calendarDate(end);
  const lastPart = `${last.day} ${MONTHS[last.month - 1]} ${last.year}`;
  if (first.year !== last.year) return `${first.day} ${MONTHS[first.month - 1]} ${first.year} – ${lastPart}`;
  if (first.month !== last.month) return `${first.day} ${MONTHS[first.month - 1]} – ${lastPart}`;
  return `${first.day}–${lastPart}`;
}
