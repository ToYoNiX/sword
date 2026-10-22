import { describe, expect, it } from 'vitest';
import { fileVault } from '@sword/vault';
import { CommandError, check, invoke, plan } from '../src/index.ts';
import type { Context } from '../src/index.ts';
import { vault } from './helpers.ts';

const manifest = JSON.stringify({ id: 'demo', name: 'Demo', version: '0.2.0' });
const plugin = (body: string) => `export default { id: 'demo', anchors({ dates }) { ${body} } };`;
const context = (root: string): Context => ({ vault: fileVault(root), now: () => '2026-10-25T00:00:00Z' });
const installed = (main: string) =>
  vault({ 'sword.yaml': 'time_zone: UTC\nplugins:\n  - https://example.com/demo\n', '.sword/plugins/demo/manifest.json': manifest, '.sword/plugins/demo/main.js': main });

describe('plugins in commands', () => {
  it('check lists the plugins that loaded', async () => {
    const root = await installed(plugin("return dates.map((date) => ({ id: 'demo.noon', date, start: date + 'T12:00:00Z' }));"));
    expect(await invoke(check, context(root), {})).toEqual({ tasks: 0, plugins: [{ id: 'demo', version: '0.2.0' }], problems: [] });
  });

  it('check reports a plugin that fails while planning, against its file', async () => {
    const root = await installed(plugin("throw new Error('no location set');"));
    expect((await invoke(check, context(root), {})).problems).toEqual([{ file: '.sword/plugins/demo/main.js', level: 'error', message: 'demo: no location set' }]);
  });

  it('plan refuses with the plugin named when it fails', async () => {
    const root = await installed(plugin("throw new Error('no location set');"));
    const error = await invoke(plan, context(root), {}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({ code: 'vault_errors', message: 'plugin demo: no location set' });
  });
});
