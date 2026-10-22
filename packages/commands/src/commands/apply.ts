import { z } from 'zod';
import type { Applied } from '@sword/vault';
import { CommandError, defineCommand } from '../command.ts';
import { days, planVault } from '../planning.ts';
import type { PlanResult } from '../planning.ts';

export interface ApplyResult extends PlanResult {
  applied: Applied;
}

export const apply = defineCommand({
  name: 'apply',
  description:
    "Save the current plan: each task file gets the times of its occurrences (its planned property), and occurrences whose time passed without being done are logged as missed. Pass the planId from plan to apply only the plan you previewed.",
  scope: 'write',
  input: z
    .object({
      days,
      planId: z.string().optional().describe('From a plan you previewed; apply refuses if the plan has changed since'),
    })
    .strict(),
  async run(ctx, input): Promise<ApplyResult> {
    const { vault, ...result } = await planVault(ctx, input.days);
    if (input.planId !== undefined && input.planId !== result.planId) {
      throw new CommandError('stale_plan', 'the plan has changed since it was previewed; preview it again');
    }
    const applied = await ctx.vault.applyPlan(vault, result.plan, { now: result.now });
    return { ...result, applied };
  },
});
