import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTaskFile, loadVault, trashTaskFile, updateTaskFile } from '../src/index.ts';
import { vault } from './helpers.ts';

describe('task files', () => {
  it('creates a new task file, and refuses to overwrite one', async () => {
    const root = await vault({ 'sword.yaml': '' });
    const v = await loadVault(root);
    await createTaskFile(v, 'tasks/Study Go.md', '---\nduration: 45m\n---\n');
    expect(await readFile(join(root, 'tasks/Study Go.md'), 'utf8')).toBe('---\nduration: 45m\n---\n');
    await expect(createTaskFile(v, 'tasks/Study Go.md', 'other')).rejects.toThrow();
    expect(await readFile(join(root, 'tasks/Study Go.md'), 'utf8')).toBe('---\nduration: 45m\n---\n');
  });

  it('updates a task file unless it changed since it was read', async () => {
    const root = await vault({ 'sword.yaml': '', 'tasks/a.md': '---\nduration: 45m\n---\n' });
    const v = await loadVault(root);
    const task = v.tasks[0]!;
    expect(await updateTaskFile(v, task, '---\nduration: 1h\n---\n')).toBeNull();
    expect(await readFile(join(root, 'tasks/a.md'), 'utf8')).toBe('---\nduration: 1h\n---\n');
    // `task` still holds the old source: the file has changed since.
    expect(await updateTaskFile(v, task, '---\nduration: 2h\n---\n')).toBe('it changed while Sword was planning');
    expect(await readFile(join(root, 'tasks/a.md'), 'utf8')).toBe('---\nduration: 1h\n---\n');
  });

  it('moves a deleted task to the trash, keeping its folder, without overwriting', async () => {
    const root = await vault({ 'sword.yaml': '', 'tasks/errands/a.md': '---\nduration: 15m\n---\n', '.trash/tasks/errands/a.md': 'older' });
    const v = await loadVault(root);
    expect(await trashTaskFile(v, v.tasks[0]!)).toBe('.trash/tasks/errands/a 2.md');
    expect(await readdir(join(root, 'tasks/errands'))).toEqual([]);
    expect(await readFile(join(root, '.trash/tasks/errands/a 2.md'), 'utf8')).toBe('---\nduration: 15m\n---\n');
    expect(await readFile(join(root, '.trash/tasks/errands/a.md'), 'utf8')).toBe('older');
    expect((await loadVault(root)).tasks).toEqual([]);
  });

  it('refuses to trash a file that changed since it was read', async () => {
    const root = await vault({ 'sword.yaml': '', 'tasks/a.md': '---\nduration: 15m\n---\n' });
    const v = await loadVault(root);
    await writeFile(join(root, 'tasks/a.md'), '---\nduration: 20m\n---\n');
    await expect(trashTaskFile(v, v.tasks[0]!)).rejects.toThrow('it changed while Sword was planning');
  });
});
