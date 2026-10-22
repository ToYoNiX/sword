/**
 * The scheduler (docs/design.md §6). Pure and deterministic: the same input
 * always gives the same plan, and nothing outside the input is read.
 *
 * Order of work:
 *  1. Settle occurrences from history: done, missed, or already started.
 *  2. Place pins, then formulas (`at`). These never move; overlaps are
 *     reported as conflicts.
 *  3. Fitted occurrences, one priority level at a time, highest first:
 *     keep the level's existing placements that are still valid (stability),
 *     then place the rest of the level, longer tasks first. A higher priority
 *     always wins; within a priority, what is placed stays.
 */
import { buildAnchorIndex } from './anchors.ts';
import type { AnchorIndex } from './anchors.ts';
import { addDayParts, readDayParts } from './day-parts.ts';
import { addFixedAnchors, readFixedAnchors } from './fixed-anchors.ts';
import type { DayPart } from './day-parts.ts';
import { LogicalDays } from './day.ts';
import { formatDuration } from './duration.ts';
import { EngineInputError, ParseError } from './errors.ts';
import { buildEvents } from './events.ts';
import { parseTimeExpr } from './expr.ts';
import { compileIntentions } from './intentions.ts';
import type { Intention } from './intentions.ts';
import { overlaps, subtract } from './interval.ts';
import { occursOn } from './recurrence.ts';
import type { Interval } from './interval.ts';
import { parseSelector } from './selectors.ts';
import type { Selector } from './selectors.ts';
import { addDays, assertTimeZone, formatClock, localDateTimeMs, parseInstant, toIso } from './time.ts';
import type {
  Conflict,
  DayInfo,
  Diff,
  ExistingPlacement,
  Issue,
  Move,
  OccurrenceRef,
  Pin,
  Placement,
  PlacementKind,
  PlacementState,
  Plan,
  Removal,
  ScheduleInput,
  Unplaced,
  UnplacedCode,
} from './types.ts';

const MINUTE = 60_000;
const MAX_HORIZON_DAYS = 366;
const STATES = new Set<unknown>(['scheduled', 'pinned', 'done', 'missed']);
/** Which record of an occurrence wins: what happened, then a pin, then a plain scheduled time. */
const RANK: Record<PlacementState, number> = { done: 2, missed: 2, pinned: 1, scheduled: 0 };

export function schedule(input: ScheduleInput): Plan {
  return new Planner(input).run();
}

interface Occurrence {
  readonly id: string;
  readonly intention: Intention;
  /** Null for a one-off that can go on any day. */
  readonly date: string | null;
}

/** Something that takes up time, or that a task may choose to avoid. */
interface Item {
  readonly ref: string;
  readonly label: string;
  readonly interval: Interval;
  readonly tags: readonly string[];
  readonly kind: 'event' | 'anchor' | 'task';
  /** Event id, anchor id or intention id, for selectors. */
  readonly id: string;
  /** Busy items block every task; others only block tasks that avoid them. */
  readonly busy: boolean;
  readonly occurrenceId?: string;
}

interface Stored {
  readonly occurrenceId: string;
  readonly start: number;
  readonly end: number;
  readonly state: PlacementState;
}

type Region =
  | { readonly kind: 'ok'; readonly lo: number; readonly hi: number }
  | { readonly kind: 'fail'; readonly code: UnplacedCode; readonly message: string };

type Slot =
  /** `gap` is the length of the free gap the slot was taken from (for best fit). */
  | { readonly kind: 'ok'; readonly start: number; readonly gap: number; readonly why: string }
  | { readonly kind: 'fail'; readonly code: UnplacedCode; readonly message: string; readonly blockers: string[] };

class Planner {
  private readonly errors: Issue[] = [];
  private readonly warnings: Issue[] = [];
  private readonly timeZone: string;
  private readonly now: number;
  private readonly anchors: AnchorIndex;
  private readonly days: LogicalDays;
  private readonly globalAvoid: readonly Selector[];
  private readonly intentions: Map<string, Intention>;
  private readonly invalidIds: ReadonlySet<string>;
  private readonly dates: readonly string[];
  private readonly dateSet: ReadonlySet<string>;
  private readonly dayParts: readonly DayPart[];
  private readonly existing: Map<string, Stored>;
  private readonly pins: Map<string, number>;

  /** Events and anchors. */
  private readonly items: Item[] = [];
  /** Placed tasks that occupy time. */
  private readonly tasks: Item[] = [];
  private readonly placements = new Map<string, Placement>();
  private readonly intervals = new Map<string, Interval>();
  private readonly unplaced = new Map<string, Unplaced>();
  private readonly conflicts: Conflict[] = [];
  private readonly inbox: string[] = [];
  private readonly missed: string[] = [];
  private readonly moveReasons = new Map<string, string>();
  /** Placements that cannot move (pins, formulas, in progress); checked for conflicts. */
  private readonly fixed: Occurrence[] = [];

  constructor(input: ScheduleInput) {
    if (input === null || typeof input !== 'object') throw new EngineInputError('input must be an object');
    assertTimeZone(input.timeZone);
    this.timeZone = input.timeZone;
    this.now = fatal('now', () => parseInstant(input.now));
    if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > MAX_HORIZON_DAYS) {
      throw new EngineInputError(`horizonDays must be a whole number from 1 to ${MAX_HORIZON_DAYS}`);
    }
    if (!Array.isArray(input.intentions)) throw new EngineInputError('intentions must be a list');

    this.anchors = buildAnchorIndex(input.anchors ?? [], this.warnings);
    const dayStart = fatal('dayStart', () => parseTimeExpr(input.dayStart ?? '00:00'));
    if (dayStart.kind === 'anchor' && !this.anchors.ids.has(dayStart.anchor)) {
      throw new EngineInputError(`dayStart refers to unknown anchor "${dayStart.anchor}"`);
    }
    this.days = new LogicalDays(this.timeZone, dayStart, this.anchors, this.warnings);

    this.globalAvoid = (input.avoid ?? []).map((text) => fatal('avoid', () => parseSelector(text)));
    for (const selector of this.globalAvoid) {
      if (selector.type === 'anchor' && !this.anchors.ids.has(selector.value)) {
        throw new EngineInputError(`avoid refers to unknown anchor "${selector.value}"`);
      }
    }

    const today = this.days.dateOf(this.now);
    this.dates = Array.from({ length: input.horizonDays }, (_, i) => addDays(today, i));
    this.dateSet = new Set(this.dates);
    this.dayParts = readDayParts(input.dayParts, this.anchors);
    const fixed = readFixedAnchors(input.fixedAnchors, this.anchors, this.dayParts);
    addDayParts(this.dayParts, this.dates, this.days, this.anchors, this.timeZone);
    addFixedAnchors(fixed, this.dates, this.anchors, this.timeZone);

    const compiled = compileIntentions(input.intentions, this.anchors, this.errors);
    this.intentions = compiled.valid;
    this.invalidIds = compiled.invalidIds;

    for (const event of buildEvents(input.events ?? [], this.warnings)) {
      this.items.push({ ref: `event:${event.id}`, label: event.title, interval: event.interval, tags: event.tags, kind: 'event', id: event.id, busy: event.busy });
    }
    for (const anchor of this.anchors.all()) {
      const base = { ref: `anchor:${anchor.id}@${anchor.date}`, label: anchor.id, tags: anchor.tags, kind: 'anchor' as const, id: anchor.id };
      if (anchor.busy.length === 0) this.items.push({ ...base, interval: anchor.window, busy: false });
      for (const interval of anchor.busy) this.items.push({ ...base, interval, busy: true });
    }

    this.existing = this.readExisting(input.existing ?? []);
    this.pins = this.readPins(input.pins ?? []);
  }

  run(): Plan {
    const occurrences = this.generate();
    const known = new Set(occurrences.map((o) => o.id));
    this.warnAboutUnknownPins(known);

    const open = occurrences.filter((occurrence) => !this.settleFromHistory(occurrence));
    this.settleBeforeHorizon(known);
    for (const occurrence of open) {
      const pin = this.pins.get(occurrence.id);
      if (pin !== undefined) this.placePinned(occurrence, pin);
    }
    for (const occurrence of open) {
      if (occurrence.intention.at && !this.placements.has(occurrence.id)) this.placeFormula(occurrence);
    }
    this.findConflicts();

    // A higher priority always wins; within the same priority, what is already
    // placed stays. So each priority level is done in full before the next:
    // first its placements that are still valid, then everything else in it.
    const fitted = open.filter((o) => !o.intention.at && !this.placements.has(o.id)).sort((a, b) => this.compare(a, b));
    for (const level of byPriority(fitted)) this.placeLevel(level);

    return this.result(known);
  }

  // ── occurrences ──────────────────────────────────────────────────────────

  private generate(): Occurrence[] {
    const occurrences: Occurrence[] = [];
    const intentions = [...this.intentions.values()].sort((a, b) => compareText(a.id, b.id));
    for (const intention of intentions) {
      if (intention.recurrence) {
        const deadline = this.deadlineMs(intention);
        for (const date of this.dates) {
          if (!occursOn(intention.recurrence, date)) continue;
          if (this.days.start(date) >= deadline) continue;
          occurrences.push({ id: `${intention.id}@${date}`, intention, date });
        }
      } else if (isInbox(intention)) {
        this.inbox.push(intention.id);
      } else {
        occurrences.push({ id: intention.id, intention, date: intention.date });
      }
    }
    return occurrences;
  }

  /** Done, missed and in-progress occurrences are final. Returns true if settled. */
  private settleFromHistory(occurrence: Occurrence): boolean {
    const stored = this.existing.get(occurrence.id);
    if (stored === undefined) return false;
    const kind = this.kindOf(occurrence);
    if (stored.state === 'done') {
      this.place(occurrence, stored, kind, 'done', 'completed', stored.end > this.now);
      return true;
    }
    if (stored.state === 'missed' || stored.end <= this.now) {
      if (stored.state !== 'missed') this.missed.push(occurrence.id);
      this.place(occurrence, stored, kind, 'missed', 'its time passed without completion', false);
      return true;
    }
    if (stored.start <= this.now) {
      // Only the future is re-planned; something that already started stays.
      this.place(occurrence, stored, kind, stored.state, 'already started');
      this.fixed.push(occurrence);
      return true;
    }
    return false;
  }

  /**
   * Stored placements from days before the horizon have no occurrence this
   * run, but are never dropped silently: done and missed stay as history, and
   * unfinished ones become missed.
   */
  private settleBeforeHorizon(known: ReadonlySet<string>): void {
    const firstDate = this.dates[0] as string;
    for (const stored of this.existing.values()) {
      if (known.has(stored.occurrenceId)) continue;
      const intention = this.intentions.get(intentionIdOf(stored.occurrenceId));
      if (!intention) continue;
      const date = this.days.dateOf(stored.start);
      if (date >= firstDate) continue;
      this.settleFromHistory({ id: stored.occurrenceId, intention, date });
    }
  }

  // ── fixed placements ─────────────────────────────────────────────────────

  private placePinned(occurrence: Occurrence, start: number): void {
    const interval = { start, end: start + occurrence.intention.minutes * MINUTE };
    this.place(occurrence, interval, 'pinned', 'pinned', 'pinned by you');
    this.fixed.push(occurrence);
  }

  private placeFormula(occurrence: Occurrence): void {
    const { intention } = occurrence;
    const date = occurrence.date as string;
    if (!this.dateSet.has(date)) {
      if (date < (this.dates[0] as string)) this.fail(occurrence, date, 'window_passed', `${date} has already passed`);
      return;
    }
    const at = intention.at;
    if (at === null) return;
    const resolved = this.days.resolveRule(at, 'at', date);
    if (!resolved.ok) {
      this.fail(occurrence, date, 'missing_anchor', missingMessage(resolved.missing, date));
      return;
    }
    const interval = { start: resolved.ms, end: resolved.ms + intention.minutes * MINUTE };
    if (interval.end <= this.now) {
      this.fail(occurrence, date, 'window_passed', `its time (${this.clock(interval.start)}) has already passed`);
      return;
    }
    this.place(occurrence, interval, 'formula', 'scheduled', `at ${at.source}: ${this.clock(interval.start)}`);
    this.fixed.push(occurrence);
  }

  private findConflicts(): void {
    for (const occurrence of this.fixed) {
      const interval = this.intervals.get(occurrence.id) as Interval;
      const hits = this.blockers(occurrence).filter((item) => overlaps(item.interval, interval));
      if (hits.length === 0) continue;
      this.conflicts.push({ occurrenceId: occurrence.id, with: refs(hits), message: `overlaps ${this.describe(hits)}` });
    }
  }

  // ── fitted placements ────────────────────────────────────────────────────

  /**
   * Places one priority level: first the placements still valid where they
   * are, then the rest. If something then doesn't fit, the free time may just
   * be cut into gaps too small for it, so the level is placed again from
   * scratch, and that is kept only if more of it fits (docs/design.md §6.4).
   */
  private placeLevel(level: readonly Occurrence[]): void {
    const before = this.snapshot();
    const reasons = new Map<string, string>();
    const retry: Occurrence[] = [];
    for (const occurrence of level) {
      const stored = this.existing.get(occurrence.id);
      if (stored === undefined) {
        retry.push(occurrence);
        continue;
      }
      const invalid = this.invalidity(occurrence, stored);
      if (invalid === null) {
        this.place(occurrence, stored, 'fitted', 'scheduled', 'unchanged: still satisfies its rules');
      } else {
        reasons.set(occurrence.id, invalid);
        retry.push(occurrence);
      }
    }
    for (const occurrence of retry) this.placeFitted(occurrence);
    const unplaced = (ids: ReadonlySet<string>) => level.filter((o) => ids.has(o.id));
    const stable = unplaced(new Set(this.unplaced.keys()));
    if (!stable.some((o) => this.unplaced.get(o.id)?.code === 'no_slot')) {
      for (const [id, reason] of reasons) this.moveReasons.set(id, reason);
      return;
    }

    const kept = this.snapshot();
    this.restore(before);
    for (const occurrence of level) this.placeFitted(occurrence);
    const repacked = unplaced(new Set(this.unplaced.keys()));
    if (repacked.length >= stable.length) {
      this.restore(kept);
      for (const [id, reason] of reasons) this.moveReasons.set(id, reason);
      return;
    }
    const madeRoomFor = stable.filter((o) => !repacked.includes(o)).map((o) => o.intention.title);
    for (const occurrence of level) {
      const reason = reasons.get(occurrence.id) ?? `moved to make room for ${madeRoomFor.join(', ')}`;
      this.moveReasons.set(occurrence.id, reason);
    }
  }

  private snapshot() {
    return {
      placements: new Map(this.placements),
      intervals: new Map(this.intervals),
      unplaced: new Map(this.unplaced),
      tasks: this.tasks.length,
    };
  }

  private restore(state: ReturnType<Planner['snapshot']>): void {
    for (const [target, source] of [
      [this.placements, state.placements],
      [this.intervals, state.intervals],
      [this.unplaced, state.unplaced],
    ] as [Map<string, unknown>, Map<string, unknown>][]) {
      target.clear();
      for (const [key, value] of source) target.set(key, value);
    }
    this.tasks.length = state.tasks;
  }

  /** Higher priority, then longer, then earlier deadline, then earlier date, then id. */
  private compare(a: Occurrence, b: Occurrence): number {
    return (
      b.intention.priority - a.intention.priority ||
      b.intention.minutes - a.intention.minutes ||
      compareNumber(this.deadlineMs(a.intention), this.deadlineMs(b.intention)) ||
      compareText(a.date ?? '~', b.date ?? '~') ||
      compareText(a.id, b.id)
    );
  }

  /** Why a stored placement can no longer stay where it is, or null if it can. */
  private invalidity(occurrence: Occurrence, stored: Interval): string | null {
    const { intention } = occurrence;
    if (stored.end - stored.start !== intention.minutes * MINUTE) {
      return `its duration changed to ${formatDuration(intention.minutes)}`;
    }
    const date = occurrence.date ?? this.days.dateOf(stored.start);
    if (!this.dateSet.has(date)) return 'it is outside the scheduling horizon';
    const region = this.region(intention, date);
    if (region.kind === 'fail') return region.message;
    if (stored.start < region.lo || stored.end > region.hi) {
      return `it is outside its window (${this.clock(region.lo)}–${this.clock(region.hi)})`;
    }
    const hits = this.blockers(occurrence).filter((item) => overlaps(item.interval, stored));
    return hits.length > 0 ? `it overlaps ${this.describe(hits)}` : null;
  }

  private placeFitted(occurrence: Occurrence): void {
    const { intention } = occurrence;
    if (occurrence.date !== null) {
      const date = occurrence.date;
      if (!this.dateSet.has(date)) {
        if (date < (this.dates[0] as string)) this.fail(occurrence, date, 'window_passed', `${date} has already passed`);
        return;
      }
      const region = this.region(intention, date);
      if (region.kind === 'fail') return this.fail(occurrence, date, region.code, region.message);
      const slot = this.findSlot(occurrence, region.lo, region.hi);
      if (slot.kind === 'ok') return this.placeAt(occurrence, slot);
      return this.fail(occurrence, date, slot.code, slot.message, slot.blockers);
    }

    // A one-off without a date: try each day up to the deadline.
    const deadline = this.deadlineMs(intention);
    if (deadline <= this.now) {
      return this.fail(occurrence, null, 'deadline_passed', `its deadline (${intention.deadlineText}) has passed`);
    }
    const dates = intention.prefer === 'latest' ? [...this.dates].reverse() : this.dates;
    let firstFailure: Region | null = null;
    let triedAnyDay = false;
    let best: Extract<Slot, { kind: 'ok' }> | null = null;
    for (const date of dates) {
      if (this.days.start(date) >= deadline) continue;
      const region = this.region(intention, date);
      if (region.kind === 'fail') {
        firstFailure ??= region;
        continue;
      }
      triedAnyDay = true;
      const slot = this.findSlot(occurrence, region.lo, region.hi);
      if (slot.kind !== 'ok') continue;
      // Earliest or latest: the first day that fits wins. Packed: the smallest gap on any day.
      if (intention.prefer !== 'packed') return this.placeAt(occurrence, slot);
      if (best === null || slot.gap < best.gap) best = slot;
    }
    if (best !== null) return this.placeAt(occurrence, best);
    if (!triedAnyDay && firstFailure?.kind === 'fail') return this.fail(occurrence, null, firstFailure.code, firstFailure.message);
    const scope = intention.deadline ? `before its deadline (${intention.deadlineText})` : `in the next ${this.dates.length} days`;
    return this.fail(occurrence, null, 'no_slot', `no free ${formatDuration(intention.minutes)} slot ${scope}`);
  }

  /** The interval an occurrence must fit in on a logical day. */
  private region(intention: Intention, date: string): Region {
    let missing: readonly string[] = [];
    const bound = (rule: Intention['after'], role: 'after' | 'before'): number | null => {
      if (rule === null || missing.length > 0) return null;
      const resolved = this.days.resolveRule(rule, role, date);
      if (resolved.ok) return resolved.ms;
      missing = resolved.missing;
      return null;
    };
    let within: Interval | null = null;
    if (intention.within !== null) {
      const anchor = intention.within.map((id) => this.anchors.get(id, date)).find((a) => a !== undefined);
      if (anchor) within = anchor.window;
      else missing = intention.within;
    }
    const after = bound(intention.after, 'after');
    const before = bound(intention.before, 'before');
    if (missing.length > 0) return { kind: 'fail', code: 'missing_anchor', message: missingMessage(missing, date) };

    let lo = within?.start ?? this.days.start(date);
    let hi = within?.end ?? this.days.end(date);
    if (after !== null) lo = within ? Math.max(lo, after) : after;
    if (before !== null) hi = within ? Math.min(hi, before) : before;
    hi = Math.min(hi, this.deadlineMs(intention));
    if (lo >= hi) {
      return { kind: 'fail', code: 'window_empty', message: `its window is empty: ${this.clock(lo)} is not before ${this.clock(hi)}` };
    }
    return { kind: 'ok', lo, hi };
  }

  private findSlot(occurrence: Occurrence, lo: number, hi: number): Slot {
    const { intention } = occurrence;
    const length = intention.minutes * MINUTE;
    // Work starts on a whole minute, so a window with less than a minute left has passed too.
    const earliest = Math.ceil(this.now / MINUTE) * MINUTE;
    if (hi <= earliest) {
      return { kind: 'fail', code: 'window_passed', message: `its window ended at ${this.clock(hi)}`, blockers: [] };
    }
    const span = { start: Math.max(lo, earliest), end: hi };
    const hits = this.blockers(occurrence).filter((item) => overlaps(item.interval, span));
    const free = subtract(span, hits.map((item) => item.interval)).filter((gap) => gap.end - gap.start >= length);
    const last = free.at(-1);
    const first = free[0];
    if (first === undefined || last === undefined) {
      const blockedBy = hits.length > 0 ? `; blocked by ${this.describe(hits)}` : '';
      return {
        kind: 'fail',
        code: 'no_slot',
        message: `no free ${formatDuration(intention.minutes)} slot between ${this.clock(span.start)} and ${this.clock(hi)}${blockedBy}`,
        blockers: refs(hits),
      };
    }
    const between = `between ${this.clock(lo)} and ${this.clock(hi)}`;
    if (intention.prefer === 'latest') {
      return { kind: 'ok', start: last.end - length, gap: last.end - last.start, why: `latest free slot ${between}` };
    }
    if (intention.prefer === 'packed') {
      const smallest = free.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a));
      return { kind: 'ok', start: smallest.start, gap: smallest.end - smallest.start, why: `smallest free gap that fits ${between}` };
    }
    return { kind: 'ok', start: first.start, gap: first.end - first.start, why: `earliest free slot ${between}` };
  }

  private placeAt(occurrence: Occurrence, slot: { start: number; why: string }): void {
    const interval = { start: slot.start, end: slot.start + occurrence.intention.minutes * MINUTE };
    this.place(occurrence, interval, 'fitted', 'scheduled', slot.why);
  }

  // ── shared helpers ───────────────────────────────────────────────────────

  /** Everything this occurrence must not overlap. */
  private blockers(occurrence: Occurrence): Item[] {
    const avoid = [...occurrence.intention.avoid, ...this.globalAvoid];
    return [...this.items, ...this.tasks].filter(
      (item) => item.occurrenceId !== occurrence.id && (item.busy || avoid.some((selector) => matches(selector, item))),
    );
  }

  private place(
    occurrence: Occurrence,
    interval: Interval,
    kind: PlacementKind,
    state: PlacementState,
    why: string,
    occupies = true,
  ): void {
    const { intention } = occurrence;
    this.intervals.set(occurrence.id, { start: interval.start, end: interval.end });
    this.placements.set(occurrence.id, {
      occurrenceId: occurrence.id,
      intentionId: intention.id,
      date: occurrence.date ?? this.days.dateOf(interval.start),
      start: toIso(interval.start),
      end: toIso(interval.end),
      kind,
      state,
      why,
    });
    if (occupies) {
      this.tasks.push({
        ref: `task:${occurrence.id}`,
        label: intention.title,
        interval,
        tags: intention.tags,
        kind: 'task',
        id: intention.id,
        busy: true,
        occurrenceId: occurrence.id,
      });
    }
  }

  private fail(occurrence: Occurrence, date: string | null, code: UnplacedCode, message: string, blockers: string[] = []): void {
    this.unplaced.set(occurrence.id, { occurrenceId: occurrence.id, intentionId: occurrence.intention.id, date, code, message, blockers });
  }

  private kindOf(occurrence: Occurrence): PlacementKind {
    if (this.pins.has(occurrence.id)) return 'pinned';
    return occurrence.intention.at ? 'formula' : 'fitted';
  }

  private deadlineMs(intention: Intention): number {
    const { deadline } = intention;
    if (deadline === null) return Number.POSITIVE_INFINITY;
    if (deadline.kind === 'date') return this.days.end(deadline.date);
    if (deadline.kind === 'local') return localDateTimeMs(deadline.dateTime, this.timeZone);
    return deadline.ms;
  }

  private clock(ms: number): string {
    return formatClock(ms, this.timeZone);
  }

  private describe(items: readonly Item[]): string {
    return [...items]
      .sort((a, b) => a.interval.start - b.interval.start || compareText(a.ref, b.ref))
      .map((item) => `${item.label} (${this.clock(item.interval.start)}–${this.clock(item.interval.end)})`)
      .join(', ');
  }

  // ── input ────────────────────────────────────────────────────────────────

  private readExisting(inputs: readonly ExistingPlacement[]): Map<string, Stored> {
    const stored = new Map<string, Stored>();
    for (const raw of inputs) {
      let entry: Stored;
      try {
        if (!STATES.has(raw.state)) throw new ParseError(`unknown state ${JSON.stringify(raw.state)}`);
        const start = parseInstant(raw.start);
        entry = { occurrenceId: this.occurrenceOf(raw, start), start, end: parseInstant(raw.end), state: raw.state };
        if (entry.end <= entry.start) throw new ParseError('it ends before it starts');
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        this.warnings.push({ code: 'invalid_existing', message: `ignored existing placement: ${error.message}`, occurrenceId: refOf(raw) });
        continue;
      }
      const previous = stored.get(entry.occurrenceId);
      if (previous) {
        const rank = RANK[entry.state] - RANK[previous.state];
        if (rank < 0) continue;
        if (rank === 0) {
          this.warnings.push({ code: 'duplicate_existing', message: 'more than one existing placement; keeping the earliest', occurrenceId: entry.occurrenceId });
          if (previous.start <= entry.start) continue;
        }
      }
      stored.set(entry.occurrenceId, entry);
    }
    return stored;
  }

  private readPins(inputs: readonly Pin[]): Map<string, number> {
    const pins = new Map<string, number>();
    for (const raw of inputs) {
      let start: number;
      let occurrenceId: string;
      try {
        start = parseInstant(raw.start);
        occurrenceId = this.occurrenceOf(raw, start);
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        this.warnings.push({ code: 'invalid_pin', message: `ignored pin: ${error.message}`, occurrenceId: refOf(raw) });
        continue;
      }
      const previous = pins.get(occurrenceId);
      if (previous !== undefined) {
        this.warnings.push({ code: 'duplicate_pin', message: 'pinned more than once; keeping the earliest', occurrenceId });
        if (previous <= start) continue;
      }
      pins.set(occurrenceId, start);
    }
    return pins;
  }

  /** The occurrence a pin or stored placement refers to, by id or by task and time. */
  private occurrenceOf(raw: OccurrenceRef, start: number): string {
    const { occurrenceId, intentionId } = raw as { occurrenceId?: unknown; intentionId?: unknown };
    if (occurrenceId !== undefined && intentionId !== undefined) throw new ParseError('give an occurrenceId or an intentionId, not both');
    if (typeof occurrenceId === 'string' && occurrenceId !== '') return occurrenceId;
    if (typeof intentionId !== 'string' || intentionId === '') throw new ParseError('it has no occurrenceId or intentionId');
    return this.intentions.get(intentionId)?.recurrence ? `${intentionId}@${this.days.dateOf(start)}` : intentionId;
  }

  private warnAboutUnknownPins(known: ReadonlySet<string>): void {
    for (const occurrenceId of this.pins.keys()) {
      if (known.has(occurrenceId)) continue;
      const intentionId = intentionIdOf(occurrenceId);
      if (this.invalidIds.has(intentionId)) continue; // its errors are reported already
      if (this.intentions.has(intentionId)) {
        // A pin beyond the plan waits for its day; one inside it has nothing to move.
        const date = occurrenceId.slice(intentionId.length + 1);
        if (this.dateSet.has(date)) {
          this.warnings.push({ code: 'unknown_occurrence', message: `pinned on ${date}, when ${intentionId} does not occur`, occurrenceId, intentionId });
        }
        continue;
      }
      this.warnings.push({ code: 'unknown_occurrence', message: `pin for unknown intention "${intentionId}"`, occurrenceId });
    }
  }

  // ── output ───────────────────────────────────────────────────────────────

  private result(known: ReadonlySet<string>): Plan {
    const placements = [...this.placements.values()].sort(
      (a, b) => compareNumber(Date.parse(a.start), Date.parse(b.start)) || compareText(a.occurrenceId, b.occurrenceId),
    );
    return {
      days: this.dates.map((date) => this.dayInfo(date)),
      placements,
      unplaced: [...this.unplaced.values()].sort((a, b) => compareText(a.date ?? '~', b.date ?? '~') || compareText(a.occurrenceId, b.occurrenceId)),
      conflicts: [...this.conflicts].sort((a, b) => compareText(a.occurrenceId, b.occurrenceId)),
      inbox: [...this.inbox].sort(compareText),
      diff: this.diff(placements, known),
      errors: sortIssues(this.errors),
      warnings: sortIssues(this.warnings),
    };
  }

  private dayInfo(date: string): DayInfo {
    const parts = this.dayParts.flatMap((part) => {
      const anchor = this.anchors.get(part.name, date);
      return anchor ? [{ name: part.name, start: toIso(anchor.window.start), end: toIso(anchor.window.end) }] : [];
    });
    return { date, start: toIso(this.days.start(date)), end: toIso(this.days.end(date)), parts };
  }

  private diff(placements: readonly Placement[], known: ReadonlySet<string>): Diff {
    const added: string[] = [];
    const moved: Move[] = [];
    for (const placement of placements) {
      if (placement.state !== 'scheduled' && placement.state !== 'pinned') continue;
      const stored = this.existing.get(placement.occurrenceId);
      const interval = this.intervals.get(placement.occurrenceId) as Interval;
      if (stored === undefined) {
        added.push(placement.occurrenceId);
      } else if (stored.start !== interval.start || stored.end !== interval.end) {
        moved.push({
          occurrenceId: placement.occurrenceId,
          from: { start: toIso(stored.start), end: toIso(stored.end) },
          to: { start: placement.start, end: placement.end },
          reason: this.moveReasons.get(placement.occurrenceId) ?? defaultMoveReason(placement.kind),
        });
      }
    }

    const removed: Removal[] = [];
    for (const stored of this.existing.values()) {
      if (stored.state !== 'scheduled' && stored.state !== 'pinned') continue;
      if (stored.end <= this.now || this.placements.has(stored.occurrenceId)) continue;
      const intentionId = intentionIdOf(stored.occurrenceId);
      if (this.invalidIds.has(intentionId)) continue; // fix the errors first; don't wipe the calendar
      const outsideHorizon = !this.dateSet.has(this.days.dateOf(stored.start)) && !known.has(stored.occurrenceId);
      if (this.intentions.has(intentionId) && outsideHorizon) continue;
      removed.push({
        occurrenceId: stored.occurrenceId,
        start: toIso(stored.start),
        end: toIso(stored.end),
        reason: this.unplaced.get(stored.occurrenceId)?.message ?? 'its intention or occurrence no longer exists',
      });
    }

    return {
      added: added.sort(compareText),
      moved: moved.sort((a, b) => compareText(a.occurrenceId, b.occurrenceId)),
      removed: removed.sort((a, b) => compareText(a.occurrenceId, b.occurrenceId)),
      missed: [...this.missed].sort(compareText),
    };
  }
}

function fatal<T>(what: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ParseError) throw new EngineInputError(`invalid ${what}: ${error.message}`);
    throw error;
  }
}

function missingMessage(missing: readonly string[], date: string): string {
  if (missing.length === 1) return `anchor "${missing[0]}" is not available on ${date}`;
  return `none of ${missing.map((m) => `"${m}"`).join(', ')} is available on ${date}`;
}

function isInbox(intention: Intention): boolean {
  return (
    intention.at === null &&
    intention.after === null &&
    intention.before === null &&
    intention.within === null &&
    intention.deadline === null &&
    intention.date === null
  );
}

function matches(selector: Selector, item: Item): boolean {
  switch (selector.type) {
    case 'tag':
      return item.tags.includes(selector.value);
    case 'anchor':
    case 'event':
    case 'task':
      return item.kind === selector.type && item.id === selector.value;
  }
}

function refs(items: readonly Item[]): string[] {
  return [...new Set(items.map((item) => item.ref))].sort(compareText);
}

/** Occurrences already sorted by priority, split into one list per priority. */
function byPriority(occurrences: readonly Occurrence[]): Occurrence[][] {
  const levels: Occurrence[][] = [];
  for (const occurrence of occurrences) {
    const level = levels.at(-1);
    if (level && level[0]?.intention.priority === occurrence.intention.priority) level.push(occurrence);
    else levels.push([occurrence]);
  }
  return levels;
}

function refOf(raw: unknown): string {
  const { occurrenceId, intentionId } = (raw ?? {}) as { occurrenceId?: unknown; intentionId?: unknown };
  return String(occurrenceId ?? intentionId);
}

function intentionIdOf(occurrenceId: string): string {
  const at = occurrenceId.lastIndexOf('@');
  return at < 0 ? occurrenceId : occurrenceId.slice(0, at);
}

function defaultMoveReason(kind: PlacementKind): string {
  if (kind === 'formula') return 'its anchor moved';
  if (kind === 'pinned') return 'it was pinned to a new time';
  return 'its rules changed';
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      compareText(a.intentionId ?? '', b.intentionId ?? '') ||
      compareText(a.occurrenceId ?? '', b.occurrenceId ?? '') ||
      compareText(a.code, b.code) ||
      compareText(a.message, b.message),
  );
}
