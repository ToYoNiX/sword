import { Temporal } from 'temporal-polyfill';
import type { Pin, ScheduleInput } from '@sword/engine';
import type { Vault } from './load.ts';

export interface InputOptions {
  now: string;
  /** Overrides the settings; otherwise the settings, then 7. */
  horizonDays?: number;
}

/**
 * The engine input for a vault. Anchors from plugins and events from
 * calendars are not wired in yet; fixed anchors and day parts are.
 */
export function scheduleInput(vault: Vault, options: InputOptions): ScheduleInput {
  const { config } = vault;
  const timeZone = config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const input: ScheduleInput = {
    timeZone,
    now: options.now,
    horizonDays: options.horizonDays ?? config.horizonDays ?? 7,
    intentions: vault.tasks.map((t) => t.intention),
    pins: pins(vault, timeZone),
    existing: vault.log.map(({ occurrenceId, start, end, state }) => ({ occurrenceId, start, end, state })),
  };
  if (config.dayStart !== undefined) input.dayStart = config.dayStart;
  if (config.dayParts !== undefined) input.dayParts = config.dayParts;
  if (config.fixedAnchors !== undefined) input.fixedAnchors = config.fixedAnchors;
  if (config.avoid !== undefined) input.avoid = config.avoid;
  return input;
}

function pins(vault: Vault, timeZone: string): Pin[] {
  return vault.tasks.flatMap((task) =>
    Object.entries(task.pins).map(([date, time]) => ({
      occurrenceId: task.intention.repeat === undefined ? task.intention.id : `${task.intention.id}@${date}`,
      start: Temporal.PlainDateTime.from(`${date}T${time.padStart(5, '0')}`).toZonedDateTime(timeZone).toInstant().toString(),
    })),
  );
}
