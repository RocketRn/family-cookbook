import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID, listItem, MEMBER } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * The personal "Saved" shelf, for real (PRD UC-10, 4.9; D-051): save someone else's recipe from
 * its card, find it on the "Saved" tab, search there, remove it. The development sample shelf of
 * earlier sprints is gone.
 */
const THEIRS = { ...GOLUBTSY, is_mine: false, can_edit: false, author: MEMBER, is_saved: false };
const SHELF = '/api/recipes?scope=saved&limit=50';
const page = (titles: string[]) => ({
  items: titles.map((title, i) =>
    listItem({ id: `00000000-0000-4000-8000-00000000010${i}`, title, is_saved: true } as never),
  ),
  next_cursor: null,
});

function api(over: Record<string, Handler> = {}) {
  let saved = false;
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, { ...THEIRS, is_saved: saved }),
    [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () => json(404, {}),
    'GET /api/timers?active=1': () =>
      json(200, { timers: [], server_now: new Date().toISOString() }),
    [`POST /api/recipes/${GOLUBTSY_ID}/save`]: () => {
      saved = true;
      return json(201, { saved: true });
    },
    [`DELETE /api/recipes/${GOLUBTSY_ID}/save`]: () => {
      saved = false;
      return new Response(null, { status: 204 });
    },
    [`GET ${SHELF}`]: () => json(200, page(saved ? ['Голубцы'] : [])),
    ...over,
  });
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('saving from the card', () => {
  it('someone else’s recipe: "Save" keeps it on your shelf; tapping again removes it', async () => {
    const calls = api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const save = await screen.findByRole('button', { name: '🔖 Save' });
    expect(save.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(save);
    const saved = await screen.findByRole('button', { name: '🔖 Saved' });
    expect(saved.getAttribute('aria-pressed')).toBe('true');
    expect(
      calls.some((c) => c.method === 'POST' && c.url === `/api/recipes/${GOLUBTSY_ID}/save`),
    ).toBe(true);
    fireEvent.click(saved);
    await screen.findByRole('button', { name: '🔖 Save' });
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url === `/api/recipes/${GOLUBTSY_ID}/save`),
    ).toBe(true);
  });

  it('your own recipe has no "Save" (it is already yours)', async () => {
    api({ [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY) });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Голубцы' });
    expect(screen.queryByRole('button', { name: /🔖/ })).toBeNull();
  });

  it('if saving fails, it says so and stays unsaved', async () => {
    api({
      [`POST /api/recipes/${GOLUBTSY_ID}/save`]: () =>
        json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } }),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: '🔖 Save' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: '🔖 Save' })).toBeTruthy();
  });
});

describe('the "Saved" tab', () => {
  it('shows the saved recipes from the server, with search', async () => {
    const calls = api({
      [`GET ${SHELF}`]: () => json(200, page(['Голубцы', 'Сырники'])),
      [`GET ${SHELF}&q=%D1%81%D1%8B%D1%80`]: () => json(200, page(['Сырники'])),
    });
    renderApp('/saved');
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();
    expect(await screen.findByText('Голубцы')).toBeTruthy();
    expect(screen.getByText('Сырники')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Title or ingredient' }), {
      target: { value: 'сыр' },
    });
    await waitFor(() => expect(screen.queryByText('Голубцы')).toBeNull());
    expect(calls.some((c) => c.url === `${SHELF}&q=%D1%81%D1%8B%D1%80`)).toBe(true);
    // No development sample data any more.
    expect(screen.queryByText(/Development sample/)).toBeNull();
  });

  it('empty: says how to save a recipe', async () => {
    api();
    renderApp('/saved');
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByText(/Tap 🔖 Save on a recipe/)).toBeTruthy();
  });

  it('saving on a card puts it on the shelf (the tab asks the server again)', async () => {
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: '🔖 Save' }));
    await screen.findByRole('button', { name: '🔖 Saved' });
    // The card has no tab bar: back to the book, then the "Saved" tab.
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid=mock-back-button]')!);
    fireEvent.click(await screen.findByRole('link', { name: /Saved/ }));
    const list = await screen.findByText('Голубцы');
    expect(within(list.closest('a') ?? document.body).getByText('Голубцы')).toBeTruthy();
  });
});
