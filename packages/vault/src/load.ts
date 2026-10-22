import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { readConfigFile, readIntentionFile, readLog } from '@sword/schema';
import type { Config, LogEntry } from '@sword/schema';
import type { IntentionInput } from '@sword/engine';
import { VaultError } from './errors.ts';
import { loadPlugins } from './plugins.ts';
import type { LoadedPlugin } from './plugins.ts';

export const CONFIG_FILE = 'sword.yaml';

export interface Task {
  id: string;
  /** Path relative to the vault root, with forward slashes. */
  file: string;
  intention: IntentionInput;
  /** Occurrences moved by hand, as local date-times ("2026-10-26T07:30"). */
  pins: string[];
  /** Where occurrences were placed when a plan was last applied, in the same form. */
  planned: string[];
  notes: string;
  /** The file as read, to notice if it changes before Sword writes to it. */
  source: string;
}

export interface Problem {
  /** Path relative to the vault root; log problems end in ":line". */
  file: string;
  level: 'error' | 'warning';
  message: string;
}

export interface Vault {
  root: string;
  config: Config;
  tasks: Task[];
  /** The latest log entry for each occurrence. */
  log: LogEntry[];
  /** Plugins listed in sword.yaml that loaded. */
  plugins: LoadedPlugin[];
  /** Problems in single files. Those files (or lines) are skipped; the rest is read. */
  problems: Problem[];
}

/**
 * Reads a vault: sword.yaml, tasks/**\/*.md and log/*.jsonl. A broken file
 * never stops the rest from being read; it is reported in `problems`.
 */
export async function loadVault(path: string): Promise<Vault> {
  const root = resolve(path);
  const problems: Problem[] = [];

  let configSource: string;
  try {
    configSource = await readFile(join(root, CONFIG_FILE), 'utf8');
  } catch {
    throw new VaultError(`${root} is not a Sword vault: it has no ${CONFIG_FILE}`, 'not_found');
  }
  const configResult = readConfigFile(configSource);
  problems.push(...configResult.warnings.map((message) => ({ file: CONFIG_FILE, level: 'warning' as const, message })));
  if (!configResult.ok) problems.push(...configResult.errors.map((message) => ({ file: CONFIG_FILE, level: 'error' as const, message })));
  const config: Config = configResult.ok ? configResult.value : { plugins: [], other: {} };
  const plugins = await loadPlugins(root, config, problems);

  const tasks: Task[] = [];
  for (const file of await listFiles(root, 'tasks', '.md')) {
    const id = file.slice(file.lastIndexOf('/') + 1, -'.md'.length);
    const source = await readFile(join(root, file), 'utf8');
    const result = readIntentionFile(source, { id });
    problems.push(...result.warnings.map((message) => ({ file, level: 'warning' as const, message })));
    if (!result.ok) {
      problems.push(...result.errors.map((message) => ({ file, level: 'error' as const, message })));
      continue;
    }
    const { intention, pins, planned, notes } = result.value;
    tasks.push({ id: intention.id, file, intention, pins, planned, notes, source });
  }

  const latest = new Map<string, LogEntry>();
  for (const file of await listFiles(root, 'log', '.jsonl')) {
    const result = readLog(await readFile(join(root, file), 'utf8'));
    for (const error of result.errors) problems.push({ file: `${file}:${error.line}`, level: 'error', message: error.message });
    for (const entry of result.entries) latest.set(entry.occurrenceId, entry);
  }
  const log = [...latest.values()].sort((a, b) => (a.occurrenceId < b.occurrenceId ? -1 : 1));

  return { root, config, tasks, log, plugins, problems };
}

/** The vault containing `path`: the nearest folder upwards with a sword.yaml. */
export async function findVault(path: string): Promise<string | null> {
  let dir = resolve(path);
  for (;;) {
    try {
      await access(join(dir, CONFIG_FILE));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/** Files with an extension under a folder of the vault, skipping hidden ones, sorted. */
async function listFiles(root: string, folder: string, extension: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(root, folder), { recursive: true, withFileTypes: true });
  } catch {
    return []; // the folder doesn't exist yet
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => !file.split('/').some((segment) => segment.startsWith('.')))
    .sort();
}
