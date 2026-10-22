import { z } from 'zod';
import { issues } from './result.ts';

/**
 * One line of log/*.jsonl: something that happened to an occurrence. The
 * log is append-only; for each occurrence, the last line wins. An `open`
 * line undoes a mistaken `done`: the occurrence is as if never marked.
 */
export type LogEntry =
  | {
      /** When it was recorded. */
      at: string;
      occurrenceId: string;
      state: 'done' | 'missed';
      /** The placement it happened to. */
      start: string;
      end: string;
    }
  | { at: string; occurrenceId: string; state: 'open' };

const lineSchema = z.discriminatedUnion('state', [
  z.object({ at: z.string(), occurrence: z.string(), state: z.enum(['done', 'missed']), start: z.string(), end: z.string() }),
  z.object({ at: z.string(), occurrence: z.string(), state: z.literal('open') }),
]);

export interface LogResult {
  entries: LogEntry[];
  /** Bad lines, by line number (from 1); the rest are still read. */
  errors: { line: number; message: string }[];
}

export function readLog(source: string): LogResult {
  const result: LogResult = { entries: [], errors: [] };
  source.split(/\r?\n/).forEach((text, i) => {
    if (text.trim() === '') return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      result.errors.push({ line: i + 1, message: 'not valid JSON' });
      return;
    }
    const parsed = lineSchema.safeParse(data);
    if (!parsed.success) {
      result.errors.push({ line: i + 1, message: issues(parsed.error).join('; ') });
      return;
    }
    const { occurrence, ...rest } = parsed.data;
    result.entries.push(rest.state === 'open' ? { at: rest.at, occurrenceId: occurrence, state: 'open' } : { ...rest, occurrenceId: occurrence });
  });
  return result;
}
