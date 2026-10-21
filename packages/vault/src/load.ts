import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Temporal } from 'temporal-polyfill';
import { readConfigFile, readIntentionFile, readLog } from '@sword/schema';
import type { Config, LogEntry } from '@sword/schema';
import type { IntentionInput } from '@sword/engine';
import { VaultError } from './errors.ts';

export const CONFIG_FILE = 'sword.yaml';

export interface Task {
  id: string;
  /** Path relative to the vault root, with forward slashes. */
  file: string;
  intention: IntentionInput;
  /** Occurrences moved by hand: logical date → local time. */
  pins: Record<string, string>;
  notes: string;
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
    throw new VaultError(`${root} is not a Sword vault: it has no ${CONFIG_FILE} (run "sword init" to create one)`);
  }
  const configResult = readConfigFile(configSource);
  problems.push(...configResult.warnings.map((message) => ({ file: CONFIG_FILE, level: 'warning' as const, message })));
  if (!configResult.ok) problems.push(...configResult.errors.map((message) => ({ file: CONFIG_FILE, level: 'error' as const, message })));
  const config: Config = configResult.ok ? configResult.value : { plugins: [] };

  const tasks: Task[] = [];
  for (const file of await listFiles(root, 'tasks', '.md')) {
    const id = file.slice(file.lastIndexOf('/') + 1, -'.md'.length);
    const result = readIntentionFile(await readFile(join(root, file), 'utf8'), { id });
    problems.push(...result.warnings.map((message) => ({ file, level: 'warning' as const, message })));
    if (!result.ok) {
      problems.push(...result.errors.map((message) => ({ file, level: 'error' as const, message })));
      continue;
    }
    const pins = Object.fromEntries(
      Object.entries(result.value.pins).filter(([date]) => {
        if (isRealDate(date)) return true;
        problems.push({ file, level: 'error', message: `pins: ${date} is not a real date` });
        return false;
      }),
    );
    tasks.push({ id: result.value.intention.id, file, intention: result.value.intention, pins, notes: result.value.notes });
  }

  const latest = new Map<string, LogEntry>();
  for (const file of await listFiles(root, 'log', '.jsonl')) {
    const result = readLog(await readFile(join(root, file), 'utf8'));
    for (const error of result.errors) problems.push({ file: `${file}:${error.line}`, level: 'error', message: error.message });
    for (const entry of result.entries) latest.set(entry.occurrenceId, entry);
  }
  const log = [...latest.values()].sort((a, b) => (a.occurrenceId < b.occurrenceId ? -1 : 1));

  return { root, config, tasks, log, problems };
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

function isRealDate(date: string): boolean {
  try {
    Temporal.PlainDate.from(date, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}
