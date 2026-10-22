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
import { D0, anchor, daily, expectNoOverlaps, input, rerun, slot } from './fixtures.ts';

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
