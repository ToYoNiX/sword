import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schedule } from '@sword/engine';
import { PluginError, VaultError, installPlugin, loadVault, scheduleInput } from '../src/index.ts';
import { vault } from './helpers.ts';

const manifest = (id = 'demo') => JSON.stringify({ id, name: 'Demo', version: '0.1.0' });

/** A plugin that puts demo.noon at 12:00 for `minutes` (from its settings, default 10) on every date. */
const demo = `
export default {
  id: 'demo',
  settings(raw) {
    if (raw === undefined) return { ok: true, value: { minutes: 10 } };
    if (typeof raw?.minutes !== 'number') return { ok: false, errors: ['minutes: must be a number'] };
    return { ok: true, value: raw };
  },
  anchors({ dates, timeZone, location, settings }) {
    if (timeZone !== 'UTC') throw new Error('expected UTC');
    return dates.map((date) => ({
      id: 'demo.noon',
      date,
      start: date + 'T12:00:00Z',
      end: date + 'T13:00:00Z',
      busy: [{ start: date + 'T12:00:00Z', end: new Date(Date.parse(date + 'T12:00:00Z') + settings.minutes * 60000).toISOString() }],
      tags: [location ? 'located' : 'nowhere'],
    }));
  },
};
`;

/** A git repository for a plugin, as `sword plugin add` would find it. */
async function repo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sword-plugin-'));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plugin');
  return dir;
}

/** A vault with the demo plugin installed in .sword/plugins/demo. */
const installed = (settings: string, plugin: Record<string, string> = { 'manifest.json': manifest(), 'main.js': demo }) =>
  vault({
    'sword.yaml': `time_zone: UTC\nplugins:\n  - https://example.com/demo\n${settings}`,
    ...Object.fromEntries(Object.entries(plugin).map(([name, content]) => [`.sword/plugins/demo/${name}`, content])),
  });

describe('loading plugins', () => {
  it('loads an installed plugin with its settings, and plans with its anchors', async () => {
    const v = await loadVault(await installed('demo:\n  minutes: 30\n'));
    expect(v.problems).toEqual([]);
    expect(v.plugins.map((p) => [p.id, p.version, p.folder, p.settings])).toEqual([['demo', '0.1.0', '.sword/plugins/demo', { minutes: 30 }]]);
    const input = scheduleInput(v, { now: '2026-10-25T00:00:00Z', horizonDays: 2 });
    expect(input.anchors?.map((a) => a.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(input.anchors?.[1]?.busy).toEqual([{ start: '2026-10-25T12:00:00Z', end: '2026-10-25T12:30:00.000Z' }]);
  });

  it('lets tasks use its anchors', async () => {
    const root = await installed('');
    await writeFile(join(root, 'sword.yaml'), 'time_zone: UTC\nlocation: { latitude: 30, longitude: 31 }\nplugins:\n  - https://example.com/demo\n');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'tasks'));
    await writeFile(join(root, 'tasks/lunch walk.md'), '---\nduration: 20m\nrepeat: daily\nafter: demo.noon\n---\n');
    const v = await loadVault(root);
    const input = scheduleInput(v, { now: '2026-10-25T00:00:00Z', horizonDays: 1 });
    expect(input.anchors?.[0]?.tags).toEqual(['located']);
    const plan = schedule(input);
    expect(plan.placements).toEqual([expect.objectContaining({ occurrenceId: 'lunch walk@2026-10-25', start: '2026-10-25T12:10:00Z' })]);
  });

  it('reports a plugin that is listed but not installed, with how to install it', async () => {
    const v = await loadVault(await vault({ 'sword.yaml': 'plugins:\n  - https://github.com/ToYoNiX/sword-prayer\n' }));
    expect(v.problems).toEqual([
      { file: 'sword.yaml', level: 'error', message: 'plugin https://github.com/ToYoNiX/sword-prayer is not installed; run: sword plugin add https://github.com/ToYoNiX/sword-prayer' },
    ]);
  });

  it.each<[string, Record<string, string>, string, string]>([
    ['no manifest', { 'main.js': demo }, 'manifest.json', 'missing'],
    ['a manifest that is not JSON', { 'manifest.json': '{', 'main.js': demo }, 'manifest.json', 'not valid JSON'],
    ['a manifest without a version', { 'manifest.json': '{"id":"demo","name":"Demo"}', 'main.js': demo }, 'manifest.json', 'version'],
    ['an id with capitals', { 'manifest.json': manifest('Demo'), 'main.js': demo }, 'manifest.json', 'id'],
    ['an id that is a core setting', { 'manifest.json': manifest('location'), 'main.js': demo.replace("id: 'demo'", "id: 'location'") }, 'manifest.json', 'location'],
    ['no main.js', { 'manifest.json': manifest() }, 'main.js', 'missing'],
    ['a main.js that throws', { 'manifest.json': manifest(), 'main.js': 'throw new Error("boom")' }, 'main.js', 'boom'],
    ['a main.js with a syntax error', { 'manifest.json': manifest(), 'main.js': 'export default {' }, 'main.js', 'could not be loaded'],
    ['no default export', { 'manifest.json': manifest(), 'main.js': 'export const x = 1;' }, 'main.js', 'default export'],
    ['an id that differs from the manifest', { 'manifest.json': manifest(), 'main.js': demo.replace("id: 'demo'", "id: 'other'") }, 'main.js', '"other"'],
    ['anchors that is not a function', { 'manifest.json': manifest(), 'main.js': "export default { id: 'demo', anchors: [] }" }, 'main.js', 'anchors'],
  ])('reports %s, by file, and plans without it', async (_, files, file, message) => {
    const v = await loadVault(await installed('', files));
    expect(v.plugins).toEqual([]);
    expect(v.problems).toEqual([{ file: `.sword/plugins/demo/${file}`, level: 'error', message: expect.stringContaining(message) }]);
  });

  it('reports settings the plugin rejects, under its id in sword.yaml', async () => {
    const v = await loadVault(await installed('demo:\n  minutes: soon\n'));
    expect(v.problems).toEqual([{ file: 'sword.yaml', level: 'error', message: 'demo: minutes: must be a number' }]);
  });

  it('warns about a setting that belongs to no plugin', async () => {
    const v = await loadVault(await installed('day_strat: "05:00"\n'));
    expect(v.problems).toEqual([{ file: 'sword.yaml', level: 'warning', message: 'unknown setting "day_strat"' }]);
  });

  it('refuses two plugins with the same id', async () => {
    const root = await installed('');
    await writeFile(join(root, 'sword.yaml'), 'time_zone: UTC\nplugins:\n  - https://example.com/demo\n  - https://example.org/demo.git\n');
    const v = await loadVault(root);
    expect(v.problems).toEqual([expect.objectContaining({ file: 'sword.yaml', message: expect.stringContaining('listed twice') })]);
  });

  it('turns a plugin that fails while planning into a PluginError naming it', async () => {
    const v = await loadVault(await installed(''));
    const broken = { ...v, config: { ...v.config, timeZone: 'Africa/Cairo' } };
    expect(() => scheduleInput(broken, { now: '2026-10-25T00:00:00Z' })).toThrow(new PluginError('demo', 'expected UTC'));
  });

  it('refuses anchors not named after the plugin', async () => {
    const v = await loadVault(await installed('', { 'manifest.json': manifest(), 'main.js': demo.replace("id: 'demo.noon'", "id: 'work'") }));
    expect(() => scheduleInput(v, { now: '2026-10-25T00:00:00Z' })).toThrow('anchor "work" must be named "demo.<name>"');
  });
});

describe('installPlugin', () => {
  it('clones the repository into .sword/plugins, checks it, and lists it in sword.yaml', async () => {
    const source = await repo({ 'manifest.json': manifest(), 'main.js': demo, 'README.md': '# Demo' });
    const root = await vault({ 'sword.yaml': '# My settings\ntime_zone: UTC   # here\n' });
    expect(await installPlugin(root, source)).toEqual({ id: 'demo', name: 'Demo', version: '0.1.0', folder: `.sword/plugins/${source.split('/').at(-1)}` });
    expect(await readFile(join(root, 'sword.yaml'), 'utf8')).toBe(`# My settings\ntime_zone: UTC   # here\nplugins:\n  - ${source}\n`);
    const v = await loadVault(root);
    expect(v.problems).toEqual([]);
    expect(v.plugins.map((p) => p.id)).toEqual(['demo']);
  });

  it('adds to an existing list of plugins', async () => {
    const source = await repo({ 'manifest.json': manifest(), 'main.js': demo });
    const root = await vault({ 'sword.yaml': 'plugins:\n  - https://example.com/other\n' });
    await installPlugin(root, source);
    expect(await readFile(join(root, 'sword.yaml'), 'utf8')).toBe(`plugins:\n  - https://example.com/other\n  - ${source}\n`);
  });

  it('removes the clone and says why when the plugin is not valid', async () => {
    const source = await repo({ 'manifest.json': manifest(), 'README.md': 'no main.js' });
    const root = await vault({ 'sword.yaml': 'time_zone: UTC\n' });
    await expect(installPlugin(root, source)).rejects.toThrow(new VaultError('main.js: missing; a plugin needs main.js at the root of its repository', 'invalid_input'));
    await expect(access(join(root, '.sword/plugins', source.split('/').at(-1)!))).rejects.toThrow();
    expect(await readFile(join(root, 'sword.yaml'), 'utf8')).toBe('time_zone: UTC\n');
  });

  it('reports a repository that cannot be cloned', async () => {
    const root = await vault({ 'sword.yaml': '' });
    await expect(installPlugin(root, join(tmpdir(), 'no-such-repo-anywhere'))).rejects.toThrow('could not clone');
  });

  it('refuses a plugin that is installed already', async () => {
    const source = await repo({ 'manifest.json': manifest(), 'main.js': demo });
    const root = await vault({ 'sword.yaml': '' });
    await installPlugin(root, source);
    await expect(installPlugin(root, source)).rejects.toThrow('already installed');
  });
});
