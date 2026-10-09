import type { Lang } from './types.js';
import { LANGS } from './types.js';

/**
 * THE unit list: single source of truth for the engine, the formatter, the future parser (BE-06)
 * and the database `units` table, which `pnpm db:migrate` fills from this list (D-021).
 */
export type Dimension = 'mass' | 'volume' | 'count' | 'other';
/** How amounts in this unit are rounded when the ingredient's round_class is `continuous`. */
export type UnitFamily = 'metric' | 'tsp' | 'tbsp' | 'cup' | 'count';
/** A label without plural forms, or forms picked by plural category (Intl.PluralRules). */
export type Label = string | { one: string; few?: string; many?: string; other: string };

export type UnitDef = {
  code: string;
  dimension: Dimension;
  /** Multiplier to g or ml; only for exact metric units. Inexact measures are null until stage 2. */
  toBase: number | null;
  family: UnitFamily;
  aliases: Record<Lang, readonly string[]>;
  labels: Record<Lang, Label>;
};

const ru = (one: string, few: string, many: string, other: string) => ({ one, few, many, other });

export const UNITS: readonly UnitDef[] = [
  {
    code: 'g',
    dimension: 'mass',
    toBase: 1,
    family: 'metric',
    aliases: {
      ru: ['г', 'гр', 'грамм', 'грамма', 'граммов'],
      uk: ['г', 'гр', 'грам', 'грама', 'грамів'],
      en: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'],
      sv: ['g', 'gram'],
    },
    labels: { ru: 'г', uk: 'г', en: 'g', sv: 'g' },
  },
  {
    code: 'kg',
    dimension: 'mass',
    toBase: 1000,
    family: 'metric',
    aliases: {
      ru: ['кг', 'килограмм', 'килограмма', 'килограммов'],
      uk: ['кг', 'кілограм', 'кілограма', 'кілограмів'],
      en: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'],
      sv: ['kg', 'kilo'],
    },
    labels: { ru: 'кг', uk: 'кг', en: 'kg', sv: 'kg' },
  },
  {
    code: 'ml',
    dimension: 'volume',
    toBase: 1,
    family: 'metric',
    aliases: {
      ru: ['мл', 'миллилитр', 'миллилитра', 'миллилитров'],
      uk: ['мл', 'мілілітр', 'мілілітра', 'мілілітрів'],
      en: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
      sv: ['ml', 'milliliter'],
    },
    labels: { ru: 'мл', uk: 'мл', en: 'ml', sv: 'ml' },
  },
  {
    code: 'l',
    dimension: 'volume',
    toBase: 1000,
    family: 'metric',
    aliases: {
      ru: ['л', 'литр', 'литра', 'литров'],
      uk: ['л', 'літр', 'літра', 'літрів'],
      en: ['l', 'liter', 'liters', 'litre', 'litres'],
      sv: ['l', 'liter'],
    },
    labels: { ru: 'л', uk: 'л', en: 'l', sv: 'l' },
  },
  {
    // Exactly 100 ml, but Swedish measures convert only with the stage-2 reference (brief, PRD 7.4).
    code: 'dl',
    dimension: 'volume',
    toBase: null,
    family: 'cup',
    aliases: { ru: ['дл'], uk: ['дл'], en: ['dl'], sv: ['dl', 'deciliter'] },
    labels: { ru: 'дл', uk: 'дл', en: 'dl', sv: 'dl' },
  },
  {
    code: 'tsp',
    dimension: 'volume',
    toBase: null,
    family: 'tsp',
    aliases: {
      ru: ['ч. л.', 'ч.л.', 'чл', 'чайная ложка', 'чайной ложки', 'чайных ложек', 'чайные ложки'],
      uk: ['ч. л.', 'ч.л.', 'чайна ложка', 'чайної ложки', 'чайних ложок', 'чайні ложки'],
      en: ['tsp', 'teaspoon', 'teaspoons'],
      sv: [],
    },
    labels: { ru: 'ч. л.', uk: 'ч. л.', en: 'tsp', sv: 'tsk' },
  },
  {
    code: 'tbsp',
    dimension: 'volume',
    toBase: null,
    family: 'tbsp',
    aliases: {
      ru: [
        'ст. л.',
        'ст.л.',
        'стл',
        'столовая ложка',
        'столовой ложки',
        'столовых ложек',
        'столовые ложки',
      ],
      uk: ['ст. л.', 'ст.л.', 'столова ложка', 'столової ложки', 'столових ложок', 'столові ложки'],
      en: ['tbsp', 'tbs', 'tablespoon', 'tablespoons'],
      sv: [],
    },
    labels: { ru: 'ст. л.', uk: 'ст. л.', en: 'tbsp', sv: 'msk' },
  },
  {
    code: 'cup',
    dimension: 'volume',
    toBase: null,
    family: 'cup',
    aliases: {
      ru: ['стакан', 'стакана', 'стаканов', 'стаканы'],
      uk: ['склянка', 'склянки', 'склянок'],
      en: ['cup', 'cups'],
      sv: ['kopp', 'koppar'],
    },
    labels: {
      ru: ru('стакан', 'стакана', 'стаканов', 'стакана'),
      uk: ru('склянка', 'склянки', 'склянок', 'склянки'),
      en: { one: 'cup', other: 'cups' },
      sv: { one: 'kopp', other: 'koppar' },
    },
  },
  {
    code: 'msk',
    dimension: 'volume',
    toBase: null,
    family: 'tbsp',
    aliases: { ru: [], uk: [], en: [], sv: ['msk', 'matsked', 'matskedar'] },
    labels: { ru: 'ст. л.', uk: 'ст. л.', en: 'tbsp', sv: 'msk' },
  },
  {
    code: 'tsk',
    dimension: 'volume',
    toBase: null,
    family: 'tsp',
    aliases: { ru: [], uk: [], en: [], sv: ['tsk', 'tesked', 'teskedar'] },
    labels: { ru: 'ч. л.', uk: 'ч. л.', en: 'tsp', sv: 'tsk' },
  },
  {
    code: 'krm',
    dimension: 'volume',
    toBase: null,
    family: 'tsp',
    aliases: { ru: [], uk: [], en: [], sv: ['krm', 'kryddmått'] },
    labels: { ru: 'krm', uk: 'krm', en: 'krm', sv: 'krm' },
  },
  {
    code: 'pcs',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: {
      ru: ['шт', 'шт.', 'штука', 'штуки', 'штук'],
      uk: ['шт', 'шт.', 'штука', 'штуки', 'штук'],
      en: ['pc', 'pcs', 'piece', 'pieces'],
      sv: ['st', 'st.', 'styck', 'stycken'],
    },
    labels: { ru: 'шт.', uk: 'шт.', en: { one: 'pc', other: 'pcs' }, sv: 'st' },
  },
  {
    code: 'clove',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: {
      ru: ['зубчик', 'зубчика', 'зубчиков', 'зуб.'],
      uk: ['зубчик', 'зубчика', 'зубчики', 'зубчиків'],
      en: ['clove', 'cloves'],
      sv: ['klyfta', 'klyftor'],
    },
    labels: {
      ru: ru('зубчик', 'зубчика', 'зубчиков', 'зубчика'),
      uk: ru('зубчик', 'зубчики', 'зубчиків', 'зубчика'),
      en: { one: 'clove', other: 'cloves' },
      sv: { one: 'klyfta', other: 'klyftor' },
    },
  },
  {
    code: 'bunch',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: {
      ru: ['пучок', 'пучка', 'пучков'],
      uk: ['пучок', 'пучки', 'пучків'],
      en: ['bunch', 'bunches'],
      sv: ['knippe', 'knippen'],
    },
    labels: {
      ru: ru('пучок', 'пучка', 'пучков', 'пучка'),
      uk: ru('пучок', 'пучки', 'пучків', 'пучка'),
      en: { one: 'bunch', other: 'bunches' },
      sv: { one: 'knippe', other: 'knippen' },
    },
  },
  {
    code: 'jar',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: {
      ru: ['банка', 'банки', 'банок'],
      uk: ['банка', 'банки', 'банок'],
      en: ['jar', 'jars'],
      sv: ['burk', 'burkar'],
    },
    labels: {
      ru: ru('банка', 'банки', 'банок', 'банки'),
      uk: ru('банка', 'банки', 'банок', 'банки'),
      en: { one: 'jar', other: 'jars' },
      sv: { one: 'burk', other: 'burkar' },
    },
  },
  {
    code: 'can',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: { ru: [], uk: [], en: ['can', 'cans', 'tin', 'tins'], sv: [] },
    labels: {
      ru: ru('банка', 'банки', 'банок', 'банки'),
      uk: ru('банка', 'банки', 'банок', 'банки'),
      en: { one: 'can', other: 'cans' },
      sv: { one: 'burk', other: 'burkar' },
    },
  },
  {
    code: 'pack',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: {
      ru: ['пачка', 'пачки', 'пачек', 'упаковка', 'упаковки', 'упаковок'],
      uk: ['пачка', 'пачки', 'пачок', 'упаковка', 'упаковки', 'упаковок'],
      en: ['pack', 'packs', 'package', 'packages'],
      sv: ['paket', 'förpackning', 'förpackningar'],
    },
    labels: {
      ru: ru('пачка', 'пачки', 'пачек', 'пачки'),
      uk: ru('пачка', 'пачки', 'пачок', 'пачки'),
      en: { one: 'pack', other: 'packs' },
      sv: 'paket',
    },
  },
  {
    code: 'slice',
    dimension: 'count',
    toBase: null,
    family: 'count',
    aliases: {
      ru: ['ломтик', 'ломтика', 'ломтиков'],
      uk: ['скибка', 'скибки', 'скибок'],
      en: ['slice', 'slices'],
      sv: ['skiva', 'skivor'],
    },
    labels: {
      ru: ru('ломтик', 'ломтика', 'ломтиков', 'ломтика'),
      uk: ru('скибка', 'скибки', 'скибок', 'скибки'),
      en: { one: 'slice', other: 'slices' },
      sv: { one: 'skiva', other: 'skivor' },
    },
  },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]));
export const unitByCode = (code: string | null | undefined): UnitDef | undefined =>
  code ? BY_CODE.get(code) : undefined;

/** "Ст. Л." -> "стл": case, spaces and dots do not matter when matching an alias. */
export const normalizeUnitText = (s: string): string =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.]+/g, '');

const ALIAS_INDEX: Record<Lang, Map<string, string>> = Object.fromEntries(
  LANGS.map((l) => [
    l,
    new Map(UNITS.flatMap((u) => u.aliases[l].map((a) => [normalizeUnitText(a), u.code] as const))),
  ]),
) as Record<Lang, Map<string, string>>;

/** Unit code for a unit as written, preferring the recipe language, then any language; null if unknown. */
export function resolveUnit(raw: string, lang: Lang): string | null {
  const key = normalizeUnitText(raw);
  if (!key) return null;
  const own = ALIAS_INDEX[lang].get(key);
  if (own) return own;
  for (const l of LANGS) {
    const hit = ALIAS_INDEX[l].get(key);
    if (hit) return hit;
  }
  return null;
}
