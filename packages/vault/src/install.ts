import { execFile } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { VaultError } from './errors.ts';
import { CONFIG_FILE, loadVault } from './load.ts';
import { pluginFolder, readPlugin } from './plugins.ts';
import { setSettings, writeAtomic } from './write.ts';

/**
 * Installs a plugin: clones its repository (a URL, or a local path) into
 * .sword/plugins/<name>, checks its manifest.json and main.js, and adds it to
 * `plugins` in sword.yaml. Nothing to build or install: main.js is bundled.
 */
export async function installPlugin(root: string, source: string): Promise<{ id: string; name: string; version: string; folder: string }> {
  const from = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || /^[\w.-]+@[\w.-]+:/.test(source) || isAbsolute(source) ? source : resolve(source);
  const folder = pluginFolder(from);
  const target = join(root, folder);
  if (await access(target).then(() => true, () => false)) throw new VaultError(`${folder} is already installed; delete that folder to install it again`, 'refused');

  try {
    await promisify(execFile)('git', ['clone', '--quiet', '--depth', '1', from, target]);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    throw new VaultError(`could not clone ${from}: ${detail}`, 'refused');
  }

  const read = await readPlugin(root, folder);
  const vault = await loadVault(root);
  const clash = read.ok ? vault.plugins.find((p) => p.id === read.manifest.id) : undefined;
  if (!read.ok || clash) {
    await rm(target, { recursive: true, force: true });
    throw read.ok
      ? new VaultError(`another plugin already has the id "${read.manifest.id}": ${clash?.source}`, 'refused')
      : new VaultError(`${read.file}: ${read.message}`, 'invalid_input');
  }

  if (!vault.config.plugins.includes(from)) {
    const path = join(root, CONFIG_FILE);
    await writeAtomic(path, setSettings(await readFile(path, 'utf8'), { plugins: [...vault.config.plugins, from] }));
  }
  return { id: read.manifest.id, name: read.manifest.name, version: read.manifest.version, folder };
}
