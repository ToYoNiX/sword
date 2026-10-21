import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import type { Repeat } from '../src/index.ts';
import { D0, day, input } from './fixtures.ts';

/** The logical days a repeating intention gets an occurrence on. */
function datesOf(repeat: Repeat, horizonDays: number): string[] {
  const plan = schedule(
    input({ horizonDays, intentions: [{ id: 'r', duration: '30m', repeat, window: { after: '08:00', before: '10:00' } }] }),
  );
  expect(plan.errors).toEqual([]);
  return plan.placements.map((p) => p.date);
}

describe('recurrence', () => {
  it('daily', () => {
    expect(datesOf('daily', 3)).toEqual([D0, day(1), day(2)]);
  });

  it('on selected weekdays', () => {
    expect(datesOf({ on: ['mon', 'wed'] }, 7)).toEqual(['2026-10-26', '2026-10-28']);
  });

  it('every N days, counted from "since"', () => {
    expect(datesOf({ every: '2 days', since: D0 }, 7)).toEqual([D0, day(2), day(4), day(6)]);
  });

  it('every N days keeps its rhythm when "since" is in the past', () => {
    expect(datesOf({ every: '2 days', since: day(-1) }, 7)).toEqual([day(1), day(3), day(5)]);
  });

  it('never before "since"', () => {
    expect(datesOf({ every: 'day', since: day(2) }, 5)).toEqual([day(2), day(3), day(4)]);
  });

  it('every N weeks on selected weekdays', () => {
    expect(datesOf({ every: '2 weeks', on: ['mon'], since: '2026-10-26' }, 22)).toEqual(['2026-10-26', '2026-11-09']);
  });

  it('every N weeks counts whole weeks (Monday to Sunday) from the week of "since"', () => {
    // since is a Wednesday: its week (Oct 26 – Nov 1) is week 0, but Monday Oct 26 is before since.
    expect(datesOf({ every: '2 weeks', on: ['mon', 'fri'], since: '2026-10-28' }, 22)).toEqual([
      '2026-10-30',
      '2026-11-09',
      '2026-11-13',
    ]);
  });

  it('weekly defaults to the weekday of "since"', () => {
    expect(datesOf({ every: 'week', since: '2026-10-27' }, 14)).toEqual(['2026-10-27', '2026-11-03']);
  });

  it('monthly on the 31st uses the last day of shorter months', () => {
    expect(datesOf({ every: 'month', onDay: 31 }, 100)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  });

  it('every N months', () => {
    expect(datesOf({ every: '3 months', onDay: 15, since: '2026-09-15' }, 120)).toEqual(['2026-12-15']);
  });

  it('monthly defaults to the day of "since"', () => {
    expect(datesOf({ every: 'month', since: '2026-09-28' }, 40)).toEqual(['2026-10-28', '2026-11-28']);
  });
});
