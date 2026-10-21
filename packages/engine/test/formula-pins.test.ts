import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import type { IntentionInput } from '../src/index.ts';
import {
  D0,
  PT,
  addMinutes,
  anchor,
  daily,
  day,
  expectNoOverlaps,
  hasPlacement,
  input,
  placement,
  prayers,
  slot,
  t,
  unplacedOf,
} from './fixtures.ts';

const quran: IntentionInput = { id: 'quran', duration: '20m', repeat: 'daily', at: 'prayer.fajr.busy.end + 5m' };

const twoDays = [...prayers(D0), ...prayers(day(1), { ...PT, fajr: addMinutes(PT.fajr, 1) })];

describe('formula placements (at)', () => {
  it('follow their anchor every day', () => {
    const plan = schedule(input({ horizonDays: 2, anchors: twoDays, intentions: [quran] }));
    expect(slot(plan, `quran@${D0}`)).toBe('05:15-05:35');
    expect(slot(plan, `quran@${day(1)}`)).toBe('05:16-05:36');
    expect(placement(plan, `quran@${D0}`).kind).toBe('formula');
  });

  it('are reported, not moved, when they collide with something', () => {
    const plan = schedule(
      input({
        horizonDays: 2,
        anchors: twoDays,
        events: [{ id: 'standup', start: t(D0, '05:20'), end: t(D0, '05:40') }],
        intentions: [quran],
      }),
    );
    expect(slot(plan, `quran@${D0}`)).toBe('05:15-05:35');
    expect(plan.conflicts).toEqual([expect.objectContaining({ occurrenceId: `quran@${D0}`, with: ['event:standup'] })]);
  });

  it('are avoided by fitted tasks', () => {
    const scheduled = input({
      anchors: prayers(D0),
      intentions: [quran, daily('study', '45m', { after: 'prayer.fajr', before: '07:00' })],
    });
    const plan = schedule(scheduled);
    // Fajr's busy portion ends 05:10, but the 5 minutes before Quran are too short.
    expect(slot(plan, `study@${D0}`)).toBe('05:35-06:20');
    expectNoOverlaps(plan, scheduled);
  });
});

describe('missing anchors', () => {
  it('without a fallback, block the occurrence and say which anchor is missing', () => {
    const plan = schedule(input({ horizonDays: 3, anchors: twoDays, intentions: [quran] }));
    const miss = unplacedOf(plan, `quran@${day(2)}`);
    expect(miss.code).toBe('missing_anchor');
    expect(miss.message).toContain('prayer.fajr');
    expect(hasPlacement(plan, `quran@${day(1)}`)).toBe(true);
  });

  it('use the first fallback that exists', () => {
    const plan = schedule(
      input({ horizonDays: 3, anchors: twoDays, intentions: [{ ...quran, at: 'prayer.fajr.busy.end + 5m or 05:30' }] }),
    );
    expect(slot(plan, `quran@${D0}`)).toBe('05:15-05:35');
    expect(slot(plan, `quran@${day(2)}`)).toBe('05:30-05:50');
  });

  it('can give a window bound a fallback', () => {
    const work = anchor('work', D0, '09:00', '17:00', { busy: [['09:00', '17:00']] });
    const plan = schedule(
      input({
        horizonDays: 2,
        anchors: [work],
        intentions: [daily('evening', '30m', { after: 'work.end or 18:00', before: '23:00' })],
      }),
    );
    expect(slot(plan, `evening@${D0}`)).toBe('17:00-17:30');
    expect(slot(plan, `evening@${day(1)}`)).toBe('18:00-18:30');
  });

  it('try fallbacks in the order written', () => {
    const plan = schedule(
      input({
        horizonDays: 3,
        anchors: [
          anchor('gym', D0, '20:00', '21:00'),
          anchor('work', D0, '09:00', '17:00', { busy: [['09:00', '17:00']] }),
          anchor('work', day(1), '09:00', '17:00', { busy: [['09:00', '17:00']] }),
        ],
        intentions: [daily('read', '30m', { after: 'gym.end or work.end or 19:00' })],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('21:00-21:30');
    expect(slot(plan, `read@${day(1)}`)).toBe('17:00-17:30');
    expect(slot(plan, `read@${day(2)}`)).toBe('19:00-19:30');
  });
});

describe('pins', () => {
  const study = daily('study', '45m', { after: 'prayer.fajr', before: '07:00' });

  it('place the occurrence exactly where the user put it, even outside its window', () => {
    const plan = schedule(
      input({ anchors: prayers(D0), intentions: [study], pins: [{ occurrenceId: `study@${D0}`, start: t(D0, '07:30') }] }),
    );
    expect(slot(plan, `study@${D0}`)).toBe('07:30-08:15');
    expect(placement(plan, `study@${D0}`)).toMatchObject({ kind: 'pinned', state: 'pinned' });
    expect(plan.conflicts).toEqual([]);
  });

  it('are kept but reported when they overlap a prayer', () => {
    const plan = schedule(
      input({ anchors: prayers(D0), intentions: [study], pins: [{ occurrenceId: `study@${D0}`, start: t(D0, '11:40') }] }),
    );
    expect(slot(plan, `study@${D0}`)).toBe('11:40-12:25');
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ occurrenceId: `study@${D0}`, with: [`anchor:prayer.dhuhr@${D0}`] }),
    ]);
  });

  it('are avoided by other tasks', () => {
    const scheduled = input({
      anchors: prayers(D0),
      intentions: [quran, study, daily('walk', '30m', { after: 'prayer.fajr', before: '07:00' })],
      pins: [{ occurrenceId: `study@${D0}`, start: t(D0, '05:35') }],
    });
    const plan = schedule(scheduled);
    expect(slot(plan, `walk@${D0}`)).toBe('06:20-06:50');
    expectNoOverlaps(plan, scheduled);
  });

  it('that overlap each other are both reported', () => {
    const plan = schedule(
      input({
        intentions: [daily('a', '30m', { after: '08:00', before: '12:00' }), daily('b', '30m', { after: '08:00', before: '12:00' })],
        pins: [
          { occurrenceId: `a@${D0}`, start: t(D0, '08:00') },
          { occurrenceId: `b@${D0}`, start: t(D0, '08:15') },
        ],
      }),
    );
    expect(plan.conflicts.map((c) => [c.occurrenceId, c.with])).toEqual([
      [`a@${D0}`, [`task:b@${D0}`]],
      [`b@${D0}`, [`task:a@${D0}`]],
    ]);
  });

  it('for an unknown intention produce a warning', () => {
    const plan = schedule(input({ pins: [{ occurrenceId: `nope@${D0}`, start: t(D0, '08:00') }] }));
    expect(plan.warnings).toEqual([expect.objectContaining({ code: 'unknown_occurrence', occurrenceId: `nope@${D0}` })]);
  });
});
