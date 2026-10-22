import { toIcs } from '@sword/commands';
import type { BusyTime, Placement } from '@sword/engine';
import type { CalDav, RemoteEvent } from './caldav.ts';

export interface SyncResult {
  created: boolean;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Sword's events that are over and no longer in the plan: left as history. */
  kept: number;
}

const PUBLISHED = new Set(['scheduled', 'pinned', 'done']);

/**
 * Makes the calendar show the plan: one event per placement, and one per busy
 * time of an anchor (a prayer), each in its own file named after it. Events Sword didn't make are never
 * touched, and Sword's events that are over stay as history.
 */
export async function syncPlan(
  calendar: CalDav,
  placements: readonly Placement[],
  titles: Record<string, string>,
  now: string,
  busy: readonly BusyTime[] = [],
): Promise<SyncResult> {
  const created = await calendar.ensureCalendar('Sword');
  const remote = new Map((await calendar.list()).map((event) => [event.name, event]));
  const result: SyncResult = { created, added: 0, updated: 0, removed: 0, unchanged: 0, kept: 0 };

  const wanted = new Map<string, string>();
  for (const placement of placements) {
    if (!PUBLISHED.has(placement.state)) continue;
    wanted.set(eventName(placement.occurrenceId), toIcs([placement], { titles: new Map(Object.entries(titles)), stamp: now }));
  }
  for (const time of busy) {
    wanted.set(eventName(`anchor:${time.anchor}@${time.date}`), toIcs([], { titles: new Map(), stamp: now, busy: [time] }));
  }

  for (const [name, data] of wanted) {
    const existing = remote.get(name);
    if (existing === undefined) {
      await calendar.put(name, data, null);
      result.added++;
    } else if (fingerprint(existing.data) !== fingerprint(data)) {
      await calendar.put(name, data, existing.etag);
      result.updated++;
    } else {
      result.unchanged++;
    }
  }

  for (const event of remote.values()) {
    if (wanted.has(event.name) || !isSwords(event)) continue;
    const end = endOf(event.data);
    if (end !== null && end <= Date.parse(now)) {
      result.kept++;
      continue;
    }
    await calendar.delete(event.name, event.etag);
    result.removed++;
  }
  return result;
}

/** A file name that is safe on any server, the same for an occurrence every time. */
export function eventName(occurrenceId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(occurrenceId)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return `sword-${hash.toString(16).padStart(16, '0')}.ics`;
}

function isSwords(event: RemoteEvent): boolean {
  return /^X-SWORD-(?:OCCURRENCE|ANCHOR):/m.test(unfold(event.data));
}

/**
 * What an event says, independent of how the server stored it: servers
 * reorder properties and change line endings, and DTSTAMP is just when the
 * file was written.
 */
function fingerprint(ics: string): string {
  return unfold(ics)
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('DTSTAMP'))
    .sort()
    .join('\n');
}

function endOf(ics: string): number | null {
  const match = /^DTEND(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/m.exec(unfold(ics));
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function unfold(ics: string): string {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}
