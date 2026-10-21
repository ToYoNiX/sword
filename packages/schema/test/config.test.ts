import { describe, expect, it } from 'vitest';
import { readConfig, readConfigFile } from '../src/index.ts';

describe('readConfigFile', () => {
  it('reads sword.yaml into engine settings', () => {
    const result = readConfigFile(`
time_zone: Asia/Riyadh
day_start: prayer.fajr.start
horizon_days: 14
avoid: [tag:prayer]
day_parts:
  morning: { start: "07:00", end: "12:00" }
  siesta: { start: "14:00", end: "16:00" }
  night: null
plugins:
  - github.com/ToYoNiX/sword-prayer@v0.1.0
`);
    expect(result).toEqual({
      ok: true,
      warnings: [],
      value: {
        timeZone: 'Asia/Riyadh',
        dayStart: 'prayer.fajr.start',
        horizonDays: 14,
        avoid: ['tag:prayer'],
        dayParts: {
          morning: { start: '07:00', end: '12:00' },
          siesta: { start: '14:00', end: '16:00' },
          night: null,
        },
        plugins: ['github.com/ToYoNiX/sword-prayer@v0.1.0'],
      },
    });
  });

  it('accepts an empty file', () => {
    expect(readConfigFile('')).toEqual({ ok: true, warnings: [], value: { plugins: [] } });
  });

  it('reads unquoted times as text', () => {
    const result = readConfigFile('day_start: 05:00\nday_parts:\n  early: { start: 04:00, end: 05:00 }\n');
    expect(result).toMatchObject({ ok: true, value: { dayStart: '05:00', dayParts: { early: { start: '04:00', end: '05:00' } } } });
  });

  it('rejects invalid YAML', () => {
    expect(readConfigFile('day_start: [').ok).toBe(false);
  });
});

describe('readConfig', () => {
  it('warns about unknown settings', () => {
    expect(readConfig({ day_strat: '05:00' })).toMatchObject({ ok: true, warnings: ['unknown setting "day_strat"'] });
  });

  it.each([
    ['a horizon that is text', { horizon_days: 'week' }, 'horizon_days'],
    ['a day part without an end', { day_parts: { siesta: { start: '14:00' } } }, 'day_parts.siesta.end'],
    ['a day part with an extra field', { day_parts: { siesta: { start: '14:00', end: '16:00', color: 'red' } } }, 'color'],
    ['avoid that is not a list', { avoid: 'tag:prayer' }, 'avoid'],
    ['a config that is a list', ['x'], 'mapping'],
  ])('rejects %s and names the field', (_, data, field) => {
    const result = readConfig(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toContain(field);
  });
});
