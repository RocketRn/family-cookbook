import type { Lang } from '../types.js';

/** PRD 5.1.2 heading dictionary (compared after `fold` and without a trailing colon). */
export const HEADINGS: Record<
  'ingredients' | 'steps' | 'notes',
  Record<Lang, readonly string[]>
> = {
  ingredients: {
    ru: ['ингредиенты', 'состав', 'продукты'],
    uk: ['інгредієнти', 'склад', 'продукти'],
    en: ['ingredients'],
    sv: ['ingredienser'],
  },
  steps: {
    ru: ['приготовление', 'способ приготовления', 'как готовить', 'шаги'],
    uk: ['приготування', 'спосіб приготування', 'кроки'],
    en: ['directions', 'method', 'instructions', 'steps'],
    sv: ['gör så här', 'tillagning', 'instruktioner'],
  },
  notes: {
    ru: ['советы', 'заметки', 'примечание', 'примечания'],
    uk: ['поради', 'нотатки'],
    en: ['notes', 'tips'],
    sv: ['tips', 'anteckningar'],
  },
};

/** PRD 5.1.3 TASTE and PINCH, all languages (a line may mix them). Longest first. */
export const TASTE = ['по вкусу', 'на вкус', 'до смаку', 'за смаком', 'to taste', 'efter smak'];
export const PINCH = [
  'a pinch of',
  'pinch of',
  'en knivsudd',
  'en nypa',
  'щепотку',
  'щепотка',
  'щепотки',
  'щіпку',
  'щіпка',
  'щіпки',
  'knivsudd',
  'pinch',
  'nypa',
];
/** P5: a name made only of these becomes "to taste" (PRD: "salt, pepper"). */
export const SPICES = new Set([
  'соль',
  'перец',
  'черный перец',
  'молотый перец',
  'черный молотый перец',
  'сіль',
  'перець',
  'чорний перець',
  'salt',
  'pepper',
  'black pepper',
  'peppar',
  'svartpeppar',
  'vitpeppar',
]);
/** Words joining spices: "соль и перец", "salt and pepper". */
export const SPICE_SEPARATOR = /\s*(?:,|&|\s(?:и|і|та|and|och)\s)\s*/;
/** Section label inside an ingredient list: "Для теста:", "For the dough", "För degen". */
export const SUBHEADING_START = /^(?:для|for|för)\s/i;
/** Words that never make an ingredient-to-step link. */
export const STOP_WORDS = new Set([
  'для',
  'или',
  'без',
  'под',
  'при',
  'над',
  'або',
  'від',
  'the',
  'and',
  'for',
  'with',
  'och',
  'med',
  'för',
  'till',
]);

/** Duration units in seconds (PRD 5.1.4, plus Ukrainian). Longest spelling first. */
export const DURATION_UNITS: ReadonlyArray<[string, number]> = [
  ['часов', 3600],
  ['часа', 3600],
  ['час', 3600],
  ['ч', 3600],
  ['годин', 3600],
  ['години', 3600],
  ['годину', 3600],
  ['год', 3600],
  ['hours', 3600],
  ['hour', 3600],
  ['hrs', 3600],
  ['hr', 3600],
  ['h', 3600],
  ['timmar', 3600],
  ['timme', 3600],
  ['tim', 3600],
  ['минуты', 60],
  ['минут', 60],
  ['минуту', 60],
  ['мин', 60],
  ['хвилини', 60],
  ['хвилину', 60],
  ['хвилин', 60],
  ['хв', 60],
  ['minutes', 60],
  ['minute', 60],
  ['mins', 60],
  ['min', 60],
  ['minuter', 60],
  ['minut', 60],
  ['секунды', 1],
  ['секунд', 1],
  ['сек', 1],
  ['seconds', 1],
  ['second', 1],
  ['secs', 1],
  ['sec', 1],
  ['sekunder', 1],
  ['sek', 1],
];

/** Explicit metadata phrases only (PRD 5.1.1 stage 3). Lines of at most 60 characters. */
export const SERVINGS: readonly RegExp[] = [
  /^(?:на|for|för) (\d{1,3}) (?:порци\p{L}{0,3}|персон\p{L}{0,3}|человек\p{L}{0,2}|людей|осіб|personer|portioner|people|persons|servings)$/iu,
  /^(\d{1,3}) (?:порци\p{L}{0,3}|порці\p{L}{0,3}|portioner|servings|personer)$/iu,
  /^(?:на) (\d{1,3}) (?:порці\p{L}{0,3})$/iu,
  /^(?:порций|порции|количество порций|порцій|кількість порцій|portioner|antal portioner|serves|servings|yield|makes) ?:? ?(\d{1,3})(?: (?:people|persons|servings|portioner))?$/iu,
];
export const PREP_TIME =
  /^(?:время подготовки|подготовка|час підготовки|підготовка|prep(?:aration)?(?: time)?|förberedelsetid|förberedelse) ?:? ?(.{1,40})$/iu;
export const COOK_TIME =
  /^(?:время приготовления|время готовки|общее время|время|час приготування|загальний час|час|cook(?:ing)? time|total time|time|tillagningstid|total tid|tid) ?:? ?(.{1,40})$/iu;
