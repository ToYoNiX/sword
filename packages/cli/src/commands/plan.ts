import { Temporal } from 'temporal-polyfill';
import { invoke, plan as planVault } from '@sword/commands';
import type { PlanResult } from '@sword/commands';
import type { Placement } from '@sword/engine';
import { formatDate } from '@sword/vault';
import { describeChanges } from '../changes.ts';
import { paint } from '../io.ts';
import type { Io } from '../io.ts';
import { context } from '../vault.ts';

export interface PlanOptions {
  dir: string | undefined;
  days: number | undefined;
  json: boolean;
}

export async function plan(io: Io, options: PlanOptions): Promise<number> {
  const result = await invoke(planVault, await context(io, options.dir), { days: options.days });
  io.out(options.json ? `${JSON.stringify(result.plan, null, 2)}\n` : formatPlan(io, result));
  return 0;
}

function formatPlan(io: Io, { plan, titles, timeZone, now }: PlanResult): string {
  const title = (id: string) => titles[id] ?? id;
  const clock = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).toPlainTime().toString({ smallestUnit: 'minute' });
  const conflicted = new Set(plan.conflicts.map((c) => c.occurrenceId));
  const lines: string[] = [paint(io, 'dim', `${timeZone} · now ${formatDate(Temporal.Instant.from(now).toZonedDateTimeISO(timeZone).toPlainDate().toString())} ${clock(now)}`), ''];

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
  const { added, moved, removed, missed } = plan.diff;
  if (added.length + moved.length + removed.length + missed.length > 0) {
    lines.push(
      paint(io, 'yellow', 'Changes, not applied yet'),
      ...describeChanges(plan, titles, timeZone).map((c) => `  ${c}`),
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
