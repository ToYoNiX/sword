import { describe, expect, it } from 'vitest';
import { EngineInputError, schedule } from '../src/index.ts';
import { D0, daily, day, input, slot, t, unplacedOf } from './fixtures.ts';

// D0 is a Sunday.
const work = { start: '09:00', end: '17:00', on: ['sun', 'mon', 'tue', 'wed', 'thu'] as const, busy: true };

describe('fixed anchors from settings', () => {
  it('exist on their weekdays, so rules can use them', () => {
    const plan = schedule(
      input({
        horizonDays: 6,
        fixedAnchors: { work: { ...work, on: [...work.on] } },
        intentions: [daily('commute', '30m', { before: 'work' }, { prefer: 'latest' })],
      }),
    );
    expect(slot(plan, `commute@${D0}`)).toBe('08:30-09:00');
    // Friday (day 5) has no work.
    expect(unplacedOf(plan, `commute@${day(5)}`).code).toBe('missing_anchor');
  });

  it('block time when busy', () => {
    const plan = schedule(
      input({
        fixedAnchors: { work: { ...work, on: [...work.on] } },
        intentions: [daily('read', '1h', { after: '08:30', before: '18:00' })],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('17:00-18:00');
  });

  it('do not block time when not busy', () => {
    const plan = schedule(
      input({
        fixedAnchors: { gym_hours: { start: '18:00', end: '21:00' } },
        intentions: [daily('gym', '1h', { within: 'gym_hours' })],
      }),
    );
    expect(slot(plan, `gym@${D0}`)).toBe('18:00-19:00');
  });

  it('can run past midnight, unlike day parts', () => {
    const plan = schedule(
      input({
        fixedAnchors: { night_shift: { start: '22:00', end: '06:00' } },
        intentions: [daily('break', '30m', { within: 'night_shift' }, { prefer: 'latest' })],
      }),
    );
    expect(plan.placements[0]).toMatchObject({ start: t(day(1), '05:30'), end: t(day(1), '06:00') });
  });

  it('every day when no weekdays are given', () => {
    const plan = schedule(
      input({
        horizonDays: 7,
        fixedAnchors: { lunch: { start: '13:00', end: '14:00' } },
        intentions: [daily('eat', '30m', { within: 'lunch' })],
      }),
    );
    expect(plan.placements).toHaveLength(7);
  });

  it.each([
    ['an invalid time', { lunch: { start: '1pm', end: '14:00' } }],
    ['an anchor reference instead of a time', { lunch: { start: 'day.start', end: '14:00' } }],
    ['an invalid weekday', { lunch: { start: '13:00', end: '14:00', on: ['monday' as never] } }],
    ['an invalid name', { 'Lunch Break': { start: '13:00', end: '14:00' } }],
    ['the name of a day part', { morning: { start: '06:00', end: '07:00' } }],
  ])('reject %s', (_, fixedAnchors) => {
    expect(() => schedule(input({ fixedAnchors }))).toThrow(EngineInputError);
  });

  it('reject the name of an anchor a provider already gives', () => {
    expect(() =>
      schedule(input({ anchors: [{ id: 'work', date: D0, start: t(D0, '09:00') }], fixedAnchors: { work: { start: '09:00', end: '17:00' } } })),
    ).toThrow(EngineInputError);
  });
});
