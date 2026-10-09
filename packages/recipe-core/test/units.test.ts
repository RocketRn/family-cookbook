import { describe, expect, it } from 'vitest';
import { LANGS, resolveUnit, UNITS, unitByCode } from '../src/index.js';

describe('units: the single source of truth', () => {
  it('codes are unique and every unit has labels in all four languages', () => {
    const codes = UNITS.map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const u of UNITS)
      for (const l of LANGS) expect(u.labels[l], `${u.code}/${l}`).toBeTruthy();
  });

  it('only exact metric units have to_base (inexact measures wait for the stage-2 reference)', () => {
    const withBase = UNITS.filter((u) => u.toBase !== null)
      .map((u) => u.code)
      .sort();
    expect(withBase).toEqual(['g', 'kg', 'l', 'ml']);
    expect(unitByCode('kg')?.toBase).toBe(1000);
  });

  it('an alias maps to exactly one unit within a language', () => {
    for (const l of LANGS) {
      const seen = new Map<string, string>();
      for (const u of UNITS)
        for (const a of u.aliases[l]) {
          const key = a.toLowerCase();
          expect(seen.get(key) ?? u.code, `${l}: "${a}"`).toBe(u.code);
          seen.set(key, u.code);
        }
    }
  });

  it.each<[string, 'ru' | 'uk' | 'en' | 'sv', string | null]>([
    ['ст. л.', 'ru', 'tbsp'],
    ['ст.л', 'ru', 'tbsp'],
    ['Ст. Л.', 'ru', 'tbsp'],
    ['ч. л.', 'ru', 'tsp'],
    ['г', 'ru', 'g'],
    ['гр.', 'ru', 'g'],
    ['стакана', 'ru', 'cup'],
    ['шт.', 'ru', 'pcs'],
    ['склянки', 'uk', 'cup'],
    ['TBSP', 'en', 'tbsp'],
    ['cups', 'en', 'cup'],
    ['msk', 'sv', 'msk'],
    ['dl', 'sv', 'dl'],
    ['st', 'sv', 'pcs'],
    ['g', 'ru', 'g'], // a Latin unit inside a Russian recipe
    ['стопка', 'ru', null], // unknown: kept as written
    ['', 'ru', null],
  ])('resolveUnit(%j, %s) = %s', (raw, lang, code) => {
    expect(resolveUnit(raw, lang)).toBe(code);
  });
});
