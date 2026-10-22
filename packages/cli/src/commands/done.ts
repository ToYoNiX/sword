import { done as markDone, invoke, undoDone } from '@sword/commands';
import { formatDate } from '@sword/vault';
import type { Io } from '../io.ts';
import { context } from '../vault.ts';

export interface DoneOptions {
  dir: string | undefined;
  task: string;
  date: string | undefined;
  undo: boolean;
}

export async function done(io: Io, options: DoneOptions): Promise<number> {
  const result = await invoke(options.undo ? undoDone : markDone, await context(io, options.dir), { task: options.task, date: options.date });
  const which = result.date === null ? result.title : `${result.title} (${formatDate(result.date)})`;
  io.out(`${which} ${result.state === 'done' ? 'is done' : 'is not done anymore'}.\n`);
  return 0;
}
