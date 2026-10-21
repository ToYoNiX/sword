import type { AnchorIndex } from './anchors.ts';
import type { LogicalDays } from './day.ts';
import { EngineInputError, ParseError } from './errors.ts';
import { isAnchorId, parseTimeExpr } from './expr.ts';
import type { TimeExpr } from './expr.ts';
import { addDays, wallTime } from './time.ts';
import type { DayPartInput } from './types.ts';

/** Parts of every day that always exist, so rules have something to refer to. */
export const DEFAULT_DAY_PARTS: Readonly<Record<string, DayPartInput>> = {
  morning: { start: '05:00', end: '12:00' },
  afternoon: { start: '12:00', end: '17:00' },
  evening: { start: '17:00', end: '21:00' },
  night: { start: '21:00', end: 'day.end' },
};

export interface DayPart {
  readonly name: string;
  readonly start: TimeExpr;
  readonly end: TimeExpr;
}

/** Merges the defaults with the user's changes and validates them. */
export function readDayParts(overrides: Record<string, DayPartInput | null> | undefined, anchors: AnchorIndex): DayPart[] {
  const merged: Record<string, DayPartInput | null> = { ...DEFAULT_DAY_PARTS, ...overrides };
  const parts: DayPart[] = [];
  for (const [name, part] of Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (part === null) continue;
    if (!isAnchorId(name) || name === 'day') throw new EngineInputError(`invalid day part name "${name}"`);
    if (anchors.ids.has(name)) throw new EngineInputError(`day part "${name}" has the same name as an anchor`);
    parts.push({ name, start: readTime(name, part.start), end: readTime(name, part.end) });
  }
  return parts;
}

function readTime(name: string, text: string): TimeExpr {
  let expr: TimeExpr;
  try {
    expr = parseTimeExpr(text);
  } catch (error) {
    if (error instanceof ParseError) throw new EngineInputError(`invalid time in day part "${name}": ${error.message}`);
    throw error;
  }
  if (expr.kind === 'anchor' && expr.anchor !== 'day') {
    throw new EngineInputError(`day part "${name}" can only use times, day.start or day.end, not "${expr.source}"`);
  }
  return expr;
}

/**
 * Adds each day part to the anchor index for every date. Clock times are read
 * on the civil date (an end before the start wraps past midnight) and then
 * clipped to the logical day; a part that ends up empty doesn't exist that day.
 */
export function addDayParts(parts: readonly DayPart[], dates: readonly string[], days: LogicalDays, anchors: AnchorIndex, timeZone: string): void {
  for (const date of dates) {
    const dayStart = days.start(date);
    const dayEnd = days.end(date);
    const at = (expr: TimeExpr, nextDay: boolean) => {
      if (expr.kind === 'anchor') return (expr.edge === 'end' ? dayEnd : dayStart) + expr.offset;
      return wallTime(nextDay ? addDays(date, 1) : date, expr.minutes, timeZone) + expr.offset;
    };
    for (const part of parts) {
      const start = at(part.start, false);
      let end = at(part.end, false);
      if (end <= start && part.end.kind === 'clock') end = at(part.end, true);
      const window = { start: Math.max(start, dayStart), end: Math.min(end, dayEnd) };
      if (window.end <= window.start) continue;
      anchors.set({ id: part.name, date, window, busy: [], tags: ['day_part'] });
    }
  }
}
