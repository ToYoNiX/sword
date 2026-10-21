import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CONFIG_FILE } from '@sword/vault';
import { CliError } from '../io.ts';
import type { Io } from '../io.ts';

export async function init(io: Io, positionals: string[]): Promise<number> {
  const dir = resolve(io.cwd, positionals[0] ?? '.');
  if (await exists(join(dir, CONFIG_FILE))) throw new CliError(`${dir} is already a Sword vault (it has a ${CONFIG_FILE}).`);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  await mkdir(join(dir, 'tasks'), { recursive: true });
  await writeFile(join(dir, CONFIG_FILE), settings(timeZone));
  await writeFile(join(dir, 'tasks', 'plan-the-day.md'), EXAMPLE_TASK);
  if (!(await exists(join(dir, '.gitignore')))) await writeFile(join(dir, '.gitignore'), '.sword/\n');

  io.out(`Created a Sword vault in ${dir}\n  ${CONFIG_FILE}\n  tasks/plan-the-day.md\n\nNext: sword plan${positionals[0] ? ` --dir ${positionals[0]}` : ''}\n`);
  return 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const settings = (timeZone: string) => `# Sword settings: https://github.com/ToYoNiX/sword/blob/main/docs/design.md
time_zone: ${timeZone}
horizon_days: 7

# When your day starts; midnight by default.
# day_start: "05:00"

# Anchors at fixed times that tasks can refer to, e.g. "before: work.start".
anchors:
  work: { start: "09:00", end: "17:00", on: [mon, tue, wed, thu, fri], busy: true }

# Change, add, or remove (null) the built-in day parts: morning, afternoon, evening, night.
# day_parts:
#   morning: { start: "07:00", end: "12:00" }
`;

const EXAMPLE_TASK = `---
title: Plan the day
duration: 15m
repeat: daily
before: work.start or 10:00
prefer: latest
---

An example task; edit or delete it. Every Markdown file in tasks/ is a task,
and its file name is its name. The properties above work in Obsidian too.
`;
