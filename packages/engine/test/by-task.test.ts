/*
 * Pins and existing placements given by task (intentionId) instead of by
 * occurrence: the engine finds the occurrence from the logical day the time
 * falls in. This is how task files store them: as real local times.
 */
import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import type { IntentionInput } from '../src/index.ts';
import { D0, addMinutes, daily, day, expectEmptyDiff, input, placement, slot, t } from './fixtures.ts';

// The logical day runs 04:00–04:00, so 03:00 on the 26th belongs to the 25th.
// (03:00 in Riyadh is midnight UTC, so the UTC date would be wrong too.)
const night = daily('night', '30m', { after: '22:00', before: '03:45' });

describe('a pin given by task', () => {
  it('belongs to the logical day its time falls in, even after midnight', () => {
    const plan = schedule(
      input({ dayStart: '04:00', now: t(D0, '12:00'), intentions: [night], pins: [{ intentionId: 'night', start: t(day(1), '03:00') }] }),
    );
    expect(placement(plan, `night@${D0}`)).toMatchObject({ kind: 'pinned', date: D0, start: t(day(1), '03:00') });
    expect(plan.warnings).toEqual([]);
  });

  it('of a one-off task is that task, whatever the date', () => {
    const report: IntentionInput = { id: 'report', duration: '1h', deadline: day(3) };
    const plan = schedule(input({ horizonDays: 3, intentions: [report], pins: [{ intentionId: 'report', start: t(day(2), '09:00') }] }));
    expect(placement(plan, 'report')).toMatchObject({ kind: 'pinned', start: t(day(2), '09:00') });
  });

  it('for an unknown task produces a warning', () => {
    const plan = schedule(input({ pins: [{ intentionId: 'nope', start: t(D0, '08:00') }] }));
    expect(plan.warnings).toEqual([expect.objectContaining({ code: 'unknown_occurrence', occurrenceId: 'nope' })]);
  });

  it('with neither a task nor an occurrence is ignored with a warning', () => {
    const plan = schedule(input({ dayStart: '04:00', intentions: [night], pins: [{ start: t(D0, '08:00') } as never] }));
    expect(plan.warnings).toEqual([expect.objectContaining({ code: 'invalid_pin' })]);
    expect(plan.placements[0]?.kind).toBe('fitted');
  });

  it('with both a task and an occurrence is ignored with a warning', () => {
    const pin = { intentionId: 'night', occurrenceId: `night@${D0}`, start: t(D0, '23:00') } as never;
    const plan = schedule(input({ intentions: [night], pins: [pin] }));
    expect(plan.warnings).toEqual([expect.objectContaining({ code: 'invalid_pin' })]);
  });
});

describe('an existing placement given by task', () => {
  it('is kept where it is, after midnight too, with nothing to change', () => {
    const scheduled = input({ dayStart: '04:00', now: t(D0, '12:00'), intentions: [night] });
    const first = schedule(scheduled);
    const start = placement(first, `night@${D0}`).start;
    const again = schedule({ ...scheduled, existing: [{ intentionId: 'night', start: t(day(1), '03:00'), end: t(day(1), '03:30'), state: 'scheduled' }] });
    expect(start).toBe(t(D0, '22:00'));
    expect(placement(again, `night@${D0}`)).toMatchObject({ date: D0, start: t(day(1), '03:00'), why: 'unchanged: still satisfies its rules' });
    expect(again.diff.added).toEqual([]);
  });

  it('round-trips a whole plan with an empty diff', () => {
    const scheduled = input({ horizonDays: 3, intentions: [daily('study', '45m', { after: '05:00', before: '07:00' })] });
    const plan = schedule(scheduled);
    const existing = plan.placements.map(({ intentionId, start, end, state }) => ({ intentionId, start, end, state }));
    expectEmptyDiff(schedule({ ...scheduled, existing }));
  });

  it('on a day the task does not occur is removed', () => {
    const gym: IntentionInput = { id: 'gym', duration: '1h', repeat: { on: ['mon'] }, window: { after: '17:00' } };
    // D0 is a Sunday.
    const plan = schedule(input({ intentions: [gym], existing: [{ intentionId: 'gym', start: t(D0, '18:00'), end: t(D0, '19:00'), state: 'scheduled' }] }));
    expect(plan.diff.removed).toEqual([expect.objectContaining({ occurrenceId: `gym@${D0}`, reason: 'its intention or occurrence no longer exists' })]);
  });

  it('that passed without being done becomes missed', () => {
    const plan = schedule(
      input({
        now: t(D0, '12:00'),
        intentions: [daily('study', '45m', { after: '05:00', before: '07:00' })],
        existing: [{ intentionId: 'study', start: t(D0, '05:00'), end: t(D0, '05:45'), state: 'scheduled' }],
      }),
    );
    expect(placement(plan, `study@${D0}`).state).toBe('missed');
    expect(plan.diff.missed).toEqual([`study@${D0}`]);
  });

  it('that is pinned and passed without being done becomes missed', () => {
    const plan = schedule(
      input({
        now: t(D0, '12:00'),
        intentions: [daily('study', '45m', { after: '05:00', before: '07:00' })],
        pins: [{ intentionId: 'study', start: t(D0, '08:00') }],
        existing: [{ intentionId: 'study', start: t(D0, '08:00'), end: t(D0, '08:45'), state: 'pinned' }],
      }),
    );
    expect(placement(plan, `study@${D0}`).state).toBe('missed');
    expect(plan.diff.missed).toEqual([`study@${D0}`]);
  });
});

describe('two records of the same occurrence', () => {
  const study = daily('study', '45m', { after: '05:00', before: '09:00' });
  const at = (time: string) => ({ start: t(D0, time), end: t(D0, addMinutes(time, 45)) });

  it('prefer what happened (done) over what was planned, without a warning', () => {
    const plan = schedule(
      input({
        now: t(D0, '12:00'),
        intentions: [study],
        existing: [
          { intentionId: 'study', ...at('05:00'), state: 'scheduled' },
          { occurrenceId: `study@${D0}`, ...at('06:00'), state: 'done' },
        ],
      }),
    );
    expect(placement(plan, `study@${D0}`)).toMatchObject({ state: 'done', start: t(D0, '06:00') });
    expect(plan.warnings).toEqual([]);
    expect(plan.diff.missed).toEqual([]);
  });

  it('prefer missed over planned', () => {
    const plan = schedule(
      input({
        now: t(D0, '12:00'),
        intentions: [study],
        existing: [
          { occurrenceId: `study@${D0}`, ...at('05:00'), state: 'missed' },
          { intentionId: 'study', ...at('05:00'), state: 'scheduled' },
        ],
      }),
    );
    expect(placement(plan, `study@${D0}`).state).toBe('missed');
    expect(plan.diff.missed).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('prefer a pin over a planned time, without a warning', () => {
    const plan = schedule(
      input({
        intentions: [study],
        pins: [{ intentionId: 'study', start: t(D0, '08:00') }],
        existing: [
          { intentionId: 'study', ...at('05:00'), state: 'scheduled' },
          { intentionId: 'study', ...at('08:00'), state: 'pinned' },
        ],
      }),
    );
    expect(slot(plan, `study@${D0}`)).toBe('08:00-08:45');
    expect(plan.warnings).toEqual([]);
  });

  it('of the same kind keep the earliest, with a warning', () => {
    const plan = schedule(
      input({
        intentions: [study],
        existing: [
          { intentionId: 'study', ...at('07:00'), state: 'scheduled' },
          { intentionId: 'study', ...at('05:00'), state: 'scheduled' },
        ],
      }),
    );
    expect(slot(plan, `study@${D0}`)).toBe('05:00-05:45');
    expect(plan.warnings).toEqual([expect.objectContaining({ code: 'duplicate_existing', occurrenceId: `study@${D0}` })]);
  });
});

