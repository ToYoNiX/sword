import { installPlugin } from '@sword/vault';
import { CliError } from '../io.ts';
import type { Io } from '../io.ts';
import { vaultRoot } from '../vault.ts';

/** sword plugin add <url or path>: download a plugin into the vault and list it in sword.yaml. */
export async function plugin(io: Io, args: string[], dir: string | undefined, usage: string): Promise<number> {
  const [action, source, ...rest] = args;
  if (action === undefined) throw new CliError(`which plugin command? e.g. sword plugin add https://github.com/ToYoNiX/sword-prayer\n\n${usage}`, 2);
  if (action !== 'add') throw new CliError(`unknown plugin command "${action}"\n\n${usage}`, 2);
  if (source === undefined) throw new CliError(`which plugin? Give its repository: sword plugin add https://github.com/ToYoNiX/sword-prayer`, 2);
  if (rest.length > 0) throw new CliError('one plugin at a time', 2);
  const root = await vaultRoot(io, dir);
  try {
    const installed = await installPlugin(root, source);
    io.out(`Installed ${installed.name} ${installed.version} (${installed.id}) in ${installed.folder}\n`);
  } catch (error) {
    throw new CliError((error as Error).message);
  }
  return 0;
}
