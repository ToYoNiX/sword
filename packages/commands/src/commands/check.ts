import { z } from 'zod';
import { EngineInputError, schedule } from '@sword/engine';
import { PluginError, scheduleInput } from '@sword/vault';
import type { Problem, Vault } from '@sword/vault';
import { defineCommand } from '../command.ts';

export interface CheckResult {
  tasks: number;
  /** The plugins that loaded. */
  plugins: { id: string; version: string }[];
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
      if (error instanceof PluginError) {
        const folder = vault.plugins.find((p) => p.id === error.plugin)?.folder;
        problems.push({ file: `${folder}/main.js`, level: 'error', message: `${error.plugin}: ${error.message}` });
      } else if (error instanceof EngineInputError) {
        problems.push({ file: 'sword.yaml', level: 'error', message: error.message });
      } else {
        throw error;
      }
    }
    problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return { tasks: vault.tasks.length, plugins: vault.plugins.map((p) => ({ id: p.id, version: p.version })), problems };
  },
});

/** The file a task or occurrence id came from. */
function fileOf(vault: Vault, id: string | undefined): string {
  if (id === undefined) return 'sword.yaml';
  const task = vault.tasks.find((t) => t.id === id) ?? vault.tasks.find((t) => t.id === id.slice(0, id.lastIndexOf('@')));
  return task?.file ?? `tasks/${id.includes('@') ? id.slice(0, id.lastIndexOf('@')) : id}.md`;
}
