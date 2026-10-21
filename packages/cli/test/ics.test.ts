import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import type { Placement } from '@sword/engine';
import { toIcs } from '../src/ics.ts';

const placement = (over: Partial<Placement>): Placement => ({
  occurrenceId: 'study-go@2026-10-25',
  intentionId: 'study-go',
  date: '2026-10-25',
  start: '2026-10-25T05:15:00Z',
  end: '2026-10-25T06:00:00Z',
  kind: 'fitted',
  state: 'scheduled',
  why: 'earliest free slot between 00:00 and 09:00',
  ...over,
});

const ics = (placements: Placement[], titles: Record<string, string> = { 'study-go': 'Study Go' }) =>
  toIcs(placements, { titles: new Map(Object.entries(titles)), stamp: '2026-10-21T16:49:00Z' });

/** Parses with ical.js, an independent implementation, so the output is checked by more than our own reading. */
function events(text: string) {
  const calendar = new ICAL.Component(ICAL.parse(text));
  return calendar.getAllSubcomponents('vevent').map((v) => {
    const event = new ICAL.Event(v);
    return {
      uid: event.uid,
      summary: event.summary,
      start: event.startDate.toJSDate().toISOString(),
      end: event.endDate.toJSDate().toISOString(),
      occurrence: v.getFirstPropertyValue('x-sword-occurrence'),
    };
  });
}

describe('toIcs', () => {
  it('writes a calendar that a standard parser reads back', () => {
    expect(events(ics([placement({})]))).toEqual([
      {
        uid: 'sword-study-go@2026-10-25',
        summary: 'Study Go',
        start: '2026-10-25T05:15:00.000Z',
        end: '2026-10-25T06:00:00.000Z',
        occurrence: 'study-go@2026-10-25',
      },
    ]);
  });

  it('uses CRLF line endings, as iCalendar requires', () => {
    const text = ics([placement({})]);
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('folds long lines at 75 bytes without splitting a character', () => {
    const title = 'قراءة سورة الكهف بعد صلاة الجمعة، ثم مراجعة الحفظ والتفسير مع العائلة في البيت';
    const text = ics([placement({})], { 'study-go': title });
    const bytes = (line: string) => new TextEncoder().encode(line).length;
    for (const line of text.split('\r\n')) expect(bytes(line)).toBeLessThanOrEqual(75);
    expect(events(text)[0]?.summary).toBe(title);
  });

  it('escapes commas, semicolons, backslashes and newlines in text', () => {
    const title = 'Groceries; milk, eggs \\ bread\nand tea';
    const text = ics([placement({})], { 'study-go': title });
    // ical.js is lenient, so also check the raw text against RFC 5545.
    expect(text).toContain('SUMMARY:Groceries\\; milk\\, eggs \\\\ bread\\nand tea\r\n');
    expect(events(text)[0]?.summary).toBe(title);
  });

  it('keeps the same UID for an occurrence, so a calendar updates it instead of duplicating it', () => {
    const before = events(ics([placement({})]))[0]?.uid;
    const moved = events(ics([placement({ start: '2026-10-25T07:00:00Z', end: '2026-10-25T07:45:00Z' })]))[0]?.uid;
    expect(moved).toBe(before);
  });

  it('exports planned, pinned and done occurrences, but not missed ones', () => {
    const text = ics([
      placement({ occurrenceId: 'a', state: 'scheduled' }),
      placement({ occurrenceId: 'b', state: 'pinned', kind: 'pinned' }),
      placement({ occurrenceId: 'c', state: 'done' }),
      placement({ occurrenceId: 'd', state: 'missed' }),
    ]);
    expect(events(text).map((e) => e.occurrence)).toEqual(['a', 'b', 'c']);
  });

  it('writes an empty calendar when there is nothing to export', () => {
    expect(events(ics([]))).toEqual([]);
  });
});
