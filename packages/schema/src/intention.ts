import { parse } from 'yaml';
import { z } from 'zod';
import type { IntentionInput, Preference, Repeat, Weekday } from '@sword/engine';
import { isMapping, issues, unknownKeys } from './result.ts';
import type { Result } from './result.ts';

/*
 * The schema checks shape and converts names (snake_case in files, camelCase
 * in the engine). What values mean, e.g. whether "prayer.fajrr" is a real
 * anchor, is the engine's job, so it is reported in one place.
 */

const text = z.string();

const windowSchema = z.strictObject({
  after: text.optional(),
  before: text.optional(),
  within: text.optional(),
});

const repeatSchema = z.strictObject({
  every: text.optional(),
  on: z.array(text).optional(),
  on_day: z.number().optional(),
  since: text.optional(),
});

const intentionSchema = z.object({
  id: text,
  title: text.optional(),
  duration: text,
  repeat: z.unknown().optional(),
  date: text.optional(),
  at: text.optional(),
  window: windowSchema.optional(),
  avoid: z.array(text).optional(),
  deadline: text.optional(),
  prefer: text.optional(),
  priority: z.number().optional(),
  tags: z.array(text).optional(),
});

const FIELDS = new Set(Object.keys(intentionSchema.shape));

export interface IntentionFile {
  intention: IntentionInput;
  /** The Markdown body after the frontmatter. */
  notes: string;
}

/**
 * Reads an intention file: YAML frontmatter between `---` lines, then notes.
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
  const result = readIntention(data, options);
  if (!result.ok) return result;
  const notes = lines.slice(close + 1).join('\n').replace(/^\n+/, '');
  return { ok: true, value: { intention: result.value, notes }, warnings: result.warnings };
}

/** Reads already-parsed frontmatter (or a task entry in any YAML document). */
export function readIntention(data: unknown, options: { id?: string } = {}): Result<IntentionInput> {
  if (!isMapping(data)) return { ok: false, errors: ['an intention must be a mapping of fields'], warnings: [] };
  const warnings = unknownKeys(data, FIELDS).map((key) => `unknown field "${key}"`);
  const parsed = intentionSchema.safeParse({ ...data, id: data['id'] ?? options.id });
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings };

  const raw = parsed.data;
  let repeat: Repeat | undefined;
  if (raw.repeat !== undefined) {
    if (typeof raw.repeat === 'string') {
      if (raw.repeat !== 'daily') return { ok: false, errors: ['repeat: use "daily" or a mapping such as { every: 2 days }'], warnings };
      repeat = 'daily';
    } else {
      const rule = repeatSchema.safeParse(raw.repeat);
      if (!rule.success) return { ok: false, errors: issues(rule.error, ['repeat']), warnings };
      const { every, on, on_day: onDay, since } = rule.data;
      repeat = defined({ every, on: on as Weekday[] | undefined, onDay, since });
    }
  }

  const intention: IntentionInput = {
    id: raw.id,
    duration: raw.duration,
    ...defined({
      title: raw.title,
      repeat,
      date: raw.date,
      at: raw.at,
      window: raw.window && defined(raw.window),
      avoid: raw.avoid,
      deadline: raw.deadline,
      prefer: raw.prefer as Preference | undefined,
      priority: raw.priority,
      tags: raw.tags,
    }),
  };
  return { ok: true, value: intention, warnings };
}

/** Drops undefined fields, so outputs only contain what was written. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
