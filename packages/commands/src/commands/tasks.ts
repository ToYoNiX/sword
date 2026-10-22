import { z } from 'zod';
import { EngineInputError, schedule } from '@sword/engine';
import { readIntentionFile } from '@sword/schema';
import { PluginError, findTask, scheduleInput, setProperties, taskFile } from '@sword/vault';
import type { PropertyValue, Task, Vault } from '@sword/vault';
import { CommandError, defineCommand } from '../command.ts';

const value = z.union([z.string(), z.number(), z.array(z.string())]);

const PROPERTIES = `A task's properties, as in its file's frontmatter. duration is required ("45m", "1h30m").
Repeating: repeat ("daily", "weekly", "monthly") with repeat_on (["mon", "thu"]), repeat_every (2), repeat_day (15) or repeat_since ("2026-10-26").
One-off: date ("2026-10-26") for a given day, or a deadline ("2026-10-30", "2026-10-30T17:00") to place it on any day before.
When: at ("17:30", "prayer.fajr + 10m") for an exact time; otherwise after and before, each an anchor ("prayer.asr", "work.end"), a time ("09:00"), with an offset ("prayer.fajr + 1h") or fallbacks ("work.start or 08:00"). Give both after and before, or the task may land anywhere later in the day. within: an anchor whose window it must fit inside.
Also: prefer ("earliest", "latest", "packed"), priority (a whole number; higher is placed first), avoid (["tag:focus"]), tags, title.
Anchors come from the settings and plugins; an unknown one is refused with the reason. Times are never set directly: Sword places the task.`;

/** Properties only Sword or the pin scope may change. */
const RESERVED: Record<string, string> = {
  planned: 'planned is written by apply, not set directly',
  pins: 'pins set exact times, which needs the pin scope',
  id: "id can't be changed here; the note name is the task's id",
};

export interface TaskResult {
  /** The task's id (its note name). */
  task: string;
  file: string;
  /** Likely typos among the properties; the task was still saved. */
  warnings: string[];
}

export const createTask = defineCommand({
  name: 'create_task',
  description: `Add a task to the vault as rules, not times: Sword decides where it goes. Preview the result with plan, and save it with apply.`,
  scope: 'write',
  input: z
    .object({
      name: z.string().describe('The note name, which is the task\'s id: "Study Go", "قراءة الكهف". No slashes; not starting with a dot.'),
      properties: z.record(z.string(), value).describe(PROPERTIES),
      notes: z.string().optional().describe('Free-form notes, the body of the note'),
    })
    .strict(),
  async run(ctx, input): Promise<TaskResult> {
    checkName(input.name);
    reserved(Object.keys(input.properties));
    const vault = await ctx.vault.load();
    if (vault.tasks.some((t) => t.id === input.name)) throw new CommandError('refused', `a task named "${input.name}" already exists`);
    const file = `tasks/${input.name}.md`;
    const content = written(() => taskFile(input.properties, input.notes));
    const warnings = validate(vault, input.name, file, content, null, ctx.now());
    try {
      await ctx.vault.createTask(vault, file, content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CommandError('refused', `${file} already exists`);
      throw error;
    }
    return { task: input.name, file, warnings };
  },
});

export const updateTask = defineCommand({
  name: 'update_task',
  description: "Change some of a task's properties; the others, the notes and the note's formatting stay as they were. Sword moves its placements if they no longer fit. Preview with plan, save with apply.",
  scope: 'write',
  input: z
    .object({
      task: z.string().min(1).describe("The task's note name or title"),
      set: z.record(z.string(), value).optional().describe(`Properties to add or change. ${PROPERTIES}`),
      unset: z.array(z.string()).optional().describe('Properties to remove'),
    })
    .strict(),
  async run(ctx, input): Promise<TaskResult & { changed: string[] }> {
    const changed = [...Object.keys(input.set ?? {}), ...(input.unset ?? [])];
    if (changed.length === 0) throw new CommandError('invalid_input', 'nothing to change: give set or unset');
    reserved(changed);
    const vault = await ctx.vault.load();
    const task = findTask(vault, input.task);
    const changes: Record<string, PropertyValue | undefined> = { ...input.set };
    for (const name of input.unset ?? []) changes[name] = undefined;
    const content = written(() => setProperties(task.source, changes));
    const warnings = validate(vault, task.id, task.file, content, task, ctx.now());
    const skipped = await ctx.vault.updateTask(vault, task, content);
    if (skipped !== null) throw new CommandError('refused', `${task.file} was not updated: ${skipped}; try again`);
    return { task: task.id, file: task.file, changed, warnings };
  },
});

export const deleteTask = defineCommand({
  name: 'delete_task',
  description: "Remove a task: its note moves to the vault's .trash folder, as Obsidian does, so it can be restored. Its done and missed history stays in the log.",
  scope: 'write',
  input: z.object({ task: z.string().min(1).describe("The task's note name or title") }).strict(),
  async run(ctx, input): Promise<{ task: string; file: string; trashedTo: string }> {
    const vault = await ctx.vault.load();
    const task = findTask(vault, input.task);
    try {
      return { task: task.id, file: task.file, trashedTo: await ctx.vault.trashTask(vault, task) };
    } catch (error) {
      throw new CommandError('refused', `${task.file} was not deleted: ${(error as Error).message}`);
    }
  },
});

function checkName(name: string): void {
  const problem =
    name.trim() === '' ? 'is empty'
    : /[/\\]/.test(name) ? 'has a slash'
    : name.startsWith('.') ? 'starts with a dot'
    : /\.md$/i.test(name) ? 'ends in .md; leave the extension out'
    : /[\u0000-\u001f]/.test(name) ? 'has a control character'
    : name.length > 200 ? 'is longer than 200 characters'
    : null;
  if (problem !== null) throw new CommandError('invalid_input', `name: "${name}" ${problem}`);
}

function reserved(names: readonly string[]): void {
  const problems = names.flatMap((name) => (RESERVED[name] === undefined ? [] : [RESERVED[name]]));
  if (problems.length > 0) throw new CommandError('invalid_input', problems.join('; '));
}

/** Runs a frontmatter edit, turning its refusals into input errors. */
function written(write: () => string): string {
  try {
    return write();
  } catch (error) {
    throw new CommandError('invalid_input', (error as Error).message);
  }
}

/**
 * Checks a task file before it is written: the properties by the schema, the
 * rules by the engine (unknown anchors, contradictions). Returns warnings.
 */
function validate(vault: Vault, id: string, file: string, content: string, replacing: Task | null, now: string): string[] {
  const result = readIntentionFile(content, { id });
  if (!result.ok) throw new CommandError('invalid_input', result.errors.join('; '));
  const task: Task = { id, file, intention: result.value.intention, pins: result.value.pins, planned: result.value.planned, notes: result.value.notes, source: content };
  const tasks = replacing === null ? [...vault.tasks, task] : vault.tasks.map((t) => (t === replacing ? task : t));
  let errors: string[];
  try {
    const plan = schedule(scheduleInput({ ...vault, tasks }, { now, horizonDays: 1 }));
    errors = plan.errors.filter((e) => e.intentionId === id).map((e) => e.message);
  } catch (error) {
    if (error instanceof EngineInputError) throw new CommandError('vault_errors', `sword.yaml: ${error.message}`);
    if (error instanceof PluginError) throw new CommandError('vault_errors', `plugin ${error.plugin}: ${error.message}`);
    throw error;
  }
  if (errors.length > 0) throw new CommandError('invalid_input', errors.join('; '));
  return result.warnings;
}
