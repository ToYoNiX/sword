import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import type { ScheduleInput } from '../src/index.ts';
import {
  D0,
  daily,
  day,
  expectEmptyDiff,
  input,
  placement,
  prayers,
  rerun,
  slot,
  t,
  unplacedOf,
} from './fixtures.ts';

const window8to10 = { after: '08:00', before: '10:00' };
const read = daily('read', '30m', window8to10);

describe('time passing', () => {
  it('never places new work in the past', () => {
    const plan = schedule(input({ now: t(D0, '09:07:30'), intentions: [daily('read', '30m', { after: '08:00', before: '12:00' })] }));
    expect(slot(plan, `read@${D0}`)).toBe('09:08-09:38');
  });

  it('reports a window that already ended today and still plans tomorrow', () => {
    const plan = schedule(input({ now: t(D0, '13:00'), horizonDays: 2, intentions: [read] }));
    expect(unplacedOf(plan, `read@${D0}`).code).toBe('window_passed');
    expect(slot(plan, `read@${day(1)}`)).toBe('08:00-08:30');
  });

  it('does not create a formula occurrence whose time has passed', () => {
    const plan = schedule(
      input({ now: t(D0, '07:00'), intentions: [{ id: 'quran', duration: '20m', repeat: 'daily', at: '06:00' }] }),
    );
    expect(unplacedOf(plan, `quran@${D0}`).code).toBe('window_passed');
    expect(plan.placements).toEqual([]);
  });

  it('marks an occurrence missed when its time ends without completion, and does not re-place it', () => {
    const plan = schedule(
      input({
        now: t(D0, '10:00'),
        intentions: [daily('read', '30m', { after: '08:00', before: '12:00' })],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(plan.placements).toEqual([expect.objectContaining({ occurrenceId: `read@${D0}`, state: 'missed' })]);
    expect(plan.diff.missed).toEqual([`read@${D0}`]);
  });

  it('marks yesterday\'s unfinished placements missed, even though yesterday is outside the horizon', () => {
    const plan = schedule(
      input({
        now: t(day(1), '10:00'),
        intentions: [read],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(placement(plan, `read@${D0}`)).toMatchObject({ state: 'missed', date: D0 });
    expect(plan.diff.missed).toEqual([`read@${D0}`]);
    expect(plan.diff.removed).toEqual([]);
  });

  it('keeps done and missed placements from before the horizon as history', () => {
    const scheduled = input({
      now: t(day(2), '10:00'),
      intentions: [read],
      existing: [
        { occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'done' },
        { occurrenceId: `read@${day(1)}`, start: t(day(1), '08:00'), end: t(day(1), '08:30'), state: 'missed' },
      ],
    });
    const plan = schedule(scheduled);
    expect(placement(plan, `read@${D0}`).state).toBe('done');
    expect(placement(plan, `read@${day(1)}`).state).toBe('missed');
    expectEmptyDiff(plan);
    expectEmptyDiff(rerun(scheduled, plan));
  });

  it('leaves a missed one-off task missed until the user acts on it', () => {
    const plan = schedule(
      input({
        now: t(D0, '10:00'),
        horizonDays: 3,
        intentions: [{ id: 'call', duration: '30m', window: { after: '08:00', before: '09:00' }, deadline: day(2) }],
        existing: [{ occurrenceId: 'call', start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(plan.placements).toEqual([expect.objectContaining({ occurrenceId: 'call', state: 'missed', date: D0 })]);
  });

  it('keeps completed placements as history, even if they now overlap something', () => {
    const plan = schedule(
      input({
        events: [{ id: 'late_meeting', start: t(D0, '08:00'), end: t(D0, '09:00') }],
        intentions: [read],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'done' }],
      }),
    );
    expect(placement(plan, `read@${D0}`)).toMatchObject({ state: 'done', start: t(D0, '08:00') });
    expect(plan.conflicts).toEqual([]);
    expectEmptyDiff(plan);
  });

  it('never moves a placement that has already started, but reports a new conflict', () => {
    const plan = schedule(
      input({
        now: t(D0, '08:10'),
        events: [{ id: 'call', start: t(D0, '08:15'), end: t(D0, '08:45') }],
        intentions: [read],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('08:00-08:30');
    expect(plan.conflicts).toEqual([expect.objectContaining({ occurrenceId: `read@${D0}`, with: ['event:call'] })]);
    expectEmptyDiff(plan);
  });
});

describe('stability', () => {
  it('keeps a valid placement even when an earlier slot is free', () => {
    const plan = schedule(
      input({
        intentions: [read],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:30'), end: t(D0, '09:00'), state: 'scheduled' }],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('08:30-09:00');
    expect(placement(plan, `read@${D0}`).why).toContain('unchanged');
    expectEmptyDiff(plan);
  });

  it('moves an invalidated placement and explains why', () => {
    const plan = schedule(
      input({
        events: [{ id: 'standup', start: t(D0, '08:00'), end: t(D0, '08:20') }],
        intentions: [read],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('08:20-08:50');
    expect(plan.diff.added).toEqual([]);
    expect(plan.diff.moved).toEqual([
      expect.objectContaining({ occurrenceId: `read@${D0}`, reason: expect.stringContaining('standup') }),
    ]);
  });

  it('moves a placement when its duration changes', () => {
    const plan = schedule(
      input({
        intentions: [daily('read', '45m', window8to10)],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:30'), end: t(D0, '09:00'), state: 'scheduled' }],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('08:00-08:45');
    expect(plan.diff.moved[0]?.reason).toContain('45m');
  });

  it('removes the placement of a deleted intention', () => {
    const plan = schedule(
      input({
        existing: [{ occurrenceId: `gone@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(plan.placements).toEqual([]);
    expect(plan.diff.removed).toEqual([expect.objectContaining({ occurrenceId: `gone@${D0}` })]);
  });

  it('removes a placement that no longer fits, with the reason', () => {
    const plan = schedule(
      input({
        events: [{ id: 'offsite', start: t(D0, '08:00'), end: t(D0, '10:00') }],
        intentions: [read],
        existing: [{ occurrenceId: `read@${D0}`, start: t(D0, '08:00'), end: t(D0, '08:30'), state: 'scheduled' }],
      }),
    );
    expect(unplacedOf(plan, `read@${D0}`).code).toBe('no_slot');
    expect(plan.diff.removed).toEqual([
      expect.objectContaining({ occurrenceId: `read@${D0}`, reason: expect.stringContaining('no free') }),
    ]);
  });
});

describe('determinism', () => {
  const busyDay: ScheduleInput = input({
    horizonDays: 2,
    anchors: [...prayers(D0), ...prayers(day(1))],
    events: [
      { id: 'standup', start: t(D0, '09:00'), end: t(D0, '09:15') },
      { id: 'review', start: t(day(1), '13:00'), end: t(day(1), '14:00') },
    ],
    intentions: [
      { id: 'quran', duration: '20m', repeat: 'daily', at: 'prayer.fajr.busy.end + 5m' },
      daily('study', '45m', { after: 'prayer.fajr', before: '09:00' }),
      daily('walk', '30m', { after: 'prayer.asr', before: 'prayer.maghrib' }),
      daily('read', '30m', { after: 'prayer.isha' }, { prefer: 'latest' }),
      { id: 'report', duration: '1h', window: { before: 'prayer.dhuhr' }, deadline: day(1) },
    ],
    pins: [{ occurrenceId: `walk@${day(1)}`, start: t(day(1), '16:00') }],
  });

  it('produces the same plan for the same input', () => {
    expect(schedule(busyDay)).toEqual(schedule(busyDay));
  });

  it('does not depend on the order of the input', () => {
    const reversed: ScheduleInput = {
      ...busyDay,
      anchors: [...(busyDay.anchors ?? [])].reverse(),
      events: [...(busyDay.events ?? [])].reverse(),
      intentions: [...busyDay.intentions].reverse(),
    };
    expect(schedule(reversed)).toEqual(schedule(busyDay));
  });

  it('produces an empty diff when nothing changed', () => {
    const first = schedule(busyDay);
    const second = rerun(busyDay, first);
    expectEmptyDiff(second);
    expect(second.placements.map(({ occurrenceId, start, end, state }) => ({ occurrenceId, start, end, state }))).toEqual(
      first.placements.map(({ occurrenceId, start, end, state }) => ({ occurrenceId, start, end, state })),
    );
  });
});
