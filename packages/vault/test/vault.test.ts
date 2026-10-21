import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { schedule } from '@sword/engine';
import { VaultError, findVault, loadVault, scheduleInput } from '../src/index.ts';

const dirs: string[] = [];

/** A temporary vault with the given files (path → content). */
async function vault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sword-vault-'));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const config = `time_zone: Africa/Cairo
anchors:
  work: { start: "09:00", end: "17:00", on: [sun, mon, tue, wed, thu], busy: true }
`;

const study = `---
title: Study Go
duration: 45m
repeat: daily
window:
  before: work.start or 08:00
prefer: latest
pins:
  2026-10-26: "06:30"
---

Chapter 7.
`;

const done = (occurrence: string, start: string, end: string) =>
  JSON.stringify({ at: '2026-10-25T10:00:00Z', occurrence, state: 'done', start, end });

describe('loadVault', () => {
  it('reads the settings, every task (in subfolders too) and the log', async () => {
    const root = await vault({
      'sword.yaml': config,
      'tasks/study-go.md': study,
      'tasks/errands/buy-milk.md': '---\nduration: 15m\n---\n',
      'log/2026-10.jsonl': `${done('study-go@2026-10-25', '2026-10-25T04:00:00Z', '2026-10-25T04:45:00Z')}\n`,
    });
    const v = await loadVault(root);
    expect(v.problems).toEqual([]);
    expect(v.config.timeZone).toBe('Africa/Cairo');
    expect(v.tasks.map((t) => [t.id, t.file])).toEqual([
      ['buy-milk', 'tasks/errands/buy-milk.md'],
      ['study-go', 'tasks/study-go.md'],
    ]);
    expect(v.tasks[1]).toMatchObject({ notes: 'Chapter 7.\n', pins: { '2026-10-26': '06:30' } });
    expect(v.log).toEqual([expect.objectContaining({ occurrenceId: 'study-go@2026-10-25', state: 'done' })]);
  });

  it('works without tasks/ and log/ folders', async () => {
    const v = await loadVault(await vault({ 'sword.yaml': '' }));
    expect(v).toMatchObject({ tasks: [], log: [], problems: [] });
  });

  it('ignores files that are not tasks, and hidden folders', async () => {
    const v = await loadVault(
      await vault({
        'sword.yaml': '',
        'tasks/readme.txt': 'not a task',
        'tasks/.trash/old.md': '---\nduration: 15m\n---\n',
        '.sword/index.db': '',
      }),
    );
    expect(v.tasks).toEqual([]);
  });

  it('reports a bad file by path and still reads the rest', async () => {
    const v = await loadVault(
      await vault({
        'sword.yaml': '',
        'tasks/good.md': '---\nduration: 15m\n---\n',
        'tasks/bad.md': '---\nduration: 45\n---\n',
        'tasks/odd.md': '---\nduration: 15m\ncssclasses: [x]\n---\n',
      }),
    );
    expect(v.tasks.map((t) => t.id)).toEqual(['good', 'odd']);
    expect(v.problems).toEqual([
      expect.objectContaining({ file: 'tasks/bad.md', level: 'error', message: expect.stringContaining('duration') }),
      expect.objectContaining({ file: 'tasks/odd.md', level: 'warning', message: 'unknown field "cssclasses"' }),
    ]);
  });

  it('drops a pin on a date that does not exist, with an error', async () => {
    const v = await loadVault(
      await vault({ 'sword.yaml': '', 'tasks/x.md': '---\nduration: 15m\nrepeat: daily\npins:\n  2026-02-30: "07:00"\n  2026-03-01: "07:00"\n---\n' }),
    );
    expect(v.tasks[0]?.pins).toEqual({ '2026-03-01': '07:00' });
    expect(v.problems).toEqual([expect.objectContaining({ file: 'tasks/x.md', level: 'error', message: expect.stringContaining('2026-02-30') })]);
  });

  it('reports bad settings', async () => {
    const v = await loadVault(await vault({ 'sword.yaml': 'horizon_days: week\n' }));
    expect(v.problems).toEqual([expect.objectContaining({ file: 'sword.yaml', level: 'error' })]);
  });

  it('reports bad log lines by file and line, and the last line per occurrence wins', async () => {
    const v = await loadVault(
      await vault({
        'sword.yaml': '',
        'log/2026-09.jsonl': `${done('a@2026-09-30', '2026-09-30T04:00:00Z', '2026-09-30T04:30:00Z')}\n`,
        'log/2026-10.jsonl': [
          'garbage',
          JSON.stringify({ at: '2026-10-01T10:00:00Z', occurrence: 'a@2026-09-30', state: 'missed', start: '2026-09-30T04:00:00Z', end: '2026-09-30T04:30:00Z' }),
        ].join('\n'),
      }),
    );
    expect(v.problems).toEqual([expect.objectContaining({ file: 'log/2026-10.jsonl:1', level: 'error' })]);
    expect(v.log).toEqual([expect.objectContaining({ occurrenceId: 'a@2026-09-30', state: 'missed' })]);
  });

  it('refuses a folder without sword.yaml', async () => {
    await expect(loadVault(await vault({ 'tasks/a.md': '---\nduration: 15m\n---\n' }))).rejects.toThrow(VaultError);
  });
});

describe('findVault', () => {
  it('finds the vault from a folder inside it, like git', async () => {
    const root = await vault({ 'sword.yaml': '', 'tasks/errands/x.md': '---\nduration: 15m\n---\n' });
    expect(await findVault(join(root, 'tasks', 'errands'))).toBe(root);
  });

  it('returns null outside any vault', async () => {
    expect(await findVault(await vault({ 'notes.md': '' }))).toBeNull();
  });
});

describe('scheduleInput', () => {
  it('turns the vault into engine input that schedules', async () => {
    const v = await loadVault(
      await vault({
        'sword.yaml': config,
        'tasks/study-go.md': study,
        'log/2026-10.jsonl': `${done('study-go@2026-10-25', '2026-10-25T04:00:00Z', '2026-10-25T04:45:00Z')}\n`,
      }),
    );
    // Sunday Oct 25, 2026, 00:00 in Cairo (still summer time, UTC+3).
    const input = scheduleInput(v, { now: '2026-10-24T21:00:00Z', horizonDays: 3 });
    expect(input).toMatchObject({ timeZone: 'Africa/Cairo', horizonDays: 3, fixedAnchors: { work: { busy: true } } });
    expect(input.pins).toEqual([{ occurrenceId: 'study-go@2026-10-26', start: '2026-10-26T03:30:00Z' }]);

    const plan = schedule(input);
    expect(plan.errors).toEqual([]);
    const byId = Object.fromEntries(plan.placements.map((p) => [p.occurrenceId, p]));
    expect(byId['study-go@2026-10-25']).toMatchObject({ state: 'done' });
    expect(byId['study-go@2026-10-26']).toMatchObject({ state: 'pinned', start: '2026-10-26T03:30:00Z' });
    expect(byId['study-go@2026-10-27']).toMatchObject({ state: 'scheduled', end: '2026-10-27T06:00:00Z' });
  });

  it('pins a one-off task by its id', async () => {
    const v = await loadVault(
      await vault({ 'sword.yaml': 'time_zone: UTC\n', 'tasks/call.md': '---\nduration: 30m\ndeadline: 2026-10-30\npins:\n  2026-10-27: "10:00"\n---\n' }),
    );
    expect(scheduleInput(v, { now: '2026-10-25T00:00:00Z' }).pins).toEqual([{ occurrenceId: 'call', start: '2026-10-27T10:00:00Z' }]);
  });

  it("uses the settings' horizon, then a week", async () => {
    const withHorizon = await loadVault(await vault({ 'sword.yaml': 'time_zone: UTC\nhorizon_days: 14\n' }));
    const without = await loadVault(await vault({ 'sword.yaml': 'time_zone: UTC\n' }));
    expect(scheduleInput(withHorizon, { now: '2026-10-25T00:00:00Z' }).horizonDays).toBe(14);
    expect(scheduleInput(without, { now: '2026-10-25T00:00:00Z' }).horizonDays).toBe(7);
  });
});
