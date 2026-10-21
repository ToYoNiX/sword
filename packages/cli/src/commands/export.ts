import { writeFile } from 'node:fs/promises';
import { toIcs } from '../ics.ts';
import { resolvePath } from '../io.ts';
import type { Io } from '../io.ts';
import { openVault } from '../vault.ts';
import { computePlan } from './plan.ts';

export interface ExportOptions {
  dir: string | undefined;
  days: number | undefined;
  /** A file to write; standard output if left out. */
  out: string | undefined;
}

/** The plan as iCalendar, for Radicale, a phone's calendar, and the like. */
export async function exportIcs(io: Io, options: ExportOptions): Promise<number> {
  const vault = await openVault(io, options.dir);
  const { plan } = computePlan(io, vault, options.days);
  const titles = new Map(vault.tasks.map((t) => [t.intention.id, t.intention.title ?? t.intention.id]));
  const ics = toIcs(plan.placements, { titles, stamp: io.now() });
  if (options.out === undefined) {
    io.out(ics);
  } else {
    const path = resolvePath(io, options.out);
    await writeFile(path, ics);
    const count = plan.placements.filter((p) => p.state !== 'missed').length;
    io.out(`Wrote ${count} ${count === 1 ? 'event' : 'events'} to ${path}\n`);
  }
  return 0;
}
