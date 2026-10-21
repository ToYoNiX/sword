import { parseDuration } from './duration.ts';
import { ParseError } from './errors.ts';

/**
 * Which instant of an anchor a reference means. `auto` depends on how it is
 * used: "after X" means after X's busy portion, "before X" before it.
 */
export type Edge = 'auto' | 'start' | 'end' | 'busy.start' | 'busy.end';

export type TimeExpr =
  | { readonly kind: 'clock'; readonly minutes: number; readonly offset: number; readonly source: string }
  | { readonly kind: 'anchor'; readonly anchor: string; readonly edge: Edge; readonly offset: number; readonly source: string };

const ANCHOR_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const RESERVED_SEGMENTS = new Set(['start', 'end', 'busy']);
const EDGE_SUFFIXES = ['busy.start', 'busy.end', 'start', 'end'] as const;
const EXPRESSION = /^([^\s+-]+)\s*(?:([+-])\s*(\S+))?$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;

/** Lowercase dot-separated segments; the last one can't be an edge name. */
export function isAnchorId(id: string): boolean {
  return ANCHOR_ID.test(id) && !RESERVED_SEGMENTS.has(id.slice(id.lastIndexOf('.') + 1));
}

/** One or more time expressions; the first one that exists on a day is used. */
export interface TimeRule {
  readonly alternatives: readonly TimeExpr[];
  readonly source: string;
}

const OR = /\s+or\s+/;

/** Parses "work.start", or fallbacks like "work.start or noon or 12:00". */
export function parseTimeRule(text: string): TimeRule {
  if (typeof text !== 'string') throw new ParseError('time rule must be a string');
  const source = text.trim();
  return { alternatives: source.split(OR).map(parseTimeExpr), source };
}

/**
 * Parses "09:00", "prayer.asr", "work.start - 15m" or
 * "prayer.fajr.busy.end + 5m".
 */
export function parseTimeExpr(text: string): TimeExpr {
  if (typeof text !== 'string') throw new ParseError('time expression must be a string');
  const source = text.trim();
  const match = EXPRESSION.exec(source);
  if (!match) {
    throw new ParseError(`invalid time expression "${text}"; expected e.g. "09:00", "prayer.asr" or "work.start - 15m"`);
  }
  const [, ref = '', sign, amount] = match;

  let offset = 0;
  if (sign !== undefined && amount !== undefined) {
    let minutes: number;
    try {
      minutes = parseDuration(amount);
    } catch {
      throw new ParseError(`invalid offset "${amount}" in "${text}"; expected e.g. 5m or 1h30m`);
    }
    offset = (sign === '-' ? -minutes : minutes) * 60_000;
  }

  const clock = CLOCK.exec(ref);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) throw new ParseError(`invalid time "${ref}" in "${text}"`);
    return { kind: 'clock', minutes: hours * 60 + minutes, offset, source };
  }

  let anchor = ref;
  let edge: Edge = 'auto';
  for (const suffix of EDGE_SUFFIXES) {
    if (ref.endsWith(`.${suffix}`)) {
      anchor = ref.slice(0, -(suffix.length + 1));
      edge = suffix;
      break;
    }
  }
  if (!isAnchorId(anchor)) throw new ParseError(`invalid anchor reference "${ref}" in "${text}"`);
  return { kind: 'anchor', anchor, edge, offset, source };
}
