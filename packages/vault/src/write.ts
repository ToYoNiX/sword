import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

/**
 * Sets the `pins` and `planned` lists of a task file (local date-times like
 * "2026-10-26T07:30"), changing only those lines: the rest of the note stays
 * byte for byte as it was. An empty list removes the property. Throws if the
 * file has no frontmatter, or if the edit would change anything else.
 */
export function setTimes(source: string, changes: { pins?: string[]; planned?: string[] }): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  let close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (lines[0]?.trim() !== '---' || close < 0) throw new Error('the file has no frontmatter');
  const before = parse(lines.slice(1, close).join('\n')) as Record<string, unknown> | null;

  for (const [name, times] of Object.entries(changes)) {
    if (times === undefined) continue;
    const frontmatter = lines.slice(1, close);
    const indent = /^(\s*)- /.exec(frontmatter.find((line) => /^\s*- /.test(line)) ?? '')?.[1] ?? '  ';
    const block = times.length === 0 ? [] : [`${name}:`, ...times.map((time) => `${indent}- ${render(time)}`)];
    const start = frontmatter.findIndex((line) => line.startsWith(`${name}:`) || new RegExp(`^${name}\\s+:`).test(line));
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
  for (const [name, times] of Object.entries(changes)) {
    if (times === undefined) continue;
    delete expected[name];
    if (times.length > 0) expected[name] = times.map((time) => time.replace('T', ' '));
  }
  if (after === null || !isDeepStrictEqual(after, expected)) {
    throw new Error(`its frontmatter is written in a way Sword can't safely edit; update ${Object.keys(changes).join(' and ')} by hand`);
  }
  return lines.join(eol);
}

/** "2026-10-26T07:30" as "2026-10-26 07:30", the way Obsidian users write it; quoted with seconds. */
function render(time: string): string {
  const text = time.replace('T', ' ');
  // With seconds it looks like a YAML 1.1 timestamp, which some readers would turn into a date.
  return text.length > 16 ? `"${text}"` : text;
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
