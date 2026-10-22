import { writeFile } from 'node:fs/promises';
import { exportIcs as toIcs, invoke } from '@sword/commands';
import { resolvePath } from '../io.ts';
import type { Io } from '../io.ts';
import { context } from '../vault.ts';

export interface ExportOptions {
  dir: string | undefined;
  days: number | undefined;
  /** A file to write; standard output if left out. */
  out: string | undefined;
}

export async function exportIcs(io: Io, options: ExportOptions): Promise<number> {
  const { ics, events } = await invoke(toIcs, await context(io, options.dir), { days: options.days });
  if (options.out === undefined) {
    io.out(ics);
  } else {
    const path = resolvePath(io, options.out);
    await writeFile(path, ics);
    io.out(`Wrote ${events} ${events === 1 ? 'event' : 'events'} to ${path}\n`);
  }
  return 0;
}
