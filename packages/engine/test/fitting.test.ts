import { describe, expect, it } from 'vitest';
import { schedule } from '../src/index.ts';
import {
  D0,
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

const window8to10 = { after: '08:00', before: '10:00' };

describe('fitting into a window', () => {
  it('places a task at the earliest free time in its window', () => {
    const plan = schedule(input({ intentions: [daily('read', '30m', window8to10)] }));
    expect(slot(plan, `read@${D0}`)).toBe('08:00-08:30');
    expect(placement(plan, `read@${D0}`)).toMatchObject({ kind: 'fitted', state: 'scheduled', intentionId: 'read', date: D0 });
  });

  it('places at the latest free time when preferred', () => {
    const plan = schedule(input({ intentions: [daily('read', '30m', window8to10, { prefer: 'latest' })] }));
    expect(slot(plan, `read@${D0}`)).toBe('09:30-10:00');
  });

  it('skips busy events', () => {
    const scheduled = input({
      events: [{ id: 'standup', start: t(D0, '08:00'), end: t(D0, '08:45') }],
      intentions: [daily('read', '30m', window8to10)],
    });
    const plan = schedule(scheduled);
    expect(slot(plan, `read@${D0}`)).toBe('08:45-09:15');
    expectNoOverlaps(plan, scheduled);
  });

  it('never overlaps prayer time, even without an avoid rule', () => {
    const scheduled = input({
      anchors: prayers(D0),
      intentions: [daily('task', '30m', { after: '11:30', before: '13:00' })],
    });
    const plan = schedule(scheduled);
    expect(slot(plan, `task@${D0}`)).toBe('12:10-12:40');
    expectNoOverlaps(plan, scheduled);
  });

  it('reads "after an anchor" as after its busy portion, and "before" as before it', () => {
    const plan = schedule(
      input({
        anchors: prayers(D0),
        intentions: [
          daily('x', '30m', { after: 'prayer.asr' }),
          daily('y', '30m', { after: 'prayer.asr', before: 'prayer.maghrib' }, { prefer: 'latest' }),
        ],
      }),
    );
    expect(slot(plan, `x@${D0}`)).toBe('15:30-16:00');
    expect(slot(plan, `y@${D0}`)).toBe('17:05-17:35');
  });

  it('uses the busy portion, not the window start, when they differ (e.g. iqama after the adhan)', () => {
    const asr = anchor('prayer.asr', D0, '15:10', '17:35', { busy: [['15:25', '15:45']], tags: ['prayer'] });
    const plan = schedule(
      input({
        anchors: [asr],
        intentions: [
          daily('after', '15m', { after: 'prayer.asr' }),
          daily('before', '15m', { after: '14:00', before: 'prayer.asr' }, { prefer: 'latest' }),
          { id: 'formula', duration: '10m', repeat: 'daily', at: 'prayer.asr' },
        ],
      }),
    );
    expect(slot(plan, `formula@${D0}`)).toBe('15:45-15:55');
    expect(slot(plan, `after@${D0}`)).toBe('15:55-16:10');
    expect(slot(plan, `before@${D0}`)).toBe('15:10-15:25');
  });

  it('with several busy portions, reads "before" as before the first and "after" as after the last', () => {
    const jumuah = anchor('jumuah', D0, '11:30', '13:00', { busy: [['11:30', '11:50'], ['12:10', '12:30']] });
    const plan = schedule(
      input({
        anchors: [jumuah],
        intentions: [
          daily('before', '15m', { after: '11:00', before: 'jumuah' }, { prefer: 'latest' }),
          daily('after', '15m', { after: 'jumuah', before: '13:00' }),
        ],
      }),
    );
    expect(slot(plan, `before@${D0}`)).toBe('11:15-11:30');
    expect(slot(plan, `after@${D0}`)).toBe('12:30-12:45');
  });

  it('supports explicit window edges', () => {
    const plan = schedule(
      input({
        anchors: prayers(D0),
        intentions: [daily('z', '30m', { after: 'prayer.dhuhr', before: 'prayer.dhuhr.end' }, { prefer: 'latest' })],
      }),
    );
    // Dhuhr's window ends when Asr starts (15:10).
    expect(slot(plan, `z@${D0}`)).toBe('14:40-15:10');
  });

  it('reads "after" a window without a busy portion as after the window ends', () => {
    const plan = schedule(
      input({
        anchors: [anchor('work', D0, '09:00', '17:00')],
        intentions: [
          daily('gym', '1h', { after: 'work' }),
          daily('prep', '15m', { before: 'work' }, { prefer: 'latest' }),
        ],
      }),
    );
    expect(slot(plan, `gym@${D0}`)).toBe('17:00-18:00');
    expect(slot(plan, `prep@${D0}`)).toBe('08:45-09:00');
  });

  it('falls back to the next "within" anchor when the first is missing', () => {
    const plan = schedule(
      input({
        horizonDays: 2,
        anchors: [anchor('gym_hours', D0, '18:00', '21:00')],
        intentions: [daily('gym', '1h', { within: 'gym_hours or evening' })],
      }),
    );
    expect(slot(plan, `gym@${D0}`)).toBe('18:00-19:00');
    expect(slot(plan, `gym@${day(1)}`)).toBe('17:00-18:00');
  });

  it('keeps a task inside an anchor window with "within"', () => {
    const plan = schedule(
      input({
        anchors: [anchor('gym_hours', D0, '18:00', '21:00')],
        intentions: [daily('gym', '1h', { within: 'gym_hours' }, { prefer: 'latest' })],
      }),
    );
    expect(slot(plan, `gym@${D0}`)).toBe('20:00-21:00');
  });

  it('only creates occurrences on the listed days', () => {
    const plan = schedule(
      input({ horizonDays: 7, intentions: [daily('swim', '30m', window8to10, { repeat: { on: ['mon', 'wed'] } })] }),
    );
    expect(plan.placements.map((p) => p.occurrenceId)).toEqual(['swim@2026-10-26', 'swim@2026-10-28']);
  });
});

describe('task ids', () => {
  it('can be note names: spaces and any language', () => {
    const plan = schedule(
      input({ intentions: [daily('Study Go', '30m', window8to10), daily('قراءة الكهف', '30m', window8to10)] }),
    );
    expect(plan.errors).toEqual([]);
    expect(plan.placements.map((p) => p.occurrenceId).sort()).toEqual([`Study Go@${D0}`, `قراءة الكهف@${D0}`].sort());
  });
});

describe('competing tasks', () => {
  it('never puts two tasks on top of each other', () => {
    const scheduled = input({
      intentions: [daily('c', '1h', { after: '08:00', before: '11:00' }), daily('a', '1h', { after: '08:00', before: '11:00' }), daily('b', '1h', { after: '08:00', before: '11:00' })],
    });
    const plan = schedule(scheduled);
    expect([slot(plan, `a@${D0}`), slot(plan, `b@${D0}`), slot(plan, `c@${D0}`)]).toEqual([
      '08:00-09:00',
      '09:00-10:00',
      '10:00-11:00',
    ]);
    expectNoOverlaps(plan, scheduled);
  });

  it('gives the earlier slot to the higher priority', () => {
    const plan = schedule(
      input({ intentions: [daily('a', '1h', window8to10), daily('b', '1h', window8to10, { priority: 5 })] }),
    );
    expect(slot(plan, `b@${D0}`)).toBe('08:00-09:00');
    expect(slot(plan, `a@${D0}`)).toBe('09:00-10:00');
  });

  it('places the longer task first when priorities are equal', () => {
    const plan = schedule(
      input({
        intentions: [
          daily('gym', '30m', { after: '08:00', before: '09:00' }),
          { id: 'call', duration: '1h', window: { after: '08:00', before: '09:00' }, deadline: D0 },
        ],
      }),
    );
    expect(slot(plan, 'call')).toBe('08:00-09:00');
    expect(unplacedOf(plan, `gym@${D0}`).code).toBe('no_slot');
  });
});

describe('when a task cannot fit', () => {
  it('leaves it unplaced and names what is in the way', () => {
    const scheduled = input({
      events: [{ id: 'meeting', title: 'Team meeting', start: t(D0, '08:15'), end: t(D0, '09:45') }],
      intentions: [daily('read', '30m', window8to10)],
    });
    const plan = schedule(scheduled);
    const miss = unplacedOf(plan, `read@${D0}`);
    expect(miss.code).toBe('no_slot');
    expect(miss.blockers).toEqual(['event:meeting']);
    expect(miss.message).toContain('Team meeting');
    expect(hasPlacement(plan, `read@${D0}`)).toBe(false);
  });

  it('does not squeeze a task into a window shorter than its duration', () => {
    const plan = schedule(input({ intentions: [daily('read', '30m', { after: '09:00', before: '09:20' })] }));
    expect(unplacedOf(plan, `read@${D0}`).code).toBe('no_slot');
    expect(plan.placements).toEqual([]);
  });

  it('treats an inverted window as empty instead of wrapping it', () => {
    const plan = schedule(input({ intentions: [daily('read', '30m', { after: '10:00', before: '09:00' })] }));
    expect(unplacedOf(plan, `read@${D0}`).code).toBe('window_empty');
    expect(plan.placements).toEqual([]);
  });
});

describe('packing', () => {
  // Free time 08:00–12:00 with a meeting 10:00–11:15: gaps of 2h and 45m.
  const meeting = { id: 'meeting', start: t(D0, '10:00'), end: t(D0, '11:15') };
  const window = { after: '08:00', before: '12:00' };

  it('earliest-first fragments the free time', () => {
    const plan = schedule(
      input({
        events: [meeting],
        intentions: [
          { id: 'short', duration: '30m', date: D0, window, priority: 1 },
          { id: 'long', duration: '2h', date: D0, window },
        ],
      }),
    );
    expect(slot(plan, 'short')).toBe('08:00-08:30');
    expect(unplacedOf(plan, 'long').code).toBe('no_slot');
  });

  it('"packed" uses the smallest gap that fits, leaving room for the long task', () => {
    const scheduled = input({
      events: [meeting],
      intentions: [
        { id: 'short', duration: '30m', date: D0, window, priority: 1, prefer: 'packed' },
        { id: 'long', duration: '2h', date: D0, window, prefer: 'packed' },
      ],
    });
    const plan = schedule(scheduled);
    expect(slot(plan, 'short')).toBe('11:15-11:45');
    expect(slot(plan, 'long')).toBe('08:00-10:00');
    expectNoOverlaps(plan, scheduled);
  });

  it('"packed" compares gaps across days for a one-off task', () => {
    const plan = schedule(
      input({
        horizonDays: 2,
        events: [
          { id: 'busy0', start: t(D0, '10:00'), end: t(D0, '12:00') },
          { id: 'busy1', start: t(day(1), '08:45'), end: t(day(1), '12:00') },
        ],
        intentions: [{ id: 'task', duration: '30m', window, deadline: day(1), prefer: 'packed' }],
      }),
    );
    expect(placement(plan, 'task')).toMatchObject({ date: day(1), start: t(day(1), '08:00') });
  });
});

describe('avoid rules', () => {
  it('can exclude time that is not busy', () => {
    const plan = schedule(
      input({
        events: [{ id: 'focus', start: t(D0, '08:00'), end: t(D0, '09:00'), busy: false, tags: ['focus'] }],
        intentions: [daily('a', '30m', window8to10), daily('b', '30m', window8to10, { avoid: ['tag:focus'] })],
      }),
    );
    expect(slot(plan, `a@${D0}`)).toBe('08:00-08:30');
    expect(slot(plan, `b@${D0}`)).toBe('09:00-09:30');
  });

  it('avoid a whole anchor window when the anchor has no busy portion', () => {
    const plan = schedule(
      input({
        anchors: [anchor('lunch', D0, '12:00', '13:00')],
        intentions: [
          daily('a', '30m', { after: '11:45', before: '14:00' }),
          daily('b', '30m', { after: '11:45', before: '14:00' }, { avoid: ['anchor:lunch'] }),
        ],
      }),
    );
    expect(slot(plan, `a@${D0}`)).toBe('11:45-12:15');
    expect(slot(plan, `b@${D0}`)).toBe('13:00-13:30');
  });

  it('applies global avoid rules to every task', () => {
    const plan = schedule(
      input({
        avoid: ['tag:focus'],
        events: [{ id: 'focus', start: t(D0, '08:00'), end: t(D0, '09:00'), busy: false, tags: ['focus'] }],
        intentions: [daily('read', '30m', window8to10)],
      }),
    );
    expect(slot(plan, `read@${D0}`)).toBe('09:00-09:30');
  });
});

describe('one-off tasks', () => {
  const window8to9 = { after: '08:00', before: '09:00' };

  it('go on the earliest day with room before the deadline', () => {
    const plan = schedule(
      input({
        horizonDays: 3,
        events: [{ id: 'block', start: t(D0, '08:00'), end: t(D0, '09:00') }],
        intentions: [{ id: 'report', duration: '1h', window: window8to9, deadline: day(2) }],
      }),
    );
    expect(placement(plan, 'report')).toMatchObject({ date: day(1), start: t(day(1), '08:00'), end: t(day(1), '09:00') });
  });

  it('are never placed after their deadline', () => {
    const plan = schedule(
      input({
        horizonDays: 3,
        events: [
          { id: 'block0', start: t(D0, '08:00'), end: t(D0, '09:00') },
          { id: 'block1', start: t(day(1), '08:00'), end: t(day(1), '09:00') },
        ],
        intentions: [{ id: 'report', duration: '1h', window: window8to9, deadline: day(1) }],
      }),
    );
    expect(unplacedOf(plan, 'report')).toMatchObject({ code: 'no_slot', date: null });
    expect(hasPlacement(plan, 'report')).toBe(false);
  });

  it('must end by a deadline in the middle of the day', () => {
    const plan = schedule(
      input({
        events: [{ id: 'standup', start: t(D0, '08:00'), end: t(D0, '08:30') }],
        intentions: [{ id: 'report', duration: '1h', window: { after: '08:00', before: '12:00' }, deadline: t(D0, '09:00') }],
      }),
    );
    expect(unplacedOf(plan, 'report').code).toBe('no_slot');
    expect(hasPlacement(plan, 'report')).toBe(false);
  });

  it('read a deadline without a time zone in the plan\'s time zone', () => {
    const meeting = { id: 'standup', start: t(D0, '08:00'), end: t(D0, '08:30') };
    const task = { id: 'report', duration: '1h', window: { after: '08:00', before: '12:00' } };
    const tight = schedule(input({ events: [meeting], intentions: [{ ...task, deadline: `${D0}T09:00:00` }] }));
    expect(unplacedOf(tight, 'report').code).toBe('no_slot');
    const roomy = schedule(input({ events: [meeting], intentions: [{ ...task, deadline: `${D0}T10:00` }] }));
    expect(slot(roomy, 'report')).toBe('08:30-09:30');
  });

  it('report a deadline that has already passed', () => {
    const plan = schedule(
      input({
        now: t(day(1), '10:00'),
        intentions: [{ id: 'report', duration: '1h', window: window8to9, deadline: D0 }],
      }),
    );
    expect(unplacedOf(plan, 'report').code).toBe('deadline_passed');
  });

  it('can be tied to a specific date', () => {
    const plan = schedule(
      input({ horizonDays: 3, intentions: [{ id: 'dentist_prep', duration: '30m', date: day(1), window: window8to9 }] }),
    );
    expect(placement(plan, 'dentist_prep')).toMatchObject({ date: day(1), start: t(day(1), '08:00') });
  });

  it('stay in the inbox when they have no rules', () => {
    const plan = schedule(input({ intentions: [{ id: 'idea', duration: '30m' }] }));
    expect(plan.inbox).toEqual(['idea']);
    expect(plan.placements).toEqual([]);
    expect(plan.unplaced).toEqual([]);
  });
});
