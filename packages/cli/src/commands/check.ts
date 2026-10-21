import { EngineInputError, schedule } from '@sword/engine';
import { scheduleInput } from '@sword/vault';
import type { Problem } from '@sword/vault';
import { paint } from '../io.ts';
import type { Io } from '../io.ts';
import { fileOf, openVault } from '../vault.ts';

/** Every problem in the vault, by file: what the files say and what the engine says. */
export async function check(io: Io, dir: string | undefined): Promise<number> {
  const vault = await openVault(io, dir);
  const problems: Problem[] = [...vault.problems];
  try {
    const plan = schedule(scheduleInput(vault, { now: io.now() }));
    for (const e of plan.errors) problems.push({ file: fileOf(vault, e.intentionId), level: 'error', message: e.message });
    for (const w of plan.warnings) {
      problems.push({ file: fileOf(vault, w.intentionId ?? w.occurrenceId), level: 'warning', message: w.message });
    }
  } catch (error) {
    if (!(error instanceof EngineInputError)) throw error;
    problems.push({ file: 'sword.yaml', level: 'error', message: error.message });
  }

  problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const p of problems) {
    io.out(`${p.file}: ${p.level === 'error' ? paint(io, 'red', 'error') : paint(io, 'yellow', 'warning')}: ${p.message}\n`);
  }
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;
  const tasks = `${vault.tasks.length} ${vault.tasks.length === 1 ? 'task' : 'tasks'}`;
  io.out(
    problems.length === 0
      ? `${tasks}, no problems\n`
      : `${problems.length > 0 ? '\n' : ''}${tasks}, ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}\n`,
  );
  return errors > 0 ? 1 : 0;
}
