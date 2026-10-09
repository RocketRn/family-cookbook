import { describe, expect, it } from 'vitest';
import {
  amountPreview,
  canonicalText,
  check,
  defaultShare,
  displayText,
  emptyIngredient,
  emptyRecipe,
  emptyStep,
  fromRecipe,
  insertion,
  moveIngredient,
  numberInput,
  parseStart,
  readAmount,
  removeIngredient,
  serverErrors,
  startInput,
  tokenLabels,
  toBody,
  type EdIngredient,
  type EdRecipe,
} from '../src/editor/model';
import { suggestTimer } from '../src/editor/parts';
import { GOLUBTSY } from './fixtures';

const RU = { recipeLang: 'ru' as const, uiLang: 'ru' as const };
const ing = (over: Partial<EdIngredient>): EdIngredient => ({ ...emptyIngredient(), ...over });

/** A small new recipe: sugar (1 cup) and eggs (3), one step that uses both. */
function sharlotka(): EdRecipe {
  const r = emptyRecipe('ru', true);
  const sugar = ing({ key: 'n-sugar', name: 'сахар', amount: '1', unitCode: 'cup' });
  const eggs = ing({ key: 'n-eggs', name: 'яйца', amount: '3', unitCode: 'pcs' });
  return {
    ...r,
    title: ' Шарлотка ',
    ingredients: [sugar, eggs],
    steps: [
      {
        ...emptyStep(),
        key: 's-1',
        text: 'Взбейте {ing:n-eggs} с {ing:n-sugar}.',
        links: [
          { key: 'n-eggs', share: 1 },
          { key: 'n-sugar', share: 1 },
        ],
      },
    ],
  };
}

describe('editor model: numbers as the author types them', () => {
  it('shows stored amounts with fraction glyphs and the recipe language decimal mark', () => {
    expect(numberInput(1.5, 'ru')).toBe('1½');
    expect(numberInput(0.5, 'ru')).toBe('½');
    expect(numberInput(1 / 3, 'en')).toBe('⅓');
    expect(numberInput(0.3, 'ru')).toBe('0,3');
    expect(numberInput(0.3, 'en')).toBe('0.3');
    expect(numberInput(800, 'sv')).toBe('800');
  });

  it('reads amounts through recipe-core: ranges, fractions, decimal comma', () => {
    expect(readAmount(ing({ amount: '4–5' }))).toEqual({ kind: 'range', min: 4, max: 5 });
    expect(readAmount(ing({ amount: '1,5' }))).toEqual({ kind: 'exact', min: 1.5, max: 1.5 });
    expect(readAmount(ing({ amount: '½' }))).toEqual({ kind: 'exact', min: 0.5, max: 0.5 });
    expect(readAmount(ing({ amount: '' }))).toBeNull(); // "exact" needs a number
    expect(readAmount(ing({ amount: 'много' }))).toBeNull();
    expect(readAmount(ing({ amount: '0' }))).toBeNull();
    expect(readAmount(ing({ kind: 'to_taste' }))).toEqual({
      kind: 'to_taste',
      min: null,
      max: null,
    });
  });

  it('reads a video start as m:ss or h:mm:ss', () => {
    expect(parseStart('1:35')).toBe(95);
    expect(parseStart('1:02:03')).toBe(3723);
    expect(parseStart('45')).toBe(45);
    expect(parseStart('1:75')).toBeNull();
    expect(parseStart('abc')).toBeNull();
    expect(startInput(95)).toBe('1:35');
    expect(startInput(3723)).toBe('1:02:03');
  });
});

describe('editor model: [Name] tokens in step text (owner decision: "name (amount)")', () => {
  it('shows placeholders as names and turns them back into placeholders', () => {
    const r = sharlotka();
    const labels = tokenLabels(r.ingredients);
    const shown = displayText(r.steps[0]!.text, labels);
    expect(shown).toBe('Взбейте [яйца] с [сахар].');
    expect(canonicalText(shown, labels)).toBe(r.steps[0]!.text);
  });

  it('a renamed ingredient keeps its placeholders (they point at the line, not the word)', () => {
    const r = sharlotka();
    const renamed = r.ingredients.map((i) =>
      i.key === 'n-sugar' ? { ...i, name: 'сахар-песок' } : i,
    );
    expect(displayText(r.steps[0]!.text, tokenLabels(renamed))).toBe(
      'Взбейте [яйца] с [сахар-песок].',
    );
  });

  it('two lines with the same name get the section (or a number) in their label', () => {
    const labels = tokenLabels([
      ing({ key: 'a', name: 'соль', group: 'Для теста' }),
      ing({ key: 'b', name: 'Соль', group: 'Для начинки' }),
      ing({ key: 'c', name: 'вода' }),
      ing({ key: 'd', name: 'вода' }),
    ]);
    expect([...labels.values()]).toEqual([
      'соль · Для теста',
      'Соль · Для начинки',
      'вода 1',
      'вода 2',
    ]);
  });

  it('brackets that are not an ingredient stay text; typed "{ing:" never becomes a placeholder', () => {
    const labels = tokenLabels(sharlotka().ingredients);
    expect(canonicalText('[примечание] и {ing:n-sugar}', labels)).toBe(
      '[примечание] и { ing:n-sugar}',
    );
  });

  it('inserts the name and the amount placeholder', () => {
    const r = sharlotka();
    expect(insertion(r.ingredients[0]!, tokenLabels(r.ingredients))).toBe('сахар ([сахар])');
  });

  it('previews a placeholder as the amount, or as the step share of it (D-029)', () => {
    const sugar = sharlotka().ingredients[0]!;
    expect(amountPreview(sugar, 1, RU)).toBe('1 стакан');
    expect(amountPreview({ ...sugar, amount: '2' }, 0.5, RU)).toBe('1 стакан');
  });
});

describe('editor model: checks before saving', () => {
  it('a draft needs a title and readable amounts; empty lines are left out, not reported', () => {
    const r = sharlotka();
    r.ingredients.push(emptyIngredient());
    r.steps.push(emptyStep());
    expect(check(r, true)).toEqual({});
    expect(check({ ...r, title: '  ' }, false)).toEqual({ title: 'title' });
    const bad = { ...r, ingredients: [ing({ key: 'x', name: 'мука', amount: 'стакан' })] };
    expect(check(bad, false)).toEqual({ 'ing:x:amount': 'amount' });
    expect(check({ ...r, prepMin: '1,5', cookMin: '99999' }, false)).toEqual({
      prep: 'minutes',
      cook: 'minutes',
    });
  });

  it('publishing also needs an ingredient and a step with text (PRD 2.2 step 10)', () => {
    const r = { ...emptyRecipe('ru', true), title: 'Чай' };
    expect(check(r, false)).toEqual({});
    expect(check(r, true)).toEqual({ ingredients: 'missing_ingredients', steps: 'missing_steps' });
  });

  it('a new section must be named; parts of one ingredient may not add up to more than all', () => {
    const r = sharlotka();
    r.ingredients.push(ing({ key: 'n-apple', group: '', name: 'яблоки', amount: '4' }));
    r.steps.push({
      ...emptyStep(),
      key: 's-2',
      text: 'Ещё сахар.',
      links: [{ key: 'n-sugar', share: 0.5 }],
    });
    expect(check(r, false)).toEqual({
      'section:n-apple': 'section',
      'step:s-1:shares': 'shares',
      'step:s-2:shares': 'shares',
    });
  });

  it('timers need minutes; a video needs a YouTube link and a readable start', () => {
    const r = sharlotka();
    r.steps[0] = {
      ...r.steps[0]!,
      timers: [{ key: 't1', label: 'Взбивать', minutes: '0' }],
      video: 'https://example.com/v',
      videoStart: '1:99',
    };
    expect(check(r, false)).toEqual({
      'step:s-1:timer:t1': 'timer',
      'step:s-1:video': 'video',
      'step:s-1:video_start': 'video_start',
    });
  });
});

describe('editor model: the API body (D-022)', () => {
  it('a new recipe: refs, amounts, units, links, placeholders, timers and one video entry', () => {
    const r = sharlotka();
    r.ingredients.push(ing({ key: 'n-salt', name: 'соль', kind: 'pinch', unitCode: 'g' }));
    r.ingredients.push(ing({ key: 'n-apple', name: 'яблоки', amount: '4–5' }));
    r.ingredients.push(emptyIngredient()); // left out
    r.steps[0]!.timers = [{ key: 't1', label: ' Взбивать ', minutes: '1,5' }];
    r.steps[0]!.video = 'https://youtu.be/aqz-KE-bpKQ?t=30';
    r.steps.push({
      ...emptyStep(),
      key: 's-2',
      text: 'Ещё раз.',
      video: 'aqz-KE-bpKQ',
      videoStart: '2:00',
    });
    r.tags = ['baking'];
    r.customTags = [' бабушкин '];
    const { body, ingredientKeys, stepKeys } = toBody(r, 'published');
    expect(body).toMatchObject({
      title: 'Шарлотка',
      servings: 4,
      status: 'published',
      visibility: 'book',
      language: 'ru',
      tags: ['baking', 'бабушкин'],
      cover_media_id: null,
    });
    expect(body.ingredients).toEqual([
      expect.objectContaining({
        ref: 'n-sugar',
        name: 'сахар',
        qty_kind: 'exact',
        amount_min: 1,
        amount_max: null,
        unit_code: 'cup',
      }),
      expect.objectContaining({
        ref: 'n-eggs',
        qty_kind: 'exact',
        amount_min: 3,
        unit_code: 'pcs',
      }),
      expect.objectContaining({
        ref: 'n-salt',
        qty_kind: 'pinch',
        amount_min: null,
        unit_code: null,
      }),
      expect.objectContaining({ ref: 'n-apple', qty_kind: 'range', amount_min: 4, amount_max: 5 }),
    ]);
    expect(body.ingredients[0]).not.toHaveProperty('id');
    expect(body.ingredients[0]).not.toHaveProperty('round_class'); // the API classifies by name
    expect(body.steps[0]).toEqual({
      title: null,
      body: 'Взбейте {ing:n-eggs} с {ing:n-sugar}.',
      photo_media_id: null,
      video_ref: 'v1',
      video_start_sec: 30,
      ingredients: [
        { ref: 'n-eggs', portion_fraction: 1 },
        { ref: 'n-sugar', portion_fraction: 1 },
      ],
      timers: [{ label: 'Взбивать', duration_sec: 90 }],
    });
    expect(body.steps[1]).toMatchObject({ video_ref: 'v1', video_start_sec: 120 });
    expect(body.videos).toEqual([{ ref: 'v1', youtube_id: 'aqz-KE-bpKQ' }]);
    expect(ingredientKeys).toEqual(['n-sugar', 'n-eggs', 'n-salt', 'n-apple']);
    expect(stepKeys).toEqual(['s-1', 's-2']);
  });

  it('an existing recipe goes back with its ids, placeholders, portions, photos and videos', () => {
    const ed = fromRecipe(GOLUBTSY, 'en');
    expect(ed.ingredients.map((i) => i.amount)).toEqual(['1', '800', '½', '', '2', '']);
    expect(ed.tags).toEqual(['main']);
    expect(ed.customTags).toEqual(['бабушкин рецепт']);
    expect(ed.steps[1]).toMatchObject({
      video: 'https://youtu.be/dQw4w9WgXcQ',
      videoStart: '1:35',
    });
    expect(ed.steps[1]!.timers[0]).toMatchObject({ label: 'Тушить', minutes: '90' });
    expect(displayText(ed.steps[0]!.text, tokenLabels(ed.ingredients))).toBe(
      'Смешайте [Говяжий фарш] фарша и [Рис] риса. <b>не HTML</b>',
    );

    const { body } = toBody(ed, 'published');
    expect(body.ingredients.map((i) => i.id)).toEqual(GOLUBTSY.ingredients.map((i) => i.id));
    expect(body.ingredients[0]).toMatchObject({
      unit_code: null,
      unit_raw: 'кочан',
      amount_min: 1,
    });
    // Saved lines keep their rounding while their name is the same; a renamed one leaves it to the API.
    expect(body.ingredients[0]).toMatchObject({ round_class: 'whole_item', min_piece: 1 });
    const renamed = toBody(
      {
        ...ed,
        ingredients: ed.ingredients.map((i, n) => (n === 0 ? { ...i, name: 'Капуста белая' } : i)),
      },
      'published',
    ).body;
    expect(renamed.ingredients[0]).not.toHaveProperty('round_class');
    expect(body.ingredients[3]).toMatchObject({ qty_kind: 'to_taste', amount_min: null });
    expect(body.steps[0]).toMatchObject({
      id: GOLUBTSY.steps[0]!.id,
      body: GOLUBTSY.steps[0]!.body,
    });
    expect(body.steps[0]!.ingredients).toEqual([
      { ref: GOLUBTSY.ingredients[1]!.id, portion_fraction: 1 },
      { ref: GOLUBTSY.ingredients[2]!.id, portion_fraction: 0.5 },
    ]);
    expect(body.steps[1]).toMatchObject({
      photo_media_id: GOLUBTSY.steps[1]!.photo!.id,
      video_start_sec: 95,
      timers: [{ label: 'Тушить', duration_sec: 5400 }],
    });
    // The step video keeps a new ref; the recipe video no step uses keeps its id.
    expect(body.videos).toEqual([
      { ref: GOLUBTSY.videos[1]!.id, id: GOLUBTSY.videos[1]!.id, youtube_id: 'aqz-KE-bpKQ' },
      { ref: 'v2', youtube_id: 'dQw4w9WgXcQ' },
    ]);
    expect(body.cover_media_id).toBe(GOLUBTSY.cover!.id);
    expect(body.tags).toEqual(['main', 'бабушкин рецепт']);
  });
});

describe('editor model: edits that touch several parts', () => {
  it('removing an ingredient unlinks it and writes its amount into the step text', () => {
    const r = removeIngredient(sharlotka(), 'n-sugar', RU);
    expect(r.ingredients.map((i) => i.key)).toEqual(['n-eggs']);
    expect(r.steps[0]!.text).toBe('Взбейте {ing:n-eggs} с 1 стакан.');
    expect(r.steps[0]!.links).toEqual([{ key: 'n-eggs', share: 1 }]);
  });

  it('moving a line past a section edge moves it into that section first', () => {
    const list = [
      ing({ key: 'a', group: 'Тесто' }),
      ing({ key: 'b', group: 'Тесто' }),
      ing({ key: 'c', group: 'Начинка' }),
    ];
    const once = moveIngredient(list, 'c', -1);
    expect(once.map((i) => [i.key, i.group])).toEqual([
      ['a', 'Тесто'],
      ['b', 'Тесто'],
      ['c', 'Тесто'],
    ]);
    expect(moveIngredient(once, 'c', -1).map((i) => i.key)).toEqual(['a', 'c', 'b']);
    expect(moveIngredient(list, 'a', -1)).toBe(list);
  });

  it('a new link gets what other steps left of the ingredient', () => {
    const r = sharlotka();
    r.steps[0]!.links = [{ key: 'n-sugar', share: 2 / 3 }];
    r.steps.push({ ...emptyStep(), key: 's-2' });
    expect(defaultShare(r.steps, 'n-sugar', 's-2')).toBeCloseTo(1 / 3, 4);
    expect(defaultShare(r.steps, 'n-eggs', 's-2')).toBe(1);
  });
});

describe('editor model: server errors land on fields', () => {
  const keys = { ingredientKeys: ['n-sugar', 'n-eggs'], stepKeys: ['s-1'] };
  it('NOT_PUBLISHABLE lists the missing parts', () => {
    expect(serverErrors('NOT_PUBLISHABLE', { missing: ['ingredients', 'steps'] }, keys)).toEqual({
      ingredients: 'missing_ingredients',
      steps: 'missing_steps',
    });
  });
  it('VALIDATION_ERROR paths point at the line that was sent', () => {
    expect(
      serverErrors(
        'VALIDATION_ERROR',
        [
          { path: 'ingredients[1].amount_min', message: 'x' },
          { path: 'steps[0].body', message: 'x' },
          { path: 'title', message: 'x' },
        ],
        keys,
      ),
    ).toEqual({ 'ing:n-eggs:amount': 'amount', 'step:s-1:text': 'step', title: 'title' });
    expect(serverErrors('INTERNAL', undefined, keys)).toBeNull();
  });
});

describe('editor: a new timer comes from the step text', () => {
  it('takes the first duration that has no timer yet, with the parser label', () => {
    const step = {
      ...emptyStep(),
      text: 'Взбейте яйца с сахаром. Взбивайте 5 минут, затем выпекайте 40 минут.',
    };
    const first = suggestTimer(step, [], RU);
    expect(first).toMatchObject({ minutes: '5', label: 'Взбивайте 5 минут' });
    const second = suggestTimer({ ...step, timers: [first] }, [], RU);
    expect(second).toMatchObject({ minutes: '40', label: 'затем выпекайте 40 минут' });
    const none = suggestTimer({ ...step, text: 'Подавайте горячим. Приятного аппетита!' }, [], RU);
    expect(none).toMatchObject({ minutes: '', label: 'Подавайте горячим' });
  });
});
