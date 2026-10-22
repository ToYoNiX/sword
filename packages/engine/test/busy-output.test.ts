/*
 * The plan lists the busy parts of anchors on its days, e.g. prayer times,
 * so a calendar or a UI can show them without resolving anchors itself.
 */
import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import { D0, anchor, day, input, t } from './fixtures.ts';

describe('busy times in the plan', () => {
  it('lists the busy part of each anchor on the plan\'s days, with its title', () => {
    const plan = schedule(
      input({
        horizonDays: 1,
        anchors: [
          { ...anchor('prayer.asr', D0, '15:49', '18:14', { busy: [['15:49', '16:19']], tags: ['prayer'] }), title: 'Asr' },
          anchor('prayer.asr', day(1), '15:48', '18:13', { busy: [['15:48', '16:18']] }),
          anchor('sun.rise', D0, '06:30'),
        ],
      }),
    );
    expect(plan.busy).toEqual([{ anchor: 'prayer.asr', date: D0, title: 'Asr', start: t(D0, '15:49'), end: t(D0, '16:19'), tags: ['prayer'] }]);
  });

  it('includes fixed anchors that are busy, titled by their name', () => {
    const plan = schedule(input({ horizonDays: 1, fixedAnchors: { work: { start: '09:00', end: '17:00', busy: true }, lunch: { start: '12:00', end: '13:00' } } }));
    expect(plan.busy).toEqual([{ anchor: 'work', date: D0, title: 'work', start: t(D0, '09:00'), end: t(D0, '17:00'), tags: [] }]);
  });

  it('is in time order', () => {
    const plan = schedule(
      input({
        horizonDays: 1,
        anchors: [anchor('b.late', D0, '18:00', '19:00', { busy: [['18:00', '18:30']] }), anchor('a.early', D0, '05:00', '06:00', { busy: [['05:00', '05:20']] })],
      }),
    );
    expect(plan.busy.map((b) => b.anchor)).toEqual(['a.early', 'b.late']);
  });
});
