import { parse } from 'yaml';
import { z } from 'zod';
import type { DayPartInput, FixedAnchorInput, Weekday } from '@sword/engine';
import { isMapping, issues } from './result.ts';
import type { Result } from './result.ts';

const text = z.string();

const configSchema = z.object({
  time_zone: text.optional(),
  day_start: text.optional(),
  horizon_days: z.number().optional(),
  avoid: z.array(text).optional(),
  day_parts: z.record(text, z.strictObject({ start: text, end: text }).nullable()).optional(),
  anchors: z
    .record(
      text,
      z.strictObject({
        start: text,
        end: text,
        on: z.array(text).optional(),
        busy: z.boolean().optional(),
        tags: z.array(text).optional(),
      }),
    )
    .optional(),
  location: z
    .strictObject({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
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
  /** The `anchors` section: anchors at fixed times, e.g. work hours. */
  fixedAnchors?: Record<string, FixedAnchorInput>;
  location?: { latitude: number; longitude: number };
  /** Plugins the vault uses: where each was installed from. */
  plugins: string[];
  /**
   * Every other setting, as written: a plugin's settings are under its id.
   * The vault, which knows the installed plugins, warns about the rest.
   */
  other: Record<string, unknown>;
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
  const known = Object.fromEntries(Object.entries(data).filter(([key]) => SETTINGS.has(key)));
  const other = Object.fromEntries(Object.entries(data).filter(([key]) => !SETTINGS.has(key)));
  const parsed = configSchema.safeParse(known);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings: [] };
  const raw = parsed.data;
  const config: Config = { plugins: raw.plugins ?? [], other };
  if (raw.location !== undefined) config.location = raw.location;
  if (raw.time_zone !== undefined) config.timeZone = raw.time_zone;
  if (raw.day_start !== undefined) config.dayStart = raw.day_start;
  if (raw.horizon_days !== undefined) config.horizonDays = raw.horizon_days;
  if (raw.avoid !== undefined) config.avoid = raw.avoid;
  if (raw.day_parts !== undefined) config.dayParts = raw.day_parts;
  if (raw.anchors !== undefined) {
    config.fixedAnchors = Object.fromEntries(
      Object.entries(raw.anchors).map(([name, a]) => {
        const anchor: FixedAnchorInput = { start: a.start, end: a.end };
        if (a.on !== undefined) anchor.on = a.on as Weekday[];
        if (a.busy !== undefined) anchor.busy = a.busy;
        if (a.tags !== undefined) anchor.tags = a.tags;
        return [name, anchor];
      }),
    );
  }
  return { ok: true, value: config, warnings: [] };
}
