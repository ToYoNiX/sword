import { edgeValue } from './anchors.ts';
import type { AnchorIndex, EdgeRole } from './anchors.ts';
import type { TimeExpr, TimeRule } from './expr.ts';
import { addDays, civilDate, wallTime } from './time.ts';
import type { Issue } from './types.ts';

export type Resolution = { readonly ok: true; readonly ms: number } | { readonly ok: false; readonly missing: string };

export type RuleResolution =
  | { readonly ok: true; readonly ms: number }
  | { readonly ok: false; readonly missing: readonly string[] };

/**
 * Logical days (docs/design.md §4.2): each runs from its day start to the next
 * one, and is labelled with the civil date its start falls on.
 */
export class LogicalDays {
  readonly #starts = new Map<string, number>();
  private readonly timeZone: string;
  private readonly dayStart: TimeExpr;
  private readonly anchors: AnchorIndex;
  private readonly warnings: Issue[];

  constructor(timeZone: string, dayStart: TimeExpr, anchors: AnchorIndex, warnings: Issue[]) {
    this.timeZone = timeZone;
    this.dayStart = dayStart;
    this.anchors = anchors;
    this.warnings = warnings;
  }

  start(date: string): number {
    const cached = this.#starts.get(date);
    if (cached !== undefined) return cached;
    let ms: number | undefined;
    if (this.dayStart.kind === 'clock') {
      ms = wallTime(date, this.dayStart.minutes, this.timeZone) + this.dayStart.offset;
    } else {
      const anchor = this.anchors.get(this.dayStart.anchor, date);
      const edge = anchor && edgeValue(anchor, this.dayStart.edge, 'dayStart');
      if (edge !== undefined) ms = edge + this.dayStart.offset;
    }
    if (ms === undefined) {
      this.warnings.push({
        code: 'day_start_fallback',
        message: `"${this.dayStart.source}" is not available on ${date}; that logical day starts at midnight`,
      });
      ms = wallTime(date, 0, this.timeZone);
    }
    this.#starts.set(date, ms);
    return ms;
  }

  end(date: string): number {
    return this.start(addDays(date, 1));
  }

  /** The logical day an instant falls in. */
  dateOf(ms: number): string {
    const civil = civilDate(ms, this.timeZone);
    return ms >= this.start(civil) ? civil : addDays(civil, -1);
  }

  /**
   * A wall-clock time within a logical day: the first instant at that time
   * on or after the day start. With a 05:00 day start, 01:00 is the next
   * civil date.
   */
  clock(date: string, minutes: number): number {
    const sameDate = wallTime(date, minutes, this.timeZone);
    return sameDate >= this.start(date) ? sameDate : wallTime(addDays(date, 1), minutes, this.timeZone);
  }

  /** The first alternative of a rule that exists on this day. */
  resolveRule(rule: TimeRule, role: EdgeRole, date: string): RuleResolution {
    const missing: string[] = [];
    for (const alternative of rule.alternatives) {
      const resolved = this.resolve(alternative, role, date);
      if (resolved.ok) return resolved;
      missing.push(resolved.missing);
    }
    return { ok: false, missing };
  }

  resolve(expr: TimeExpr, role: EdgeRole, date: string): Resolution {
    if (expr.kind === 'clock') return { ok: true, ms: this.clock(date, expr.minutes) + expr.offset };
    if (expr.anchor === 'day') {
      return { ok: true, ms: (expr.edge === 'end' ? this.end(date) : this.start(date)) + expr.offset };
    }
    const anchor = this.anchors.get(expr.anchor, date);
    if (!anchor) return { ok: false, missing: expr.anchor };
    const ms = edgeValue(anchor, expr.edge, role);
    if (ms === undefined) return { ok: false, missing: `${expr.anchor}.${expr.edge}` };
    return { ok: true, ms: ms + expr.offset };
  }
}
