import type { AnchorIndex } from './anchors.ts';
import type { DayPart } from './day-parts.ts';
import { EngineInputError, ParseError } from './errors.ts';
import { isAnchorId, parseTimeExpr } from './expr.ts';
import { addDays, isWeekday, wallTime, weekday } from './time.ts';
import type { FixedAnchorInput, Weekday } from './types.ts';

interface FixedAnchor {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly on: ReadonlySet<Weekday> | null;
  readonly busy: boolean;
  readonly tags: readonly string[];
}

/**
 * Anchors at fixed wall-clock times from the settings, e.g. work hours.
 * Unlike day parts they are not clipped to the logical day, so a night shift
 * can run past midnight.
 */
export function readFixedAnchors(
  input: Record<string, FixedAnchorInput> | undefined,
  anchors: AnchorIndex,
  dayParts: readonly DayPart[],
): FixedAnchor[] {
  const partNames = new Set(dayParts.map((p) => p.name));
  return Object.entries(input ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, raw]) => {
      if (!isAnchorId(name) || name === 'day') throw new EngineInputError(`invalid anchor name "${name}"`);
      if (anchors.ids.has(name)) throw new EngineInputError(`anchor "${name}" is also provided by a plugin or calendar`);
      if (partNames.has(name)) throw new EngineInputError(`anchor "${name}" has the same name as a day part`);
      const bad = raw.on?.find((d) => !isWeekday(d));
      if (bad !== undefined) throw new EngineInputError(`anchor "${name}": invalid weekday ${JSON.stringify(bad)}`);
      return {
        name,
        start: clockMinutes(name, raw.start),
        end: clockMinutes(name, raw.end),
        on: raw.on ? new Set(raw.on) : null,
        busy: raw.busy === true,
        tags: [...(raw.tags ?? [])],
      };
    });
}

export function addFixedAnchors(fixed: readonly FixedAnchor[], dates: readonly string[], anchors: AnchorIndex, timeZone: string): void {
  for (const date of dates) {
    for (const anchor of fixed) {
      if (anchor.on && !anchor.on.has(weekday(date))) continue;
      const start = wallTime(date, anchor.start, timeZone);
      let end = wallTime(date, anchor.end, timeZone);
      if (end <= start) end = wallTime(addDays(date, 1), anchor.end, timeZone);
      const window = { start, end };
      anchors.set({ id: anchor.name, date, window, busy: anchor.busy ? [window] : [], tags: anchor.tags });
    }
  }
}

function clockMinutes(name: string, text: string): number {
  let expr;
  try {
    expr = parseTimeExpr(text);
  } catch (error) {
    if (error instanceof ParseError) throw new EngineInputError(`anchor "${name}": ${error.message}`);
    throw error;
  }
  if (expr.kind !== 'clock' || expr.offset !== 0) throw new EngineInputError(`anchor "${name}": use a time like "09:00", not "${text}"`);
  return expr.minutes;
}
