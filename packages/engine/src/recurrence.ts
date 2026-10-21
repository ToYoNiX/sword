import { Temporal } from 'temporal-polyfill';
import { ParseError } from './errors.ts';
import { isWeekday, parsePlainDate, weekday } from './time.ts';
import type { Repeat, Weekday } from './types.ts';

/**
 * A small, fixed menu instead of full RRULE: every N days, every N weeks on
 * some weekdays, or every N months on a day of the month.
 */
export type Recurrence =
  | { readonly unit: 'day'; readonly every: number; readonly since: string | null }
  | { readonly unit: 'week'; readonly every: number; readonly on: ReadonlySet<Weekday>; readonly since: string | null }
  | { readonly unit: 'month'; readonly every: number; readonly onDay: number; readonly since: string | null };

const EVERY = /^(?:(\d+)\s*)?(day|week|month)s?$/;
const KEYS = new Set(['every', 'on', 'onDay', 'since']);

export function parseRepeat(repeat: Repeat): Recurrence {
  if (repeat === 'daily') return { unit: 'day', every: 1, since: null };
  if (repeat === null || typeof repeat !== 'object' || Array.isArray(repeat)) {
    throw new ParseError(`invalid repeat ${JSON.stringify(repeat)}; use "daily" or e.g. { every: "2 weeks", on: [mon] }`);
  }
  const unknown = Object.keys(repeat).filter((key) => !KEYS.has(key));
  if (unknown.length > 0) throw new ParseError(`unknown repeat option "${unknown[0]}"; use every, on, onDay or since`);

  const since = repeat.since === undefined ? null : parsePlainDate(repeat.since);
  let unit: Recurrence['unit'] = 'week';
  let every = 1;
  if (repeat.every !== undefined) {
    const match = typeof repeat.every === 'string' ? EVERY.exec(repeat.every.trim()) : null;
    if (!match || Number(match[1] ?? 1) < 1) {
      throw new ParseError(`invalid repeat every ${JSON.stringify(repeat.every)}; use e.g. "day", "2 weeks" or "3 months"`);
    }
    every = Number(match[1] ?? 1);
    unit = match[2] as Recurrence['unit'];
  }
  if (every > 1 && since === null) throw new ParseError(`"every ${repeat.every}" needs a "since" date to count from`);

  if (unit === 'day') {
    if (repeat.on !== undefined || repeat.onDay !== undefined) throw new ParseError('"on" and "onDay" do not apply to daily repeats');
    return { unit, every, since };
  }
  if (unit === 'week') {
    if (repeat.onDay !== undefined) throw new ParseError('"onDay" only applies to monthly repeats');
    let on: Set<Weekday>;
    if (repeat.on !== undefined) {
      if (!Array.isArray(repeat.on) || repeat.on.length === 0) throw new ParseError('"on" must list at least one weekday');
      const bad = repeat.on.find((d) => !isWeekday(d));
      if (bad !== undefined) throw new ParseError(`invalid weekday ${JSON.stringify(bad)}; use mon, tue, wed, thu, fri, sat or sun`);
      on = new Set(repeat.on);
    } else if (since !== null) {
      on = new Set([weekday(since)]);
    } else {
      throw new ParseError('a weekly repeat needs "on" weekdays or a "since" date');
    }
    return { unit, every, on, since };
  }
  if (repeat.on !== undefined) throw new ParseError('"on" only applies to weekly repeats; use "onDay" for months');
  let onDay: number;
  if (repeat.onDay !== undefined) {
    if (!Number.isInteger(repeat.onDay) || repeat.onDay < 1 || repeat.onDay > 31) {
      throw new ParseError(`"onDay" must be a day of the month from 1 to 31, not ${JSON.stringify(repeat.onDay)}`);
    }
    onDay = repeat.onDay;
  } else if (since !== null) {
    onDay = Temporal.PlainDate.from(since).day;
  } else {
    throw new ParseError('a monthly repeat needs "onDay" or a "since" date');
  }
  return { unit, every, onDay, since };
}

/** Whether a repeat has an occurrence on a logical day. */
export function occursOn(recurrence: Recurrence, date: string): boolean {
  const { since } = recurrence;
  if (since !== null && date < since) return false;
  const day = Temporal.PlainDate.from(date);
  switch (recurrence.unit) {
    case 'day':
      return recurrence.every === 1 || daysBetween(since as string, date) % recurrence.every === 0;
    case 'week': {
      if (!recurrence.on.has(weekday(date))) return false;
      if (recurrence.every === 1) return true;
      const sinceDay = Temporal.PlainDate.from(since as string);
      const firstMonday = sinceDay.subtract({ days: sinceDay.dayOfWeek - 1 });
      const weeks = Math.floor(daysBetween(firstMonday.toString(), date) / 7);
      return weeks % recurrence.every === 0;
    }
    case 'month': {
      // The 31st falls on the last day of shorter months.
      if (day.day !== Math.min(recurrence.onDay, day.daysInMonth)) return false;
      if (recurrence.every === 1) return true;
      const sinceDay = Temporal.PlainDate.from(since as string);
      const months = (day.year - sinceDay.year) * 12 + (day.month - sinceDay.month);
      return months % recurrence.every === 0;
    }
  }
}

function daysBetween(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'days' }).days;
}
