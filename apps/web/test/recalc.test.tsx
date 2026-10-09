import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../src/api/types';
import { setLanguage } from '../src/i18n';
import {
  computeRecalc,
  readRecalc,
  recalcKey,
  unitOptions,
  writeRecalc,
} from '../src/recipe/recalc';
import { servingsText } from '../src/recipe/RecalcSheet';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi } from './harness';

/** FE-07 recalculation panel (PRD 5.2, 5.3, 4.8; D-037). */
const [CABBAGE, MINCE, RICE] = GOLUBTSY.ingredients;

describe('recalculation state', () => {
  it('offers only units that convert exactly (g/kg, ml/l); others stay as they are', () => {
    expect(unitOptions(MINCE!)).toEqual(['g', 'kg']);
    expect(unitOptions(RICE!)).toEqual(['cup']);
    expect(unitOptions(CABBAGE!)).toEqual([null]);
  });

  it('k by servings or from one product (PRD 5.4: 500 g of 800 g -> k 0.625, ≈ 2.5 servings)', () => {
    expect(computeRecalc(GOLUBTSY, { mode: 'servings', servings: 2 })).toEqual({
      ok: true,
      k: 0.5,
      servings: 2,
      warning: null,
    });
    const from = (amount: number, unit: string | null) =>
      computeRecalc(GOLUBTSY, { mode: 'product', ingredientId: MINCE!.id, amount, unit });
    expect(from(500, 'g')).toMatchObject({ ok: true, k: 0.625, servings: 2.5 });
    expect(from(0.5, 'kg')).toMatchObject({ ok: true, k: 0.625 });
    expect(servingsText(2.5, 'ru')).toBe('≈ 2,5');
    expect(servingsText(8, 'en')).toBe('8');
  });

  it('warns about a big change and refuses past 1/20 or 20 times', () => {
    expect(computeRecalc(GOLUBTSY, { mode: 'servings', servings: 20 })).toMatchObject({
      ok: true,
      warning: 'big_change',
    });
    expect(computeRecalc(GOLUBTSY, { mode: 'servings', servings: 81 })).toEqual({
      ok: false,
      error: 'K_OUT_OF_RANGE',
    });
    expect(
      computeRecalc(GOLUBTSY, {
        mode: 'product',
        ingredientId: MINCE!.id,
        amount: Number.NaN,
        unit: 'g',
      }),
    ).toEqual({ ok: false, error: 'BAD_INPUT' });
  });

  it('is kept under recalc:<recipe_id> and checked again when read', () => {
    writeRecalc(GOLUBTSY_ID, { v: 1, mode: 'servings', servings: 8, k: 2 });
    expect(JSON.parse(localStorage.getItem(recalcKey(GOLUBTSY_ID))!)).toMatchObject({ k: 2 });
    // The recipe now has 8 servings: the same choice means k = 1, not the stored 2.
    expect(readRecalc({ ...GOLUBTSY, servings: 8 })).toMatchObject({ servings: 8, k: 1 });
    // The product is gone from the recipe: nothing to restore.
    writeRecalc(GOLUBTSY_ID, {
      v: 1,
      mode: 'product',
      ingredientId: 'gone',
      amount: 1,
      unit: 'g',
      k: 1,
    });
    expect(readRecalc(GOLUBTSY)).toBeNull();
    localStorage.setItem(recalcKey(GOLUBTSY_ID), '{not json');
    expect(readRecalc(GOLUBTSY)).toBeNull();
    writeRecalc(GOLUBTSY_ID, null);
    expect(localStorage.getItem(recalcKey(GOLUBTSY_ID))).toBeNull();
  });
});

const EGGS_ID = '00000000-0000-4000-8000-0000000000f1';
/** 3 servings with 1 egg and 1 garlic clove: 4 servings gives 1.33 of each (PRD 5.3 hints). */
const OMELETTE: Recipe = {
  ...GOLUBTSY,
  id: EGGS_ID,
  title: 'Омлет',
  servings: 3,
  steps: [],
  videos: [],
  ingredients: [
    {
      ...CABBAGE!,
      id: `${EGGS_ID.slice(0, -2)}a1`,
      name: 'Яйца',
      amount_min: 1,
      unit_code: 'pcs',
      unit_raw: null,
      round_class: 'whole_item',
      min_piece: 1,
    },
    {
      ...CABBAGE!,
      id: `${EGGS_ID.slice(0, -2)}a2`,
      name: 'Чеснок',
      amount_min: 1,
      unit_code: 'clove',
      unit_raw: null,
      round_class: 'whole_item',
      min_piece: 1,
    },
  ],
};

function api() {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    [`GET /api/recipes/${EGGS_ID}`]: () => json(200, OMELETTE),
  });
}
const amounts = () =>
  [...document.querySelectorAll('[aria-labelledby=ings-h] .ing__amount')].map((e) => e.textContent);

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('recalculation on the recipe card', () => {
  it('by servings: amounts, step placeholders and portions follow; times do not; it is remembered', async () => {
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));
    const sheet = screen.getByRole('dialog', { name: 'Recalculate the recipe' });
    expect(within(sheet).getByText('In the recipe: 4')).toBeTruthy();
    for (let i = 0; i < 4; i++)
      fireEvent.click(within(sheet).getByRole('button', { name: 'More servings' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Recalculate' }));

    expect(screen.getByText('Recalculated · servings: 8')).toBeTruthy();
    expect(screen.getByText('Servings: 8')).toBeTruthy();
    expect(amounts()).toEqual(['2 кочан', '1600 г', '1 стакан', 'по вкусу', '4 шт.']);
    // Step 1 uses all the mince and half the rice: placeholders follow k (D-029).
    const step1 = screen
      .getAllByRole('listitem')
      .find((li) => li.textContent?.startsWith('Step 1'))!;
    expect(step1.textContent).toContain('Смешайте 1600 г фарша и ½ стакана риса.');
    expect(
      screen.getByText(/Timers and numbers typed in the step text are for the original amount/),
    ).toBeTruthy();
    expect(screen.getByText('Тушить').parentElement!.textContent).toContain('1 h 30 min');
    expect(JSON.parse(localStorage.getItem(`recalc:${GOLUBTSY_ID}`)!)).toEqual({
      mode: 'servings',
      servings: 8,
      v: 1,
      k: 2,
    });
  });

  it('comes back after reopening, and "Back to the original" clears it', async () => {
    writeRecalc(GOLUBTSY_ID, { v: 1, mode: 'servings', servings: 2, k: 0.5 });
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    expect(await screen.findByText('Recalculated · servings: 2')).toBeTruthy();
    expect(amounts()[1]).toBe('400 г');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the original' }));
    expect(amounts()[1]).toBe('800 г');
    expect(screen.getByText('4 servings')).toBeTruthy();
    expect(localStorage.getItem(`recalc:${GOLUBTSY_ID}`)).toBeNull();
  });

  it('from one product: 500 g of minced meat -> ≈ 2.5 servings; a far-off amount is refused', async () => {
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));
    const sheet = screen.getByRole('dialog', { name: 'Recalculate the recipe' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'From one product' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Говяжий фарш' }));
    expect(within(sheet).getByText('In the recipe: 800 г')).toBeTruthy();
    const have = within(sheet).getByLabelText('How much you have');
    fireEvent.change(have, { target: { value: '100000' } });
    expect(within(sheet).getByRole('alert').textContent).toMatch(/more than 20 times/);
    expect(
      (within(sheet).getByRole('button', { name: 'Recalculate' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(have, { target: { value: '100' } });
    expect(within(sheet).getByText(/A big change/)).toBeTruthy();
    fireEvent.change(have, { target: { value: '0,5' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'кг' }));
    expect(within(sheet).getByText('Servings after recalculation: ≈ 2.5')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Recalculate' }));
    expect(screen.getByText('Recalculated · servings: ≈ 2.5')).toBeTruthy();
    expect(screen.getByText('From what you have: Говяжий фарш, 0,5 кг')).toBeTruthy();
    expect(amounts()[1]).toBe('500 г');
  });

  it('hints for whole items: eggs are whisked, other items are taken (owner decision, PRD 5.3)', async () => {
    api();
    renderApp(`/recipe/${EGGS_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Recalculate' }));
    const sheet = screen.getByRole('dialog', { name: 'Recalculate the recipe' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'More servings' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Recalculate' }));
    // Numbers and units in the recipe's language (ru), hints in the interface language (en).
    expect(amounts()).toEqual([
      '1 шт. (or whisk 2 pcs and take ⅔)',
      '1 зубчик (or take 2 cloves and use ⅔)',
    ]);
  });
});
