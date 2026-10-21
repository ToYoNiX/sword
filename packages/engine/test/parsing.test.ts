import { describe, expect, it } from 'vitest';
import { ParseError, parseDuration, parseSelector, parseTimeExpr, parseTimeRule } from '../src/index.ts';

describe('parseDuration', () => {
  it.each([
    ['45m', 45],
    ['2h', 120],
    ['1h30m', 90],
    ['90m', 90],
    ['1h0m', 60],
    [' 15m ', 15],
  ])('parses %j as %i minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each(['', ' ', '45', 'm', 'h', '45 m', '1m30h', '-5m', '0m', '0h0m', '1.5h', '45min', '1d', 'abc'])(
    'rejects %j',
    (text) => {
      expect(() => parseDuration(text)).toThrow(ParseError);
    },
  );
});

describe('parseTimeExpr', () => {
  it('parses wall-clock times', () => {
    expect(parseTimeExpr('09:00')).toMatchObject({ kind: 'clock', minutes: 540, offset: 0 });
    expect(parseTimeExpr('9:05')).toMatchObject({ kind: 'clock', minutes: 545 });
    expect(parseTimeExpr('00:00')).toMatchObject({ kind: 'clock', minutes: 0 });
    expect(parseTimeExpr('23:59')).toMatchObject({ kind: 'clock', minutes: 1439 });
  });

  it('parses anchor references with edges', () => {
    expect(parseTimeExpr('prayer.fajr')).toMatchObject({ kind: 'anchor', anchor: 'prayer.fajr', edge: 'auto', offset: 0 });
    expect(parseTimeExpr('work.start')).toMatchObject({ anchor: 'work', edge: 'start' });
    expect(parseTimeExpr('prayer.asr.end')).toMatchObject({ anchor: 'prayer.asr', edge: 'end' });
    expect(parseTimeExpr('prayer.fajr.busy.start')).toMatchObject({ anchor: 'prayer.fajr', edge: 'busy.start' });
    expect(parseTimeExpr('prayer.fajr.busy.end')).toMatchObject({ anchor: 'prayer.fajr', edge: 'busy.end' });
    expect(parseTimeExpr('day.start')).toMatchObject({ anchor: 'day', edge: 'start' });
  });

  it('parses offsets', () => {
    expect(parseTimeExpr('prayer.fajr.busy.end + 5m')).toMatchObject({ edge: 'busy.end', offset: 5 * 60_000 });
    expect(parseTimeExpr('work.start - 15m')).toMatchObject({ offset: -15 * 60_000 });
    expect(parseTimeExpr('prayer.asr.end+1h30m')).toMatchObject({ offset: 90 * 60_000 });
    expect(parseTimeExpr('09:00 + 10m')).toMatchObject({ kind: 'clock', minutes: 540, offset: 10 * 60_000 });
  });

  it.each([
    '',
    '24:00',
    '25:00',
    '09:60',
    '9.00',
    '+5m',
    'prayer.fajr +',
    'prayer.fajr + 5',
    'prayer.fajr * 5m',
    'prayer.fajr + 5m + 5m',
    'prayer..fajr',
    'Prayer.Fajr',
    'prayer.fajr.busy',
    'prayer.fajr.start.end',
    'start',
    '.start',
    'prayer-fajr',
    'prayer fajr',
  ])('rejects %j', (text) => {
    expect(() => parseTimeExpr(text)).toThrow(ParseError);
  });
});

describe('parseTimeRule', () => {
  it('parses a single expression', () => {
    expect(parseTimeRule('work.start').alternatives).toEqual([expect.objectContaining({ anchor: 'work', edge: 'start' })]);
  });

  it('parses fallbacks in order', () => {
    expect(parseTimeRule('gym.end or work.end - 15m or 19:00').alternatives).toEqual([
      expect.objectContaining({ anchor: 'gym', edge: 'end' }),
      expect.objectContaining({ anchor: 'work', edge: 'end', offset: -15 * 60_000 }),
      expect.objectContaining({ kind: 'clock', minutes: 19 * 60 }),
    ]);
  });

  it.each(['', 'or 12:00', 'work.start or', 'work.start or or 12:00', 'work.start || 12:00', 'work.start or 25:00'])(
    'rejects %j',
    (text) => {
      expect(() => parseTimeRule(text)).toThrow(ParseError);
    },
  );
});

describe('parseSelector', () => {
  it('parses each selector type', () => {
    expect(parseSelector('tag:prayer')).toEqual({ type: 'tag', value: 'prayer' });
    expect(parseSelector('anchor:prayer.asr')).toEqual({ type: 'anchor', value: 'prayer.asr' });
    expect(parseSelector('event:standup')).toEqual({ type: 'event', value: 'standup' });
    expect(parseSelector('task:study')).toEqual({ type: 'task', value: 'study' });
  });

  it.each(['prayer', 'color:red', 'tag:', ':prayer', 'tag: prayer'])('rejects %j', (text) => {
    expect(() => parseSelector(text)).toThrow(ParseError);
  });
});
