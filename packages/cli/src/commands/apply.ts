import { apply as applyPlan, invoke } from '@sword/commands';
import { describeChanges } from '../changes.ts';
import { CliError } from '../io.ts';
import type { Io } from '../io.ts';
import { context } from '../vault.ts';

export interface ApplyOptions {
  dir: string | undefined;
  days: number | undefined;
}

export async function apply(io: Io, options: ApplyOptions): Promise<number> {
  const result = await invoke(applyPlan, await context(io, options.dir), { days: options.days });
  const { applied } = result;
  const changes = describeChanges(result.plan, result.titles, result.timeZone);
  const updated = applied.files.length;
  if (changes.length === 0 && updated === 0 && applied.skipped.length === 0) {
    io.out('Nothing to apply: your task files already hold this plan.\n');
    return 0;
  }
  if (changes.length === 1) io.out(`Applied: ${changes[0]}.\n`);
  if (changes.length > 1) io.out(`Applied:\n${changes.map((c) => `  ${c}\n`).join('')}`);
  if (updated > 0) io.out(`Updated ${updated} task ${updated === 1 ? 'file' : 'files'}.\n`);
  if (applied.skipped.length > 0) {
    throw new CliError(applied.skipped.map((s) => `${s.file} was not updated: ${s.reason}`).join('\nsword: '));
  }
  return 0;
}
