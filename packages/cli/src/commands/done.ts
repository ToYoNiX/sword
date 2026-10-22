import { appendLog, formatDate, markDone, reopen } from '@sword/vault';
import type { Vault } from '@sword/vault';
import { CliError } from '../io.ts';
import type { Io } from '../io.ts';
import { openVault } from '../vault.ts';
import { computePlan } from './plan.ts';

export interface DoneOptions {
  dir: string | undefined;
  task: string;
  date: string | undefined;
  undo: boolean;
}

/** Marks today's (or another day's) occurrence of a task done, or undoes that today. */
export async function done(io: Io, options: DoneOptions): Promise<number> {
  const vault = await openVault(io, options.dir);
  const { plan } = computePlan(io, vault, undefined);
  const request = { task: options.task, now: io.now(), ...(options.date !== undefined && { date: options.date }) };
  let entry;
  try {
    entry = options.undo ? reopen(vault, plan, request) : markDone(vault, plan, request);
  } catch (error) {
    throw new CliError((error as Error).message);
  }
  await appendLog(vault, [entry]);
  io.out(`${describe(vault, entry.occurrenceId)} ${options.undo ? 'is not done anymore' : 'is done'}.\n`);
  return 0;
}

/** "Study Go (Sun 25 Oct)", or just the title for a one-off task. */
function describe(vault: Vault, occurrenceId: string): string {
  const at = occurrenceId.lastIndexOf('@');
  const task = vault.tasks.find((t) => t.id === occurrenceId) ?? vault.tasks.find((t) => t.id === occurrenceId.slice(0, at));
  const title = task?.intention.title ?? task?.id ?? occurrenceId;
  return task?.id === occurrenceId ? title : `${title} (${formatDate(occurrenceId.slice(at + 1))})`;
}
