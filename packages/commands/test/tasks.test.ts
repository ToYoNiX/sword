import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileVault } from '@sword/vault';
import { CommandError, createTask, deleteTask, invoke, plan, updateTask } from '../src/index.ts';
import type { Context } from '../src/index.ts';
import { vault } from './helpers.ts';

const NOW = '2026-10-25T00:00:00Z';
const settings = 'time_zone: Asia/Riyadh\nhorizon_days: 2\nanchors:\n  prayer.fajr: { start: "05:36", end: "06:06", busy: true }\n';
const study = '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nafter: prayer.fajr\nbefore: 09:00\n---\n\nChapter 7.\n';
const context = (root: string): Context => ({ vault: fileVault(root), now: () => NOW });

async function failure(promise: Promise<unknown>): Promise<CommandError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
}

describe('create_task', () => {
  it('writes a task file from properties and notes, ready to plan', async () => {
    const root = await vault({ 'sword.yaml': settings });
    const result = await invoke(createTask, context(root), {
      name: 'Read Al-Kahf',
      properties: { duration: '20m', repeat: 'weekly', repeat_on: ['fri'], after: 'prayer.fajr', before: '09:00', tags: ['quran'] },
      notes: 'Before Jumuah.',
    });
    expect(result).toEqual({ task: 'Read Al-Kahf', file: 'tasks/Read Al-Kahf.md', warnings: [] });
    expect(await readFile(join(root, 'tasks/Read Al-Kahf.md'), 'utf8')).toBe(
      '---\nduration: 20m\nrepeat: weekly\nrepeat_on:\n  - fri\nafter: prayer.fajr\nbefore: 09:00\ntags:\n  - quran\n---\n\nBefore Jumuah.\n',
    );
    expect((await invoke(plan, context(root), { days: 7 })).plan.placements.map((p) => p.occurrenceId)).toEqual(['Read Al-Kahf@2026-10-30']);
  });

  it.each<[string, object, string]>([
    ['a missing duration', { after: '09:00' }, 'duration: missing'],
    ['a bad property type', { duration: '30m', priority: 'high' }, 'priority: must be a number'],
    ['an unknown anchor', { duration: '30m', after: 'prayer.fajrr' }, 'unknown anchor "prayer.fajrr"'],
    ['rules that contradict', { duration: '30m', at: '09:00', after: '08:00' }, 'at'],
    ['planned, which only apply writes', { duration: '30m', planned: ['2026-10-25 09:00'] }, 'planned'],
    ['pins, which need the pin scope', { duration: '30m', pins: ['2026-10-25 09:00'] }, 'pins'],
    ['a value with a line break', { duration: '30m', title: 'a\nb' }, 'line break'],
  ])('refuses %s, and writes nothing', async (_, properties, message) => {
    const root = await vault({ 'sword.yaml': settings });
    const error = await failure(invoke(createTask, context(root), { name: 'x', properties }));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain(message);
    expect(await readdir(root)).toEqual(['sword.yaml']);
  });

  it.each(['../escape', 'sub/dir', '.hidden', '', 'name.md'])('refuses the name %j', async (name) => {
    const root = await vault({ 'sword.yaml': settings });
    expect((await failure(invoke(createTask, context(root), { name, properties: { duration: '30m' } }))).code).toBe('invalid_input');
  });

  it('refuses a name that is taken, leaving the task alone', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const error = await failure(invoke(createTask, context(root), { name: 'study', properties: { duration: '1h' } }));
    expect(error).toMatchObject({ code: 'refused', message: 'a task named "study" already exists' });
    expect(await readFile(join(root, 'tasks/study.md'), 'utf8')).toBe(study);
  });

  it('passes on warnings about likely typos', async () => {
    const root = await vault({ 'sword.yaml': settings });
    const result = await invoke(createTask, context(root), { name: 'x', properties: { duration: '30m', befor: '09:00' } });
    expect(result.warnings).toEqual(['unknown property "befor"; did you mean "before"?']);
  });
});

describe('update_task', () => {
  it('changes only the named properties, by note name or title', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const result = await invoke(updateTask, context(root), { task: 'Study Go', set: { duration: '1h', priority: 1 }, unset: ['before'] });
    expect(result).toEqual({ task: 'study', file: 'tasks/study.md', changed: ['duration', 'priority', 'before'], warnings: [] });
    expect(await readFile(join(root, 'tasks/study.md'), 'utf8')).toBe('---\ntitle: Study Go\nduration: 1h\nrepeat: daily\nafter: prayer.fajr\npriority: 1\n---\n\nChapter 7.\n');
  });

  it('refuses a change that breaks the task, and leaves the file as it was', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const error = await failure(invoke(updateTask, context(root), { task: 'study', unset: ['duration'] }));
    expect(error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('duration: missing') });
    expect(await readFile(join(root, 'tasks/study.md'), 'utf8')).toBe(study);
  });

  it.each<[string, object, string]>([
    ['no change', {}, 'set or unset'],
    ['planned', { set: { planned: ['2026-10-25 09:00'] } }, 'planned'],
    ['pins', { unset: ['pins'] }, 'pins'],
    ['the id', { set: { id: 'other' } }, 'id'],
  ])('refuses %s', async (_, change, message) => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const error = await failure(invoke(updateTask, context(root), { task: 'study', ...change }));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain(message);
  });

  it('reports an unknown task', async () => {
    const root = await vault({ 'sword.yaml': settings });
    expect((await failure(invoke(updateTask, context(root), { task: 'nope', set: { duration: '1h' } }))).code).toBe('not_found');
  });
});

describe('delete_task', () => {
  it('moves the task to the trash, so it is out of the plan but not lost', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    expect(await invoke(deleteTask, context(root), { task: 'Study Go' })).toEqual({ task: 'study', file: 'tasks/study.md', trashedTo: '.trash/tasks/study.md' });
    expect(await readFile(join(root, '.trash/tasks/study.md'), 'utf8')).toBe(study);
    expect((await invoke(plan, context(root), {})).plan.placements).toEqual([]);
  });

  it('refuses a task that changed since it was read', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const ctx = context(root);
    const loaded = await ctx.vault.load();
    await writeFile(join(root, 'tasks/study.md'), study.replace('45m', '50m'));
    const stale: Context = { ...ctx, vault: { ...ctx.vault, load: async () => loaded } };
    expect((await failure(invoke(deleteTask, stale, { task: 'study' }))).code).toBe('refused');
  });
});
