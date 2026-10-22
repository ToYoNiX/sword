import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Temporal } from 'temporal-polyfill';
import type { LogEntry } from '@sword/schema';
import { timeZoneOf } from './input.ts';
import type { Vault } from './load.ts';

/** Appends entries to log/YYYY-MM.jsonl, by the local month they were recorded in. */
export async function appendLog(vault: Vault, entries: readonly LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const timeZone = timeZoneOf(vault);
  const byMonth = new Map<string, string[]>();
  for (const entry of entries) {
    const month = Temporal.Instant.from(entry.at).toZonedDateTimeISO(timeZone).toPlainDate().toString().slice(0, 7);
    const { at, occurrenceId: occurrence, state } = entry;
    const line = JSON.stringify(entry.state === 'open' ? { at, occurrence, state } : { at, occurrence, state, start: entry.start, end: entry.end });
    byMonth.set(month, [...(byMonth.get(month) ?? []), line]);
  }
  await mkdir(join(vault.root, 'log'), { recursive: true });
  for (const [month, lines] of byMonth) {
    const path = join(vault.root, 'log', `${month}.jsonl`);
    const existing = await readFile(path, 'utf8').catch(() => '');
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
    await appendFile(path, `${separator}${lines.join('\n')}\n`);
  }
}
