import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi } from './harness';

/**
 * FE-12 / S6-6 (D-059): first-run tips. Each says one thing that is easy to miss, where it
 * matters, until the person taps "Got it"; then never again on this phone. The book: a recipe can
 * be forwarded to the bot. The card: "Recalculate". Cooking: timers keep going with the app closed.
 */
const SESSION = '00000000-0000-4000-8000-0000000000e1';
function api() {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [BOOK_LIST]: () => json(200, BOOK_PAGE),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () => json(404, {}),
    'GET /api/timers?active=1': () =>
      json(200, { timers: [], server_now: new Date().toISOString() }),
    'POST /api/cook-sessions': () => json(201, { id: SESSION, state: 'active', max_step_index: 0 }),
    [`PATCH /api/cook-sessions/${SESSION}`]: () => json(200, { id: SESSION }),
  });
}
const tip = (text: RegExp) =>
  screen.findByRole('note', { name: 'Tip' }).then((n) => {
    expect(n.textContent).toMatch(text);
    return n;
  });

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('first-run tips', () => {
  it('the book: a recipe can be forwarded to the bot; "Got it" hides it for good', async () => {
    api();
    renderApp('/');
    const note = await tip(/forward a recipe’s text to the bot/);
    fireEvent.click(within(note).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note', { name: 'Tip' })).toBeNull();
    // Next time the app opens on this phone: no tip.
    cleanup();
    __resetTelegramRuntime();
    renderApp('/');
    await screen.findByRole('link', { name: /Голубцы/ });
    expect(screen.queryByRole('note', { name: 'Tip' })).toBeNull();
  });

  it('the card: what "Recalculate" does; dismissing one tip leaves the others', async () => {
    api();
    renderApp('/');
    fireEvent.click(within(await tip(/forward/)).getByRole('button', { name: 'Got it' }));
    fireEvent.click(await screen.findByRole('link', { name: /Голубцы/ }));
    const note = await tip(/“Recalculate” changes the amounts/);
    fireEvent.click(within(note).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note', { name: 'Tip' })).toBeNull();
  });

  it('cooking: timers keep going with the app closed, and the bot writes when one ends', async () => {
    api();
    renderApp(`/cook/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Start cooking' }));
    await tip(/Timers keep going when you close the app/);
  });
});
