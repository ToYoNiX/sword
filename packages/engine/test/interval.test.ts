import { describe, expect, it } from 'vitest';
import { overlaps, subtract } from '../src/interval.ts';

const iv = (start: number, end: number) => ({ start, end });

describe('overlaps', () => {
  it('treats touching intervals as not overlapping', () => {
    expect(overlaps(iv(0, 10), iv(10, 20))).toBe(false);
    expect(overlaps(iv(10, 20), iv(0, 10))).toBe(false);
  });

  it('detects partial and full overlap', () => {
    expect(overlaps(iv(0, 10), iv(9, 20))).toBe(true);
    expect(overlaps(iv(0, 100), iv(40, 60))).toBe(true);
    expect(overlaps(iv(40, 60), iv(0, 100))).toBe(true);
  });

  it('never overlaps an empty interval', () => {
    expect(overlaps(iv(0, 10), iv(5, 5))).toBe(false);
  });
});

describe('subtract', () => {
  it('returns the region when there is nothing to remove', () => {
    expect(subtract(iv(0, 100), [])).toEqual([iv(0, 100)]);
  });

  it('cuts holes out of the region', () => {
    expect(subtract(iv(0, 100), [iv(20, 30), iv(50, 60)])).toEqual([iv(0, 20), iv(30, 50), iv(60, 100)]);
  });

  it('does not depend on the order of the holes', () => {
    expect(subtract(iv(0, 100), [iv(50, 60), iv(20, 30)])).toEqual([iv(0, 20), iv(30, 50), iv(60, 100)]);
  });

  it('handles overlapping holes', () => {
    expect(subtract(iv(0, 100), [iv(20, 40), iv(30, 50)])).toEqual([iv(0, 20), iv(50, 100)]);
  });

  it('returns nothing when a hole covers the region', () => {
    expect(subtract(iv(0, 100), [iv(-10, 200)])).toEqual([]);
  });

  it('keeps the region intact for holes that only touch it', () => {
    expect(subtract(iv(0, 100), [iv(100, 120), iv(-20, 0)])).toEqual([iv(0, 100)]);
  });

  it('trims holes at the edges', () => {
    expect(subtract(iv(0, 100), [iv(0, 10), iv(90, 100)])).toEqual([iv(10, 90)]);
  });

  it('returns nothing for an empty or inverted region', () => {
    expect(subtract(iv(50, 50), [])).toEqual([]);
    expect(subtract(iv(60, 50), [])).toEqual([]);
  });

  it('ignores empty or inverted holes', () => {
    expect(subtract(iv(0, 100), [iv(30, 30), iv(60, 40)])).toEqual([iv(0, 100)]);
  });
});
