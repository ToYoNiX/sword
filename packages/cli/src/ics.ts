/**
 * Writes placements as iCalendar (RFC 5545), for calendars like Radicale or
 * a phone's calendar app. One VEVENT per occurrence, with a UID that stays
 * the same when the occurrence moves, so subscribers update instead of
 * duplicating it. This moves into the ical plugin once plugins exist.
 */
import type { Placement } from '@sword/engine';

export interface IcsOptions {
  /** Task titles by intention id. */
  titles: ReadonlyMap<string, string>;
  /** When the file is written (DTSTAMP). */
  stamp: string;
}

const EXPORTED = new Set(['scheduled', 'pinned', 'done']);

export function toIcs(placements: readonly Placement[], options: IcsOptions): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sword//Sword//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Sword'];
  for (const p of placements) {
    if (!EXPORTED.has(p.state)) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${text(`sword-${p.occurrenceId}`)}`,
      `DTSTAMP:${utc(options.stamp)}`,
      `DTSTART:${utc(p.start)}`,
      `DTEND:${utc(p.end)}`,
      `SUMMARY:${text(options.titles.get(p.intentionId) ?? p.intentionId)}`,
      `DESCRIPTION:${text(p.state === 'done' ? 'Done.' : p.why)}`,
      `X-SWORD-OCCURRENCE:${text(p.occurrenceId)}`,
      `X-SWORD-KIND:${p.kind}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** 2026-10-25T05:15:00Z → 20261025T051500Z */
function utc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines may be at most 75 bytes; longer ones continue on lines starting with a space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
