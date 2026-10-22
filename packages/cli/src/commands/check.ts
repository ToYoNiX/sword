import { check as checkVault, invoke } from '@sword/commands';
import { paint } from '../io.ts';
import type { Io } from '../io.ts';
import { context } from '../vault.ts';

export async function check(io: Io, dir: string | undefined): Promise<number> {
  const { tasks, plugins, problems } = await invoke(checkVault, await context(io, dir), {});
  for (const p of problems) {
    io.out(`${p.file}: ${p.level === 'error' ? paint(io, 'red', 'error') : paint(io, 'yellow', 'warning')}: ${p.message}\n`);
  }
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;
  const installed = plugins.length === 0 ? '' : `, plugins: ${plugins.map((p) => `${p.id} ${p.version}`).join(', ')}`;
  const count = `${tasks} ${tasks === 1 ? 'task' : 'tasks'}${installed}`;
  io.out(
    problems.length === 0
      ? `${count}, no problems\n`
      : `\n${count}, ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}\n`,
  );
  return errors > 0 ? 1 : 0;
}
