import type { Plan } from '@sword/engine';
import type { LogEntry } from '@sword/schema';
import { timeZoneOf } from './input.ts';
import type { Task, Vault } from './load.ts';
import { appendLog } from './log.ts';
import { toInstant, toLocal } from './times.ts';
import { updateTaskFile } from './files.ts';
import { setTimes } from './write.ts';

export interface Applied {
  /** Task files that were updated. */
  files: string[];
  /** Task files left alone, and why: e.g. they changed after they were read. */
  skipped: { file: string; reason: string }[];
  /** Lines added to the log: occurrences that were missed. */
  logged: LogEntry[];
}

/**
 * Saves a plan into the vault: newly missed occurrences go to the log, then
 * each task file gets its `planned` times, from today on. Pins and planned
 * times from earlier days are dropped (the log has what happened); planned
 * times beyond the plan's last day are left alone. Only files that change
 * are written, so applying the same plan twice does nothing.
 */
export async function applyPlan(vault: Vault, plan: Plan, options: { now: string }): Promise<Applied> {
  const timeZone = timeZoneOf(vault);
  const [first, last] = [plan.days[0], plan.days.at(-1)];
  if (first === undefined || last === undefined) throw new Error('the plan has no days');
  const dayStart = Date.parse(first.start);
  const horizonEnd = Date.parse(last.end);
  const at = (time: string) => Date.parse(toInstant(time, timeZone));

  const logged = plan.diff.missed.flatMap((occurrenceId): LogEntry[] => {
    const placement = plan.placements.find((p) => p.occurrenceId === occurrenceId);
    return placement ? [{ at: options.now, occurrenceId, state: 'missed', start: placement.start, end: placement.end }] : [];
  });
  await appendLog(vault, logged);

  const applied: Applied = { files: [], skipped: [], logged };
  for (const task of vault.tasks) {
    const planned = unique([
      ...plan.placements.filter((p) => p.intentionId === task.id && p.kind !== 'pinned' && p.date >= first.date).map((p) => toLocal(p.start, timeZone)),
      ...task.planned.filter((time) => at(time) >= horizonEnd),
    ]);
    const pins = task.pins.filter((time) => at(time) >= dayStart);
    if (same(planned, task.planned) && same(pins, task.pins)) continue;
    const skipped = await writeTask(vault, task, { pins, planned });
    if (skipped === null) applied.files.push(task.file);
    else applied.skipped.push({ file: task.file, reason: skipped });
  }
  return applied;
}

/** Writes a task's times unless the file changed since it was read. Returns why it was skipped, or null. */
async function writeTask(vault: Vault, task: Task, times: { pins: string[]; planned: string[] }): Promise<string | null> {
  let content: string;
  try {
    content = setTimes(task.source, times);
  } catch (error) {
    return (error as Error).message;
  }
  return updateTaskFile(vault, task, content);
}

function unique(times: string[]): string[] {
  return [...new Set(times)].sort();
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
