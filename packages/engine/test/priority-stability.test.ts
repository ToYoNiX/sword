/*
 * Stability (keep what's placed) and priority (higher goes first) together:
 * a higher priority always wins, and within the same priority, what's
 * already placed stays. Found by moving Fajr in a real routine: the morning
 * adhkar (priority 2) were dropped because problem solving (priority 1)
 * kept the slot they needed.
 */
import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import type { AnchorInput, IntentionInput } from '../src/index.ts';
import { D0, anchor, daily, expectNoOverlaps, input, rerun, slot, t } from './fixtures.ts';

const fajr = (start: string, end: string): AnchorInput => anchor('prayer.fajr', D0, start, end, { busy: [[start, end]], tags: ['prayer'] });
const routine: IntentionInput[] = [
  daily('adhkar', '20m', { after: 'prayer.fajr', before: 'prayer.fajr + 1h' }, { priority: 2 }),
  daily('solving', '2h30m', { after: 'prayer.fajr', before: '12:00' }, { priority: 1 }),
  daily('treadmill', '1h', { after: 'prayer.fajr', before: '12:00' }),
];

describe('priority and stability', () => {
  it('moves lower-priority placements out of the way of a higher priority that has to move', () => {
    const first = input({ anchors: [fajr('05:36', '06:06')], intentions: routine });
    const before = schedule(first);
    expect([slot(before, `adhkar@${D0}`), slot(before, `solving@${D0}`), slot(before, `treadmill@${D0}`)]).toEqual([
      '06:06-06:26',
      '06:26-08:56',
      '08:56-09:56',
    ]);

    // Fajr comes 14 minutes later: the adhkar's old slot is now during the prayer.
    const later = { ...first, anchors: [fajr('05:50', '06:20')] };
    const after = rerun(later, before, later);
    expect([slot(after, `adhkar@${D0}`), slot(after, `solving@${D0}`), slot(after, `treadmill@${D0}`)]).toEqual([
      '06:20-06:40',
      '06:40-09:10',
      '09:10-10:10',
    ]);
    expect(after.unplaced).toEqual([]);
    expect(after.diff.moved.map((m) => m.occurrenceId)).toEqual([`adhkar@${D0}`, `solving@${D0}`, `treadmill@${D0}`]);
    expectNoOverlaps(after, later);
  });

  it('keeps placements of the same priority where they are when a new task arrives', () => {
    const first = input({ intentions: [daily('a', '1h', { after: '08:00', before: '12:00' })] });
    const before = schedule(first);
    const withNew = { ...first, intentions: [...first.intentions, daily('b', '2h', { after: '08:00', before: '12:00' })] };
    const after = rerun(withNew, before, withNew);
    // b is longer, so it would go first on a fresh plan; a stays where it was instead.
    expect(slot(after, `a@${D0}`)).toBe('08:00-09:00');
    expect(slot(after, `b@${D0}`)).toBe('09:00-11:00');
    expect(after.diff.moved).toEqual([]);
  });

  it('lets a new higher-priority task take its slot, moving lower ones', () => {
    const first = input({ intentions: [daily('a', '1h', { after: '08:00', before: '12:00' })] });
    const before = schedule(first);
    const withUrgent = { ...first, intentions: [...first.intentions, daily('urgent', '1h', { after: '08:00', before: '12:00' }, { priority: 1 })] };
    const after = rerun(withUrgent, before, withUrgent);
    expect(slot(after, `urgent@${D0}`)).toBe('08:00-09:00');
    expect(slot(after, `a@${D0}`)).toBe('09:00-10:00');
    expect(after.diff.moved).toEqual([expect.objectContaining({ occurrenceId: `a@${D0}`, reason: expect.stringContaining('urgent') })]);
  });

  it('keeps a lower-priority placement that is not in the way', () => {
    const first = input({ anchors: [fajr('05:36', '06:06')], intentions: routine });
    const before = schedule(first);
    // A tiny shift that leaves room: the adhkar still fit before problem solving.
    const later = { ...first, anchors: [fajr('05:30', '06:00')] };
    const after = rerun(later, before, later);
    expect(slot(after, `adhkar@${D0}`)).toBe('06:06-06:26');
    expect(slot(after, `solving@${D0}`)).toBe('06:26-08:56');
    expect(after.diff.moved).toEqual([]);
  });
});

describe('making room when the free time is fragmented', () => {
  const morning = { after: '08:00', before: '12:00' };
  const kept = (id: string, start: string, end: string) => ({ occurrenceId: `${id}@${D0}`, start: t(D0, start), end: t(D0, end), state: 'scheduled' as const });

  it('moves placements of the same priority when that lets one more task fit', () => {
    // a and b leave gaps of 30, 60 and 30 minutes: a 90-minute task fits in none.
    const plan = schedule(
      input({
        intentions: [daily('a', '1h', morning), daily('b', '1h', morning), daily('c', '1h30m', morning)],
        existing: [kept('a', '08:30', '09:30'), kept('b', '10:30', '11:30')],
      }),
    );
    expect(plan.unplaced).toEqual([]);
    expect([slot(plan, `c@${D0}`), slot(plan, `a@${D0}`), slot(plan, `b@${D0}`)]).toEqual(['08:00-09:30', '09:30-10:30', '10:30-11:30']);
    expect(plan.diff.moved).toEqual([expect.objectContaining({ occurrenceId: `a@${D0}`, reason: 'moved to make room for c' })]);
  });

  it('leaves placements where they are when moving them would not help', () => {
    // Four hours of work in a four-hour window that already holds two hours: nothing can make 3h fit.
    const plan = schedule(
      input({
        intentions: [daily('a', '1h', morning), daily('b', '1h', morning), daily('c', '3h', morning)],
        existing: [kept('a', '08:30', '09:30'), kept('b', '10:30', '11:30')],
      }),
    );
    expect(plan.unplaced.map((u) => u.occurrenceId)).toEqual([`c@${D0}`]);
    expect(plan.diff.moved).toEqual([]);
  });

  it('never moves a higher priority to make room for a lower one', () => {
    const plan = schedule(
      input({
        intentions: [daily('a', '1h', morning, { priority: 1 }), daily('b', '1h', morning, { priority: 1 }), daily('c', '1h30m', morning)],
        existing: [kept('a', '08:30', '09:30'), kept('b', '10:30', '11:30')],
      }),
    );
    expect(plan.unplaced.map((u) => u.occurrenceId)).toEqual([`c@${D0}`]);
    expect(plan.diff.moved).toEqual([]);
  });
});
