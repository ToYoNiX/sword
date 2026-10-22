import { Temporal } from 'temporal-polyfill';
import { parseDuration } from '@sword/engine';
import type { Plan } from '@sword/engine';
import type { LogEntry } from '@sword/schema';
import { VaultError } from './errors.ts';
import type { Task, Vault } from './load.ts';
import { formatDate } from './times.ts';

export interface DoneRequest {
  /** The task's id (its note name, or its `id` property), or its title. */
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
  if (placement?.state === 'done') throw new VaultError(`${nameOf(task)} is already done${when}`);
  if (placement) return { at: request.now, occurrenceId, state: 'done', start: placement.start, end: placement.end };

  const exists = plan.unplaced.some((u) => u.occurrenceId === occurrenceId) || plan.inbox.includes(occurrenceId);
  if (!exists) {
    const today = plan.days[0]?.date ?? '';
    if (date !== null && date < today) throw new VaultError(`${nameOf(task)} was not planned on ${formatDate(date)}`, 'not_found');
    throw new VaultError(`${nameOf(task)} has no occurrence${when}`, 'not_found');
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
  if (day !== null && day !== today) throw new VaultError(`only today's tasks can be undone; ${nameOf(task)} on ${formatDate(day)} is history`);
  if (placement?.state !== 'done') throw new VaultError(`${nameOf(task)} is not marked done${day === null ? '' : ` on ${formatDate(day)}`}`);
  return { at: request.now, occurrenceId, state: 'open' };
}

/** The occurrence a request is about; `date` is null for a one-off task. */
function occurrence(vault: Vault, plan: Plan, request: DoneRequest): { task: Task; occurrenceId: string; date: string | null } {
  const task = findTask(vault, request.task);
  if (task.intention.repeat === undefined) {
    if (request.date !== undefined) throw new VaultError(`${nameOf(task)} is a one-off task; leave out the date`, 'invalid_input');
    return { task, occurrenceId: task.id, date: null };
  }
  const date = request.date ?? plan.days[0]?.date;
  if (date === undefined) throw new Error('the plan has no days');
  if (!isDate(date)) throw new VaultError(`"${date}" is not a date; use one like 2026-10-25`, 'invalid_input');
  return { task, occurrenceId: `${task.id}@${date}`, date };
}

/** How messages refer to a task: its title, or else its note name. */
function nameOf(task: Task): string {
  return task.intention.title ?? task.id;
}

/** A task by its id (the note name), or else by its title. */
function findTask(vault: Vault, name: string): Task {
  const byId = vault.tasks.find((t) => t.id === name);
  if (byId) return byId;
  const byTitle = vault.tasks.filter((t) => t.intention.title === name);
  if (byTitle.length > 1) {
    throw new VaultError(`"${name}" is the title of ${byTitle.length} tasks; use the note name: ${byTitle.map((t) => t.id).sort().join(', ')}`, 'invalid_input');
  }
  if (byTitle[0]) return byTitle[0];
  throw new VaultError(`no task named "${name}"`, 'not_found');
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
