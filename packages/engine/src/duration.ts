import { ParseError } from './errors.ts';

const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?$/;

/** Parses "45m", "2h" or "1h30m" into minutes. */
export function parseDuration(text: string): number {
  if (typeof text !== 'string') throw new ParseError('duration must be a string');
  const match = DURATION.exec(text.trim());
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    throw new ParseError(`invalid duration "${text}"; expected e.g. 45m, 2h or 1h30m`);
  }
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  if (minutes <= 0) throw new ParseError(`duration "${text}" must be longer than zero`);
  return minutes;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h${m}m`;
}
