import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Anchor, Manifest, Plugin } from '@sword/plugin-api';
import type { Config } from '@sword/schema';
import type { Problem } from './load.ts';

/** A plugin that loaded, with its checked settings. */
export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  /** Where it was installed from, as listed in sword.yaml. */
  source: string;
  /** Where it lives in the vault: ".sword/plugins/<name>". */
  folder: string;
  plugin: Plugin;
  settings: unknown;
}

/** A plugin failed while Sword was using it. */
export class PluginError extends Error {
  override name = 'PluginError';
  readonly plugin: string;

  constructor(plugin: string, message: string) {
    super(message);
    this.plugin = plugin;
  }
}

/** Settings of the core; a plugin can't use these as its id. */
const CORE = new Set(['time_zone', 'day_start', 'horizon_days', 'avoid', 'day_parts', 'anchors', 'location', 'plugins', 'caldav', 'day']);
const ID = /^[a-z][a-z0-9_]*$/;

/** The folder a plugin from `source` (a URL or a path) is installed in. */
export function pluginFolder(source: string): string {
  const name = source.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1)?.replace(/\.git$/, '') ?? '';
  return `.sword/plugins/${name}`;
}

/**
 * Loads the plugins listed in sword.yaml from .sword/plugins. A broken one is
 * reported by file and left out; the others still load. Settings that belong
 * to no plugin get a warning.
 */
export async function loadPlugins(root: string, config: Config, problems: Problem[]): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  const folders = new Map<string, string>();
  const tried = new Set<string>();
  for (const source of config.plugins) {
    const folder = pluginFolder(source);
    if (folders.has(folder)) {
      problems.push({ file: 'sword.yaml', level: 'error', message: `plugins: ${source} and ${folders.get(folder)} would both be in ${folder}; a plugin is listed twice` });
      continue;
    }
    folders.set(folder, source);
    if (!(await exists(join(root, folder)))) {
      problems.push({ file: 'sword.yaml', level: 'error', message: `plugin ${source} is not installed; run: sword plugin add ${source}` });
      continue;
    }
    const result = await readPlugin(root, folder);
    if (!result.ok) {
      problems.push({ file: `${folder}/${result.file}`, level: 'error', message: result.message });
      continue;
    }
    const { manifest, plugin } = result;
    tried.add(manifest.id);
    if (loaded.some((p) => p.id === manifest.id)) {
      problems.push({ file: 'sword.yaml', level: 'error', message: `plugins: two plugins have the id "${manifest.id}"` });
      continue;
    }
    const raw = config.other[manifest.id];
    let settings: unknown = raw;
    if (plugin.settings) {
      const checked = plugin.settings(raw);
      if (!checked.ok) {
        problems.push(...checked.errors.map((error) => ({ file: 'sword.yaml', level: 'error' as const, message: `${manifest.id}: ${error}` })));
        continue;
      }
      settings = checked.value;
    }
    loaded.push({ id: manifest.id, name: manifest.name, version: manifest.version, source, folder, plugin, settings });
  }
  for (const key of Object.keys(config.other)) {
    if (!tried.has(key)) problems.push({ file: 'sword.yaml', level: 'warning', message: `unknown setting "${key}"` });
  }
  return loaded;
}

type Read = { ok: true; manifest: Manifest; plugin: Plugin } | { ok: false; file: 'manifest.json' | 'main.js'; message: string };

/** Reads a plugin's manifest.json and loads its main.js, checking both. */
export async function readPlugin(root: string, folder: string): Promise<Read> {
  const manifestFile = join(root, folder, 'manifest.json');
  const text = await readFile(manifestFile, 'utf8').catch(() => null);
  if (text === null) return { ok: false, file: 'manifest.json', message: 'missing; a plugin needs manifest.json at the root of its repository' };
  let manifest: Partial<Manifest>;
  try {
    manifest = JSON.parse(text) as Partial<Manifest>;
  } catch {
    return { ok: false, file: 'manifest.json', message: 'not valid JSON' };
  }
  for (const field of ['id', 'name', 'version'] as const) {
    if (typeof manifest[field] !== 'string' || manifest[field] === '') return { ok: false, file: 'manifest.json', message: `${field}: missing` };
  }
  const id = manifest.id as string;
  if (!ID.test(id)) return { ok: false, file: 'manifest.json', message: `id: "${id}" must be lowercase letters, digits and "_"` };
  if (CORE.has(id)) return { ok: false, file: 'manifest.json', message: `id: "${id}" is a setting of Sword itself` };

  const main = join(root, folder, 'main.js');
  if (!(await exists(main))) return { ok: false, file: 'main.js', message: 'missing; a plugin needs main.js at the root of its repository' };
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(main).href)) as { default?: unknown };
  } catch (error) {
    return { ok: false, file: 'main.js', message: `could not be loaded: ${(error as Error).message}` };
  }
  const plugin = module.default as Partial<Plugin> | undefined;
  if (plugin === null || typeof plugin !== 'object') return { ok: false, file: 'main.js', message: 'needs a default export: the plugin' };
  if (plugin.id !== id) return { ok: false, file: 'main.js', message: `the plugin's id is ${JSON.stringify(plugin.id)}, but manifest.json says "${id}"` };
  for (const part of ['settings', 'anchors'] as const) {
    if (plugin[part] !== undefined && typeof plugin[part] !== 'function') return { ok: false, file: 'main.js', message: `${part} must be a function` };
  }
  return { ok: true, manifest: manifest as Manifest, plugin: plugin as Plugin };
}

/** Every plugin's anchors for these dates, checked to be named after it. */
export function pluginAnchors(plugins: readonly LoadedPlugin[], dates: string[], timeZone: string, config: Config): Anchor[] {
  return plugins.flatMap((loaded) => {
    if (!loaded.plugin.anchors) return [];
    let anchors: Anchor[];
    try {
      anchors = loaded.plugin.anchors({ dates, timeZone, location: config.location, settings: loaded.settings });
    } catch (error) {
      throw new PluginError(loaded.id, (error as Error).message);
    }
    if (!Array.isArray(anchors)) throw new PluginError(loaded.id, 'anchors must return a list');
    for (const anchor of anchors) {
      if (typeof anchor?.id !== 'string' || !anchor.id.startsWith(`${loaded.id}.`)) {
        throw new PluginError(loaded.id, `anchor ${JSON.stringify(anchor?.id)} must be named "${loaded.id}.<name>"`);
      }
    }
    return anchors;
  });
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
