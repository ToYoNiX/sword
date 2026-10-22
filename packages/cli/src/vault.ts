import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '@sword/commands';
import { CONFIG_FILE, fileVault, findVault } from '@sword/vault';
import { CliError, resolvePath } from './io.ts';
import type { Io } from './io.ts';

/** The context for commands: the vault given with --dir, or the one the current folder is in. */
export async function context(io: Io, dir: string | undefined): Promise<Context> {
  const root = dir === undefined ? await findVault(io.cwd()) : resolvePath(io, dir);
  if (root === null) {
    throw new CliError('not inside a Sword vault: no sword.yaml here or in any folder above.\nRun "sword init" to create one, or pass --dir.');
  }
  try {
    await access(join(root, CONFIG_FILE));
  } catch {
    throw new CliError(`${root} is not a Sword vault: it has no ${CONFIG_FILE} (run "sword init" to create one)`);
  }
  return { vault: fileVault(root), now: io.now };
}
