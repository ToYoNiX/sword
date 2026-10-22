import { z } from 'zod';
import { defineCommand } from '../command.ts';
import { toIcs } from '../ics.ts';
import { days, planVault } from '../planning.ts';

export interface ExportResult {
  /** The plan as an iCalendar file. */
  ics: string;
  /** How many events it has. */
  events: number;
}

export const exportIcs = defineCommand({
  name: 'export',
  description: 'The plan as iCalendar (.ics), for calendars like Radicale or a phone. Each occurrence keeps the same UID when it moves.',
  scope: 'read',
  input: z.object({ days }).strict(),
  async run(ctx, input): Promise<ExportResult> {
    const { plan, titles, now } = await planVault(ctx, input.days);
    const ics = toIcs(plan.placements, { titles: new Map(Object.entries(titles)), stamp: now, busy: plan.busy });
    return { ics, events: plan.placements.filter((p) => p.state !== 'missed').length + plan.busy.length };
  },
});
