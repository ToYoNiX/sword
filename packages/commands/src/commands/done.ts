import { z } from 'zod';
import { markDone, reopen } from '@sword/vault';
import { defineCommand } from '../command.ts';
import type { Context } from '../command.ts';
import { planVault } from '../planning.ts';

export interface DoneResult {
  occurrenceId: string;
  /** The task's id (its note name). */
  task: string;
  title: string;
  /** The occurrence's logical day; null for a one-off task. */
  date: string | null;
  state: 'done' | 'open';
}

const input = z
  .object({
    task: z.string().min(1).describe("The task's note name or title"),
    date: z.string().optional().describe('The logical day (YYYY-MM-DD) of a repeating task; today if left out'),
  })
  .strict();

export const done = defineCommand({
  name: 'done',
  description: "Mark an occurrence of a task done: today's, or another day's with date. A one-off task has a single occurrence.",
  scope: 'write',
  input,
  run: (ctx, request) => record(ctx, request, 'done'),
});

export const undoDone = defineCommand({
  name: 'undo_done',
  description: 'Undo a done marked by mistake. Only works for occurrences of today; older ones are history.',
  scope: 'write',
  input,
  run: (ctx, request) => record(ctx, request, 'open'),
});

async function record(ctx: Context, request: z.output<typeof input>, state: 'done' | 'open'): Promise<DoneResult> {
  const { vault, plan, now, titles } = await planVault(ctx, undefined);
  const args = { task: request.task, now, ...(request.date !== undefined && { date: request.date }) };
  const entry = state === 'done' ? markDone(vault, plan, args) : reopen(vault, plan, args);
  await ctx.vault.appendLog(vault, [entry]);
  const oneOff = vault.tasks.some((t) => t.id === entry.occurrenceId);
  const task = oneOff ? entry.occurrenceId : entry.occurrenceId.slice(0, entry.occurrenceId.lastIndexOf('@'));
  return {
    occurrenceId: entry.occurrenceId,
    task,
    title: titles[task] ?? task,
    date: oneOff ? null : entry.occurrenceId.slice(entry.occurrenceId.lastIndexOf('@') + 1),
    state,
  };
}
