import { describe, expect, it } from 'vitest';
import { classifyProduct, isEgg } from '../src/index.js';

describe('classifyProduct: round_class and min_piece from the product dictionary (PRD 5.1.3)', () => {
  it.each<[string, string, number | null]>([
    ['яйца', 'whole_item', 1],
    ['Яйцо куриное', 'whole_item', 1],
    ['яйця', 'whole_item', 1],
    ['eggs', 'whole_item', 1],
    ['ägg', 'whole_item', 1],
    ['eggplant', 'continuous', null],
    ['äggplanta', 'continuous', null],
    ['лук репчатый', 'whole_item', 0.5],
    ['цибуля', 'whole_item', 0.5],
    ['onion', 'whole_item', 0.5],
    ['gul lök', 'whole_item', 0.5],
    ['чеснок', 'whole_item', 1],
    ['garlic', 'whole_item', 1],
    ['vitlök', 'whole_item', 1],
    ['лавровый лист', 'spice_item', 1],
    ['bay leaves', 'spice_item', 1],
    ['lagerblad', 'spice_item', 1],
    ['гвоздика', 'spice_item', 1],
    ['cloves', 'spice_item', 1],
    ['перец горошком', 'spice_item', 1],
    ['black peppercorns', 'spice_item', 1],
    ['мука', 'continuous', null],
    ['говяжий фарш', 'continuous', null],
    ['лук-порей', 'continuous', null],
  ])('%s -> %s', (name, roundClass, minPiece) => {
    expect(classifyProduct(name)).toEqual({ roundClass, minPiece });
  });
});

describe('isEgg: which whole items are whisked (D-037)', () => {
  it.each(['яйца', 'Яйцо куриное', '4 яиц', 'яйця', 'яєць', 'eggs', 'Egg yolk', 'ägg', 'Äggen'])(
    '%s is an egg',
    (name) => expect(isEgg(name)).toBe(true),
  );
  it.each(['чеснок', 'garlic', 'лук', 'яичный порошок', 'eggplant', 'baklažan', 'nutmeg'])(
    '%s is not',
    (name) => expect(isEgg(name)).toBe(false),
  );
});
