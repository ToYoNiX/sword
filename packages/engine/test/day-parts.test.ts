import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import { D0, daily, day, input, slot, t } from './fixtures.ts';

describe('built-in day parts', () => {
  it('exist every day without any plugin', () => {
    const plan = schedule(
      input({
        horizonDays: 2,
        intentions: [
          { id: 'call', duration: '15m', repeat: 'daily', at: 'afternoon' },
          daily('nap', '30m', { within: 'afternoon' }),
          daily('plan', '15m', { before: 'evening' }, { prefer: 'latest' }),
        ],
      }),
    );
    for (const date of [D0, day(1)]) {
      expect(slot(plan, `call@${date}`)).toBe('12:00-12:15');
      expect(slot(plan, `nap@${date}`)).toBe('12:15-12:45');
      expect(slot(plan, `plan@${date}`)).toBe('16:45-17:00');
    }
    expect(plan.errors).toEqual([]);
  });

  it('can be changed and extended in settings', () => {
    const plan = schedule(
      input({
        dayParts: { morning: { start: '07:00', end: '11:00' }, siesta: { start: '14:00', end: '16:00' } },
        intentions: [daily('read', '30m', { within: 'morning' }), daily('rest', '30m', { within: 'siesta' }, { prefer: 'latest' })],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('07:00-07:30');
    expect(slot(plan, `rest@${D0}`)).toBe('15:30-16:00');
  });

  it('can be removed', () => {
    const plan = schedule(input({ dayParts: { evening: null }, intentions: [daily('walk', '30m', { within: 'evening' })] }));
    expect(plan.errors).toEqual([expect.objectContaining({ code: 'unknown_anchor', intentionId: 'walk' })]);
  });

  it('run the night until the end of the logical day', () => {
    const plan = schedule(input({ intentions: [daily('read', '30m', { within: 'night' }, { prefer: 'latest' })] }));
    expect(slot(plan, `read@${D0}`)).toBe('23:30-00:00');
  });

  it('are clipped to the logical day', () => {
    const plan = schedule(
      input({ now: t(D0, '06:00'), dayStart: '06:00', intentions: [daily('read', '30m', { within: 'morning' })] }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('06:00-06:30');
  });

  it('are reported per logical day in the plan, for drawing', () => {
    const plan = schedule(input({ horizonDays: 2 }));
    expect(plan.days.map((d) => d.date)).toEqual([D0, day(1)]);
    expect(plan.days[0]).toMatchObject({ start: t(D0, '00:00'), end: t(day(1), '00:00') });
    expect(plan.days[0]?.parts).toEqual([
      { name: 'afternoon', start: t(D0, '12:00'), end: t(D0, '17:00') },
      { name: 'evening', start: t(D0, '17:00'), end: t(D0, '21:00') },
      { name: 'morning', start: t(D0, '05:00'), end: t(D0, '12:00') },
      { name: 'night', start: t(D0, '21:00'), end: t(day(1), '00:00') },
    ]);
  });

  it('can wrap past midnight', () => {
    const plan = schedule(
      input({
        dayParts: { late: { start: '23:00', end: '01:00' } },
        intentions: [daily('read', '30m', { within: 'late' }, { prefer: 'latest' })],
      }),
    );
    // Clipped to the logical day, which ends at midnight.
    expect(slot(plan, `read@${D0}`)).toBe('23:30-00:00');
  });
});
