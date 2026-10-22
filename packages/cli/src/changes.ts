import { Temporal } from 'temporal-polyfill';
import type { Plan } from '@sword/engine';
import { formatDate } from '@sword/vault';

/** What a plan changes compared with the task files, one line each. */
export function describeChanges(plan: Plan, titles: Record<string, string>, timeZone: string): string[] {
  const byId = new Map(plan.placements.map((p) => [p.occurrenceId, p]));
  const local = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone);
  const clock = (iso: string) => local(iso).toPlainTime().toString({ smallestUnit: 'minute' });
  const name = (occurrenceId: string, start: string) => {
    const placement = byId.get(occurrenceId);
    const intentionId = placement?.intentionId ?? (occurrenceId.includes('@') ? occurrenceId.slice(0, occurrenceId.lastIndexOf('@')) : occurrenceId);
    return `${titles[intentionId] ?? intentionId} (${formatDate(placement?.date ?? local(start).toPlainDate().toString())})`;
  };

  const { added, moved, removed, missed } = plan.diff;
  return [
    ...(added.length > 0 ? [`${added.length} new`] : []),
    ...moved.map((m) => `${name(m.occurrenceId, m.from.start)}: ${clock(m.from.start)} → ${clock(m.to.start)}, because ${m.reason}`),
    ...removed.map((r) => `${name(r.occurrenceId, r.start)}: removed, because ${r.reason}`),
    ...missed.map((id) => `${name(id, byId.get(id)?.start ?? '')}: missed`),
  ];
}
