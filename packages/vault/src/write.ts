import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

/** A property value as it goes into frontmatter: text, a number, or a list of text. */
export type PropertyValue = string | number | readonly string[];

/**
 * Sets properties of a task file, changing only their lines: the rest of
 * the note stays byte for byte as it was. `undefined` or an empty list
 * removes a property; a new one goes at the end of the frontmatter. Throws
 * if the file has no frontmatter, or if the edit would change anything else.
 */
export function setProperties(source: string, changes: Readonly<Record<string, PropertyValue | undefined>>): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  let close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (lines[0]?.trim() !== '---' || close < 0) throw new Error('the file has no frontmatter');
  const before = parse(lines.slice(1, close).join('\n')) as Record<string, unknown> | null;

  for (const [name, value] of Object.entries(changes)) {
    const frontmatter = lines.slice(1, close);
    const indent = /^(\s*)- /.exec(frontmatter.find((line) => /^\s*- /.test(line)) ?? '')?.[1] ?? '  ';
    const block = propertyLines(name, value, indent);
    const start = frontmatter.findIndex((line) => line.startsWith(`${name}:`) || new RegExp(`^${escape(name)}\\s+:`).test(line));
    let end = start + 1;
    if (start < 0) {
      lines.splice(close, 0, ...block);
    } else {
      // The property's own lines: indented ones and list items; a blank line or the next property ends it.
      while (end < frontmatter.length && /^(?:\s+\S|-)/.test(frontmatter[end] ?? '')) end++;
      lines.splice(1 + start, end - start, ...block);
    }
    close += block.length - (start < 0 ? 0 : end - start);
  }

  let after: Record<string, unknown> | null;
  try {
    after = parse(lines.slice(1, close).join('\n')) as Record<string, unknown> | null;
  } catch {
    after = null;
  }
  const expected: Record<string, unknown> = { ...before };
  for (const [name, value] of Object.entries(changes)) {
    delete expected[name];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) expected[name] = value;
  }
  if (after === null || !isDeepStrictEqual(after, expected)) {
    throw new Error(`its frontmatter is written in a way Sword can't safely edit; update ${Object.keys(changes).join(' and ')} by hand`);
  }
  return lines.join(eol);
}

/**
 * Sets the `pins` and `planned` lists (local date-times like
 * "2026-10-26T07:30"), written the way Obsidian users write them:
 * "2026-10-26 07:30".
 */
export function setTimes(source: string, changes: { pins?: string[]; planned?: string[] }): string {
  const times: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(changes)) if (list !== undefined) times[name] = list.map((time) => time.replace('T', ' '));
  return setProperties(source, times);
}

/** A new task file: the properties as frontmatter, then the notes. */
export function taskFile(properties: Readonly<Record<string, PropertyValue>>, notes = ''): string {
  const lines = Object.entries(properties).flatMap(([name, value]) => propertyLines(name, value, '  '));
  const body = notes.trim() === '' ? '' : `\n${notes.trim()}\n`;
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function propertyLines(name: string, value: PropertyValue | undefined, indent: string): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number') return [`${name}: ${render(name, value)}`];
  if (value.length === 0) return [];
  return [`${name}:`, ...value.map((item) => `${indent}- ${render(name, item)}`)];
}

/** One value as YAML, quoted only when it would otherwise read differently. */
function render(name: string, value: string | number): string {
  if (typeof value === 'number') return String(value);
  if (/[\r\n]/.test(value)) throw new Error(`${name}: a property value cannot have a line break`);
  // With seconds it looks like a YAML 1.1 timestamp, which some readers would turn into a date.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}:\d{2}/.test(value)) return JSON.stringify(value);
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Writes a file in one step, so a crash never leaves half of it. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
