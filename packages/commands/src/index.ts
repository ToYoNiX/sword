import type { Command } from './command.ts';
import { apply } from './commands/apply.ts';
import { check } from './commands/check.ts';
import { done, undoDone } from './commands/done.ts';
import { exportIcs } from './commands/export.ts';
import { plan } from './commands/plan.ts';
import { createTask, deleteTask, updateTask } from './commands/tasks.ts';

export { CommandError, allows, defineCommand, invoke } from './command.ts';
export type { Command, CommandErrorCode, Context, InputOf, ResultOf, Scope, VaultAccess } from './command.ts';
export type { PlanResult } from './planning.ts';
export { apply, check, createTask, deleteTask, done, exportIcs, plan, undoDone, updateTask };
export type { TaskResult } from './commands/tasks.ts';
export type { ApplyResult } from './commands/apply.ts';
export type { CheckResult } from './commands/check.ts';
export type { DoneResult } from './commands/done.ts';
export type { ExportResult } from './commands/export.ts';

/** Every command, for adapters that expose them all (the server, MCP). */
export const commands: readonly Command[] = [check, plan, apply, done, undoDone, createTask, updateTask, deleteTask, exportIcs];

export function commandNamed(name: string): Command | undefined {
  return commands.find((c) => c.name === name);
}
