import type { RoundClass } from './types.js';

/**
 * Product dictionary for rounding classes (PRD 5.1.3): egg -> whole_item 1, onion -> whole_item 0.5,
 * garlic -> whole_item 1, bay leaf / clove / peppercorn -> spice_item 1, everything else continuous.
 * Matches word starts in ru, uk, en and sv. The review screen lets the author correct a wrong guess.
 */
type Rule = { re: RegExp; roundClass: RoundClass; minPiece: number | null };

const start = (stems: string[]) => new RegExp(`(^|[^\\p{L}])(${stems.join('|')})`, 'iu');
const word = (words: string[]) =>
  new RegExp(`(^|[^\\p{L}])(${words.join('|')})($|[^\\p{L}])`, 'iu');

const RULES: readonly Rule[] = [
  // Not whole onions: leek and green onion are used like herbs.
  {
    re: start([
      'лук-порей',
      'порей',
      'зелен[ыйого]* лук',
      'зелён[ыйого]* лук',
      'цибуля-порей',
      'зелена цибуля',
      'leek',
      'green onion',
      'spring onion',
      'scallion',
      'purjolök',
      'salladslök',
    ]),
    roundClass: 'continuous',
    minPiece: null,
  },
  { re: start(['яйц', 'яиц', 'egg', 'ägg']), roundClass: 'whole_item', minPiece: 1 },
  {
    re: start(['чеснок', 'чесноч', 'часник', 'garlic', 'vitlök']),
    roundClass: 'whole_item',
    minPiece: 1,
  },
  {
    re: start([
      'лавров',
      'bay lea',
      'lagerblad',
      'гвоздик',
      'kryddnejlik',
      'перец горошком',
      'перець горошком',
      'душист',
      'peppercorn',
      'pepparkorn',
      'kryddpeppar',
    ]),
    roundClass: 'spice_item',
    minPiece: 1,
  },
  { re: word(['cloves', 'clove']), roundClass: 'spice_item', minPiece: 1 },
  {
    re: start(['луковиц', 'цибул', 'onion', 'rödlök', 'gullök']),
    roundClass: 'whole_item',
    minPiece: 0.5,
  },
  { re: word(['лук', 'lök']), roundClass: 'whole_item', minPiece: 0.5 },
];

export function classifyProduct(name: string): { roundClass: RoundClass; minPiece: number | null } {
  const text = name.normalize('NFC');
  const rule = RULES.find((r) => r.re.test(text));
  return rule
    ? { roundClass: rule.roundClass, minPiece: rule.minPiece }
    : { roundClass: 'continuous', minPiece: null };
}
