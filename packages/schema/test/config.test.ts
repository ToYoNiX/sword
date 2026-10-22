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
anchors:
  work: { start: "09:00", end: "17:00", on: [sun, mon], busy: true }
  gym_hours: { start: 18:00, end: 21:00, tags: [sport] }
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
        fixedAnchors: {
          work: { start: '09:00', end: '17:00', on: ['sun', 'mon'], busy: true },
          gym_hours: { start: '18:00', end: '21:00', tags: ['sport'] },
        },
        plugins: ['github.com/ToYoNiX/sword-prayer@v0.1.0'],
        other: {},
      },
    });
  });

  it('accepts an empty file', () => {
    expect(readConfigFile('')).toEqual({ ok: true, warnings: [], value: { plugins: [], other: {} } });
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
  it('reads the location', () => {
    expect(readConfig({ location: { latitude: 30.0444, longitude: 31.2357 } })).toMatchObject({
      ok: true,
      value: { location: { latitude: 30.0444, longitude: 31.2357 } },
    });
  });

  it('keeps other settings as they are, for plugins: only the vault knows which are installed', () => {
    const result = readConfig({ time_zone: 'Africa/Cairo', prayer: { method: 'egyptian' }, day_strat: '05:00' });
    expect(result).toEqual({
      ok: true,
      warnings: [],
      value: { timeZone: 'Africa/Cairo', plugins: [], other: { prayer: { method: 'egyptian' }, day_strat: '05:00' } },
    });
  });

  it.each([
    ['a horizon that is text', { horizon_days: 'week' }, 'horizon_days'],
    ['a day part without an end', { day_parts: { siesta: { start: '14:00' } } }, 'day_parts.siesta.end'],
    ['a day part with an extra field', { day_parts: { siesta: { start: '14:00', end: '16:00', color: 'red' } } }, 'color'],
    ['avoid that is not a list', { avoid: 'tag:prayer' }, 'avoid'],
    ['an anchor without an end', { anchors: { work: { start: '09:00' } } }, 'anchors.work.end'],
    ['an anchor with an extra field', { anchors: { work: { start: '09:00', end: '17:00', color: 'red' } } }, 'color'],
    ['a config that is a list', ['x'], 'mapping'],
    ['a location without a longitude', { location: { latitude: 30 } }, 'location.longitude'],
    ['a latitude out of range', { location: { latitude: 91, longitude: 31 } }, 'location.latitude'],
    ['a longitude out of range', { location: { latitude: 30, longitude: -181 } }, 'location.longitude'],
    ['a location written as text', { location: 'Cairo' }, 'location'],
    ['a location with an extra field', { location: { latitude: 30, longitude: 31, city: 'Cairo' } }, 'city'],
    ['plugins that are not a list', { plugins: 'https://github.com/ToYoNiX/sword-prayer' }, 'plugins'],
  ])('rejects %s and names the field', (_, data, field) => {
    const result = readConfig(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toContain(field);
  });
});
