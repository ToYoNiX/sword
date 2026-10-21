import { parse } from 'yaml';
import { z } from 'zod';
import type { DayPartInput } from '@sword/engine';
import { isMapping, issues, unknownKeys } from './result.ts';
import type { Result } from './result.ts';

const text = z.string();

const configSchema = z.object({
  time_zone: text.optional(),
  day_start: text.optional(),
  horizon_days: z.number().optional(),
  avoid: z.array(text).optional(),
  day_parts: z.record(text, z.strictObject({ start: text, end: text }).nullable()).optional(),
  plugins: z.array(text).optional(),
});

const SETTINGS = new Set(Object.keys(configSchema.shape));

/** The settings in sword.yaml, with engine names. */
export interface Config {
  timeZone?: string;
  dayStart?: string;
  horizonDays?: number;
  avoid?: string[];
  dayParts?: Record<string, DayPartInput | null>;
  plugins: string[];
}

export function readConfigFile(source: string): Result<Config> {
  let data: unknown;
  try {
    data = parse(source);
  } catch (error) {
    return { ok: false, errors: [`invalid YAML: ${(error as Error).message}`], warnings: [] };
  }
  return readConfig(data ?? {});
}

export function readConfig(data: unknown): Result<Config> {
  if (!isMapping(data)) return { ok: false, errors: ['sword.yaml must be a mapping of settings'], warnings: [] };
  const warnings = unknownKeys(data, SETTINGS).map((key) => `unknown setting "${key}"`);
  const parsed = configSchema.safeParse(data);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings };
  const raw = parsed.data;
  const config: Config = { plugins: raw.plugins ?? [] };
  if (raw.time_zone !== undefined) config.timeZone = raw.time_zone;
  if (raw.day_start !== undefined) config.dayStart = raw.day_start;
  if (raw.horizon_days !== undefined) config.horizonDays = raw.horizon_days;
  if (raw.avoid !== undefined) config.avoid = raw.avoid;
  if (raw.day_parts !== undefined) config.dayParts = raw.day_parts;
  return { ok: true, value: config, warnings };
}
