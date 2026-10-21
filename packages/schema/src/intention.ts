/*
 * Task files are Markdown notes with flat frontmatter properties, so they
 * work with Obsidian's properties: every property has one type (text, list,
 * number or date) in every file, and nothing is nested.
 *
 *   duration     text     45m
 *   repeat       text     daily | weekly | monthly
 *   repeat_every number   2  (every 2 days, weeks or months)
 *   repeat_on    list     mon, thu  (weekly)
 *   repeat_day   number   15  (monthly; 31 is the month's last day)
 *   repeat_since date     the first possible date, and where "every N" counts from
 *   at, after, before, within   text
 *   date, deadline               date (deadline may also be a date and time)
 *   avoid, tags, pins            list
 *   prefer text, priority number, title text, id text
 *
 * This file checks the properties and maps them to the engine's input. What
 * the values mean (is "prayer.fajrr" a real anchor?) is left to the engine.
 */
import { parse } from 'yaml';
import type { IntentionInput, Preference, Repeat, Weekday } from '@sword/engine';
import { isMapping } from './result.ts';
import type { Result } from './result.ts';

export interface IntentionFile {
  intention: IntentionInput;
  /** The Markdown body after the frontmatter. */
  notes: string;
  /** Occurrences moved by hand: logical date → local time ("07:30"). */
  pins: Record<string, string>;
}

const PROPERTIES = [
  'id',
  'title',
  'duration',
  'repeat',
  'repeat_every',
  'repeat_on',
  'repeat_day',
  'repeat_since',
  'date',
  'at',
  'after',
  'before',
  'within',
  'avoid',
  'deadline',
  'prefer',
  'priority',
  'tags',
  'pins',
] as const;

const KNOWN = new Set<string>(PROPERTIES);
const WEEKDAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const PREFERENCES = new Set(['earliest', 'latest', 'packed']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEADLINE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const PIN = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/;

/**
 * Reads a task file: YAML frontmatter between `---` lines, then notes.
 * `id` is used when the frontmatter has none (normally the file name).
 */
export function readIntentionFile(source: string, options: { id: string }): Result<IntentionFile> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (lines[0]?.trim() !== '---' || close < 0) {
    return { ok: false, errors: ['the file must start with YAML frontmatter between "---" lines'], warnings: [] };
  }
  let data: unknown;
  try {
    data = parse(lines.slice(1, close).join('\n'));
  } catch (error) {
    return { ok: false, errors: [`invalid YAML in frontmatter: ${(error as Error).message}`], warnings: [] };
  }
  if (data === null || data === undefined) return { ok: false, errors: ['the frontmatter is empty'], warnings: [] };
  const result = readTask(data, options);
  if (!result.ok) return result;
  const notes = lines.slice(close + 1).join('\n').replace(/^\n+/, '');
  return { ok: true, value: { ...result.value, notes }, warnings: result.warnings };
}

/** Reads already-parsed properties (frontmatter, or a task in any YAML document). */
export function readIntention(data: unknown, options: { id?: string } = {}): Result<IntentionInput> {
  const result = readTask(data, options);
  return result.ok ? { ...result, value: result.value.intention } : result;
}

function readTask(data: unknown, options: { id?: string }): Result<Omit<IntentionFile, 'notes'>> {
  if (!isMapping(data)) return { ok: false, errors: ['the properties must be a mapping of names to values'], warnings: [] };
  const warnings = Object.keys(data)
    .filter((key) => !KNOWN.has(key))
    .flatMap((key) => {
      const meant = nearMiss(key);
      return meant ? [`unknown property "${key}"; did you mean "${meant}"?`] : [];
    });
  const errors: string[] = [];
  const read = new Reader(data, errors);

  if ('window' in data) errors.push('window: use the separate properties after, before and within');

  const id = read.text('id') ?? options.id;
  if (id === undefined) errors.push('id: missing; it is normally the file name');
  const duration = read.text('duration');
  if (data['duration'] === undefined || data['duration'] === null) errors.push('duration: missing, e.g. "duration: 45m"');

  const repeat = readRepeat(read, errors);
  const date = read.matching('date', DATE, 'a date like 2026-10-26');
  const deadline = read.matching('deadline', DEADLINE, 'a date (2026-10-24) or a date and time (2026-10-24T17:00)');
  const prefer = read.text('prefer');
  if (prefer !== undefined && !PREFERENCES.has(prefer)) errors.push(`prefer: use earliest, latest or packed, not "${prefer}"`);
  const priority = read.number('priority');
  if (priority !== undefined && !Number.isInteger(priority)) errors.push(`priority: must be a whole number, not ${priority}`);
  const pins = readPins(read, errors);

  const window = defined({ after: read.text('after'), before: read.text('before'), within: read.text('within') });
  const intention = defined({
    title: read.text('title'),
    repeat,
    date,
    at: read.text('at'),
    window: Object.keys(window).length > 0 ? window : undefined,
    avoid: read.list('avoid'),
    deadline,
    prefer: prefer as Preference | undefined,
    priority,
    tags: read.list('tags'),
  });

  if (errors.length > 0 || id === undefined || duration === undefined) return { ok: false, errors, warnings };
  return { ok: true, value: { intention: { id, duration, ...intention }, pins }, warnings };
}

/** The repeat properties, as the engine's repeat. */
function readRepeat(read: Reader, errors: string[]): Repeat | undefined {
  const raw = read.data['repeat'];
  const every = read.number('repeat_every');
  const on = read.list('repeat_on');
  const day = read.number('repeat_day');
  const since = read.matching('repeat_since', DATE, 'a date like 2026-10-26');

  if (raw === undefined) {
    for (const name of ['repeat_every', 'repeat_on', 'repeat_day', 'repeat_since']) {
      if (name in read.data) errors.push(`${name}: only applies with "repeat: daily", "weekly" or "monthly"`);
    }
    return undefined;
  }
  if (raw !== 'daily' && raw !== 'weekly' && raw !== 'monthly') {
    const hint = isMapping(raw) ? '; write the details as repeat_every, repeat_on, repeat_day and repeat_since' : '';
    errors.push(`repeat: use daily, weekly or monthly${hint}`);
    return undefined;
  }
  const failed = errors.length;
  if (every !== undefined && !(Number.isInteger(every) && every >= 1)) errors.push(`repeat_every: must be a whole number of 1 or more, not ${every}`);
  if ((every ?? 1) > 1 && since === undefined && !('repeat_since' in read.data)) {
    errors.push(`repeat_since: needed with repeat_every ${every}, as the date to count from`);
  }
  if (on !== undefined && raw !== 'weekly') errors.push('repeat_on: only applies to weekly repeats');
  const badDay = on?.find((d) => !WEEKDAYS.has(d));
  if (badDay !== undefined) errors.push(`repeat_on: "${badDay}" is not a weekday; use mon, tue, wed, thu, fri, sat or sun`);
  if (day !== undefined && raw !== 'monthly') errors.push('repeat_day: only applies to monthly repeats');
  if (day !== undefined && !(Number.isInteger(day) && day >= 1 && day <= 31)) errors.push(`repeat_day: must be a day of the month from 1 to 31, not ${day}`);
  if (raw === 'weekly' && on === undefined && since === undefined) errors.push('repeat_on: needed for weekly repeats (or a repeat_since to take the weekday from)');
  if (raw === 'monthly' && day === undefined && since === undefined) errors.push('repeat_day: needed for monthly repeats (or a repeat_since to take the day from)');
  if (errors.length > failed) return undefined;

  const n = every ?? 1;
  if (raw === 'daily') return n === 1 && since === undefined ? 'daily' : defined({ every: `${n} ${n === 1 ? 'day' : 'days'}`, since });
  if (raw === 'weekly') return defined({ every: `${n} ${n === 1 ? 'week' : 'weeks'}`, on: on as Weekday[] | undefined, since });
  return defined({ every: `${n} ${n === 1 ? 'month' : 'months'}`, onDay: day, since });
}

/** pins: a list of "2026-10-26 07:30", as a date → time mapping. */
function readPins(read: Reader, errors: string[]): Record<string, string> {
  const raw = read.data['pins'];
  if (isMapping(raw)) {
    errors.push('pins: use a list of dates and times, like "- 2026-10-26 07:30"');
    return {};
  }
  const pins: Record<string, string> = {};
  for (const pin of read.list('pins') ?? []) {
    const match = PIN.exec(pin);
    if (!match) {
      errors.push(`pins: "${pin}" is not a date and time like 2026-10-26 07:30`);
      continue;
    }
    const [, date = '', time = ''] = match;
    if (date in pins) errors.push(`pins: ${date} is pinned twice`);
    pins[date] = time;
  }
  return pins;
}

/** Reads typed properties, recording an error for each one of the wrong type. */
class Reader {
  readonly data: Record<string, unknown>;
  private readonly errors: string[];

  constructor(data: Record<string, unknown>, errors: string[]) {
    this.data = data;
    this.errors = errors;
  }

  text(name: string): string | undefined {
    const value = this.data[name];
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    this.errors.push(`${name}: must be text, not ${describe(value)}`);
    return undefined;
  }

  number(name: string): number | undefined {
    const value = this.data[name];
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') return value;
    this.errors.push(`${name}: must be a number, not ${describe(value)}`);
    return undefined;
  }

  /** A list of text; a single text value counts as a list of one. */
  list(name: string): string[] | undefined {
    const value = this.data[name];
    if (value === undefined || value === null || isMapping(value)) return undefined;
    const items = Array.isArray(value) ? value : [value];
    if (items.every((item) => typeof item === 'string')) return items as string[];
    this.errors.push(`${name}: must be a list of text`);
    return undefined;
  }

  matching(name: string, pattern: RegExp, expected: string): string | undefined {
    const value = this.text(name);
    if (value === undefined || pattern.test(value)) return value;
    this.errors.push(`${name}: must be ${expected}, not "${value}"`);
    return undefined;
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (isMapping(value)) return 'a mapping';
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/**
 * The known property an unknown one most likely meant: the same letters
 * ignoring case, "_" and "-", or one or two typos away. Otherwise null:
 * other properties belong to you or other plugins and are left alone.
 */
function nearMiss(name: string): string | null {
  const plain = (s: string) => s.toLowerCase().replace(/[_-]/g, '');
  for (const known of PROPERTIES) {
    if (plain(name) === plain(known)) return known;
  }
  for (const known of PROPERTIES) {
    const allowed = Math.min(name.length, known.length) <= 5 ? 1 : 2;
    if (known.length >= 4 && distance(name.toLowerCase(), known) <= allowed) return known;
  }
  return null;
}

/** Edit distance (insertions, deletions, substitutions). */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Drops undefined fields, so outputs only contain what was written. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
