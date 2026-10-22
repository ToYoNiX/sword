import { Temporal } from 'temporal-polyfill';

/** A local date-time from a task file ("2026-10-26T07:30") as an ISO instant. */
export function toInstant(local: string, timeZone: string): string {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone).toInstant().toString();
}

/** An ISO instant as a local date-time, with seconds only when there are any. */
export function toLocal(instant: string, timeZone: string): string {
  const time = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDateTime();
  return time.toString({ smallestUnit: time.second === 0 ? 'minute' : 'second' });
}

/** "2026-10-25" as "Sun 25 Oct", for messages. */
export function formatDate(date: string): string {
  return Temporal.PlainDate.from(date).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
