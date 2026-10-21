/** A half-open interval [start, end) in epoch milliseconds. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Touching intervals do not overlap, and empty intervals overlap nothing. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end && a.start < a.end && b.start < b.end;
}

/** The parts of `region` not covered by any of `holes`, in order. */
export function subtract(region: Interval, holes: readonly Interval[]): Interval[] {
  let free: Interval[] = region.end > region.start ? [region] : [];
  for (const hole of holes) {
    if (hole.end <= hole.start) continue;
    const next: Interval[] = [];
    for (const part of free) {
      if (!overlaps(part, hole)) {
        next.push(part);
        continue;
      }
      if (hole.start > part.start) next.push({ start: part.start, end: hole.start });
      if (hole.end < part.end) next.push({ start: hole.end, end: part.end });
    }
    free = next;
  }
  return free.sort((a, b) => a.start - b.start);
}
