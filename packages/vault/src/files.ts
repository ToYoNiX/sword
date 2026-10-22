import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { Task, Vault } from './load.ts';
import { writeAtomic } from './write.ts';

/** Creates a task file; fails if one already exists at that path. */
export async function createTaskFile(vault: Vault, file: string, content: string): Promise<void> {
  const path = join(vault.root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { flag: 'wx' });
}

/** Replaces a task file unless it changed since it was read. Returns why it was skipped, or null. */
export async function updateTaskFile(vault: Vault, task: Task, content: string): Promise<string | null> {
  const unchanged = await unchangedSince(vault, task);
  if (unchanged !== null) return unchanged;
  await writeAtomic(join(vault.root, task.file), content);
  return null;
}

/**
 * Moves a task file into the vault's .trash folder, as Obsidian does, keeping
 * its path and never overwriting an older one. Returns where it went.
 */
export async function trashTaskFile(vault: Vault, task: Task): Promise<string> {
  const unchanged = await unchangedSince(vault, task);
  if (unchanged !== null) throw new Error(unchanged);
  const extension = extname(task.file);
  const stem = task.file.slice(0, -extension.length);
  for (let n = 1; ; n++) {
    const target = `.trash/${stem}${n === 1 ? '' : ` ${n}`}${extension}`;
    const path = join(vault.root, target);
    if (await exists(path)) continue;
    await mkdir(dirname(path), { recursive: true });
    await rename(join(vault.root, task.file), path);
    return target;
  }
}

async function unchangedSince(vault: Vault, task: Task): Promise<string | null> {
  const current = await readFile(join(vault.root, task.file), 'utf8').catch(() => null);
  if (current === null) return 'it was deleted while Sword was planning';
  if (current !== task.source) return 'it changed while Sword was planning';
  return null;
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}
