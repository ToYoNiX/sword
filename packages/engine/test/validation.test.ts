import { describe, expect, it } from 'vitest';
import { EngineInputError, schedule } from '../src/index.ts';
import type { IntentionInput } from '../src/index.ts';
import { D0, daily, input, prayers, slot, t } from './fixtures.ts';

const good = daily('good', '30m', { after: '08:00', before: '10:00' });

describe('fatal input errors', () => {
  it.each([
    ['an unknown time zone', { timeZone: 'Mars/Olympus' }],
    ['an invalid "now"', { now: 'yesterday' }],
    ['a zero-day horizon', { horizonDays: 0 }],
    ['a fractional horizon', { horizonDays: 1.5 }],
    ['an invalid day start', { dayStart: 'prayer.fajr +' }],
    ['a day start at an unknown anchor', { dayStart: 'sun.rise' }],
    ['an invalid global avoid rule', { avoid: ['prayer'] }],
    ['an invalid day part time', { dayParts: { morning: { start: '7am', end: '11:00' } } }],
    ['a day part that refers to another anchor', { dayParts: { early: { start: 'prayer.fajr', end: '07:00' } } }],
    ['a day part named like a provided anchor', { dayParts: { work: { start: '09:00', end: '17:00' } }, anchors: [{ id: 'work', date: D0, start: t(D0, '09:00') }] }],
    ['an invalid day part name', { dayParts: { 'Lunch Break': { start: '12:00', end: '13:00' } } }],
    ['a global avoid rule for an unknown anchor', { avoid: ['anchor:lunch'] }],
  ])('rejects %s', (_, overrides) => {
    expect(() => schedule(input(overrides))).toThrow(EngineInputError);
  });
});

describe('invalid intentions', () => {
  const base: IntentionInput = { id: 'bad', duration: '30m', window: { after: '08:00', before: '10:00' } };

  it.each<[string, Partial<IntentionInput>]>([
    ['invalid_id', { id: 'has space' }],
    ['invalid_id', { id: 'a@b' }],
    ['invalid_duration', { duration: '45' }],
    ['invalid_expression', { window: { after: 'prayer.fajr +' } }],
    ['unknown_anchor', { window: { after: 'prayer.fajrr' } }],
    ['unknown_anchor', { avoid: ['anchor:lunch'] }],
    ['conflicting_rules', { at: '08:00', date: D0 }],
    ['conflicting_rules', { repeat: 'daily', date: D0 }],
    ['missing_date', { at: '08:00', window: undefined }],
    ['invalid_repeat', { repeat: { on: ['monday' as never] } }],
    ['invalid_repeat', { repeat: { every: '2 fortnights', since: D0 } }],
    ['invalid_repeat', { repeat: { every: '2 days' } }],
    ['invalid_repeat', { repeat: { every: '1 month', on: ['mon'] } }],
    ['invalid_repeat', { repeat: { every: '1 month', onDay: 32 } }],
    ['invalid_repeat', { repeat: { every: '2 days', since: '2026-13-01' } }],
    ['invalid_repeat', { repeat: { evry: '1 day' } as never }],
    ['unknown_anchor', { window: { after: 'work.end or prayer.fajrr' } }],
    ['invalid_expression', { window: { after: 'work.end or' } }],
    ['invalid_within', { window: { within: 'prayer.fajr.start' } }],
    ['invalid_within', { window: { within: '08:00' } }],
    ['invalid_deadline', { deadline: 'next week' }],
    ['invalid_prefer', { prefer: 'soon' as never }],
    ['invalid_repeat', { repeat: 'hourly' as never }],
    ['invalid_selector', { avoid: ['prayer'] }],
    ['invalid_date', { date: '2026-02-30' }],
    ['invalid_priority', { priority: 1.5 }],
  ])('are reported as %s without affecting other intentions', (code, overrides) => {
    const plan = schedule(input({ anchors: prayers(D0), intentions: [{ ...base, ...overrides }, good] }));
    expect(plan.errors).toContainEqual(expect.objectContaining({ code }));
    expect(plan.placements.map((p) => p.intentionId)).toEqual(['good']);
    expect(plan.unplaced).toEqual([]);
    expect(slot(plan, `good@${D0}`)).toBe('08:00-08:30');
  });

  it('exclude every intention that shares a duplicated id', () => {
    const plan = schedule(input({ intentions: [daily('x', '30m', { after: '08:00' }), daily('x', '1h', { after: '09:00' }), good] }));
    expect(plan.errors.filter((e) => e.code === 'duplicate_id')).toHaveLength(2);
    expect(plan.placements.map((p) => p.intentionId)).toEqual(['good']);
  });
});

describe('invalid supporting data', () => {
  it('ignores an event that ends before it starts, with a warning', () => {
    const plan = schedule(
      input({ events: [{ id: 'broken', start: t(D0, '09:00'), end: t(D0, '08:00') }], intentions: [good] }),
    );
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'invalid_event' }));
    expect(slot(plan, `good@${D0}`)).toBe('08:00-08:30');
  });

  it('ignores an anchor with an invalid time, with a warning', () => {
    const plan = schedule(input({ anchors: [{ id: 'lunch', date: D0, start: 'noon' }], intentions: [good] }));
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'invalid_anchor' }));
    expect(slot(plan, `good@${D0}`)).toBe('08:00-08:30');
  });

  it('ignores an existing placement with an invalid state, with a warning', () => {
    const plan = schedule(
      input({
        intentions: [good],
        existing: [{ occurrenceId: `good@${D0}`, start: t(D0, '09:00'), end: t(D0, '09:30'), state: 'later' as never }],
      }),
    );
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'invalid_existing' }));
    expect(slot(plan, `good@${D0}`)).toBe('08:00-08:30');
  });
});
