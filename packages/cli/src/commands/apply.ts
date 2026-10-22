import { applyPlan } from '@sword/vault';
import { describeChanges } from '../changes.ts';
import { CliError } from '../io.ts';
import type { Io } from '../io.ts';
import { openVault } from '../vault.ts';
import { computePlan } from './plan.ts';

export interface ApplyOptions {
  dir: string | undefined;
  days: number | undefined;
}

/** Saves the plan in the task files, and logs what was missed. */
export async function apply(io: Io, options: ApplyOptions): Promise<number> {
  const vault = await openVault(io, options.dir);
  const { plan, timeZone } = computePlan(io, vault, options.days);
  const applied = await applyPlan(vault, plan, { now: io.now() });

  const changes = describeChanges(vault, plan, timeZone);
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
