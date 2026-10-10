import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime, getRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, GOLUBTSY_ID, MEMBER } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * FE-12 / S6-6 (D-059): the phone buzzes the same way everywhere. A light tick for a choice; a
 * "success" buzz when something is done (published, saved, deleted, joined, sent); an "error" buzz
 * whenever an action fails and says why; a "warning" when a timer ends.
 */
const NEW_ID = '00000000-0000-4000-8000-0000000000d1';
const THEIRS = { ...GOLUBTSY, is_mine: false, can_edit: false, author: MEMBER, is_saved: false };
const fail = (status = 500, code = 'INTERNAL') =>
  json(status, { error: { code, message: 'x', request_id: 'r' } });

function api(over: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [BOOK_LIST]: () => json(200, BOOK_PAGE),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () => json(404, {}),
    'GET /api/timers?active=1': () =>
      json(200, { timers: [], server_now: new Date().toISOString() }),
    ...over,
  });
}
/** Replaces the phone's buzzer once the app has started; returns what it was asked to do. */
function buzzer() {
  const done: string[] = [];
  getRuntime().webApp.HapticFeedback = {
    impactOccurred: (s) => void done.push(`impact:${s}`),
    notificationOccurred: (k) => void done.push(k),
    selectionChanged: () => void done.push('select'),
  };
  return done;
}
const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

async function writeAndPublish() {
  renderApp('/recipe/new');
  change(await screen.findByLabelText('Title'), 'Чай');
  const done = buzzer();
  change(screen.getByLabelText('Ingredient'), 'чай');
  change(screen.getByLabelText('Amount'), '1');
  change(screen.getByLabelText('What to do in step 1'), 'Заварите.');
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  return done;
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the phone buzzes', () => {
  it('"success" when a recipe is published', async () => {
    api({
      'POST /api/recipes': () => json(201, { ...GOLUBTSY, id: NEW_ID, title: 'Чай' }),
      [`GET /api/recipes/${NEW_ID}`]: () => json(200, { ...GOLUBTSY, id: NEW_ID, title: 'Чай' }),
    });
    const done = await writeAndPublish();
    await screen.findByRole('heading', { level: 1, name: 'Чай' });
    expect(done).toContain('success');
  });

  it('"error" when publishing fails, or something is missing', async () => {
    api({ 'POST /api/recipes': () => fail() });
    const done = await writeAndPublish();
    await screen.findByText('Something went wrong. Try again.');
    expect(done).toEqual(['error']);
    // Missing parts: nothing is sent, the screen says what is missing, and the phone buzzes.
    change(screen.getByLabelText('Title'), '');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(done).toEqual(['error', 'error']);
  });

  it('a tick for "Save", then "error" when it fails', async () => {
    api({
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, THEIRS),
      [`POST /api/recipes/${GOLUBTSY_ID}/save`]: () => fail(),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const save = await screen.findByRole('button', { name: '🔖 Save' });
    const done = buzzer();
    fireEvent.click(save);
    await screen.findByText('Something went wrong. Try again.');
    expect(done).toEqual(['select', 'error']);
  });

  it('"error" when pasted text cannot be read', async () => {
    api({ 'POST /api/recipes/import': () => fail(422, 'IMPORT_TIMEOUT') });
    renderApp('/import');
    const box = await screen.findByRole('textbox', { name: 'Paste recipe text' });
    const done = buzzer();
    change(box, 'Чай\n\nЗаварите.');
    fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
    await screen.findByText(/took too long to read/);
    expect(done).toEqual(['error']);
  });

  it('"success" when the author deletes a recipe; "error" when it fails', async () => {
    let ok = false;
    api({
      [`DELETE /api/recipes/${GOLUBTSY_ID}`]: () =>
        ok ? new Response(null, { status: 204 }) : fail(),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const del = await screen.findByRole('button', { name: 'Delete recipe' });
    const done = buzzer();
    fireEvent.click(del);
    await screen.findByText('Something went wrong. Try again.');
    expect(done).toEqual(['error']);
    ok = true;
    fireEvent.click(screen.getByRole('button', { name: 'Delete recipe' }));
    await waitFor(() => expect(done).toEqual(['error', 'success']));
  });
});
