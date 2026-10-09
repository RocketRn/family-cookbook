/**
 * QA-01 / BE-06 reference set (PRD 5.1 quality criterion): 10 recipes, ru × 4, uk × 2, en × 2,
 * sv × 2, in test/fixtures/import (texts written for this project; no personal data). Real family
 * texts can be added the same way (docs/fixtures/README.md).
 *   - section boundaries correct in >= 90% of texts (title, ingredient lines, steps)
 *   - "amount + unit + name" correct in >= 90% of ingredient lines
 *   - the original text is never lost
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRecipeText, type Lang, type ParsedRecipe } from '../src/index.js';

type Row = [string | null, string, number | null, number | null, string | null, string, number];
type Expected = {
  language: Lang;
  title: string;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  ingredients: Row[];
  steps: number;
  timers: Array<[number, number, number | null]>;
  videos: Array<[string, number | null, number]>;
  notes: string | null;
};

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/import');
const names = readdirSync(dir)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.slice(0, -4))
  .sort();
const load = (name: string) => ({
  text: readFileSync(path.join(dir, `${name}.txt`), 'utf8'),
  expected: JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')) as Expected,
});
const parse = (text: string, name: string): ParsedRecipe =>
  parseRecipeText(text, { fallbackLang: name.split('-')[1] as Lang });

const rowsOf = (r: ParsedRecipe): Row[] =>
  r.ingredients.map((i) => [
    i.groupLabel,
    i.qtyKind,
    i.amountMin,
    i.amountMax,
    i.unitCode,
    i.name,
    i.confidence,
  ]);
/** amount + unit + name of one line (PRD 5.1 quality criterion). */
const core = (row: Row | undefined) =>
  row ? JSON.stringify([row[1], row[2], row[3], row[4], row[5]]) : '';

describe('reference set', () => {
  it('has 10 texts: ru × 4, uk × 2, en × 2, sv × 2', () => {
    const langs = names.map((n) => n.split('-')[1]);
    expect(names).toHaveLength(10);
    expect(['ru', 'uk', 'en', 'sv'].map((l) => langs.filter((x) => x === l).length)).toEqual([
      4, 2, 2, 2,
    ]);
  });

  describe.each(names)('%s', (name) => {
    const { text, expected } = load(name);

    it('parses as expected', () => {
      const r = parse(text, name);
      expect({
        language: r.language,
        title: r.title,
        servings: r.servings,
        prepMin: r.prepMin,
        cookMin: r.cookMin,
        ingredients: rowsOf(r),
        steps: r.steps.length,
        timers: r.steps.flatMap((s, i) => s.timers.map((t) => [i, t.durationSec, t.maxSec])),
        videos: r.steps.flatMap((s, i) =>
          s.video === null ? [] : [[r.videos[s.video]!.youtubeId, r.videos[s.video]!.startSec, i]],
        ),
        notes: r.notes,
      }).toEqual(expected);
    });

    it('loses no text: every word is in the result or in a heading or metadata line', () => {
      const r = parse(text, name);
      const words = (s: string) =>
        s
          .toLowerCase()
          .replace(/https?:\/\/\S+/g, '')
          .match(/\p{L}{3,}/gu) ?? [];
      const kept = new Set(
        [
          r.title ?? '',
          r.notes ?? '',
          ...r.consumedLines,
          ...r.ingredients.flatMap((i) => [i.raw, i.groupLabel ?? '']),
          ...r.steps.map((s) => s.text),
        ].flatMap(words),
      );
      const lost = words(text).filter((w) => !kept.has(w) && !/^(видео|video|відео)$/.test(w));
      expect(lost).toEqual([]);
    });
  });

  it('meets the PRD 5.1 quality criterion over the whole set', () => {
    let sectionsOk = 0;
    let lines = 0;
    let linesOk = 0;
    for (const name of names) {
      const { text, expected } = load(name);
      const r = parse(text, name);
      const got = rowsOf(r);
      if (
        r.title === expected.title &&
        got.length === expected.ingredients.length &&
        r.steps.length === expected.steps
      )
        sectionsOk++;
      expected.ingredients.forEach((row, i) => {
        lines++;
        if (core(row) === core(got[i])) linesOk++;
      });
    }
    expect(sectionsOk / names.length).toBeGreaterThanOrEqual(0.9);
    expect(linesOk / lines).toBeGreaterThanOrEqual(0.9);
  });
});
