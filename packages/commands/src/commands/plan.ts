import { z } from 'zod';
import { defineCommand } from '../command.ts';
import { days, planVault } from '../planning.ts';
import type { PlanResult } from '../planning.ts';

export const plan = defineCommand({
  name: 'plan',
  description:
    'Preview the schedule: each day with its placements, what changed since the plan was last applied (with reasons), what could not be placed and why, and the inbox. Changes nothing.',
  scope: 'read',
  input: z.object({ days }).strict(),
  async run(ctx, input): Promise<PlanResult> {
    const { vault: _, ...result } = await planVault(ctx, input.days);
    return result;
  },
});
