import { z } from 'zod';
import { EngineInputError, schedule } from '@sword/engine';
import { scheduleInput } from '@sword/vault';
import type { Problem, Vault } from '@sword/vault';
import { defineCommand } from '../command.ts';

export interface CheckResult {
  tasks: number;
  /** Every problem, by file: what the files say and what the engine says. */
  problems: Problem[];
}

export const check = defineCommand({
  name: 'check',
  description: 'List every problem in the vault by file: bad properties, unknown anchors, typos. Plans are refused while any file has errors.',
  scope: 'read',
  input: z.object({}).strict(),
  async run(ctx): Promise<CheckResult> {
    const vault = await ctx.vault.load();
    const problems: Problem[] = [...vault.problems];
    try {
      const plan = schedule(scheduleInput(vault, { now: ctx.now() }));
      for (const e of plan.errors) problems.push({ file: fileOf(vault, e.intentionId), level: 'error', message: e.message });
      for (const w of plan.warnings) problems.push({ file: fileOf(vault, w.intentionId ?? w.occurrenceId), level: 'warning', message: w.message });
    } catch (error) {
      if (!(error instanceof EngineInputError)) throw error;
      problems.push({ file: 'sword.yaml', level: 'error', message: error.message });
    }
    problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return { tasks: vault.tasks.length, problems };
  },
});

/** The file a task or occurrence id came from. */
function fileOf(vault: Vault, id: string | undefined): string {
  if (id === undefined) return 'sword.yaml';
  const task = vault.tasks.find((t) => t.id === id) ?? vault.tasks.find((t) => t.id === id.slice(0, id.lastIndexOf('@')));
  return task?.file ?? `tasks/${id.includes('@') ? id.slice(0, id.lastIndexOf('@')) : id}.md`;
}
