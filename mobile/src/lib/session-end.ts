// THE END OF A SESSION, SAID AHEAD (DCRS REQUIREMENTS §84 addendum; the review of 8-Oct-2026). A session here ends when
// the connected system's does: DCRS ends a day's session at the close of the staff's working hours, and at the
// factory's midnight for the super admin, who may sign in again at once. DCRS's own pages warn ten minutes before; the
// app now does too, from the end the server gave at sign-in (LoginResponse and GET /me `expiresAt`). Plain functions,
// so the server's tests can check them; components/chat/SessionEndNotice.tsx shows the words.
import { clockTime } from './dates';

/** How long before a session's end the app says so — as DCRS's own pages do. */
export const SESSION_END_WARNING_MS = 10 * 60 * 1000;

/** How often the warning counts down while it shows. */
const COUNTDOWN_MS = 15 * 1000;

const endOf = (endsAt: string | null | undefined): number => (endsAt ? Date.parse(endsAt) : Number.NaN);

/** The minutes left of a session ending at `endsAt` while its warning is due — its last ten minutes; null otherwise. */
export function minutesLeft(endsAt: string | null | undefined, now: number): number | null {
  const left = endOf(endsAt) - now;
  if (!Number.isFinite(left) || left <= 0 || left > SESSION_END_WARNING_MS) return null;
  return Math.max(1, Math.ceil(left / 60_000));
}

/** How long to wait before looking again: until the warning is due, then a few seconds at a time; null once it has ended. */
export function nextLook(endsAt: string | null | undefined, now: number): number | null {
  const end = endOf(endsAt);
  if (!Number.isFinite(end) || now >= end) return null;
  const warnFrom = end - SESSION_END_WARNING_MS;
  return now < warnFrom ? warnFrom - now : Math.min(COUNTDOWN_MS, end - now);
}

/**
 * The warning, e.g. "Your session ends at 12:00 am, in 9 minutes. Finish what you are typing, then sign in again to
 * keep working." The time is the device's clock (the factory's, on the plant's phones) unless `timeZone` says another.
 * Only a super admin is told to sign in again: the staff's hours do not hold him.
 */
export function sessionEndWords(endsAt: string, minutes: number, superAdmin: boolean, timeZone?: string): string {
  const left = minutes <= 1 ? 'in about a minute' : `in ${minutes} minutes`;
  return `Your session ends at ${clockTime(endsAt, timeZone)}, ${left}. Finish what you are typing${superAdmin ? ', then sign in again to keep working' : ''}.`;
}
