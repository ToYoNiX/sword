import { describe, expect, it } from 'vitest';
import { readLog } from '../src/index.ts';

const done = '{"at":"2026-10-25T06:45:00Z","occurrence":"study@2026-10-25","state":"done","start":"2026-10-25T03:21:00Z","end":"2026-10-25T04:06:00Z"}';

describe('readLog', () => {
  it('reads one entry per line', () => {
    expect(readLog(`${done}\n`)).toEqual({
      entries: [
        {
          at: '2026-10-25T06:45:00Z',
          occurrenceId: 'study@2026-10-25',
          state: 'done',
          start: '2026-10-25T03:21:00Z',
          end: '2026-10-25T04:06:00Z',
        },
      ],
      errors: [],
    });
  });

  it('reads an open line, which reopens an occurrence, without times', () => {
    const open = '{"at":"2026-10-25T07:00:00Z","occurrence":"study@2026-10-25","state":"open"}';
    expect(readLog(`${done}\n${open}\n`).entries.map((e) => e.state)).toEqual(['done', 'open']);
    expect(readLog(open).entries[0]).toEqual({ at: '2026-10-25T07:00:00Z', occurrenceId: 'study@2026-10-25', state: 'open' });
  });

  it('skips blank lines', () => {
    expect(readLog(`\n${done}\n\n`).entries).toHaveLength(1);
  });

  it('reports bad lines by number and keeps the good ones', () => {
    const result = readLog(
      [
        done,
        'not json',
        '{"at":"2026-10-25T06:45:00Z","occurrence":"x","state":"later","start":"2026-10-25T03:00:00Z","end":"2026-10-25T04:00:00Z"}',
        '{"at":"2026-10-25T06:45:00Z","occurrence":"x","state":"done"}',
        '{"at":"2026-10-25T06:45:00Z","occurrence":"x","state":"missed","start":"2026-10-25T03:00:00Z"}',
        '{"at":"2026-10-25T06:45:00Z","state":"open"}',
        '["a list"]',
      ].join('\n'),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.errors[1]?.message).toContain('state');
    expect(result.errors[2]?.message).toContain('start');
    expect(result.errors[3]?.message).toContain('end');
    expect(result.errors[4]?.message).toContain('occurrence');
  });
});
