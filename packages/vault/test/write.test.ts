import { describe, expect, it } from 'vitest';
import { readIntentionFile } from '@sword/schema';
import { setProperties, setTimes, taskFile } from '../src/index.ts';

const note = `---
title: Study Go   # shown in the plan
duration: 45m
repeat: daily
after: "prayer.fajr"
planned:
  - 2026-10-25 05:20
  - 2026-10-26 05:21
tags: [learning, go]
aliases:
  - Go study
---

Notes mention planned:
  - 2026-01-01 00:00
`;

/** The properties of a note other than `planned` and `pins`, as read by the schema. */
function others(source: string) {
  const result = readIntentionFile(source, { id: 'x' });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return { intention: result.value.intention, notes: result.value.notes };
}

describe('setTimes', () => {
  it('replaces only the planned lines, leaving every other byte as it was', () => {
    const updated = setTimes(note, { planned: ['2026-10-26T05:21', '2026-10-27T05:22'] });
    expect(updated).toBe(note.replace('  - 2026-10-25 05:20\n  - 2026-10-26 05:21\n', '  - 2026-10-26 05:21\n  - 2026-10-27 05:22\n'));
  });

  it('adds the property at the end of the frontmatter when the note has none', () => {
    const updated = setTimes('---\nduration: 45m\nrepeat: daily\n---\nBody\n', { planned: ['2026-10-26T05:21'] });
    expect(updated).toBe('---\nduration: 45m\nrepeat: daily\nplanned:\n  - 2026-10-26 05:21\n---\nBody\n');
  });

  it('removes the property when nothing is left in it', () => {
    const updated = setTimes(note, { planned: [] });
    expect(updated).not.toContain('planned:\n  - 2026-10-25');
    expect(updated).toContain('Notes mention planned:\n  - 2026-01-01 00:00');
    expect(others(updated)).toEqual(others(note));
  });

  it('replaces a single value and a flow list', () => {
    expect(setTimes('---\nduration: 45m\nplanned: 2026-10-25 05:20\n---\n', { planned: ['2026-10-26T06:00'] })).toBe(
      '---\nduration: 45m\nplanned:\n  - 2026-10-26 06:00\n---\n',
    );
    expect(setTimes('---\nduration: 45m\nplanned: [2026-10-25 05:20, 2026-10-26 05:20]\ntags: x\n---\n', { planned: ['2026-10-26T06:00'] })).toBe(
      '---\nduration: 45m\nplanned:\n  - 2026-10-26 06:00\ntags: x\n---\n',
    );
  });

  it('follows the note\'s own list indentation', () => {
    const updated = setTimes('---\nduration: 45m\ntags:\n- a\nplanned:\n- 2026-10-25 05:20\n---\n', { planned: ['2026-10-26T06:00'] });
    expect(updated).toBe('---\nduration: 45m\ntags:\n- a\nplanned:\n- 2026-10-26 06:00\n---\n');
  });

  it('keeps Windows line endings', () => {
    const updated = setTimes('---\r\nduration: 45m\r\n---\r\nBody\r\n', { planned: ['2026-10-26T05:21'] });
    expect(updated).toBe('---\r\nduration: 45m\r\nplanned:\r\n  - 2026-10-26 05:21\r\n---\r\nBody\r\n');
  });

  it('quotes a time with seconds, so other YAML readers keep it as text', () => {
    const updated = setTimes('---\nduration: 45m\n---\n', { planned: ['2026-10-26T05:21:30'] });
    expect(updated).toBe('---\nduration: 45m\nplanned:\n  - "2026-10-26 05:21:30"\n---\n');
    const result = readIntentionFile(updated, { id: 'x' });
    expect(result.ok && result.value.planned).toEqual(['2026-10-26T05:21:30']);
  });

  it('leaves a nested property with the same name alone', () => {
    const source = '---\nduration: 45m\nmeta:\n  planned: yes\n---\n';
    expect(setTimes(source, { planned: ['2026-10-26T06:00'] })).toBe('---\nduration: 45m\nmeta:\n  planned: yes\nplanned:\n  - 2026-10-26 06:00\n---\n');
  });

  it('keeps a comment and a blank line that follow the list', () => {
    const source = '---\nduration: 45m\nplanned:\n  - 2026-10-25 05:20\n\n# rules\nafter: 05:00\n---\n';
    expect(setTimes(source, { planned: ['2026-10-26T06:00'] })).toBe('---\nduration: 45m\nplanned:\n  - 2026-10-26 06:00\n\n# rules\nafter: 05:00\n---\n');
  });

  it('changes pins and planned together, and reads back as written', () => {
    const updated = setTimes(note, { pins: ['2026-10-28T07:30'], planned: ['2026-10-27T05:22'] });
    const result = readIntentionFile(updated, { id: 'x' });
    expect(result.ok && result.value).toMatchObject({ pins: ['2026-10-28T07:30'], planned: ['2026-10-27T05:22'] });
    expect(others(updated)).toEqual(others(note));
  });

  it('refuses a note without frontmatter', () => {
    expect(() => setTimes('no frontmatter', { planned: [] })).toThrow('frontmatter');
  });
});

describe('setProperties', () => {
  const source = '---\ntitle: Study Go   # shown in the plan\nduration: 45m\nrepeat: daily\nafter: prayer.fajr\ntags:\n  - learning\n---\n\nNotes.\n';

  it('changes, adds and removes properties, leaving the rest as it was', () => {
    const updated = setProperties(source, { duration: '1h', before: 'prayer.fajr + 1h', priority: 2, after: undefined, tags: ['learning', 'go'] });
    expect(updated).toBe('---\ntitle: Study Go   # shown in the plan\nduration: 1h\nrepeat: daily\ntags:\n  - learning\n  - go\nbefore: prayer.fajr + 1h\npriority: 2\n---\n\nNotes.\n');
  });

  it('quotes what YAML would otherwise read differently', () => {
    const updated = setProperties('---\nduration: 45m\n---\n', { title: 'a: b', id: '12' });
    expect(updated).toBe('---\nduration: 45m\ntitle: "a: b"\nid: "12"\n---\n');
  });

  it('refuses a value with a line break, which a property cannot hold', () => {
    expect(() => setProperties(source, { title: 'two\nlines' })).toThrow('title: a property value cannot have a line break');
  });
});

describe('taskFile', () => {
  it('writes properties as frontmatter, then the notes', () => {
    expect(taskFile({ duration: '30m', repeat: 'weekly', repeat_on: ['tue', 'fri'], at: '17:30', priority: 1 }, 'Standing meeting.')).toBe(
      '---\nduration: 30m\nrepeat: weekly\nrepeat_on:\n  - tue\n  - fri\nat: 17:30\npriority: 1\n---\n\nStanding meeting.\n',
    );
    expect(taskFile({ duration: '1h' })).toBe('---\nduration: 1h\n---\n');
  });
});
