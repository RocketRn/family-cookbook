import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../src/api/types';
import { IMPORT_DRAFT_KEY } from '../src/editor/ImportScreen';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, KEEPER } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi, type Handler } from './harness';

/** Thin paste flow (owner decision 1; PRD 2.2 variant A, steps 1-6; D-036). */
const DRAFT_ID = '00000000-0000-4000-8000-0000000000e1';
const ing = (n: number, name: string, over: Partial<Recipe['ingredients'][number]> = {}) => ({
  ...GOLUBTSY.ingredients[0]!,
  id: `00000000-0000-4000-8000-0000000001e${n}`,
  position: n,
  name,
  group_label: null,
  qty_kind: 'exact' as const,
  amount_min: 1,
  amount_max: null,
  unit_code: null,
  unit_raw: null,
  round_class: 'continuous' as const,
  min_piece: null,
  parse_confidence: 1,
  ...over,
});
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
      amount_min: 4,
      unit_code: 'pcs',
      parse_confidence: 0.9,
      raw_line: 'яйца — 4 шт.',
    }),
    ing(1, 'мука', {
      parse_confidence: 0.5,
      note: 'стакан с горкой',
      raw_line: 'мука — 1 (стакан с горкой)',
    }),
    ing(2, 'ванилин', {
      qty_kind: 'unparsed',
      amount_min: null,
      parse_confidence: 0.5,
      raw_line: 'ванилин',
    }),
  ],
  steps: [
    {
      ...GOLUBTSY.steps[1]!,
      id: '00000000-0000-4000-8000-0000000003e1',
      body: 'Взбейте яйца, вмешайте муку.',
      photo: null,
      video_id: null,
      video_start_sec: null,
      timers: [],
      ingredients: [],
    },
  ],
};
const IMPORTED = {
  recipe: DRAFT,
  import: {
    lines: [
      { ingredient_id: DRAFT.ingredients[0]!.id, confidence: 0.9, reasons: ['p4'] },
      {
        ingredient_id: DRAFT.ingredients[1]!.id,
        confidence: 0.5,
        reasons: ['p4', 'no_unit', 'bracket'],
      },
      { ingredient_id: DRAFT.ingredients[2]!.id, confidence: 0.5, reasons: ['unparsed'] },
    ],
    warnings: ['no_headings'],
  },
};
const TEXT =
  'Шарлотка\nяйца — 4 шт.\nмука — 1 (стакан с горкой)\nванилин\nВзбейте яйца, вмешайте муку.';

function api(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [BOOK_LIST]: () => json(200, BOOK_PAGE),
    [`GET /api/recipes/${DRAFT_ID}`]: () => json(200, DRAFT),
    ...extra,
  });
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('paste recipe text', () => {
  it('"＋" offers to write a recipe or to paste its text', async () => {
    api();
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'New recipe' }));
    const sheet = screen.getByRole('dialog', { name: 'New recipe' });
    expect(within(sheet).getByRole('button', { name: /Write a recipe/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: /Paste recipe text/ }));
    expect(await screen.findByRole('heading', { name: 'Paste recipe text' })).toBeTruthy();
  });

  it('parses the text, then the editor shows what to check, highlighted, with the original', async () => {
    const calls = api({ 'POST /api/recipes/import': () => json(201, IMPORTED) });
    renderApp('/import');
    const box = await screen.findByRole('textbox', { name: 'Paste recipe text' });
    fireEvent.change(box, { target: { value: TEXT } });
    // Kept on the device until the recipe exists (PRD 4.8 "import-draft").
    expect(JSON.parse(localStorage.getItem(IMPORT_DRAFT_KEY)!)).toEqual({ v: 1, text: TEXT });
    expect(screen.getByText(`${TEXT.length} of 20,000 characters`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Parse' }));

    expect(await screen.findByRole('heading', { name: 'Check the recipe' })).toBeTruthy();
    expect(JSON.parse(calls.find((c) => c.url === '/api/recipes/import')!.body!)).toEqual({
      text: TEXT,
      ui_lang: 'en',
    });
    expect(localStorage.getItem(IMPORT_DRAFT_KEY)).toBeNull();
    expect(screen.getByText('Lines to check: 2')).toBeTruthy();
    expect(screen.getByText(/There were no headings/)).toBeTruthy();
    expect(screen.getByText('Original text')).toBeTruthy();

    // PRD 5.1.3: lines below 0.7 are highlighted, with the reasons in plain words.
    const rows = screen.getAllByTestId('ingredient-row');
    expect(rows.map((r) => r.className.includes('edit-line--low'))).toEqual([false, true, true]);
    expect(within(rows[1]!).getByText('A number in brackets was moved to the note')).toBeTruthy();
    expect(within(rows[2]!).getAllByText(/Not recognized/).length).toBeGreaterThan(0);
    // A corrected line is the author's: no longer highlighted.
    fireEvent.change(within(rows[1]!).getByLabelText('Amount'), { target: { value: '1,5' } });
    expect(screen.getAllByTestId('ingredient-row')[1]!.className).not.toContain('edit-line--low');
    expect(screen.getByText('Lines to check: 1')).toBeTruthy();
    fireEvent.change(within(rows[2]!).getByLabelText('Amount'), { target: { value: '1' } });
    expect(screen.getByText(/Nothing looked doubtful/)).toBeTruthy();
    // The import made a private draft; in a book, "Publish" means to the book.
    expect(
      screen.getByRole('radio', { name: /Everyone in your book/ }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('a failed parse says why and keeps the text', async () => {
    api({
      'POST /api/recipes/import': () =>
        json(422, { error: { code: 'IMPORT_TIMEOUT', message: 'x', request_id: 'r' } }),
    });
    localStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify({ v: 1, text: TEXT }));
    renderApp('/import');
    const box = (await screen.findByRole('textbox', {
      name: 'Paste recipe text',
    })) as HTMLTextAreaElement;
    expect(box.value).toBe(TEXT); // back after closing the app
    fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
    expect(await screen.findByText(/took too long to read/)).toBeTruthy();
    expect(box.value).toBe(TEXT);
    expect(localStorage.getItem(IMPORT_DRAFT_KEY)).not.toBeNull();
  });

  it('refuses more than 20,000 characters before sending anything', async () => {
    const calls = api();
    renderApp('/import');
    const box = await screen.findByRole('textbox', { name: 'Paste recipe text' });
    fireEvent.change(box, { target: { value: 'а'.repeat(20_001) } });
    expect(screen.getByText(/The text is too long: at most 20,000 characters/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Parse' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(false));
  });
});
