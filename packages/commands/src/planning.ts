import { z } from 'zod';
import { EngineInputError, schedule } from '@sword/engine';
import type { Plan } from '@sword/engine';
import { PluginError, scheduleInput } from '@sword/vault';
import type { Vault } from '@sword/vault';
import { CommandError } from './command.ts';
import type { Context } from './command.ts';

export const days = z.number().int().min(1).max(366).optional().describe('How many days to plan, starting today; the settings (or 7) if left out');

/** A plan of the vault as it is now, with what callers need to show it. */
export interface PlanResult {
  /** Identifies this exact plan; pass it to apply to apply only this plan. */
  planId: string;
  timeZone: string;
  now: string;
  /** Display names by task id: the title, or else the note name. */
  titles: Record<string, string>;
  plan: Plan;
}

/** Loads the vault and plans it, refusing while any file has errors. */
export async function planVault(ctx: Context, horizonDays: number | undefined): Promise<PlanResult & { vault: Vault }> {
  const vault = await ctx.vault.load();
  const fileErrors = vault.problems.filter((p) => p.level === 'error').length;
  if (fileErrors > 0) throw new CommandError('vault_errors', `${fileErrors} ${fileErrors === 1 ? 'problem' : 'problems'} in your files`);
  const now = ctx.now();
  let plan: Plan;
  let input: ReturnType<typeof scheduleInput>;
  try {
    input = scheduleInput(vault, { now, ...(horizonDays !== undefined && { horizonDays }) });
    plan = schedule(input);
  } catch (error) {
    if (error instanceof EngineInputError) throw new CommandError('vault_errors', `sword.yaml: ${error.message}`);
    if (error instanceof PluginError) throw new CommandError('vault_errors', `plugin ${error.plugin}: ${error.message}`);
    throw error;
  }
  if (plan.errors.length > 0) {
    throw new CommandError('vault_errors', `${plan.errors.length} ${plan.errors.length === 1 ? 'task has' : 'tasks have'} errors`);
  }
  const titles = Object.fromEntries(vault.tasks.map((t) => [t.id, t.intention.title ?? t.id]));
  return { vault, planId: planId(plan), timeZone: input.timeZone, now, titles, plan };
}

/**
 * A short fingerprint of a plan (64-bit FNV-1a of its JSON). The scheduler is
 * deterministic, so the same inputs give the same id; plain JavaScript, so it
 * works wherever the engine does.
 */
export function planId(plan: Plan): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(JSON.stringify(plan))) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
