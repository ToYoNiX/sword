import { ParseError } from './errors.ts';

export type SelectorType = 'tag' | 'anchor' | 'event' | 'task';

export interface Selector {
  readonly type: SelectorType;
  readonly value: string;
}

const SELECTOR = /^(tag|anchor|event|task):(\S+)$/;

/** Parses "tag:prayer", "anchor:prayer.asr", "event:standup" or "task:study". */
export function parseSelector(text: string): Selector {
  const match = typeof text === 'string' ? SELECTOR.exec(text) : null;
  if (!match) throw new ParseError(`invalid selector "${text}"; expected tag:…, anchor:…, event:… or task:…`);
  return { type: match[1] as SelectorType, value: match[2] as string };
}
