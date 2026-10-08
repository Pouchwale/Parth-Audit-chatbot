// The warning before the phone session ends (mobile/src/lib/session-end.ts; DCRS REQUIREMENTS §84 addendum, the review
// of 8-Oct-2026). DCRS ends a day's session at the close of the staff's hours, and at midnight for the super admin; the
// app now says so ten minutes before, as DCRS's own pages do: nothing until then, the minutes left, counted down, and
// one timer until the warning is due. The app has no test runner of its own, and these are plain functions.
import { expect, it } from 'vitest';

interface SessionEndModule {
  SESSION_END_WARNING_MS: number;
  minutesLeft(endsAt: string | null | undefined, now: number): number | null;
  nextLook(endsAt: string | null | undefined, now: number): number | null;
  sessionEndWords(endsAt: string, minutes: number, superAdmin: boolean, timeZone?: string): string;
}
// Loaded by a path the server's typecheck does not follow: the app's files are the app's typecheck's.
const APP_MODULE: string = new URL('../../mobile/src/lib/session-end.ts', import.meta.url).href;
const { SESSION_END_WARNING_MS, minutesLeft, nextLook, sessionEndWords } = (await import(APP_MODULE)) as SessionEndModule;

/** Midnight at the factory (India, UTC+5:30): the end of the super admin's day. */
const MIDNIGHT = '2026-10-08T18:30:00.000Z';
const before = (ms: number) => Date.parse(MIDNIGHT) - ms;

it('says nothing until ten minutes before the end, then the minutes left, and nothing once it has ended', () => {
  expect(SESSION_END_WARNING_MS).toBe(10 * 60_000);
  expect(minutesLeft(MIDNIGHT, before(10 * 60_000 + 1))).toBeNull();
  expect(minutesLeft(MIDNIGHT, before(10 * 60_000))).toBe(10);
  expect(minutesLeft(MIDNIGHT, before(9 * 60_000 + 1))).toBe(10);
  expect(minutesLeft(MIDNIGHT, before(9 * 60_000))).toBe(9);
  expect(minutesLeft(MIDNIGHT, before(5_000))).toBe(1);
  expect(minutesLeft(MIDNIGHT, before(0))).toBeNull();
  expect(minutesLeft(MIDNIGHT, before(-60_000))).toBeNull();
  // No end said (a server from before it), or one that is not a time: nothing.
  expect(minutesLeft(null, before(60_000))).toBeNull();
  expect(minutesLeft('not a time', before(60_000))).toBeNull();
});

it('waits with one timer until the warning is due, then counts down every few seconds, and stops at the end', () => {
  expect(nextLook(MIDNIGHT, before(3 * 3_600_000))).toBe(3 * 3_600_000 - 10 * 60_000);
  expect(nextLook(MIDNIGHT, before(10 * 60_000))).toBe(15_000);
  expect(nextLook(MIDNIGHT, before(4_000))).toBe(4_000);
  expect(nextLook(MIDNIGHT, before(0))).toBeNull();
  expect(nextLook(null, 0)).toBeNull();
});

it("says when on the factory's clock, and asks only the super admin to sign in again", () => {
  expect(sessionEndWords(MIDNIGHT, 9, true, 'Asia/Kolkata')).toBe('Your session ends at 12:00 am, in 9 minutes. Finish what you are typing, then sign in again to keep working.');
  // Staff's session ends with their working hours, at 6:20 pm: they are not asked to sign in again.
  expect(sessionEndWords('2026-10-08T12:50:00.000Z', 1, false, 'Asia/Kolkata')).toBe('Your session ends at 6:20 pm, in about a minute. Finish what you are typing.');
  expect(sessionEndWords('2026-10-08T06:35:00.000Z', 3, false, 'Asia/Kolkata')).toBe('Your session ends at 12:05 pm, in 3 minutes. Finish what you are typing.');
});
