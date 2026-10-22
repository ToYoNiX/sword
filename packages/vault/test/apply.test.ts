import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schedule } from '@sword/engine';
import type { Plan } from '@sword/engine';
import { VaultError, appendLog, applyPlan, loadVault, markDone, reopen, scheduleInput } from '../src/index.ts';
import type { Vault } from '../src/index.ts';
import { vault } from './helpers.ts';

// Riyadh is UTC+3 all year, so local 05:00 is 02:00Z.
const settings = 'time_zone: Asia/Riyadh\nhorizon_days: 3\n';
const study = '---\nduration: 45m\nrepeat: daily\nafter: 05:00\nbefore: 07:00\n---\n\nChapter 7.\n';

/** UTC instant of a local Riyadh time. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`).toISOString().replace('.000Z', 'Z');

async function planAt(root: string, now: string, horizonDays?: number): Promise<{ v: Vault; plan: Plan }> {
  const v = await loadVault(root);
  expect(v.problems).toEqual([]);
  const plan = schedule(scheduleInput(v, { now, ...(horizonDays !== undefined && { horizonDays }) }));
  expect(plan.errors).toEqual([]);
  return { v, plan };
}

async function applyAt(root: string, now: string, horizonDays?: number) {
  const { v, plan } = await planAt(root, now, horizonDays);
  return { plan, applied: await applyPlan(v, plan, { now }) };
}

const read = (root: string, file: string) => readFile(join(root, file), 'utf8');

describe('applyPlan', () => {
  it('writes where each occurrence was planned into its task file, and nothing else', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const { applied } = await applyAt(root, at('2026-10-25', '03:00'));
    expect(applied).toEqual({ files: ['tasks/study.md'], skipped: [], logged: [] });
    expect(await read(root, 'tasks/study.md')).toBe(
      '---\nduration: 45m\nrepeat: daily\nafter: 05:00\nbefore: 07:00\nplanned:\n  - 2026-10-25 05:00\n  - 2026-10-26 05:00\n  - 2026-10-27 05:00\n---\n\nChapter 7.\n',
    );
  });

  it('has nothing to do the second time: the plan is in the files', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    await applyAt(root, at('2026-10-25', '03:00'));
    const { plan, applied } = await applyAt(root, at('2026-10-25', '03:00'));
    expect(plan.diff).toEqual({ added: [], moved: [], removed: [], missed: [] });
    expect(applied).toEqual({ files: [], skipped: [], logged: [] });
  });

  it('keeps a planned time edited by hand while it still fits the rules', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study.replace('---\n\n', 'planned: 2026-10-25 06:10\n---\n\n') });
    const { plan } = await planAt(root, at('2026-10-25', '03:00'));
    expect(plan.placements[0]).toMatchObject({ occurrenceId: 'study@2026-10-25', start: at('2026-10-25', '06:10'), why: 'unchanged: still satisfies its rules' });
  });

  it('moves a hand-edited time that breaks the rules, and says why', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study.replace('---\n\n', 'planned: 2026-10-25 06:30\n---\n\n') });
    const { plan } = await planAt(root, at('2026-10-25', '03:00'));
    expect(plan.diff.moved).toEqual([expect.objectContaining({ occurrenceId: 'study@2026-10-25', reason: expect.stringContaining('outside its window') })]);
  });

  it('logs what was missed and drops past days from the file', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    await applyAt(root, at('2026-10-25', '03:00'));
    const { applied } = await applyAt(root, at('2026-10-26', '03:00'));
    expect(applied.logged).toEqual([
      { at: at('2026-10-26', '03:00'), occurrenceId: 'study@2026-10-25', state: 'missed', start: at('2026-10-25', '05:00'), end: at('2026-10-25', '05:45') },
    ]);
    expect(await read(root, 'tasks/study.md')).toContain('planned:\n  - 2026-10-26 05:00\n  - 2026-10-27 05:00\n  - 2026-10-28 05:00\n---');
    expect(await read(root, 'log/2026-10.jsonl')).toBe(
      `{"at":"${at('2026-10-26', '03:00')}","occurrence":"study@2026-10-25","state":"missed","start":"${at('2026-10-25', '05:00')}","end":"${at('2026-10-25', '05:45')}"}\n`,
    );
    // Logged once: the next apply has nothing to add.
    expect((await applyAt(root, at('2026-10-26', '04:00'))).applied).toEqual({ files: [], skipped: [], logged: [] });
  });

  it('removes pins from past days and keeps today\'s and later ones', async () => {
    const pins = 'pins:\n  - 2026-10-24 05:30\n  - 2026-10-25 06:00\n  - 2026-11-20 06:00\n';
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study.replace('---\n\n', `${pins}---\n\n`) });
    const { applied } = await applyAt(root, at('2026-10-25', '03:00'));
    const file = await read(root, 'tasks/study.md');
    expect(file).toContain('pins:\n  - 2026-10-25 06:00\n  - 2026-11-20 06:00\n');
    // Pinned occurrences are not repeated in planned.
    expect(file).toContain('planned:\n  - 2026-10-26 05:00\n  - 2026-10-27 05:00\n');
    // Yesterday's pinned occurrence was never marked done.
    expect(applied.logged).toEqual([expect.objectContaining({ occurrenceId: 'study@2026-10-24', state: 'missed', start: at('2026-10-24', '05:30') })]);
  });

  it('leaves planned times beyond the horizon alone', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    await applyAt(root, at('2026-10-25', '03:00'));
    await applyAt(root, at('2026-10-25', '03:00'), 1);
    expect(await read(root, 'tasks/study.md')).toContain('planned:\n  - 2026-10-25 05:00\n  - 2026-10-26 05:00\n  - 2026-10-27 05:00\n');
  });

  it('skips a file that changed after it was read, and still writes the others', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study, 'tasks/walk.md': study.replace('45m', '30m') });
    const { v, plan } = await planAt(root, at('2026-10-25', '03:00'));
    const edited = study.replace('Chapter 7.', 'Chapter 8.');
    await writeFile(join(root, 'tasks/study.md'), edited);
    expect(await applyPlan(v, plan, { now: at('2026-10-25', '03:00') })).toMatchObject({
      files: ['tasks/walk.md'],
      skipped: [{ file: 'tasks/study.md', reason: 'it changed while Sword was planning' }],
    });
    expect(await read(root, 'tasks/study.md')).toBe(edited);
  });

  it('skips a file deleted after it was read', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const { v, plan } = await planAt(root, at('2026-10-25', '03:00'));
    await rename(join(root, 'tasks/study.md'), join(root, 'study.md.bak'));
    expect(await applyPlan(v, plan, { now: at('2026-10-25', '03:00') })).toMatchObject({
      files: [],
      skipped: [{ file: 'tasks/study.md', reason: 'it was deleted while Sword was planning' }],
    });
    expect(await readdir(join(root, 'tasks'))).toEqual([]);
  });

  it.each([
    ['a YAML anchor', 'planned: &times\n  - 2026-10-25 05:00\nlater: *times\n'],
    ['an explicit key', '? planned\n: [2026-10-25 05:00]\n'],
  ])('skips a file whose frontmatter can\'t be edited safely (%s), and says so', async (_, properties) => {
    const source = study.replace('---\n\n', `${properties}---\n\n`);
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': source });
    const { applied } = await applyAt(root, at('2026-10-25', '03:00'));
    expect(applied.skipped).toEqual([{ file: 'tasks/study.md', reason: "its frontmatter is written in a way Sword can't safely edit; update pins and planned by hand" }]);
    expect(await read(root, 'tasks/study.md')).toBe(source);
  });

  it('keeps a task\'s plan when its note is renamed', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    await applyAt(root, at('2026-10-25', '03:00'));
    await rename(join(root, 'tasks/study.md'), join(root, 'tasks/Study Go.md'));
    const { plan } = await planAt(root, at('2026-10-25', '03:00'));
    expect(plan.placements.map((p) => p.occurrenceId)).toEqual(['Study Go@2026-10-25', 'Study Go@2026-10-26', 'Study Go@2026-10-27']);
    expect(plan.diff).toEqual({ added: [], moved: [], removed: [], missed: [] });
  });

  it('stores a time after midnight as the real time, in the right logical day', async () => {
    const root = await vault({
      'sword.yaml': `${settings}day_start: "04:00"\n`,
      'tasks/night.md': '---\nduration: 30m\nrepeat: daily\nafter: 22:00\nbefore: 03:45\nprefer: latest\n---\n',
    });
    await applyAt(root, at('2026-10-25', '12:00'), 1);
    expect(await read(root, 'tasks/night.md')).toContain('planned:\n  - 2026-10-26 03:15\n');
    const { plan } = await planAt(root, at('2026-10-25', '12:00'), 1);
    expect(plan.placements).toEqual([expect.objectContaining({ occurrenceId: 'night@2026-10-25', start: at('2026-10-26', '03:15') })]);
    expect(plan.diff.added).toEqual([]);
  });

  it('drops a done one-off task from its file once its day has passed', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/call.md': '---\nduration: 30m\nafter: 09:00\ndeadline: 2026-10-27\n---\n' });
    await applyAt(root, at('2026-10-25', '03:00'));
    expect(await read(root, 'tasks/call.md')).toContain('planned:\n  - 2026-10-25 09:00\n');
    const { v, plan } = await planAt(root, at('2026-10-25', '10:00'));
    await appendLog(v, [markDone(v, plan, { task: 'call', now: at('2026-10-25', '10:00') })]);
    await applyAt(root, at('2026-10-26', '08:00'));
    expect(await read(root, 'tasks/call.md')).toBe('---\nduration: 30m\nafter: 09:00\ndeadline: 2026-10-27\n---\n');
    const { plan: later } = await planAt(root, at('2026-10-26', '08:00'));
    expect(later.placements).toEqual([expect.objectContaining({ occurrenceId: 'call', state: 'done' })]);
  });
});

describe('markDone and reopen', () => {
  async function applied(now = at('2026-10-25', '03:00')) {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study, 'tasks/gym.md': '---\nduration: 1h\nrepeat: weekly\nrepeat_on: mon\nafter: 17:00\n---\n' });
    await applyAt(root, now);
    return root;
  }

  it('marks today\'s occurrence done at its planned time', async () => {
    const root = await applied();
    const { v, plan } = await planAt(root, at('2026-10-25', '06:00'));
    const entry = markDone(v, plan, { task: 'study', now: at('2026-10-25', '06:00') });
    expect(entry).toEqual({ at: at('2026-10-25', '06:00'), occurrenceId: 'study@2026-10-25', state: 'done', start: at('2026-10-25', '05:00'), end: at('2026-10-25', '05:45') });
    await appendLog(v, [entry]);
    const { plan: after } = await planAt(root, at('2026-10-25', '06:00'));
    expect(after.placements.find((p) => p.occurrenceId === 'study@2026-10-25')?.state).toBe('done');
    expect(after.diff.missed).toEqual([]);
  });

  it('marks another day with a date', async () => {
    const root = await applied();
    const { v, plan } = await planAt(root, at('2026-10-25', '06:00'));
    expect(markDone(v, plan, { task: 'gym', date: '2026-10-26', now: at('2026-10-25', '06:00') })).toMatchObject({ occurrenceId: 'gym@2026-10-26', start: at('2026-10-26', '17:00') });
  });

  it('marks an occurrence that could not be planned as done just now', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const { v, plan } = await planAt(root, at('2026-10-25', '08:00'));
    expect(markDone(v, plan, { task: 'study', now: at('2026-10-25', '08:00') })).toMatchObject({ start: at('2026-10-25', '07:15'), end: at('2026-10-25', '08:00') });
  });

  it.each<[string, { task: string; date?: string }, string, VaultError['code']]>([
    ['an unknown task', { task: 'nope' }, 'no task named "nope"', 'not_found'],
    ['a day the task does not occur on', { task: 'gym' }, 'gym has no occurrence on Sun 25 Oct', 'not_found'],
    ['a date on a one-off task', { task: 'call', date: '2026-10-25' }, 'call is a one-off task; leave out the date', 'invalid_input'],
    ['a date that is not a date', { task: 'study', date: 'tomorrow' }, '"tomorrow" is not a date; use one like 2026-10-25', 'invalid_input'],
    ['a past day with nothing planned', { task: 'study', date: '2026-10-20' }, 'study was not planned on Tue 20 Oct', 'not_found'],
  ])('refuses %s', async (_, request, message, code) => {
    const root = await applied();
    await writeFile(join(root, 'tasks/call.md'), '---\nduration: 30m\nafter: 09:00\n---\n');
    const { v, plan } = await planAt(root, at('2026-10-25', '06:00'));
    expect(() => markDone(v, plan, { ...request, now: at('2026-10-25', '06:00') })).toThrow(new VaultError(message, code));
  });

  it('finds a task by its title too, unless the title is ambiguous', async () => {
    const root = await applied();
    await writeFile(join(root, 'tasks/study.md'), study.replace('duration', 'title: Study Go\nduration'));
    await writeFile(join(root, 'tasks/gym.md'), '---\ntitle: Gym\nduration: 1h\nrepeat: daily\nafter: 17:00\n---\n');
    await writeFile(join(root, 'tasks/gym-2.md'), '---\ntitle: Gym\nduration: 1h\nrepeat: daily\nafter: 19:00\n---\n');
    const { v, plan } = await planAt(root, at('2026-10-25', '06:00'));
    expect(markDone(v, plan, { task: 'Study Go', now: at('2026-10-25', '06:00') }).occurrenceId).toBe('study@2026-10-25');
    expect(() => markDone(v, plan, { task: 'Gym', now: at('2026-10-25', '06:00') })).toThrow(
      new VaultError('"Gym" is the title of 2 tasks; use the note name: gym, gym-2', 'invalid_input'),
    );
  });

  it('refuses to mark the same occurrence done twice', async () => {
    const root = await applied();
    const { v, plan } = await planAt(root, at('2026-10-25', '06:00'));
    await appendLog(v, [markDone(v, plan, { task: 'study', now: at('2026-10-25', '06:00') })]);
    const again = await planAt(root, at('2026-10-25', '06:00'));
    expect(() => markDone(again.v, again.plan, { task: 'study', now: at('2026-10-25', '06:00') })).toThrow('study is already done on Sun 25 Oct');
  });

  it('reopens a mistaken done today; once its time has passed it is missed', async () => {
    const root = await applied();
    const first = await planAt(root, at('2026-10-25', '06:00'));
    await appendLog(first.v, [markDone(first.v, first.plan, { task: 'study', now: at('2026-10-25', '06:00') })]);
    const marked = await planAt(root, at('2026-10-25', '06:01'));
    const entry = reopen(marked.v, marked.plan, { task: 'study', now: at('2026-10-25', '06:01') });
    expect(entry).toEqual({ at: at('2026-10-25', '06:01'), occurrenceId: 'study@2026-10-25', state: 'open' });
    await appendLog(marked.v, [entry]);
    const { plan } = await planAt(root, at('2026-10-25', '06:01'));
    expect(plan.placements.find((p) => p.occurrenceId === 'study@2026-10-25')?.state).toBe('missed');
    expect(plan.diff.missed).toEqual(['study@2026-10-25']);
  });

  it('reopens an occurrence later today back to planned', async () => {
    const root = await applied();
    const first = await planAt(root, at('2026-10-25', '04:00'));
    await appendLog(first.v, [markDone(first.v, first.plan, { task: 'study', now: at('2026-10-25', '04:00') })]);
    const marked = await planAt(root, at('2026-10-25', '04:01'));
    await appendLog(marked.v, [reopen(marked.v, marked.plan, { task: 'study', now: at('2026-10-25', '04:01') })]);
    const { plan } = await planAt(root, at('2026-10-25', '04:01'));
    expect(plan.placements.find((p) => p.occurrenceId === 'study@2026-10-25')).toMatchObject({ state: 'scheduled', start: at('2026-10-25', '05:00') });
  });

  it('refuses to reopen a day other than today', async () => {
    const root = await applied();
    const first = await planAt(root, at('2026-10-25', '06:00'));
    await appendLog(first.v, [markDone(first.v, first.plan, { task: 'study', now: at('2026-10-25', '06:00') })]);
    const next = await planAt(root, at('2026-10-26', '06:00'));
    expect(() => reopen(next.v, next.plan, { task: 'study', date: '2026-10-25', now: at('2026-10-26', '06:00') })).toThrow(
      new VaultError('only today\'s tasks can be undone; study on Sun 25 Oct is history'),
    );
  });

  it('refuses to reopen something that is not done', async () => {
    const root = await applied();
    const { v, plan } = await planAt(root, at('2026-10-25', '04:00'));
    expect(() => reopen(v, plan, { task: 'study', now: at('2026-10-25', '04:00') })).toThrow(new VaultError('study is not marked done on Sun 25 Oct'));
  });
});

describe('appendLog', () => {
  it('writes to the month of the local date, adding a missing final newline', async () => {
    const root = await vault({ 'sword.yaml': settings, 'log/2026-11.jsonl': '{"partial":true}' });
    const v = await loadVault(root);
    // 22:00Z on Oct 31 is already November 1 in Riyadh.
    await appendLog(v, [{ at: '2026-10-31T22:00:00Z', occurrenceId: 'a', state: 'open' }]);
    expect(await read(root, 'log/2026-11.jsonl')).toBe('{"partial":true}\n{"at":"2026-10-31T22:00:00Z","occurrence":"a","state":"open"}\n');
  });

  it('creates the log folder', async () => {
    const root = await vault({ 'sword.yaml': settings });
    const v = await loadVault(root);
    await appendLog(v, [{ at: '2026-10-25T03:00:00Z', occurrenceId: 'a', state: 'done', start: '2026-10-25T02:00:00Z', end: '2026-10-25T02:30:00Z' }]);
    expect(await readdir(join(root, 'log'))).toEqual(['2026-10.jsonl']);
  });

  it('does nothing for no entries', async () => {
    const root = await vault({ 'sword.yaml': settings });
    await appendLog(await loadVault(root), []);
    await expect(readdir(join(root, 'log'))).rejects.toThrow();
  });
});
