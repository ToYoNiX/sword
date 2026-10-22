#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { run } from './cli.ts';
import { CliError } from './io.ts';

/**
 * The folder you ran sword in. pnpm runs scripts in the package folder, so
 * INIT_CWD comes first. If the shell's folder was deleted (and maybe recreated
 * at the same path, as `sword init` in it does), the path the shell shows is
 * still what you mean.
 */
function currentFolder(): string {
  const fromPnpm = process.env['INIT_CWD'];
  if (fromPnpm !== undefined) return fromPnpm;
  try {
    return process.cwd();
  } catch {
    const shown = process.env['PWD'];
    if (shown !== undefined && existsSync(shown)) return shown;
    throw new CliError('the current folder no longer exists (was it deleted?). cd into a folder and try again.');
  }
}

process.exitCode = await run(process.argv.slice(2), {
  cwd: currentFolder,
  // Whole seconds: these times end up in the log, where milliseconds are noise.
  now: () => new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  color: process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined,
});
