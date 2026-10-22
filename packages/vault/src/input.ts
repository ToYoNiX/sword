import { Temporal } from 'temporal-polyfill';
import { parseDuration } from '@sword/engine';
import type { ExistingPlacement, Pin, ScheduleInput } from '@sword/engine';
import type { Task, Vault } from './load.ts';
import { pluginAnchors } from './plugins.ts';
import { toInstant } from './times.ts';

export interface InputOptions {
  now: string;
  /** Overrides the settings; otherwise the settings, then 7. */
  horizonDays?: number;
}

/** The vault's time zone: the settings, or this computer's. */
export function timeZoneOf(vault: Vault): string {
  return vault.config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The engine input for a vault. Anchors from plugins and events from
 * calendars are not wired in yet; fixed anchors and day parts are.
 *
 * What the plan remembers comes from the files: `planned` and `pins` in each
 * task (by task, so the engine finds the day), then the log, which wins.
 */
export function scheduleInput(vault: Vault, options: InputOptions): ScheduleInput {
  const { config } = vault;
  const timeZone = timeZoneOf(vault);
  const input: ScheduleInput = {
    timeZone,
    now: options.now,
    horizonDays: options.horizonDays ?? config.horizonDays ?? 7,
    intentions: vault.tasks.map((t) => t.intention),
    pins: vault.tasks.flatMap((task) => task.pins.map((time): Pin => ({ intentionId: task.id, start: toInstant(time, timeZone) }))),
    existing: [
      ...vault.tasks.flatMap((task) => [
        ...stored(task, task.planned, 'scheduled', timeZone),
        ...stored(task, task.pins, 'pinned', timeZone),
      ]),
      ...vault.log.flatMap((entry): ExistingPlacement[] =>
        entry.state === 'open' ? [] : [{ occurrenceId: entry.occurrenceId, start: entry.start, end: entry.end, state: entry.state }],
      ),
    ],
  };
  if (config.dayStart !== undefined) input.dayStart = config.dayStart;
  if (config.dayParts !== undefined) input.dayParts = config.dayParts;
  if (config.fixedAnchors !== undefined) input.fixedAnchors = config.fixedAnchors;
  if (config.avoid !== undefined) input.avoid = config.avoid;
  if (vault.plugins.length > 0) {
    // From the day before today (a logical day may start the civil day before)
    // to the day after the plan (windows run into the next day).
    const today = Temporal.Instant.from(options.now).toZonedDateTimeISO(timeZone).toPlainDate();
    const dates = Array.from({ length: input.horizonDays + 2 }, (_, i) => today.add({ days: i - 1 }).toString());
    input.anchors = pluginAnchors(vault.plugins, dates, timeZone, config);
  }
  return input;
}

/** Times from a task file as stored placements, lasting the task's duration. */
function stored(task: Task, times: string[], state: 'scheduled' | 'pinned', timeZone: string): ExistingPlacement[] {
  let minutes: number;
  try {
    minutes = parseDuration(task.intention.duration);
  } catch {
    return []; // the engine reports the bad duration
  }
  return times.map((time) => {
    const start = Temporal.Instant.from(toInstant(time, timeZone));
    return { intentionId: task.id, start: start.toString(), end: start.add({ minutes }).toString(), state };
  });
}
