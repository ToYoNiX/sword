import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fileVault } from '@sword/vault';
import type { Vault } from '@sword/vault';
import type { LogEntry } from '@sword/schema';
import { CommandError, allows, apply, check, commandNamed, commands, done, exportIcs, invoke, plan, undoDone } from '../src/index.ts';
import type { Context, Scope, VaultAccess } from '../src/index.ts';
import { vault } from './helpers.ts';

// Riyadh is UTC+3 all year. Sunday Oct 25, 2026, 03:00 local.
const NOW = '2026-10-25T00:00:00Z';
const settings = 'time_zone: Asia/Riyadh\nhorizon_days: 2\n';
const study = '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nafter: 05:00\nbefore: 07:00\n---\n';

const context = (root: string, now = NOW): Context => ({ vault: fileVault(root), now: () => now });

async function failure(promise: Promise<unknown>): Promise<CommandError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
}

describe('the command list', () => {
  it('has unique snake_case names, a description and a scope for every command', () => {
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of commands) {
      expect(command.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(command.description.length).toBeGreaterThan(20);
      expect(['read', 'propose', 'write', 'pin', 'admin']).toContain(command.scope);
    }
    expect(names).toEqual(['check', 'plan', 'apply', 'done', 'undo_done', 'export']);
  });

  it('describes every input as a JSON Schema object, as MCP tools need', () => {
    for (const command of commands) {
      const schema = z.toJSONSchema(command.input) as { type?: string };
      expect(schema.type, command.name).toBe('object');
    }
    expect(z.toJSONSchema(done.input)).toMatchObject({
      properties: { task: { type: 'string', description: "The task's note name or title" } },
      required: ['task'],
    });
  });

  it('finds commands by name', () => {
    expect(commandNamed('undo_done')).toBe(undoDone);
    expect(commandNamed('nope')).toBeUndefined();
  });
});

describe('scopes', () => {
  it.each<[Scope[], Scope, boolean]>([
    [['read'], 'read', true],
    [['read'], 'write', false],
    [['write'], 'read', true],
    [['write'], 'propose', true],
    [['admin'], 'write', true],
    [['write'], 'pin', false],
    [['admin'], 'pin', false],
    [['pin'], 'pin', true],
    [['pin'], 'read', false],
    [['read', 'pin'], 'pin', true],
    [[], 'read', false],
  ])('%j allows %s: %s', (granted, needed, expected) => {
    expect(allows(granted, needed)).toBe(expected);
  });
});

describe('invoke', () => {
  it('refuses a command the caller has no scope for, before touching the vault', async () => {
    const untouchable: Context = { vault: { load: () => Promise.reject(new Error('touched')) } as unknown as VaultAccess, now: () => NOW };
    const error = await failure(invoke(apply, untouchable, {}, { scopes: ['read'] }));
    expect(error).toMatchObject({ code: 'not_allowed', message: 'apply needs the write scope' });
  });

  it.each<[string, unknown, string]>([
    ['a missing field', {}, 'task'],
    ['a field of the wrong type', { task: 5 }, 'task'],
    ['an empty task', { task: '' }, 'task'],
    ['an unknown field', { task: 'x', when: 'now' }, 'when'],
    ['not an object', 'Study Go', 'object'],
  ])('rejects %s as invalid input, naming the field', async (_, input, field) => {
    const error = await failure(invoke(done, context('/nowhere'), input));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain(field);
  });

  it('rejects days out of range', async () => {
    expect((await failure(invoke(plan, context('/nowhere'), { days: 0 }))).code).toBe('invalid_input');
    expect((await failure(invoke(plan, context('/nowhere'), { days: 1.5 }))).code).toBe('invalid_input');
  });

  it('reports a folder that is not a vault as not found', async () => {
    const error = await failure(invoke(plan, context(await vault({})), {}));
    expect(error.code).toBe('not_found');
  });
});

describe('plan', () => {
  it('returns the plan as data, with titles, the time zone and a plan id', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const result = await invoke(plan, context(root), {});
    expect(result).toMatchObject({ timeZone: 'Asia/Riyadh', now: NOW, titles: { study: 'Study Go' } });
    expect(result.plan.placements.map((p) => p.occurrenceId)).toEqual(['study@2026-10-25', 'study@2026-10-26']);
    expect(result.planId).toMatch(/^[0-9a-f]{16}$/);
    expect((await invoke(plan, context(root), {})).planId).toBe(result.planId);
    expect((await invoke(plan, context(root), { days: 1 })).planId).not.toBe(result.planId);
  });

  it('refuses while files have errors, without naming a CLI command', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/bad.md': '---\nduration: 45\n---\n' });
    const error = await failure(invoke(plan, context(root), {}));
    expect(error).toMatchObject({ code: 'vault_errors', message: '1 problem in your files' });
  });

  it('refuses settings the engine rejects', async () => {
    const root = await vault({ 'sword.yaml': `${settings}day_start: prayer.fajr.start\n` });
    expect(await failure(invoke(plan, context(root), {}))).toMatchObject({ code: 'vault_errors', message: expect.stringContaining('sword.yaml') });
  });
});

describe('apply', () => {
  it('applies the plan that was previewed', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const preview = await invoke(plan, context(root), {});
    const result = await invoke(apply, context(root), { planId: preview.planId });
    expect(result.applied).toEqual({ files: ['tasks/study.md'], skipped: [], logged: [] });
    expect(await readFile(join(root, 'tasks/study.md'), 'utf8')).toContain('planned:\n  - 2026-10-25 05:00\n  - 2026-10-26 05:00\n');
  });

  it('refuses a plan that changed since it was previewed, and writes nothing', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const preview = await invoke(plan, context(root), {});
    // An hour later, today's 05:00 is gone: the plan is different.
    const error = await failure(invoke(apply, context(root, '2026-10-25T03:00:00Z'), { planId: preview.planId }));
    expect(error.code).toBe('stale_plan');
    expect(await readFile(join(root, 'tasks/study.md'), 'utf8')).toBe(study);
  });
});

describe('done and undo_done', () => {
  it('mark and reopen an occurrence, returning what happened', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study, 'tasks/call.md': '---\nduration: 30m\nafter: 09:00\n---\n' });
    expect(await invoke(done, context(root), { task: 'Study Go' })).toEqual({
      occurrenceId: 'study@2026-10-25',
      task: 'study',
      title: 'Study Go',
      date: '2026-10-25',
      state: 'done',
    });
    expect(await invoke(undoDone, context(root), { task: 'study' })).toMatchObject({ occurrenceId: 'study@2026-10-25', state: 'open' });
    expect(await invoke(done, context(root), { task: 'call' })).toMatchObject({ occurrenceId: 'call', task: 'call', title: 'call', date: null });
  });

  it('turn vault refusals into command errors with the right code', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    expect(await failure(invoke(done, context(root), { task: 'nope' }))).toMatchObject({ code: 'not_found', message: 'no task named "nope"' });
    expect(await failure(invoke(done, context(root), { task: 'study', date: 'soon' }))).toMatchObject({ code: 'invalid_input' });
    expect(await failure(invoke(undoDone, context(root), { task: 'study' }))).toMatchObject({ code: 'refused' });
  });

  it('work against any storage that provides the VaultAccess interface', async () => {
    const memory: Vault = {
      root: 'memory:',
      config: { timeZone: 'UTC', plugins: [] },
      tasks: [
        {
          id: 'walk',
          file: 'tasks/walk.md',
          intention: { id: 'walk', duration: '30m', repeat: 'daily', window: { after: '17:00' } },
          pins: [],
          planned: [],
          notes: '',
          source: '',
        },
      ],
      log: [],
      problems: [],
    };
    const logged: LogEntry[] = [];
    const access: VaultAccess = {
      load: async () => memory,
      applyPlan: async () => ({ files: [], skipped: [], logged: [] }),
      appendLog: async (_, entries) => void logged.push(...entries),
    };
    const result = await invoke(done, { vault: access, now: () => '2026-10-25T18:00:00Z' }, { task: 'walk' });
    expect(result.occurrenceId).toBe('walk@2026-10-25');
    // Nothing was applied, so it's done at the time the plan gives it now: the next free slot.
    expect(logged).toEqual([{ at: '2026-10-25T18:00:00Z', occurrenceId: 'walk@2026-10-25', state: 'done', start: '2026-10-25T18:00:00Z', end: '2026-10-25T18:30:00Z' }]);
  });
});

describe('check and export', () => {
  it('check lists problems by file', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study, 'tasks/typo.md': '---\nduration: 30m\nafter: prayer.fajrr\n---\n' });
    const result = await invoke(check, context(root), {});
    expect(result).toEqual({ tasks: 2, problems: [expect.objectContaining({ file: 'tasks/typo.md', level: 'error', message: expect.stringContaining('prayer.fajrr') })] });
  });

  it('export returns the plan as iCalendar', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const result = await invoke(exportIcs, context(root), {});
    expect(result.events).toBe(2);
    expect(result.ics).toContain('SUMMARY:Study Go');
  });
});
