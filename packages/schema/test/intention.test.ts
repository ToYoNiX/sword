import { describe, expect, it } from 'vitest';
import { schedule } from '@sword/engine';
import type { IntentionInput } from '@sword/engine';
import { readIntention, readIntentionFile } from '../src/index.ts';

/** Reads a task from properties, failing the test with the errors if it doesn't read. */
function read(data: Record<string, unknown>): IntentionInput {
  const result = readIntention({ id: 'x', duration: '30m', ...data });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.value;
}

function errorsOf(data: Record<string, unknown>): string {
  const result = readIntention({ id: 'x', ...data });
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.errors.join('\n');
}

/** Schedules intentions for sixty days from Sunday Oct 25, 2026, to prove the engine accepts them. */
function plan(intention: IntentionInput) {
  return schedule({ timeZone: 'UTC', now: '2026-10-25T00:00:00Z', horizonDays: 60, intentions: [intention] });
}

// Exactly as Obsidian writes properties: block lists, unquoted dates and
// times, a Date & time deadline, and Obsidian's own properties alongside.
const obsidianNote = `---
title: Study Go
duration: 45m
repeat: weekly
repeat_on:
  - mon
  - thu
repeat_every: 2
repeat_since: 2026-10-26
after: prayer.fajr
before: work.start or 08:00
deadline: 2026-12-31T17:00:00
avoid:
  - tag:focus
prefer: packed
priority: 2
pins:
  - 2026-10-26 07:30
  - 2026-11-09T06:45
planned:
  - 2026-10-29 05:20
  - 2026-11-02 05:21:30
tags:
  - learning
aliases:
  - Go study
cssclasses:
  - wide
done: false
---

Working through chapter 7.
`;

describe('readIntentionFile', () => {
  it('reads a note written the way Obsidian writes properties, quietly', () => {
    const result = readIntentionFile(obsidianNote, { id: 'Study Go' });
    expect(result).toEqual({
      ok: true,
      warnings: [],
      value: {
        intention: {
          id: 'Study Go',
          title: 'Study Go',
          duration: '45m',
          repeat: { every: '2 weeks', on: ['mon', 'thu'], since: '2026-10-26' },
          window: { after: 'prayer.fajr', before: 'work.start or 08:00' },
          deadline: '2026-12-31T17:00:00',
          avoid: ['tag:focus'],
          prefer: 'packed',
          priority: 2,
          tags: ['learning'],
        },
        notes: 'Working through chapter 7.\n',
        pins: ['2026-10-26T07:30', '2026-11-09T06:45'],
        planned: ['2026-10-29T05:20', '2026-11-02T05:21:30'],
      },
    });
  });

  it('uses the file name as the id, so note names work in any language', () => {
    for (const name of ['Study Go', 'قراءة الكهف', 'buy-milk']) {
      const result = readIntentionFile('---\nduration: 15m\n---\n', { id: name });
      expect(result.ok && result.value.intention.id).toBe(name);
    }
  });

  it('lets an id property override the file name', () => {
    const result = readIntentionFile('---\nid: other\nduration: 30m\n---\n', { id: 'file-name' });
    expect(result.ok && result.value.intention.id).toBe('other');
  });

  it('handles Windows line endings', () => {
    const result = readIntentionFile('---\r\nduration: 30m\r\n---\r\nnotes\r\n', { id: 'x' });
    expect(result.ok && result.value.intention).toEqual({ id: 'x', duration: '30m' });
  });

  it('accepts a file with frontmatter and no notes', () => {
    expect(readIntentionFile('---\nduration: 30m\n---', { id: 'x' })).toMatchObject({ ok: true, value: { notes: '', pins: [], planned: [] } });
  });

  it('reads YAML 1.2 values as written: 09:00 and 2026-10-26 stay text', () => {
    const result = readIntentionFile('---\nduration: 30m\nat: 09:00\ndate: 2026-10-26\n---\n', { id: 'x' });
    expect(result.ok && result.value.intention).toMatchObject({ at: '09:00', date: '2026-10-26' });
  });

  it.each([
    ['no frontmatter', 'just some notes'],
    ['an unclosed frontmatter', '---\nduration: 30m\n'],
    ['invalid YAML', '---\nduration: [30m\n---\n'],
    ['frontmatter that is a list', '---\n- 30m\n---\n'],
    ['empty frontmatter', '---\n---\n'],
  ])('rejects %s', (_, text) => {
    expect(readIntentionFile(text, { id: 'x' }).ok).toBe(false);
  });
});

describe('repeat properties', () => {
  it.each<[string, Record<string, unknown>, IntentionInput['repeat']]>([
    ['daily', { repeat: 'daily' }, 'daily'],
    ['every 2 days', { repeat: 'daily', repeat_every: 2, repeat_since: '2026-10-25' }, { every: '2 days', since: '2026-10-25' }],
    ['daily from a date', { repeat: 'daily', repeat_since: '2026-10-27' }, { every: '1 day', since: '2026-10-27' }],
    ['weekly on some days', { repeat: 'weekly', repeat_on: ['mon', 'thu'] }, { every: '1 week', on: ['mon', 'thu'] }],
    ['weekly on one day, written as text', { repeat: 'weekly', repeat_on: 'fri' }, { every: '1 week', on: ['fri'] }],
    ['weekly on the day of repeat_since', { repeat: 'weekly', repeat_since: '2026-10-27' }, { every: '1 week', since: '2026-10-27' }],
    [
      'every 2 weeks',
      { repeat: 'weekly', repeat_every: 2, repeat_on: ['mon'], repeat_since: '2026-10-26' },
      { every: '2 weeks', on: ['mon'], since: '2026-10-26' },
    ],
    ['monthly on a day', { repeat: 'monthly', repeat_day: 31 }, { every: '1 month', onDay: 31 }],
    [
      'every 3 months',
      { repeat: 'monthly', repeat_every: 3, repeat_day: 15, repeat_since: '2026-09-15' },
      { every: '3 months', onDay: 15, since: '2026-09-15' },
    ],
  ])('%s', (_, properties, expected) => {
    const intention = read({ ...properties, after: '08:00', before: '10:00' });
    expect(intention.repeat).toEqual(expected);
    // The engine takes the result as it is, and schedules it.
    const result = plan(intention);
    expect(result.errors).toEqual([]);
    expect(result.placements.length).toBeGreaterThan(0);
  });
});

describe('other properties', () => {
  it('puts after, before and within together as the window', () => {
    expect(read({ after: 'prayer.asr', before: 'prayer.maghrib', within: 'evening' }).window).toEqual({
      after: 'prayer.asr',
      before: 'prayer.maghrib',
      within: 'evening',
    });
    expect(read({ after: '08:00' }).window).toEqual({ after: '08:00' });
    expect(read({})).not.toHaveProperty('window');
  });

  it('accepts a single value for a list property', () => {
    expect(read({ tags: 'learning', avoid: 'tag:focus' })).toMatchObject({ tags: ['learning'], avoid: ['tag:focus'] });
  });

  it.each(['2026-10-24', '2026-10-24T17:00', '2026-10-24T17:00:00', '2026-10-24T14:00:00Z', '2026-10-24T17:00:00+03:00'])(
    'accepts the deadline %s',
    (deadline) => {
      expect(read({ deadline }).deadline).toBe(deadline);
    },
  );

  it('reads pins and planned times written with a space or a T, or as a single value', () => {
    const result = readIntentionFile('---\nduration: 30m\nrepeat: daily\npins: 2026-10-26T07:30\nplanned: 2026-10-27 7:05\n---\n', { id: 'x' });
    expect(result.ok && result.value).toMatchObject({ pins: ['2026-10-26T07:30'], planned: ['2026-10-27T07:05'] });
  });

  it('keeps seconds in planned times, and allows two times on one date', () => {
    // A task that starts after midnight belongs to the day before when the day starts later.
    const result = readIntentionFile('---\nduration: 30m\nrepeat: daily\nplanned:\n  - 2026-10-26 01:00\n  - 2026-10-26 23:10:05\n---\n', { id: 'x' });
    expect(result.ok && result.value.planned).toEqual(['2026-10-26T01:00', '2026-10-26T23:10:05']);
  });

  it('reports every problem at once', () => {
    const errors = errorsOf({ duration: 45, priority: 'high', repeat: 'hourly' });
    expect(errors).toContain('duration');
    expect(errors).toContain('priority');
    expect(errors).toContain('repeat');
  });
});

describe('invalid properties are rejected, naming the property', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['a missing duration', { duration: undefined }, 'duration: missing'],
    ['an empty duration', { duration: null }, 'duration: missing'],
    ['a duration that is a number', { duration: 45 }, 'duration'],
    ['an unknown repeat', { repeat: 'hourly' }, 'repeat: use daily, weekly or monthly'],
    ['the old nested repeat', { repeat: { every: '2 days' } }, 'repeat_every'],
    ['repeat_on without repeat', { repeat_on: ['mon'] }, 'repeat_on'],
    ['repeat_every without repeat', { repeat_every: 2 }, 'repeat_every'],
    ['repeat_since without repeat', { repeat_since: '2026-10-25' }, 'repeat_since'],
    ['repeat_on with a daily repeat', { repeat: 'daily', repeat_on: ['mon'] }, 'repeat_on'],
    ['repeat_on with a monthly repeat', { repeat: 'monthly', repeat_day: 1, repeat_on: ['mon'] }, 'repeat_on'],
    ['repeat_day with a weekly repeat', { repeat: 'weekly', repeat_on: ['mon'], repeat_day: 1 }, 'repeat_day'],
    ['repeat_day 32', { repeat: 'monthly', repeat_day: 32 }, 'repeat_day'],
    ['repeat_day 0', { repeat: 'monthly', repeat_day: 0 }, 'repeat_day'],
    ['a fractional repeat_day', { repeat: 'monthly', repeat_day: 1.5 }, 'repeat_day'],
    ['repeat_every 0', { repeat: 'daily', repeat_every: 0 }, 'repeat_every'],
    ['a negative repeat_every', { repeat: 'daily', repeat_every: -1 }, 'repeat_every'],
    ['a fractional repeat_every', { repeat: 'daily', repeat_every: 1.5 }, 'repeat_every'],
    ['repeat_every written as a word', { repeat: 'daily', repeat_every: 'two' }, 'repeat_every'],
    ['repeat_every above 1 without repeat_since', { repeat: 'daily', repeat_every: 2 }, 'repeat_since'],
    ['a repeat_since that is not a date', { repeat: 'daily', repeat_since: '21-10-2026' }, 'repeat_since'],
    ['an unknown weekday', { repeat: 'weekly', repeat_on: ['monday'] }, 'repeat_on'],
    ['a weekly repeat with no days and no repeat_since', { repeat: 'weekly' }, 'repeat_on'],
    ['a monthly repeat with no day and no repeat_since', { repeat: 'monthly' }, 'repeat_day'],
    ['a date that is not a date', { date: 'tomorrow' }, 'date'],
    ['a deadline that is not a date', { deadline: 'next week' }, 'deadline'],
    ['an after that is a number', { after: 5 }, 'after'],
    ['avoid that is a number', { avoid: 5 }, 'avoid'],
    ['avoid with a number in it', { avoid: [5] }, 'avoid'],
    ['a priority that is text', { priority: 'high' }, 'priority'],
    ['a fractional priority', { priority: 1.5 }, 'priority'],
    ['an unknown prefer', { prefer: 'soon' }, 'prefer'],
    ['a title that is a number', { title: 5 }, 'title'],
    ['tags that are a number', { tags: 5 }, 'tags'],
    ['a pin with a bad date', { pins: ['tomorrow 07:30'] }, 'pins'],
    ['a pin with a bad time', { pins: ['2026-10-26 7.30'] }, 'pins'],
    ['a pin on a date that does not exist', { pins: ['2026-02-30 07:30'] }, 'pins: "2026-02-30 07:30" is not a real date and time'],
    ['a pin at an hour that does not exist', { pins: ['2026-10-26 25:00'] }, 'pins: "2026-10-26 25:00" is not a real date and time'],
    ['a pin with only a date', { pins: ['2026-10-26'] }, 'pins'],
    ['a pin that is a number', { pins: [20261026] }, 'pins'],
    ['the old pins mapping', { pins: { '2026-10-26': '07:30' } }, 'pins: use a list'],
    ['a planned time with a bad date', { planned: ['monday 05:20'] }, 'planned'],
    ['a planned time with only a time', { planned: ['05:20'] }, 'planned'],
    ['a planned time with a time zone', { planned: ['2026-10-26T05:20Z'] }, 'planned'],
    ['a planned time on a date that does not exist', { planned: ['2026-13-01 05:20'] }, 'planned: "2026-13-01 05:20" is not a real date and time'],
    ['a planned time at a minute that does not exist', { planned: ['2026-10-26 05:60'] }, 'planned'],
    ['a planned mapping', { planned: { '2026-10-26': '05:20' } }, 'planned: use a list'],
    ['the old window mapping', { window: { after: '08:00' } }, 'after, before and within'],
  ])('%s', (_, data, expected) => {
    expect(errorsOf({ duration: '30m', ...data })).toContain(expected);
  });
});

describe('unknown properties', () => {
  it('are ignored, so other plugins and your own properties can live in the same note', () => {
    const result = readIntention({ id: 'x', duration: '30m', aliases: ['y'], cssclasses: [], done: true, status: 'idea', author: 'me', related: '[[Other]]' });
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it.each([
    ['befor', 'before'],
    ['duraton', 'duration'],
    ['repeat-on', 'repeat_on'],
    ['repeatOn', 'repeat_on'],
    ['repeat_evry', 'repeat_every'],
    ['tag', 'tags'],
    ['Deadline', 'deadline'],
    ['plannd', 'planned'],
    ['pin', 'pins'],
  ])('get a hint when they look like a typo: %s', (typo, meant) => {
    const result = readIntention({ id: 'x', duration: '30m', [typo]: 'value' });
    expect(result).toMatchObject({ ok: true, warnings: [`unknown property "${typo}"; did you mean "${meant}"?`] });
  });
});
