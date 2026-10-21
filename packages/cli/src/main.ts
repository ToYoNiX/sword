#!/usr/bin/env node
import { run } from './cli.ts';

process.exitCode = await run(process.argv.slice(2), {
  // pnpm runs scripts in the package folder; INIT_CWD is where you ran it.
  cwd: process.env['INIT_CWD'] ?? process.cwd(),
  now: () => new Date().toISOString(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  color: process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined,
});
