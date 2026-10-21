import { z } from 'zod';
import { issues } from './result.ts';

/**
 * One line of log/*.jsonl: something that happened to an occurrence. The
 * log is append-only; for each occurrence, the last line wins.
 */
export interface LogEntry {
  /** When it was recorded. */
  at: string;
  occurrenceId: string;
  state: 'done' | 'missed';
  /** The placement it happened to. */
  start: string;
  end: string;
}

const lineSchema = z.object({
  at: z.string(),
  occurrence: z.string(),
  state: z.enum(['done', 'missed']),
  start: z.string(),
  end: z.string(),
});

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
    const { at, occurrence, state, start, end } = parsed.data;
    result.entries.push({ at, occurrenceId: occurrence, state, start, end });
  });
  return result;
}
