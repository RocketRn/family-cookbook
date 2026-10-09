import { describe, expect, it } from 'vitest';
import { parseAmount } from '../src/index.js';

describe('parseAmount: numbers as people write them', () => {
  it.each<[string, { min: number; max: number } | null]>([
    ['2', { min: 2, max: 2 }],
    ['1.25', { min: 1.25, max: 1.25 }],
    ['0,5', { min: 0.5, max: 0.5 }],
    ['1 1/2', { min: 1.5, max: 1.5 }],
    ['1½', { min: 1.5, max: 1.5 }],
    ['1 ½', { min: 1.5, max: 1.5 }],
    ['½', { min: 0.5, max: 0.5 }],
    ['⅔', { min: 2 / 3, max: 2 / 3 }],
    ['3/4', { min: 0.75, max: 0.75 }],
    ['2–3', { min: 2, max: 3 }],
    ['2-3', { min: 2, max: 3 }],
    ['2 — 3', { min: 2, max: 3 }],
    ['200–300', { min: 200, max: 300 }],
    ['1,5-2', { min: 1.5, max: 2 }],
    ['  4 ', { min: 4, max: 4 }],
    ['', null],
    ['abc', null],
    ['3-2', null], // a reversed range is not a range
    ['1/0', null],
  ])('%j', (text, expected) => {
    const r = parseAmount(text);
    if (expected === null) expect(r).toBeNull();
    else {
      expect(r).not.toBeNull();
      expect(r!.min).toBeCloseTo(expected.min, 12);
      expect(r!.max).toBeCloseTo(expected.max, 12);
    }
  });
});
