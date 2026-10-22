import { invoke, plan as planVault } from '@sword/commands';
import { CalDav, CalDavError } from '../caldav.ts';
import { CliError } from '../io.ts';
import type { Io } from '../io.ts';
import { syncPlan } from '../sync.ts';
import { context } from '../vault.ts';

export interface SyncOptions {
  dir: string | undefined;
  days: number | undefined;
}

/** Publishes the plan to the CalDAV calendar in sword.yaml (e.g. Radicale). */
export async function sync(io: Io, options: SyncOptions): Promise<number> {
  const ctx = await context(io, options.dir);
  const { config } = await ctx.vault.load();
  if (config.caldav === undefined) {
    throw new CliError(
      'add a caldav section to sword.yaml, e.g.\n  caldav:\n    url: http://localhost:5232/you/sword/\n    username: you\nand put the password in SWORD_CALDAV_PASSWORD',
    );
  }
  const { plan, titles, now } = await invoke(planVault, ctx, { days: options.days });
  const password = io.env('SWORD_CALDAV_PASSWORD');
  const calendar = new CalDav({ url: config.caldav.url, ...(config.caldav.username !== undefined && { username: config.caldav.username }), ...(password !== undefined && { password }) });
  let result;
  try {
    result = await syncPlan(calendar, plan.placements, titles, now);
  } catch (error) {
    if (error instanceof CalDavError) throw new CliError(error.message);
    throw error;
  }
  if (result.created) io.out(`Created the calendar at ${calendar.url}\n`);
  const total = result.added + result.updated + result.unchanged + result.kept;
  const parts = [
    result.added > 0 && `${result.added} added`,
    result.updated > 0 && `${result.updated} updated`,
    result.removed > 0 && `${result.removed} removed`,
    result.kept > 0 && `${result.kept} past ${result.kept === 1 ? 'event' : 'events'} kept`,
  ].filter(Boolean);
  io.out(parts.length === 0 || (result.added + result.updated + result.removed === 0)
    ? `Already in sync: ${total} ${total === 1 ? 'event' : 'events'} at ${calendar.url}\n`
    : `Synced ${total} ${total === 1 ? 'event' : 'events'} to ${calendar.url}: ${parts.join(', ')}.\n`);
  return 0;
}
