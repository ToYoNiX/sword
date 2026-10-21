import { describe, expect, it } from 'vitest';
import { buildAnchorIndex } from '../src/anchors.ts';
import { LogicalDays } from '../src/day.ts';
import { parseTimeExpr } from '../src/index.ts';
import type { AnchorInput, Issue } from '../src/index.ts';
import { D0, TZ, anchor, t } from './fixtures.ts';

function setup(dayStart = '00:00', anchors: AnchorInput[] = [], tz = TZ) {
  const warnings: Issue[] = [];
  const days = new LogicalDays(tz, parseTimeExpr(dayStart), buildAnchorIndex(anchors, warnings), warnings);
  return { days, warnings };
}

const ms = (iso: string) => Date.parse(iso);

describe('logical days', () => {
  it('default to civil midnight', () => {
    const { days } = setup();
    expect(days.start(D0)).toBe(ms(t(D0, '00:00')));
    expect(days.end(D0)).toBe(ms(t('2026-10-26', '00:00')));
    expect(days.dateOf(ms(t(D0, '23:59')))).toBe(D0);
  });

  it('put times before a 05:00 day start in the previous logical day', () => {
    const { days } = setup('05:00');
    expect(days.dateOf(ms(t(D0, '01:30')))).toBe('2026-10-24');
    expect(days.dateOf(ms(t(D0, '04:59')))).toBe('2026-10-24');
    expect(days.dateOf(ms(t(D0, '05:00')))).toBe(D0);
  });

  it('resolve wall-clock times after midnight to the end of the logical day', () => {
    const { days } = setup('05:00');
    expect(days.clock('2026-10-24', 60)).toBe(ms(t(D0, '01:00')));
    expect(days.clock('2026-10-24', 600)).toBe(ms(t('2026-10-24', '10:00')));
  });

  it('can start at an anchor', () => {
    const anchors = [
      anchor('prayer.fajr', '2026-10-24', '04:50'),
      anchor('prayer.fajr', D0, '04:51'),
      anchor('prayer.fajr', '2026-10-26', '04:52'),
    ];
    const { days, warnings } = setup('prayer.fajr.start', anchors);
    expect(days.start(D0)).toBe(ms(t(D0, '04:51')));
    expect(days.end(D0)).toBe(ms(t('2026-10-26', '04:52')));
    expect(days.dateOf(ms(t(D0, '04:50')))).toBe('2026-10-24');
    expect(days.dateOf(ms(t(D0, '04:51')))).toBe(D0);
    expect(warnings).toEqual([]);
  });

  it('fall back to midnight with a warning when the day-start anchor is missing', () => {
    const { days, warnings } = setup('prayer.fajr.start', [anchor('prayer.fajr', D0, '04:51')]);
    expect(days.start('2026-10-27')).toBe(ms(t('2026-10-27', '00:00')));
    expect(warnings).toEqual([expect.objectContaining({ code: 'day_start_fallback' })]);
    days.start('2026-10-27');
    expect(warnings).toHaveLength(1);
  });

  describe('across DST changes (Europe/Berlin)', () => {
    const tz = 'Europe/Berlin';

    it('resolve wall-clock times in the offset of that day', () => {
      const { days } = setup('00:00', [], tz);
      expect(days.clock('2026-10-24', 9 * 60)).toBe(ms('2026-10-24T07:00:00Z'));
      expect(days.clock('2026-10-25', 9 * 60)).toBe(ms('2026-10-25T08:00:00Z'));
    });

    it('make the day the clocks go back 25 hours long', () => {
      const { days } = setup('00:00', [], tz);
      expect(days.end('2026-10-25') - days.start('2026-10-25')).toBe(25 * 3_600_000);
    });

    it('move a time that does not exist (spring forward) to just after the gap', () => {
      const { days } = setup('00:00', [], tz);
      expect(days.clock('2026-03-29', 2 * 60 + 30)).toBe(ms('2026-03-29T01:30:00Z'));
    });
  });
});
