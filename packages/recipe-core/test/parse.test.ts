/**
 * BE-06 parser unit tests (PRD 5.1), written BEFORE the parser.
 * The PRD 5.1.3 table is reproduced exactly, confidence included.
 */
import { describe, expect, it } from 'vitest';
import {
  detectLanguage,
  findDurations,
  parseIngredientLine,
  parseRecipeText,
  type Lang,
} from '../src/index.js';

const line = (text: string, lang: Lang = 'ru') => {
  const p = parseIngredientLine(text, lang);
  return {
    kind: p.qtyKind,
    min: p.amountMin,
    max: p.amountMax,
    unit: p.unitCode,
    name: p.name,
    note: p.note,
    confidence: p.confidence,
  };
};
const row = (
  kind: string,
  min: number | null,
  max: number | null,
  unit: string | null,
  name: string,
  confidence: number,
  note: string | null = null,
) => ({ kind, min, max, unit, name, note, confidence });

describe('PRD 5.1.3 table, exactly', () => {
  it.each([
    ['2 ст. л. муки', row('exact', 2, 2, 'tbsp', 'муки', 1)],
    ['800 г говяжьего фарша', row('exact', 800, 800, 'g', 'говяжьего фарша', 1)],
    ['1½ стакана молока', row('exact', 1.5, 1.5, 'cup', 'молока', 1)],
    ['яйца — 4 шт.', row('exact', 4, 4, 'pcs', 'яйца', 0.9)],
    ['200–300 мл воды', row('range', 200, 300, 'ml', 'воды', 1)],
    ['2 msk mjöl', row('exact', 2, 2, 'msk', 'mjöl', 1)],
    ['щепотка соли', row('pinch', null, null, null, 'соли', 1)],
    ['соль по вкусу', row('to_taste', null, null, null, 'соль', 1)],
    ['1 банка томатов (400 г)', row('exact', 1, 1, 'jar', 'томатов', 0.8, '400 г')],
    ['лавровый лист', row('unparsed', null, null, null, 'лавровый лист', 0.5)],
  ])('«%s»', (input, expected) => {
    expect(line(input)).toEqual(expected);
  });

  it('gives the reasons for a lower confidence', () => {
    expect(parseIngredientLine('яйца — 4 шт.', 'ru').reasons).toEqual(['p4']);
    expect(parseIngredientLine('1 банка томатов (400 г)', 'ru').reasons).toEqual(['bracket']);
    expect(parseIngredientLine('лавровый лист', 'ru').reasons).toEqual(['unparsed']);
    expect(parseIngredientLine('мука — 1 (стакан с горкой, 160 г)', 'ru')).toMatchObject({
      confidence: 0.5,
      reasons: ['p4', 'no_unit', 'bracket'],
      note: 'стакан с горкой, 160 г',
    });
    expect(parseIngredientLine('2 яйца', 'ru')).toMatchObject({
      confidence: 0.8,
      reasons: ['no_unit'],
    });
  });
});

describe('ingredient lines as people write them', () => {
  it.each<[string, Lang, ReturnType<typeof row>]>([
    ['½ ч. л. соли', 'ru', row('exact', 0.5, 0.5, 'tsp', 'соли', 1)],
    ['1/2 ч.л. соды', 'ru', row('exact', 0.5, 0.5, 'tsp', 'соды', 1)],
    ['0,5 кг творога', 'ru', row('exact', 0.5, 0.5, 'kg', 'творога', 1)],
    ['1 1/2 cups flour', 'en', row('exact', 1.5, 1.5, 'cup', 'flour', 1)],
    ['2 cups of flour', 'en', row('exact', 2, 2, 'cup', 'flour', 1)],
    ['200г муки', 'ru', row('exact', 200, 200, 'g', 'муки', 1)],
    ['2-3 зубчика чеснока', 'ru', row('range', 2, 3, 'clove', 'чеснока', 1)],
    ['3 dl vetemjöl', 'sv', row('exact', 3, 3, 'dl', 'vetemjöl', 1)],
    ['1 склянка борошна', 'uk', row('exact', 1, 1, 'cup', 'борошна', 1)],
    ['Мука: 200 г', 'ru', row('exact', 200, 200, 'g', 'Мука', 0.9)],
    ['a pinch of salt', 'en', row('pinch', null, null, null, 'salt', 1)],
    ['Сіль — щіпка', 'uk', row('pinch', null, null, null, 'Сіль', 1)],
    ['salt and pepper to taste', 'en', row('to_taste', null, null, null, 'salt and pepper', 1)],
    ['Соль, перец — по вкусу', 'ru', row('to_taste', null, null, null, 'Соль, перец', 1)],
    ['сіль за смаком', 'uk', row('to_taste', null, null, null, 'сіль', 1)],
    ['salt och peppar efter smak', 'sv', row('to_taste', null, null, null, 'salt och peppar', 1)],
    ['соль, перец', 'ru', row('to_taste', null, null, null, 'соль, перец', 1)],
    [
      'немного муки для обвалки',
      'ru',
      row('unparsed', null, null, null, 'немного муки для обвалки', 0.5),
    ],
  ])('«%s»', (input, lang, expected) => {
    expect(line(input, lang)).toEqual(expected);
  });

  it('removes list markers and emoji; keeps the raw line', () => {
    const p = parseIngredientLine('• 🥚 2 яйца', 'ru');
    expect(p).toMatchObject({
      qtyKind: 'exact',
      amountMin: 2,
      name: 'яйца',
      roundClass: 'whole_item',
      minPiece: 1,
    });
    expect(p.raw).toBe('🥚 2 яйца');
  });

  it('keeps an unknown unit word after a P4 amount as written', () => {
    expect(parseIngredientLine('Капуста — 1 кочан', 'ru')).toMatchObject({
      amountMin: 1,
      unitCode: null,
      unitRaw: 'кочан',
      name: 'Капуста',
      confidence: 0.7,
    });
  });
});

describe('durations → timer suggestions (PRD 5.1.4)', () => {
  const sec = (text: string) => findDurations(text).map((t) => [t.durationSec, t.maxSec]);
  it.each([
    ['Выпекайте 40 минут при 180 °C.', [[2400, null]]],
    ['Варите 10–15 мин', [[600, 900]]],
    ['Тушите 1,5 часа', [[5400, null]]],
    ['Тушите 1 ч 20 мин под крышкой', [[4800, null]]],
    [
      'Simmer for 20-25 minutes, then rest 5 min.',
      [
        [1200, 1500],
        [300, null],
      ],
    ],
    ['Grädda i 25 minuter', [[1500, null]]],
    ['Låt vila 1 timme', [[3600, null]]],
    ['Варіть 20 хвилин', [[1200, null]]],
    [
      'Отварите 2 часа и ещё 30 сек',
      [
        [7200, null],
        [30, null],
      ],
    ],
  ])('«%s»', (text, expected) => {
    expect(sec(text)).toEqual(expected);
  });

  it('ignores numbers that are not durations', () => {
    expect(findDurations('Нагрейте до 180 °C, минимум 3 яйца, в 2 раза больше')).toEqual([]);
  });

  it('labels a timer with the text around it, and a range names its upper bound', () => {
    expect(findDurations('Выпекайте 40 минут при 180 °C. Остудите.')[0]!.label).toBe(
      'Выпекайте 40 минут при 180 °C',
    );
    expect(findDurations('Варите 10–15 мин')[0]!.label).toContain('15');
  });
});

describe('language of the text', () => {
  it.each<[string, Lang]>([
    ['Шарлотка\nИнгредиенты\n3 яйца', 'ru'],
    ['Вареники\nІнгредієнти\nборошно', 'uk'],
    ['Pannkakor\n3 dl mjölk', 'sv'],
    ['Pancakes\n2 cups flour', 'en'],
  ])('%#', (text, lang) => {
    expect(detectLanguage(text, 'ru')).toBe(lang);
  });
  it('falls back to the caller language without letters', () => {
    expect(detectLanguage('123 456', 'sv')).toBe('sv');
  });
});

describe('whole texts (PRD 5.1.1, 5.1.2)', () => {
  it('headings in any of the 4 languages; a trailing period means it is not a heading', () => {
    const r = parseRecipeText(
      'Тест\n\nИнгредиенты.\n2 яйца\n\nСпособ приготовления:\nВзбейте яйца.',
      {
        fallbackLang: 'ru',
      },
    );
    expect(r.steps.map((s) => s.text)).toEqual(['Взбейте яйца.']);
    expect(r.ingredients.map((i) => i.name)).toEqual(['яйца']);
    expect(r.notes).toContain('Ингредиенты.');
  });

  it('subheadings become section labels for the following lines', () => {
    const r = parseRecipeText(
      'Торт\nIngredients\nFor the dough:\n200 g flour\n2 eggs\nFor the cream:\n200 ml cream\nMethod\nMix.',
      { fallbackLang: 'en' },
    );
    expect(r.ingredients.map((i) => [i.groupLabel, i.name])).toEqual([
      ['For the dough', 'flour'],
      ['For the dough', 'eggs'],
      ['For the cream', 'cream'],
    ]);
  });

  it('metadata only from explicit phrases; difficulty is never guessed', () => {
    const r = parseRecipeText(
      'Суп\nНа 4 порции\nВремя подготовки: 15 мин\nВремя приготовления: 1 ч 20 мин\n\nИнгредиенты\n1 л воды\n\nПриготовление\nВарите.',
      { fallbackLang: 'ru' },
    );
    expect([r.servings, r.prepMin, r.cookMin]).toEqual([4, 15, 80]);
    expect(r.consumedLines).toEqual(
      expect.arrayContaining(['На 4 порции', 'Время подготовки: 15 мин']),
    );
    expect(parseRecipeText('Soup\nServes 6\n2 cups water', { fallbackLang: 'en' }).servings).toBe(
      6,
    );
    expect(
      parseRecipeText('Soppa\nPortioner: 2\n1 l vatten', { fallbackLang: 'sv' }).servings,
    ).toBe(2);
  });

  it('without steps the whole text becomes one step, with a warning; nothing is lost', () => {
    const r = parseRecipeText('Просто смешайте всё', { fallbackLang: 'ru' });
    expect(r.warnings).toContain('no_steps');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.text).toContain('Просто смешайте всё');
  });

  it('links ingredients to the steps that mention them (stems, PRD 5.1.4)', () => {
    const r = parseRecipeText(
      'Тесто\nИнгредиенты\n800 г говяжьего фарша\n2 яйца\n1 стакан сахара\n1 луковица\nПриготовление\n1. Посолите фарш.\n2. Взбейте яйца с сахаром.\n3. Обжарьте нарезанную луковицу.',
      { fallbackLang: 'ru' },
    );
    expect(r.steps.map((s) => s.links)).toEqual([[0], [1, 2], [3]]);
  });

  it('moves YouTube links to videos and attaches them to their step', () => {
    const r = parseRecipeText(
      'Пирог\nИнгредиенты\n2 яйца\nПриготовление\n1. Смешайте.\n2. Выпекайте 30 минут. Видео: https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90s',
      { fallbackLang: 'ru' },
    );
    expect(r.videos).toEqual([{ youtubeId: 'aqz-KE-bpKQ', startSec: 90 }]);
    expect(r.steps[1]).toMatchObject({ video: 0, text: 'Выпекайте 30 минут.' });
  });
});
