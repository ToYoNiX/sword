import { Temporal } from 'temporal-polyfill';
import { expect } from 'vitest';
import { schedule } from '../src/index.ts';
import type {
  AnchorInput,
  IntentionInput,
  Placement,
  Plan,
  ScheduleInput,
  Unplaced,
  WindowRule,
} from '../src/index.ts';

/** No DST, so wall-clock arithmetic in expectations stays simple. */
export const TZ = 'Asia/Riyadh';

/** A Sunday. */
export const D0 = '2026-10-25';

export function day(n: number, from = D0): string {
  return Temporal.PlainDate.from(from).add({ days: n }).toString();
}

/** Local wall-clock time on a civil date, as an ISO instant. */
export function t(date: string, time: string, tz = TZ): string {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(tz).toInstant().toString();
}

/** ISO instant → local "HH:MM". */
export function hm(iso: string, tz = TZ): string {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: 'minute' });
}

export function addMinutes(time: string, minutes: number): string {
  return Temporal.PlainTime.from(time).add({ minutes }).toString({ smallestUnit: 'minute' });
}

export function anchor(
  id: string,
  date: string,
  start: string,
  end: string = start,
  opts: { busy?: [string, string][]; tags?: string[] } = {},
): AnchorInput {
  return {
    id,
    date,
    start: t(date, start),
    end: t(date, end),
    ...(opts.busy && { busy: opts.busy.map(([s, e]) => ({ start: t(date, s), end: t(date, e) })) }),
    ...(opts.tags && { tags: opts.tags }),
  };
}

export interface PrayerTimes {
  fajr: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

export const PT: PrayerTimes = { fajr: '04:50', dhuhr: '11:50', asr: '15:10', maghrib: '17:35', isha: '19:05' };

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

/**
 * Synthetic prayer anchors: each window runs until the next prayer, and the
 * busy portion is the first `busyMinutes` of the window.
 */
export function prayers(date: string, times: PrayerTimes = PT, busyMinutes = 20): AnchorInput[] {
  return PRAYERS.map((name, i) => {
    const start = times[name];
    const next = PRAYERS[i + 1];
    const end = next ? times[next] : addMinutes(start, 90);
    return anchor(`prayer.${name}`, date, start, end, {
      busy: [[start, addMinutes(start, busyMinutes)]],
      tags: ['prayer'],
    });
  });
}

export function daily(
  id: string,
  duration: string,
  window: WindowRule,
  extra: Partial<IntentionInput> = {},
): IntentionInput {
  return { id, duration, repeat: 'daily', window, ...extra };
}

export function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return { timeZone: TZ, now: t(D0, '00:00'), horizonDays: 1, intentions: [], ...overrides };
}

export function placement(plan: Plan, occurrenceId: string): Placement {
  const found = plan.placements.find((p) => p.occurrenceId === occurrenceId);
  if (!found) {
    throw new Error(
      `no placement for ${occurrenceId}\nunplaced: ${JSON.stringify(plan.unplaced, null, 2)}\nerrors: ${JSON.stringify(plan.errors, null, 2)}`,
    );
  }
  return found;
}

/** "HH:MM-HH:MM" for an occurrence's placement. */
export function slot(plan: Plan, occurrenceId: string): string {
  const p = placement(plan, occurrenceId);
  return `${hm(p.start)}-${hm(p.end)}`;
}

export function unplacedOf(plan: Plan, occurrenceId: string): Unplaced {
  const found = plan.unplaced.find((u) => u.occurrenceId === occurrenceId);
  if (!found) throw new Error(`${occurrenceId} is not unplaced; placements: ${JSON.stringify(plan.placements, null, 2)}`);
  return found;
}

export function hasPlacement(plan: Plan, occurrenceId: string): boolean {
  return plan.placements.some((p) => p.occurrenceId === occurrenceId);
}

/** Schedule again, feeding the previous plan back in as the existing state. */
export function rerun(previousInput: ScheduleInput, plan: Plan, changes: Partial<ScheduleInput> = {}): Plan {
  return schedule({
    ...previousInput,
    existing: plan.placements.map(({ occurrenceId, start, end, state }) => ({ occurrenceId, start, end, state })),
    ...changes,
  });
}

export function expectEmptyDiff(plan: Plan): void {
  expect(plan.diff).toEqual({ added: [], moved: [], removed: [], missed: [] });
}

/**
 * The core negative invariant: apart from reported conflicts, nothing that is
 * scheduled overlaps busy time (events, prayer busy portions) or another task.
 */
export function expectNoOverlaps(plan: Plan, scheduled: ScheduleInput): void {
  const ms = (iso: string) => Date.parse(iso);
  const conflicted = new Set(plan.conflicts.map((c) => c.occurrenceId));
  const active = plan.placements.filter(
    (p) => (p.state === 'scheduled' || p.state === 'pinned') && !conflicted.has(p.occurrenceId),
  );
  const busy = [
    ...(scheduled.events ?? [])
      .filter((e) => e.busy !== false)
      .map((e) => ({ label: `event:${e.id}`, start: ms(e.start), end: ms(e.end) })),
    ...(scheduled.anchors ?? []).flatMap((a) =>
      (a.busy ?? []).map((b) => ({ label: `anchor:${a.id}@${a.date}`, start: ms(b.start), end: ms(b.end) })),
    ),
  ];
  for (const p of active) {
    const start = ms(p.start);
    const end = ms(p.end);
    for (const b of busy) {
      expect(start < b.end && b.start < end, `${p.occurrenceId} (${hm(p.start)}-${hm(p.end)}) overlaps ${b.label}`).toBe(false);
    }
    for (const q of plan.placements) {
      if (q === p || q.state === 'missed') continue;
      const overlap = start < ms(q.end) && ms(q.start) < end;
      expect(overlap, `${p.occurrenceId} overlaps ${q.occurrenceId}`).toBe(false);
    }
  }
}
