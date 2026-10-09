import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../src/api/types';
import { IMPORT_DRAFT_KEY } from '../src/editor/ImportScreen';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, KEEPER } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi, type Handler } from './harness';

/** FE-05 full import review (PRD 2.2 steps 6-9, 4.8 import-draft; D-043). */
const DRAFT_ID = '00000000-0000-4000-8000-0000000000e2';
const uid = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const ing = (n: number, name: string, over: Partial<Recipe['ingredients'][number]> = {}) => ({
  ...GOLUBTSY.ingredients[0]!,
  id: uid(n),
  position: n,
  name,
  qty_kind: 'exact' as const,
  amount_min: 1,
  amount_max: null,
  unit_code: null,
  unit_raw: null,
  round_class: 'continuous' as const,
  min_piece: null,
  optional: false,
  note: null,
  parse_confidence: 1,
  ...over,
});
const STEP = GOLUBTSY.steps[0]!;
const DRAFT: Recipe = {
  ...GOLUBTSY,
  id: DRAFT_ID,
  title: 'Шарлотка',
  author: KEEPER,
  status: 'draft',
  visibility: 'private',
  cover: null,
  tags: [],
  videos: [],
  ingredients: [
    ing(0, 'яйца', {
      group_label: 'Для теста',
      amount_min: 4,
      unit_code: 'pcs',
      raw_line: 'яйца — 4 шт.',
    }),
    ing(1, 'мука', { group_label: 'Для теста', unit_code: 'cup', raw_line: 'мука — 1 стакан' }),
    ing(2, 'яблоки', {
      group_label: 'Для начинки',
      amount_min: 4,
      unit_code: 'pcs',
      raw_line: 'яблоки — 4 шт.',
    }),
    ing(3, 'сахар', { group_label: 'Для начинки', unit_code: 'cup', raw_line: 'сахар — 1 стакан' }),
  ],
  steps: [
    {
      ...STEP,
      id: uid(50),
      position: 0,
      title: null,
      body: 'Взбейте яйца с мукой.',
      ingredients: [
        { ingredient_id: uid(0), portion_fraction: 1 },
        { ingredient_id: uid(1), portion_fraction: 1 },
      ],
      timers: [],
    },
    {
      ...STEP,
      id: uid(51),
      position: 1,
      title: null,
      body: 'Выпекайте 40 минут.',
      ingredients: [],
      timers: [{ id: uid(60), position: 0, label: 'Выпекайте', duration_sec: 2400 }],
    },
  ],
};
const TEXT = [
  'Шарлотка',
  'Для теста:',
  'яйца — 4 шт.',
  'мука — 1 стакан',
  'Для начинки:',
  'яблоки — 4 шт.',
  'сахар — 1 стакан',
  'Взбейте яйца с мукой.',
  'Выпекайте 40 минут.',
].join('\n');
const IMPORTED = {
  recipe: DRAFT,
  import: {
    lines: DRAFT.ingredients.map((i) => ({ ingredient_id: i.id, confidence: 1, reasons: [] })),
    warnings: [],
  },
};

function api(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [BOOK_LIST]: () => json(200, BOOK_PAGE),
    [`GET /api/recipes/${DRAFT_ID}`]: () => json(200, DRAFT),
    'POST /api/recipes/import': () => json(201, IMPORTED),
    [`PATCH /api/recipes/${DRAFT_ID}`]: (init) =>
      json(200, {
        ...DRAFT,
        ...JSON.parse(String(init.body)),
        ingredients: DRAFT.ingredients,
        steps: DRAFT.steps,
      }),
    ...extra,
  });
}
const saved = () => JSON.parse(localStorage.getItem(IMPORT_DRAFT_KEY) ?? 'null');
const patchBody = (calls: ReturnType<typeof api>) =>
  JSON.parse(calls.filter((c) => c.method === 'PATCH').at(-1)!.body!);
const stepCards = () => screen.getAllByTestId('step-card');

async function parsed() {
  const calls = api();
  const view = renderApp('/import');
  fireEvent.change(await screen.findByRole('textbox', { name: 'Paste recipe text' }), {
    target: { value: TEXT },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
  await screen.findByRole('heading', { name: 'Check the recipe' });
  return Object.assign(calls, { view });
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('full import review', () => {
  it('a timer the parser found is a suggestion: add it or skip it', async () => {
    const calls = await parsed();
    const step2 = stepCards()[1]!;
    const found = within(step2).getByRole('group', { name: 'Timer found: 40 min' });
    expect(found.textContent).toContain('Выпекайте');
    // Not an editable timer until it is added.
    expect(within(step2).queryByLabelText('Timer name')).toBeNull();
    fireEvent.click(within(found).getByRole('button', { name: 'Skip' }));
    expect(within(step2).queryByRole('group', { name: /Timer found/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(patchBody(calls).steps[1].timers).toEqual([]);
  });

  it('an added timer becomes an ordinary one and is saved', async () => {
    const calls = await parsed();
    const step2 = stepCards()[1]!;
    fireEvent.click(within(step2).getByRole('button', { name: 'Keep this timer' }));
    expect((within(step2).getByLabelText('Timer name') as HTMLInputElement).value).toBe(
      'Выпекайте',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(patchBody(calls).steps[1].timers).toEqual([{ label: 'Выпекайте', duration_sec: 2400 }]);
  });

  it('suggested ingredient links: keep or remove each one', async () => {
    const calls = await parsed();
    const step1 = stepCards()[0]!;
    const group = within(step1).getByRole('group', { name: 'Suggested ingredients' });
    fireEvent.click(within(group).getByRole('button', { name: 'Keep “яйца”' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Remove “мука”' }));
    expect(within(step1).queryByRole('group', { name: 'Suggested ingredients' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(patchBody(calls).steps[0].ingredients).toEqual([{ ref: uid(0), portion_fraction: 1 }]);
  });

  it('the original text is next to the result; the focused line is marked in it', async () => {
    await parsed();
    const original = screen.getByRole('complementary', { name: 'Original text' });
    expect(original.textContent).toContain('Выпекайте 40 минут.');
    fireEvent.focus(screen.getAllByLabelText('Ingredient')[2]!);
    expect(within(original).getByText('яблоки — 4 шт.').tagName).toBe('MARK');
  });

  it('a line moves to another section from its details', async () => {
    const calls = await parsed();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ingredient details' })[1]!);
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Для начинки' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    const names = screen.getAllByLabelText('Ingredient').map((i) => (i as HTMLInputElement).value);
    expect(names).toEqual(['яйца', 'яблоки', 'сахар', 'мука']);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(
      patchBody(calls).ingredients.map((i: { name: string; group_label: string }) => [
        i.name,
        i.group_label,
      ]),
    ).toEqual([
      ['яйца', 'Для теста'],
      ['яблоки', 'Для начинки'],
      ['сахар', 'Для начинки'],
      ['мука', 'Для начинки'],
    ]);
  });

  it('the review is kept on the device: reopened, it continues where it was; saving clears it', async () => {
    const calls = await parsed();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Шарлотка с корицей' } });
    await vi.waitFor(() =>
      expect(saved()).toMatchObject({
        v: 1,
        review: { recipe_id: DRAFT_ID, original: TEXT, editor: { title: 'Шарлотка с корицей' } },
      }),
    );
    // Closed and opened again: the paste screen offers to continue, with the edits and decisions.
    calls.view.unmount();
    renderApp('/import');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue checking “Шарлотка с корицей”' }),
    );
    expect(await screen.findByRole('heading', { name: 'Check the recipe' })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Шарлотка с корицей');
    expect(screen.getByRole('group', { name: 'Timer found: 40 min' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await vi.waitFor(() => expect(saved()).toBeNull());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
  });
});
