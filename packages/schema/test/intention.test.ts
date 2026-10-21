import { describe, expect, it } from 'vitest';
import { schedule } from '@sword/engine';
import { readIntention, readIntentionFile } from '../src/index.ts';

const studyFile = `---
title: Study Go
duration: 45m
repeat:
  every: 2 weeks
  on: [mon, thu]
  since: 2026-10-26
window:
  after: prayer.fajr
  before: work.start or 12:00
avoid: [tag:focus]
prefer: packed
priority: 2
tags: [learning]
---

Working through chapter 7.
`;

describe('readIntentionFile', () => {
  it('reads the frontmatter into engine input and keeps the notes', () => {
    const result = readIntentionFile(studyFile, { id: 'study-go' });
    expect(result).toEqual({
      ok: true,
      warnings: [],
      value: {
        intention: {
          id: 'study-go',
          title: 'Study Go',
          duration: '45m',
          repeat: { every: '2 weeks', on: ['mon', 'thu'], since: '2026-10-26' },
          window: { after: 'prayer.fajr', before: 'work.start or 12:00' },
          avoid: ['tag:focus'],
          prefer: 'packed',
          priority: 2,
          tags: ['learning'],
        },
        notes: 'Working through chapter 7.\n',
        pins: {},
      },
    });
  });

  it('reads pins: occurrence dates moved to a time by hand', () => {
    const result = readIntentionFile('---\nduration: 45m\nrepeat: daily\npins:\n  2026-10-26: "07:30"\n  2026-10-27: 06:45\n---\n', { id: 'study' });
    expect(result).toMatchObject({ ok: true, value: { pins: { '2026-10-26': '07:30', '2026-10-27': '06:45' } } });
    expect(result.ok && result.value.intention).not.toHaveProperty('pins');
  });

  it.each([
    ['a pin with a bad date', 'pins:\n  tomorrow: "07:30"'],
    ['a pin with a bad time', 'pins:\n  2026-10-26: "7.30"'],
    ['pins that are a list', 'pins: ["07:30"]'],
  ])('rejects %s', (_, yaml) => {
    const result = readIntentionFile(`---\nduration: 45m\n${yaml}\n---\n`, { id: 'x' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toContain('pins');
  });

  it('uses the id in the frontmatter over the file name', () => {
    const result = readIntentionFile('---\nid: other\nduration: 30m\n---\n', { id: 'file-name' });
    expect(result.ok && result.value.intention.id).toBe('other');
  });

  it('handles Windows line endings', () => {
    const result = readIntentionFile('---\r\nduration: 30m\r\n---\r\nnotes\r\n', { id: 'x' });
    expect(result.ok && result.value.intention).toEqual({ id: 'x', duration: '30m' });
  });

  it('accepts a file with frontmatter and no notes', () => {
    const result = readIntentionFile('---\nduration: 30m\n---', { id: 'x' });
    expect(result).toMatchObject({ ok: true, value: { notes: '' } });
  });

  it.each([
    ['no frontmatter', 'just some notes'],
    ['an unclosed frontmatter', '---\nduration: 30m\n'],
    ['invalid YAML', '---\nduration: [30m\n---\n'],
    ['frontmatter that is a list', '---\n- 30m\n---\n'],
    ['empty frontmatter', '---\n---\n'],
  ])('rejects %s', (_, text) => {
    const result = readIntentionFile(text, { id: 'x' });
    expect(result.ok).toBe(false);
  });
});

describe('readIntention', () => {
  it('reads YAML 1.2 values as written, not as YAML 1.1 surprises', () => {
    // In YAML 1.1, 09:00 is the number 540, 2026-10-26 a timestamp and `on` a boolean.
    const result = readIntentionFile(
      '---\nduration: 30m\nat: 09:00\ndate: 2026-10-26\n---\n',
      { id: 'x' },
    );
    expect(result.ok && result.value.intention).toMatchObject({ at: '09:00', date: '2026-10-26' });
    const weekly = readIntentionFile('---\nduration: 30m\nrepeat:\n  on: [mon]\n---\n', { id: 'x' });
    expect(weekly.ok && weekly.value.intention.repeat).toEqual({ on: ['mon'] });
  });

  it('maps snake_case fields to the engine names', () => {
    const result = readIntention({ id: 'x', duration: '30m', repeat: { every: 'month', on_day: 31 } });
    expect(result.ok && result.value.repeat).toEqual({ every: 'month', onDay: 31 });
  });

  it('accepts "daily"', () => {
    const result = readIntention({ id: 'x', duration: '30m', repeat: 'daily' });
    expect(result.ok && result.value.repeat).toBe('daily');
  });

  it('knows the pins field', () => {
    expect(readIntention({ id: 'x', duration: '30m', pins: { '2026-10-26': '07:30' } })).toMatchObject({ ok: true, warnings: [] });
  });

  it('warns about unknown fields but keeps going, so other tools can share the file', () => {
    const result = readIntention({ id: 'x', duration: '30m', aliases: ['y'], cssclasses: [] });
    expect(result).toMatchObject({ ok: true, warnings: ['unknown field "aliases"', 'unknown field "cssclasses"'] });
  });

  it.each([
    ['a missing duration', { id: 'x' }, 'duration'],
    ['a numeric duration', { id: 'x', duration: 45 }, 'duration'],
    ['a non-string window bound', { id: 'x', duration: '30m', window: { after: 5 } }, 'window.after'],
    ['a typo inside window', { id: 'x', duration: '30m', window: { afer: '08:00' } }, 'afer'],
    ['a typo inside repeat', { id: 'x', duration: '30m', repeat: { evry: 'day' } }, 'evry'],
    ['avoid that is not a list', { id: 'x', duration: '30m', avoid: 'tag:focus' }, 'avoid'],
    ['a priority that is text', { id: 'x', duration: '30m', priority: 'high' }, 'priority'],
    ['a missing id', { duration: '30m' }, 'id'],
  ])('rejects %s and names the field', (_, data, field) => {
    const result = readIntention(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toContain(field);
  });

  it('leaves meaning to the engine: the output schedules as written', () => {
    const result = readIntentionFile(
      '---\nduration: 30m\nrepeat: daily\nwindow:\n  within: afternoon\n---\n',
      { id: 'nap' },
    );
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const plan = schedule({
      timeZone: 'Asia/Riyadh',
      now: '2026-10-24T21:00:00Z',
      horizonDays: 1,
      intentions: [result.value.intention],
    });
    expect(plan.placements).toEqual([expect.objectContaining({ occurrenceId: 'nap@2026-10-25', start: '2026-10-25T09:00:00Z' })]);
  });
});
