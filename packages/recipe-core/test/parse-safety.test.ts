/**
 * Parser safety (owner decision for Sprint 3): every pattern must run in linear time, so a hostile
 * or broken 20,000-character text (PRD 7.1 import limit) cannot stall the server. Each input below
 * is a known trap for backtracking regular expressions. A linear parser handles each in a few
 * milliseconds; a quadratic one takes seconds. The budget leaves room for slow CI machines.
 */
import { describe, expect, it } from 'vitest';
import { findDurations, parseAmount, parseIngredientLine, parseRecipeText } from '../src/index.js';

const LIMIT = 20_000;
const BUDGET_MS = 250;
const fill = (unit: string) => unit.repeat(Math.floor(LIMIT / unit.length)).slice(0, LIMIT);

const PATHOLOGICAL: Record<string, string> = {
  'one long run of spaces': '1' + ' '.repeat(LIMIT - 2) + 'x',
  'digit and space runs': fill('1 '),
  'only digits': fill('1'),
  'only dashes': fill('-'),
  'spaced dashes': fill(' - '),
  'long dashes': fill('— '),
  'nested open brackets': '('.repeat(LIMIT / 2) + ')'.repeat(LIMIT / 2),
  'unclosed brackets': fill('(1 г '),
  'amounts without names': fill('200 г '),
  'broken fractions': fill('1/'),
  'mixed numbers, unfinished': fill('1 1/'),
  'decimal commas': fill('1,'),
  'unicode fractions': fill('1½'),
  'taste phrases': fill('по вкусу '),
  'pinch words': fill('щепотка '),
  'unit abbreviations': fill('ст. л. '),
  'dotted units': fill('ч.л.'),
  'headings only': fill('Ингредиенты\n'),
  'blank lines': fill('\n'),
  'one long word': fill('а'),
  durations: fill('10 мин '),
  'duration ranges': fill('10-'),
  'hours and minutes': fill('1 ч 2 мин '),
  'youtube links': fill('https://youtu.be/'),
  urls: fill('https://example.com/?a=1&'),
  emoji: fill('🥚'),
  'list markers': fill('- • 1. '),
  'P4 near-misses': fill('мука — '),
  colons: fill('Для теста:'),
  'many ingredient lines': fill('2 ст. л. муки\n'),
  'many steps': fill('1. Смешайте муку, сахар и яйца.\n'),
  'one huge step with every ingredient':
    'Ингредиенты\n' +
    Array.from({ length: 100 }, (_, i) => `${i + 1} г продукт${i}`).join('\n') +
    '\nПриготовление\n' +
    fill('продукт1 продукт2 продукт3 '),
};

const timed = (fn: () => unknown) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('linear time on pathological 20,000-character inputs', () => {
  it.each(Object.entries(PATHOLOGICAL))('%s', (_name, input) => {
    expect(input.length).toBeLessThanOrEqual(LIMIT + 2000);
    expect(timed(() => parseRecipeText(input, { fallbackLang: 'ru' }))).toBeLessThan(BUDGET_MS);
    expect(timed(() => parseIngredientLine(input, 'ru'))).toBeLessThan(BUDGET_MS);
    expect(timed(() => findDurations(input))).toBeLessThan(BUDGET_MS);
    expect(timed(() => parseAmount(input))).toBeLessThan(BUDGET_MS);
  });

  it('a pathological text still gives a usable result, not an error', () => {
    const r = parseRecipeText(fill('мука — '), { fallbackLang: 'ru' });
    expect(Array.isArray(r.steps)).toBe(true);
  });

  it('caps lists at the PRD 7.1 limits and says so', () => {
    const r = parseRecipeText(
      'Тест\nИнгредиенты\n' +
        '2 ст. л. муки\n'.repeat(150) +
        'Приготовление\n' +
        '1. Смешайте.\n'.repeat(80),
      { fallbackLang: 'ru' },
    );
    expect(r.ingredients).toHaveLength(100);
    expect(r.steps).toHaveLength(60);
    expect(r.warnings).toContain('truncated');
  });
});
