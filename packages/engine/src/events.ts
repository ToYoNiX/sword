import { ParseError } from './errors.ts';
import type { Interval } from './interval.ts';
import { parseInstant } from './time.ts';
import type { EventInput, Issue } from './types.ts';

export interface ResolvedEvent {
  readonly id: string;
  readonly title: string;
  readonly interval: Interval;
  readonly tags: readonly string[];
  readonly busy: boolean;
}

export function buildEvents(inputs: readonly EventInput[], warnings: Issue[]): ResolvedEvent[] {
  const events: ResolvedEvent[] = [];
  for (const raw of inputs) {
    try {
      if (typeof raw.id !== 'string' || raw.id === '') throw new ParseError('it has no id');
      const interval = { start: parseInstant(raw.start), end: parseInstant(raw.end) };
      if (interval.end <= interval.start) throw new ParseError('it ends before it starts');
      events.push({ id: raw.id, title: raw.title ?? raw.id, interval, tags: [...(raw.tags ?? [])], busy: raw.busy !== false });
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      warnings.push({ code: 'invalid_event', message: `ignored event ${JSON.stringify(raw?.id)}: ${error.message}` });
    }
  }
  return events;
}
