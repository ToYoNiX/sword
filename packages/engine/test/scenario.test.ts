/**
 * The acceptance scenario from docs/design.md §16, with synthetic prayer times
 * so the engine is tested without any plugin.
 *
 * Asia/Riyadh, 2026-10-25 (Sun) .. 2026-10-31 (Sat). The logical day starts at
 * Fajr, which gets a minute later every day; Asr and Maghrib a minute earlier.
 * Work is Sun–Thu 09:00–14:00. Every prayer is busy for its first 20 minutes.
 */
import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import type { AnchorInput, ScheduleInput } from '../src/index.ts';
import {
  D0,
  addMinutes,
  anchor,
  daily,
  day,
  expectEmptyDiff,
  expectNoOverlaps,
  placement,
  prayers,
  rerun,
  slot,
  t,
  unplacedOf,
} from './fixtures.ts';

const WORKDAYS = new Set([0, 1, 2, 3, 4, 7]);

interface Tweaks {
  asr?: Record<string, string>;
  workStart?: Record<string, string>;
}

function anchorsFor(tweaks: Tweaks = {}): AnchorInput[] {
  const anchors: AnchorInput[] = [];
  for (let i = 0; i <= 7; i++) {
    const date = day(i);
    anchors.push(
      ...prayers(date, {
        fajr: addMinutes('04:50', i),
        dhuhr: '11:50',
        asr: tweaks.asr?.[date] ?? addMinutes('15:10', -i),
        maghrib: addMinutes('17:35', -i),
        isha: addMinutes('19:05', -i),
      }),
    );
    if (WORKDAYS.has(i)) {
      const start = tweaks.workStart?.[date] ?? '09:00';
      anchors.push(anchor('work', date, start, '14:00', { busy: [[start, '14:00']], tags: ['work'] }));
    }
  }
  return anchors;
}

function scenario(tweaks: Tweaks = {}, overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    timeZone: 'Asia/Riyadh',
    now: t(D0, '04:50'),
    horizonDays: 7,
    dayStart: 'prayer.fajr.start',
    avoid: ['tag:prayer'],
    anchors: anchorsFor(tweaks),
    intentions: [
      { id: 'quran', title: 'Morning Quran', duration: '20m', repeat: 'daily', at: 'prayer.fajr.busy.end + 5m' },
      daily('study', '45m', { after: 'prayer.fajr', before: 'work.start' }, { title: 'Study Go' }),
      { id: 'report', title: 'Write report', duration: '30m', window: { before: 'prayer.dhuhr' }, deadline: day(2) },
      daily('walk', '30m', { after: 'prayer.asr', before: 'prayer.maghrib' }, { title: 'Walk' }),
    ],
    ...overrides,
  };
}

const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ i, date: day(i) }));

describe('acceptance scenario', () => {
  const base = scenario();
  const plan = schedule(base);

  it('has no errors or warnings', () => {
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('1. moves Morning Quran with Fajr, always 5 minutes after the prayer', () => {
    for (const { i, date } of days) {
      expect(slot(plan, `quran@${date}`), date).toBe(`${addMinutes('05:15', i)}-${addMinutes('05:35', i)}`);
    }
  });

  it('2. puts Study Go right after Morning Quran on workdays', () => {
    for (const { i, date } of days.slice(0, 5)) {
      expect(slot(plan, `study@${date}`), date).toBe(`${addMinutes('05:35', i)}-${addMinutes('06:20', i)}`);
    }
  });

  it('3. leaves Study Go unplaced on the weekend, because there is no work.start', () => {
    for (const { date } of days.slice(5)) {
      const miss = unplacedOf(plan, `study@${date}`);
      expect(miss.code).toBe('missing_anchor');
      expect(miss.message).toContain('work');
    }
  });

  it('places the one-off report in the first gap before Dhuhr', () => {
    expect(placement(plan, 'report')).toMatchObject({ date: D0, start: t(D0, '06:20'), end: t(D0, '06:50') });
  });

  it('places the walk right after Asr every day', () => {
    for (const { i, date } of days) {
      expect(slot(plan, `walk@${date}`), date).toBe(`${addMinutes('15:30', -i)}-${addMinutes('16:00', -i)}`);
    }
  });

  it('never overlaps a prayer or another task', () => {
    expectNoOverlaps(plan, base);
    expect(plan.conflicts).toEqual([]);
  });

  it('4. moves only the affected Study Go when a meeting lands on it', () => {
    const withMeeting = { ...base, events: [{ id: 'meeting', title: 'Team meeting', start: t(day(1), '06:00'), end: t(day(1), '06:30') }] };
    const next = rerun(withMeeting, plan);
    expect(slot(next, `study@${day(1)}`)).toBe('06:30-07:15');
    expect(next.diff.moved).toEqual([
      expect.objectContaining({ occurrenceId: `study@${day(1)}`, reason: expect.stringContaining('Team meeting') }),
    ]);
    expect(next.diff.added).toEqual([]);
    expect(next.diff.removed).toEqual([]);
    expectNoOverlaps(next, withMeeting);
  });

  it('5. keeps a pinned walk in place when Asr moves onto it, and reports the conflict', () => {
    const pins = [{ occurrenceId: `walk@${day(3)}`, start: t(day(3), '16:30') }];
    const pinned = rerun(base, plan, { pins });
    expect(slot(pinned, `walk@${day(3)}`)).toBe('16:30-17:00');
    expect(pinned.conflicts).toEqual([]);

    const asrMoved = scenario({ asr: { [day(3)]: '16:20' } }, { pins });
    const after = rerun(asrMoved, pinned);
    expect(slot(after, `walk@${day(3)}`)).toBe('16:30-17:00');
    expect(after.conflicts).toEqual([
      expect.objectContaining({ occurrenceId: `walk@${day(3)}`, with: [`anchor:prayer.asr@${day(3)}`] }),
    ]);
  });

  it('6. leaves Study Go unplaced on a day with no room, without overlapping anything', () => {
    const tight = scenario({ workStart: { [day(2)]: '05:50' } });
    const tightPlan = schedule(tight);
    const miss = unplacedOf(tightPlan, `study@${day(2)}`);
    expect(miss.code).toBe('no_slot');
    expect(miss.blockers).toContain(`task:quran@${day(2)}`);
    expectNoOverlaps(tightPlan, tight);
  });

  it('8. produces an empty diff when run again with no changes', () => {
    expectEmptyDiff(rerun(base, plan));
  });
});
