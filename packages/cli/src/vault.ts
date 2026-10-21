import { findVault, loadVault } from '@sword/vault';
import type { Vault } from '@sword/vault';
import { CliError, resolvePath } from './io.ts';
import type { Io } from './io.ts';

/** The vault given with --dir, or the one the current folder is in. */
export async function openVault(io: Io, dir: string | undefined): Promise<Vault> {
  const root = dir === undefined ? await findVault(io.cwd()) : resolvePath(io, dir);
  if (root === null) {
    throw new CliError('not inside a Sword vault: no sword.yaml here or in any folder above.\nRun "sword init" to create one, or pass --dir.');
  }
  try {
    return await loadVault(root);
  } catch (error) {
    throw new CliError((error as Error).message);
  }
}

/** The file a task id came from, for messages. */
export function fileOf(vault: Vault, intentionId: string | undefined): string {
  if (intentionId === undefined) return 'sword.yaml';
  const id = intentionId.includes('@') ? intentionId.slice(0, intentionId.lastIndexOf('@')) : intentionId;
  return vault.tasks.find((t) => t.intention.id === id)?.file ?? `tasks/${id}.md`;
}
