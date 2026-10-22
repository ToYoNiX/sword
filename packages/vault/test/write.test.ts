import { describe, expect, it } from 'vitest';
import { readIntentionFile } from '@sword/schema';
import { setTimes } from '../src/index.ts';

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
