/*
 * The command layer (docs/design.md §9): every operation on a vault is
 * defined once, here, as a Command. The CLI, the HTTP API, MCP and the UI
 * are thin adapters: they turn their input into a call to `invoke` and
 * present the result, which is plain data. No adapter has rules of its own.
 */
import { z } from 'zod';
import type { Plan } from '@sword/engine';
import type { LogEntry } from '@sword/schema';
import { VaultError } from '@sword/vault';
import type { Applied, Task, Vault } from '@sword/vault';

/**
 * What a caller may do (docs/design.md §9.3). `read` < `propose` < `write`
 * < `admin`, each allowing the ones before it; `pin` (setting exact times)
 * is separate and must be granted explicitly.
 */
export type Scope = 'read' | 'propose' | 'write' | 'pin' | 'admin';

const LEVELS: Record<Exclude<Scope, 'pin'>, number> = { read: 0, propose: 1, write: 2, admin: 3 };

/** Whether a caller granted `granted` may run a command that needs `needed`. */
export function allows(granted: readonly Scope[], needed: Scope): boolean {
  if (needed === 'pin') return granted.includes('pin');
  return granted.some((scope) => scope !== 'pin' && LEVELS[scope] >= LEVELS[needed]);
}

/**
 * How commands reach the vault. Commands never touch storage directly, so
 * the same commands can run against files on disk (the vault package's
 * `fileVault`), or later another storage, e.g. Obsidian's vault API.
 */
export interface VaultAccess {
  /** Reads the vault as it is now. */
  load(): Promise<Vault>;
  applyPlan(vault: Vault, plan: Plan, options: { now: string }): Promise<Applied>;
  appendLog(vault: Vault, entries: readonly LogEntry[]): Promise<void>;
  /** Creates a task file; fails if it exists. */
  createTask(vault: Vault, file: string, content: string): Promise<void>;
  /** Replaces a task file unless it changed since it was read; returns why it didn't, or null. */
  updateTask(vault: Vault, task: Task, content: string): Promise<string | null>;
  /** Moves a task file to the trash; returns where it went. */
  trashTask(vault: Vault, task: Task): Promise<string>;
}

/** Everything a command may use from the outside world. */
export interface Context {
  vault: VaultAccess;
  /** The current time, as an ISO instant. */
  now(): string;
}

export interface Command<S extends z.ZodType = z.ZodType, O = unknown> {
  /** snake_case; also the MCP tool name and the HTTP path (/api/<name>). */
  readonly name: string;
  /** One or two sentences for people and agents; also the MCP tool description. */
  readonly description: string;
  readonly scope: Scope;
  /** Validates every call; as JSON Schema it describes the MCP tool and the API. */
  readonly input: S;
  run(ctx: Context, input: z.output<S>): Promise<O>;
}

/** Defines a command, inferring its input and result types. */
export function defineCommand<S extends z.ZodType, O>(command: Command<S, O>): Command<S, O> {
  return command;
}

export type InputOf<C> = C extends Command<infer S, unknown> ? z.input<S> : never;
export type ResultOf<C> = C extends Command<z.ZodType, infer O> ? O : never;

/**
 * Why a command failed, for adapters to map: the CLI to an exit code, HTTP to
 * a status (400, 403, 404, 409, 422), MCP to a tool error.
 */
export type CommandErrorCode =
  /** The input doesn't match the command's schema, or names something malformed. */
  | 'invalid_input'
  /** The caller's scopes don't allow the command. */
  | 'not_allowed'
  /** The vault, a task, or an occurrence doesn't exist. */
  | 'not_found'
  /** Files in the vault have errors; nothing is planned until they're fixed. */
  | 'vault_errors'
  /** The plan changed since it was previewed (apply with a planId). */
  | 'stale_plan'
  /** A rule says no, e.g. undoing a done from yesterday. */
  | 'refused';

export class CommandError extends Error {
  override name = 'CommandError';
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Runs a command for an adapter: checks the caller's scopes (when given),
 * validates the raw input, and turns vault errors into CommandErrors.
 */
export async function invoke<S extends z.ZodType, O>(
  command: Command<S, O>,
  ctx: Context,
  input: unknown,
  options: { scopes?: readonly Scope[] } = {},
): Promise<O> {
  if (options.scopes !== undefined && !allows(options.scopes, command.scope)) {
    throw new CommandError('not_allowed', `${command.name} needs the ${command.scope} scope`);
  }
  const parsed = command.input.safeParse(input ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
    throw new CommandError('invalid_input', problems.join('; '));
  }
  try {
    return await command.run(ctx, parsed.data);
  } catch (error) {
    if (error instanceof VaultError) throw new CommandError(error.code, error.message);
    throw error;
  }
}
