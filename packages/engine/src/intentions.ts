import type { AnchorIndex } from './anchors.ts';
import { parseDuration } from './duration.ts';
import { ParseError } from './errors.ts';
import { parseTimeRule } from './expr.ts';
import type { TimeRule } from './expr.ts';
import { parseRepeat } from './recurrence.ts';
import type { Recurrence } from './recurrence.ts';
import { parseSelector } from './selectors.ts';
import type { Selector } from './selectors.ts';
import { isLocalDateTime, isPlainDate, parseInstant, parseLocalDateTime, parsePlainDate } from './time.ts';
import type { IntentionInput, Issue, IssueCode, Preference } from './types.ts';

export type Deadline =
  | { readonly kind: 'date'; readonly date: string }
  | { readonly kind: 'instant'; readonly ms: number }
  /** A date and time without a time zone, read in the plan's time zone. */
  | { readonly kind: 'local'; readonly dateTime: string };

/** A validated intention. */
export interface Intention {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly recurrence: Recurrence | null;
  readonly date: string | null;
  readonly at: TimeRule | null;
  readonly after: TimeRule | null;
  readonly before: TimeRule | null;
  /** Anchor ids, first available wins. */
  readonly within: readonly string[] | null;
  readonly avoid: readonly Selector[];
  readonly deadline: Deadline | null;
  readonly deadlineText: string | null;
  readonly prefer: Preference;
  readonly priority: number;
  readonly tags: readonly string[];
}

export interface CompiledIntentions {
  readonly valid: Map<string, Intention>;
  /** Ids of intentions that had errors; their old placements are left alone. */
  readonly invalidIds: ReadonlySet<string>;
}

/**
 * Ids are usually file names, so spaces and any language are fine. Not
 * allowed: "@" (it separates id and date in occurrence ids), line breaks,
 * and leading or trailing spaces.
 */
const ID = /^[^@\s](?:[^@\n\r\t]*[^@\s])?$/u;
const PREFERENCES = new Set<unknown>(['earliest', 'latest', 'packed']);

export function compileIntentions(
  inputs: readonly IntentionInput[],
  anchors: AnchorIndex,
  errors: Issue[],
): CompiledIntentions {
  const counts = new Map<unknown, number>();
  for (const raw of inputs) counts.set(raw?.id, (counts.get(raw?.id) ?? 0) + 1);

  const valid = new Map<string, Intention>();
  const invalidIds = new Set<string>();
  for (const raw of inputs) {
    const problems: [IssueCode, string][] = [];
    const intention = compile(raw, anchors, (code, message) => problems.push([code, message]));
    if ((counts.get(raw?.id) ?? 0) > 1) problems.push(['duplicate_id', `id "${raw.id}" is used by more than one intention`]);
    if (intention && problems.length === 0) {
      valid.set(intention.id, intention);
      continue;
    }
    const intentionId = String(raw?.id);
    invalidIds.add(intentionId);
    for (const [code, message] of problems) errors.push({ code, message, intentionId });
  }
  return { valid, invalidIds };
}

type Report = (code: IssueCode, message: string) => void;

function compile(raw: IntentionInput, anchors: AnchorIndex, report: Report): Intention | null {
  const failures = { count: 0 };
  const fail: Report = (code, message) => {
    failures.count++;
    report(code, message);
  };
  const attempt = <T>(code: IssueCode, parse: () => T): T | null => {
    try {
      return parse();
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      fail(code, error.message);
      return null;
    }
  };

  if (typeof raw.id !== 'string' || !ID.test(raw.id)) {
    fail('invalid_id', `invalid id ${JSON.stringify(raw.id)}: it can't be empty, contain "@" or line breaks, or start or end with a space`);
  }

  const minutes = attempt('invalid_duration', () => parseDuration(raw.duration));

  const recurring = raw.repeat !== undefined;
  const recurrence = recurring ? attempt('invalid_repeat', () => parseRepeat(raw.repeat as NonNullable<IntentionInput['repeat']>)) : null;

  const date = raw.date === undefined ? null : attempt('invalid_date', () => parsePlainDate(raw.date as string));
  if (raw.date !== undefined && recurring) fail('conflicting_rules', '"date" only applies to one-off intentions');

  const rule = (text: string | undefined) => (text === undefined ? null : attempt('invalid_expression', () => parseTimeRule(text)));
  const at = rule(raw.at);
  const after = rule(raw.window?.after);
  const beforeRule = rule(raw.window?.before);
  const withinRule = rule(raw.window?.within);

  let within: string[] | null = null;
  if (withinRule) {
    within = [];
    for (const alternative of withinRule.alternatives) {
      if (alternative.kind !== 'anchor' || alternative.edge !== 'auto' || alternative.offset !== 0 || alternative.anchor === 'day') {
        fail('invalid_within', `"within" must name anchors, e.g. "work or afternoon", not "${alternative.source}"`);
      } else {
        within.push(alternative.anchor);
      }
    }
  }

  const hasWindow = raw.window !== undefined && (raw.window.after ?? raw.window.before ?? raw.window.within) !== undefined;
  if (raw.at !== undefined && hasWindow) fail('conflicting_rules', 'use either "at" or "window", not both');
  if (raw.at !== undefined && !recurring && raw.date === undefined) fail('missing_date', 'a one-off intention with "at" needs a "date"');

  for (const e of [at, after, beforeRule].flatMap((r) => r?.alternatives ?? [])) {
    if (e.kind !== 'anchor') continue;
    if (e.anchor === 'day') {
      if (e.edge !== 'auto' && e.edge !== 'start' && e.edge !== 'end') fail('invalid_expression', `"day" has no busy portion: "${e.source}"`);
    } else if (!anchors.ids.has(e.anchor)) {
      fail('unknown_anchor', `unknown anchor "${e.anchor}" in "${e.source}"`);
    }
  }
  for (const id of within ?? []) {
    if (!anchors.ids.has(id)) fail('unknown_anchor', `unknown anchor "${id}"`);
  }

  const avoid: Selector[] = [];
  for (const text of raw.avoid ?? []) {
    const selector = attempt('invalid_selector', () => parseSelector(text));
    if (!selector) continue;
    if (selector.type === 'anchor' && !anchors.ids.has(selector.value)) fail('unknown_anchor', `unknown anchor "${selector.value}" in "${text}"`);
    avoid.push(selector);
  }

  let deadline: Deadline | null = null;
  if (raw.deadline !== undefined) {
    deadline = attempt('invalid_deadline', (): Deadline => {
      const text = raw.deadline as string;
      if (typeof text === 'string' && isPlainDate(text)) return { kind: 'date', date: parsePlainDate(text) };
      if (typeof text === 'string' && isLocalDateTime(text)) return { kind: 'local', dateTime: parseLocalDateTime(text) };
      try {
        return { kind: 'instant', ms: parseInstant(text) };
      } catch {
        throw new ParseError(`invalid deadline ${JSON.stringify(text)}; use a date (2026-10-24) or a date and time (2026-10-24T17:00)`);
      }
    });
  }

  if (raw.prefer !== undefined && !PREFERENCES.has(raw.prefer)) {
    fail('invalid_prefer', `invalid prefer ${JSON.stringify(raw.prefer)}; use "earliest", "latest" or "packed"`);
  }
  if (raw.priority !== undefined && !Number.isInteger(raw.priority)) fail('invalid_priority', `priority must be a whole number, not ${JSON.stringify(raw.priority)}`);
  if (raw.tags !== undefined && !(Array.isArray(raw.tags) && raw.tags.every((tag) => typeof tag === 'string'))) {
    fail('invalid_tags', 'tags must be a list of strings');
  }

  if (failures.count > 0 || minutes === null || (recurring && recurrence === null)) return null;
  return {
    id: raw.id,
    title: raw.title ?? raw.id,
    minutes,
    recurrence,
    date,
    at,
    after,
    before: beforeRule,
    within,
    avoid,
    deadline,
    deadlineText: raw.deadline ?? null,
    prefer: raw.prefer ?? 'earliest',
    priority: raw.priority ?? 0,
    tags: [...(raw.tags ?? [])],
  };
}
