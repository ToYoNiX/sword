import { Temporal } from 'temporal-polyfill';
import { EngineInputError, schedule } from '@sword/engine';
import type { Placement, Plan } from '@sword/engine';
import { formatDate, scheduleInput } from '@sword/vault';
import type { Vault } from '@sword/vault';
import { describeChanges, hasChanges } from '../changes.ts';
import { CliError, paint } from '../io.ts';
import type { Io } from '../io.ts';
import { openVault } from '../vault.ts';

export interface PlanOptions {
  dir: string | undefined;
  days: number | undefined;
  json: boolean;
}

export async function plan(io: Io, options: PlanOptions): Promise<number> {
  const vault = await openVault(io, options.dir);
  const result = computePlan(io, vault, options.days);
  if (options.json) {
    io.out(`${JSON.stringify(result.plan, null, 2)}\n`);
  } else {
    io.out(formatPlan(io, vault, result.plan, result.timeZone));
  }
  return 0;
}

/** Plans the vault, or explains why it can't. */
export function computePlan(io: Io, vault: Vault, days: number | undefined): { plan: Plan; timeZone: string } {
  const fileErrors = vault.problems.filter((p) => p.level === 'error').length;
  if (fileErrors > 0) throw new CliError(`${fileErrors} ${fileErrors === 1 ? 'problem' : 'problems'} in your files; run "sword check" to see them.`);
  const input = scheduleInput(vault, { now: io.now(), ...(days !== undefined && { horizonDays: days }) });
  let plan: Plan;
  try {
    plan = schedule(input);
  } catch (error) {
    if (error instanceof EngineInputError) throw new CliError(`sword.yaml: ${error.message}`);
    throw error;
  }
  if (plan.errors.length > 0) {
    throw new CliError(`${plan.errors.length} ${plan.errors.length === 1 ? 'task has' : 'tasks have'} errors; run "sword check" to see them.`);
  }
  return { plan, timeZone: input.timeZone };
}

function formatPlan(io: Io, vault: Vault, plan: Plan, timeZone: string): string {
  const titles = new Map(vault.tasks.map((t) => [t.intention.id, t.intention.title ?? t.intention.id]));
  const title = (id: string) => titles.get(id) ?? id;
  const clock = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).toPlainTime().toString({ smallestUnit: 'minute' });
  const conflicted = new Set(plan.conflicts.map((c) => c.occurrenceId));
  const lines: string[] = [paint(io, 'dim', `${timeZone} · now ${formatDate(Temporal.Instant.from(io.now()).toZonedDateTimeISO(timeZone).toPlainDate().toString())} ${clock(io.now())}`), ''];

  const line = (p: Placement) => {
    const marks = [p.state !== 'scheduled' && p.state, conflicted.has(p.occurrenceId) && 'conflict'].filter(Boolean) as string[];
    const mark = marks.length > 0 ? paint(io, p.state === 'missed' || conflicted.has(p.occurrenceId) ? 'red' : 'dim', ` · ${marks.join(' · ')}`) : '';
    return `  ${clock(p.start)}–${clock(p.end)}  ${title(p.intentionId)}${mark}`;
  };

  for (const day of plan.days) {
    const startsAt = clock(day.start);
    lines.push(paint(io, 'bold', `${formatDate(day.date)}${startsAt === '00:00' ? '' : ` (from ${startsAt})`}`));
    const placements = plan.placements.filter((p) => p.date === day.date);
    lines.push(...(placements.length > 0 ? placements.map(line) : [paint(io, 'dim', '  nothing planned')]), '');
  }

  const section = (name: string, style: 'yellow' | 'red' | 'bold', items: string[]) => {
    if (items.length > 0) lines.push(paint(io, style, name), ...items.map((i) => `  ${i}`), '');
  };
  if (hasChanges(plan)) {
    lines.push(
      paint(io, 'yellow', 'Changes, not applied yet'),
      ...describeChanges(vault, plan, timeZone).map((c) => `  ${c}`),
      paint(io, 'dim', 'Run "sword apply" to save them in your task files.'),
      '',
    );
  }
  // Windows that already passed today aren't problems, just the past: one line, not a list.
  const passed = plan.unplaced.filter((u) => u.code === 'window_passed');
  section(
    'Unplaced',
    'yellow',
    plan.unplaced
      .filter((u) => u.code !== 'window_passed')
      .map((u) => `${title(u.intentionId)} (${u.date === null ? 'any day' : formatDate(u.date)}): ${u.message}`),
  );
  section(
    'Conflicts',
    'red',
    plan.conflicts.map((c) => {
      const p = plan.placements.find((x) => x.occurrenceId === c.occurrenceId);
      return `${p ? title(p.intentionId) : c.occurrenceId}${p ? ` (${formatDate(p.date)})` : ''}: ${c.message}`;
    }),
  );
  const shown = new Set(plan.days.map((d) => d.date));
  section(
    'Missed',
    'red',
    plan.placements.filter((p) => p.state === 'missed' && !shown.has(p.date)).map((p) => `${title(p.intentionId)} (${formatDate(p.date)})`),
  );
  section('Inbox', 'bold', plan.inbox.map(title));
  if (passed.length > 0) {
    lines.push(paint(io, 'dim', passed.length === 1 ? '1 occurrence earlier today was not planned: its time had passed.' : `${passed.length} occurrences earlier today were not planned: their time had passed.`));
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
