import { Temporal } from 'temporal-polyfill';
import { parseDuration } from '@sword/engine';
import type { Plan } from '@sword/engine';
import type { LogEntry } from '@sword/schema';
import { VaultError } from './errors.ts';
import type { Task, Vault } from './load.ts';
import { formatDate } from './times.ts';

export interface DoneRequest {
  /** The task's id: its note name, or its `id` property. */
  task: string;
  /** The logical day of a repeating task; today if left out. */
  date?: string;
  now: string;
}

/**
 * The log line marking an occurrence done, at the time it was planned. One
 * that couldn't be planned is recorded as done just now.
 */
export function markDone(vault: Vault, plan: Plan, request: DoneRequest): LogEntry {
  const { task, occurrenceId, date } = occurrence(vault, plan, request);
  const placement = plan.placements.find((p) => p.occurrenceId === occurrenceId);
  const when = date === null ? '' : ` on ${formatDate(date)}`;
  if (placement?.state === 'done') throw new VaultError(`${task.id} is already done${when}`);
  if (placement) return { at: request.now, occurrenceId, state: 'done', start: placement.start, end: placement.end };

  const exists = plan.unplaced.some((u) => u.occurrenceId === occurrenceId) || plan.inbox.includes(occurrenceId);
  if (!exists) {
    const today = plan.days[0]?.date ?? '';
    if (date !== null && date < today) throw new VaultError(`${task.id} was not planned on ${formatDate(date)}`);
    throw new VaultError(`${task.id} has no occurrence${when}`);
  }
  const end = Temporal.Instant.from(request.now);
  const start = end.subtract({ minutes: parseDuration(task.intention.duration) });
  return { at: request.now, occurrenceId, state: 'done', start: start.toString(), end: end.toString() };
}

/** The log line undoing a mistaken done. Only today's occurrences can be undone. */
export function reopen(vault: Vault, plan: Plan, request: DoneRequest): LogEntry {
  const { task, occurrenceId, date } = occurrence(vault, plan, request);
  const placement = plan.placements.find((p) => p.occurrenceId === occurrenceId);
  const day = date ?? placement?.date ?? null;
  const today = plan.days[0]?.date;
  if (day !== null && day !== today) throw new VaultError(`only today's tasks can be undone; ${task.id} on ${formatDate(day)} is history`);
  if (placement?.state !== 'done') throw new VaultError(`${task.id} is not marked done${day === null ? '' : ` on ${formatDate(day)}`}`);
  return { at: request.now, occurrenceId, state: 'open' };
}

/** The occurrence a request is about; `date` is null for a one-off task. */
function occurrence(vault: Vault, plan: Plan, request: DoneRequest): { task: Task; occurrenceId: string; date: string | null } {
  const task = vault.tasks.find((t) => t.id === request.task);
  if (!task) throw new VaultError(`no task named "${request.task}"`);
  if (task.intention.repeat === undefined) {
    if (request.date !== undefined) throw new VaultError(`${task.id} is a one-off task; leave out the date`);
    return { task, occurrenceId: task.id, date: null };
  }
  const date = request.date ?? plan.days[0]?.date;
  if (date === undefined) throw new Error('the plan has no days');
  if (!isDate(date)) throw new VaultError(`"${date}" is not a date; use one like 2026-10-25`);
  return { task, occurrenceId: `${task.id}@${date}`, date };
}

function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  try {
    Temporal.PlainDate.from(text, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}
