/**
 * Public input and output types of the engine. All instants are ISO strings
 * with an offset (e.g. "2026-10-25T05:15:00Z"); all dates are "YYYY-MM-DD"
 * logical days (see docs/design.md §4.2).
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Where to put a task among the slots that fit. `packed` takes the smallest
 * gap that fits (best fit), which keeps big gaps free for big tasks.
 */
export type Preference = 'earliest' | 'latest' | 'packed';

/**
 * "daily", or a pick from a small menu:
 *  - `{ on: [mon, wed] }`: weekly on those days
 *  - `{ every: "2 days", since }`
 *  - `{ every: "2 weeks", on: [mon], since }`
 *  - `{ every: "3 months", onDay: 15, since }` (31 means the month's last day)
 * `since` is the first possible date, and is required when counting every N > 1.
 */
export type Repeat = 'daily' | RepeatRule;

export interface RepeatRule {
  /** "day", "week", "month", or with a count: "2 days", "3 months". Defaults to "week". */
  every?: string;
  on?: Weekday[];
  onDay?: number;
  since?: string;
}

/** An anchor at fixed times, e.g. work hours. An end before the start is on the next day. */
export interface FixedAnchorInput {
  start: string;
  end: string;
  /** Weekdays it exists on; every day if left out. */
  on?: Weekday[];
  /** Whether it occupies your time. Defaults to false. */
  busy?: boolean;
  tags?: string[];
}

/** A named part of every day, e.g. afternoon. Times are "HH:MM", "day.start" or "day.end". */
export interface DayPartInput {
  start: string;
  end: string;
}

export interface TimeRange {
  start: string;
  end: string;
}

/** One anchor on one civil date, as resolved by a provider. */
export interface AnchorInput {
  /** e.g. "prayer.fajr". */
  id: string;
  /** The civil date this instance belongs to. */
  date: string;
  start: string;
  /** Defaults to `start` (a point anchor). */
  end?: string;
  /** The part of the window that occupies the user's time. */
  busy?: TimeRange[];
  tags?: string[];
  /** A name to show, e.g. "Asr"; the id if left out. */
  title?: string;
}

/** Something with an authoritative time, e.g. an imported meeting. */
export interface EventInput {
  id: string;
  title?: string;
  start: string;
  end: string;
  tags?: string[];
  /** Defaults to true. Non-busy events only block tasks that avoid them. */
  busy?: boolean;
}

/** Each rule may list fallbacks: "work.start or 12:00". */
export interface WindowRule {
  after?: string;
  before?: string;
  /** Anchor ids; the task must fit entirely inside the window of the first that exists. */
  within?: string;
}

export interface IntentionInput {
  id: string;
  title?: string;
  duration: string;
  repeat?: Repeat;
  /** Without `repeat`: the logical day this one-off task belongs to. */
  date?: string;
  /** A formula: start exactly here. Excludes `window`. */
  at?: string;
  window?: WindowRule;
  /** Selectors for extra time to keep clear of, beyond busy time. */
  avoid?: string[];
  /** "YYYY-MM-DD" (end of that logical day) or an ISO instant. */
  deadline?: string;
  prefer?: Preference;
  /** Higher goes first (default 0); equal priority puts longer tasks first. */
  priority?: number;
  tags?: string[];
}

export type PlacementState = 'scheduled' | 'pinned' | 'done' | 'missed';
export type PlacementKind = 'fitted' | 'formula' | 'pinned';

/**
 * Which occurrence something belongs to: its id, or its task, in which case
 * it is the task's occurrence on the logical day `start` falls in (a one-off
 * task has only one). Task files store times this way.
 */
export type OccurrenceRef = { occurrenceId: string; intentionId?: never } | { intentionId: string; occurrenceId?: never };

/**
 * A placement from a previous plan, as stored by the caller. When two
 * describe the same occurrence, what happened (done, missed) wins over a pin,
 * and a pin over a plain scheduled time.
 */
export type ExistingPlacement = OccurrenceRef & {
  start: string;
  end: string;
  state: PlacementState;
};

export type Pin = OccurrenceRef & {
  start: string;
};

export interface ScheduleInput {
  /** IANA time zone, e.g. "Asia/Riyadh". */
  timeZone: string;
  now: string;
  /** Number of logical days to plan, starting with the one containing `now`. */
  horizonDays: number;
  /** Time expression for the start of each logical day. Defaults to "00:00". */
  dayStart?: string;
  /**
   * Changes to the built-in day parts (morning, afternoon, evening, night):
   * add or replace a part, or set it to null to remove it.
   */
  dayParts?: Record<string, DayPartInput | null>;
  /** Anchors at fixed times from the settings, e.g. work hours. */
  fixedAnchors?: Record<string, FixedAnchorInput>;
  anchors?: AnchorInput[];
  events?: EventInput[];
  intentions: IntentionInput[];
  /** Selectors every task must keep clear of. */
  avoid?: string[];
  pins?: Pin[];
  existing?: ExistingPlacement[];
}

export interface Placement {
  /** "<intention>@<date>" for recurring intentions, "<intention>" for one-offs. */
  occurrenceId: string;
  intentionId: string;
  date: string;
  start: string;
  end: string;
  kind: PlacementKind;
  state: PlacementState;
  why: string;
}

export type UnplacedCode = 'missing_anchor' | 'window_empty' | 'window_passed' | 'no_slot' | 'deadline_passed';

export interface Unplaced {
  occurrenceId: string;
  intentionId: string;
  /** Null for a one-off task that could go on any day. */
  date: string | null;
  code: UnplacedCode;
  message: string;
  /** Refs of what is in the way, e.g. "event:standup", "task:quran@2026-10-25". */
  blockers: string[];
}

/** A pinned, formula or in-progress placement that overlaps something it shouldn't. */
export interface Conflict {
  occurrenceId: string;
  with: string[];
  message: string;
}

export interface Move {
  occurrenceId: string;
  from: TimeRange;
  to: TimeRange;
  reason: string;
}

export interface Removal {
  occurrenceId: string;
  start: string;
  end: string;
  reason: string;
}

/** What changed compared with `existing`. */
export interface Diff {
  added: string[];
  moved: Move[];
  removed: Removal[];
  /** Occurrences whose time passed without completion during this run. */
  missed: string[];
}

export type IssueCode =
  | 'invalid_id'
  | 'duplicate_id'
  | 'invalid_duration'
  | 'invalid_expression'
  | 'unknown_anchor'
  | 'conflicting_rules'
  | 'missing_date'
  | 'invalid_within'
  | 'invalid_deadline'
  | 'invalid_prefer'
  | 'invalid_repeat'
  | 'invalid_selector'
  | 'invalid_date'
  | 'invalid_priority'
  | 'invalid_tags'
  | 'invalid_anchor'
  | 'duplicate_anchor'
  | 'invalid_event'
  | 'invalid_existing'
  | 'duplicate_existing'
  | 'invalid_pin'
  | 'duplicate_pin'
  | 'unknown_occurrence'
  | 'day_start_fallback';

export interface Issue {
  code: IssueCode;
  message: string;
  intentionId?: string;
  occurrenceId?: string;
}

/** A logical day in the horizon, with its boundaries and day parts, for drawing. */
export interface DayInfo {
  date: string;
  start: string;
  end: string;
  parts: { name: string; start: string; end: string }[];
}

/** A busy part of an anchor, e.g. the time of a prayer, for showing alongside the placements. */
export interface BusyTime {
  anchor: string;
  date: string;
  title: string;
  start: string;
  end: string;
  tags: string[];
}

export interface Plan {
  /** The logical days of the horizon, in order. */
  days: DayInfo[];
  /** The busy parts of anchors on those days, in time order. */
  busy: BusyTime[];
  placements: Placement[];
  unplaced: Unplaced[];
  conflicts: Conflict[];
  /** One-off intentions with no rules yet. */
  inbox: string[];
  diff: Diff;
  /** Invalid intentions; they are excluded from scheduling. */
  errors: Issue[];
  /** Ignored or questionable input that did not stop scheduling. */
  warnings: Issue[];
}
