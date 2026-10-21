import { Temporal } from 'temporal-polyfill';
import { EngineInputError, ParseError } from './errors.ts';
import type { Weekday } from './types.ts';

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertTimeZone(timeZone: string): void {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
  } catch {
    throw new EngineInputError(`unknown time zone "${timeZone}"`);
  }
}

/** ISO instant with an offset or Z → epoch milliseconds. */
export function parseInstant(text: string): number {
  try {
    return Temporal.Instant.from(text).epochMilliseconds;
  } catch {
    throw new ParseError(`invalid instant "${text}"; expected an ISO date-time with an offset, e.g. 2026-10-25T09:00:00Z`);
  }
}

/** Validates a "YYYY-MM-DD" date and returns it. */
export function parsePlainDate(text: string): string {
  if (typeof text !== 'string' || !PLAIN_DATE.test(text)) throw new ParseError(`invalid date "${text}"; expected YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString();
  } catch {
    throw new ParseError(`invalid date "${text}"`);
  }
}

export function isPlainDate(text: string): boolean {
  return PLAIN_DATE.test(text);
}

export function toIso(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toString();
}

export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function weekday(date: string): Weekday {
  return WEEKDAYS[Temporal.PlainDate.from(date).dayOfWeek - 1] as Weekday;
}

export function isWeekday(value: unknown): value is Weekday {
  return WEEKDAYS.includes(value as Weekday);
}

/**
 * The instant at a wall-clock time on a civil date. Times that don't exist
 * (spring forward) move to just after the gap; repeated times take the first.
 */
export function wallTime(date: string, minutes: number, timeZone: string): number {
  const plainTime = Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone, plainTime }).epochMilliseconds;
}

export function civilDate(ms: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** Local "HH:MM", for messages. */
export function formatClock(ms: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(ms)
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });
}
