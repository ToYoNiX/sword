import { ParseError } from './errors.ts';
import { isAnchorId } from './expr.ts';
import type { Edge } from './expr.ts';
import type { Interval } from './interval.ts';
import { parseInstant, parsePlainDate } from './time.ts';
import type { AnchorInput, Issue } from './types.ts';

export interface ResolvedAnchor {
  readonly id: string;
  readonly date: string;
  readonly window: Interval;
  /** Sorted by start. */
  readonly busy: readonly Interval[];
  readonly tags: readonly string[];
  /** A name to show; the id if there is none. */
  readonly title?: string;
}

/** How a reference is used; decides what the `auto` edge means. */
export type EdgeRole = 'after' | 'before' | 'at' | 'dayStart';

/**
 * The instant an edge refers to, or undefined if the anchor has no such edge.
 *
 * `auto` follows everyday language. If the anchor has a busy portion, that is
 * the part that matters: "after Asr" is after praying, not after Asr's whole
 * window. Otherwise the window is the thing itself: "after work" is after work
 * ends, "before work" and "at afternoon" are its start.
 */
export function edgeValue(anchor: ResolvedAnchor, edge: Edge, role: EdgeRole): number | undefined {
  const { window, busy } = anchor;
  switch (edge) {
    case 'start':
      return window.start;
    case 'end':
      return window.end;
    case 'busy.start':
      return busy[0]?.start;
    case 'busy.end':
      return busy.at(-1)?.end;
    case 'auto':
      if (role === 'dayStart') return window.start;
      if (role === 'before') return busy[0]?.start ?? window.start;
      if (role === 'after') return busy.at(-1)?.end ?? window.end;
      return busy.at(-1)?.end ?? window.start;
  }
}

export class AnchorIndex {
  readonly #byKey = new Map<string, ResolvedAnchor>();
  /** Every anchor id that exists on at least one date. */
  readonly ids = new Set<string>();

  get(id: string, date: string): ResolvedAnchor | undefined {
    return this.#byKey.get(`${id}@${date}`);
  }

  all(): ResolvedAnchor[] {
    return [...this.#byKey.values()];
  }

  /** Returns the anchor already stored for the same id and date, if any. */
  existing(anchor: ResolvedAnchor): ResolvedAnchor | undefined {
    return this.get(anchor.id, anchor.date);
  }

  set(anchor: ResolvedAnchor): void {
    this.#byKey.set(`${anchor.id}@${anchor.date}`, anchor);
    this.ids.add(anchor.id);
  }
}

export function buildAnchorIndex(inputs: readonly AnchorInput[], warnings: Issue[]): AnchorIndex {
  const index = new AnchorIndex();
  for (const raw of inputs) {
    let anchor: ResolvedAnchor;
    try {
      anchor = resolveAnchor(raw);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      warnings.push({ code: 'invalid_anchor', message: `ignored anchor ${JSON.stringify(raw?.id)}: ${error.message}` });
      continue;
    }
    const previous = index.existing(anchor);
    if (previous) {
      warnings.push({
        code: 'duplicate_anchor',
        message: `anchor "${anchor.id}" is defined more than once on ${anchor.date}; keeping the earliest`,
      });
      const later = anchor.window.start - previous.window.start || anchor.window.end - previous.window.end;
      if (later >= 0) continue;
    }
    index.set(anchor);
  }
  return index;
}

function resolveAnchor(raw: AnchorInput): ResolvedAnchor {
  if (typeof raw.id !== 'string' || !isAnchorId(raw.id) || raw.id === 'day') {
    throw new ParseError(`invalid anchor id ${JSON.stringify(raw.id)}`);
  }
  const date = parsePlainDate(raw.date);
  const start = parseInstant(raw.start);
  const end = raw.end === undefined ? start : parseInstant(raw.end);
  if (end < start) throw new ParseError('its end is before its start');
  const busy = (raw.busy ?? [])
    .map((range) => {
      const interval = { start: parseInstant(range.start), end: parseInstant(range.end) };
      if (interval.end <= interval.start) throw new ParseError('a busy range must end after it starts');
      return interval;
    })
    .sort((a, b) => a.start - b.start);
  const resolved = { id: raw.id, date, window: { start, end }, busy, tags: [...(raw.tags ?? [])] };
  return typeof raw.title === 'string' && raw.title !== '' ? { ...resolved, title: raw.title } : resolved;
}
