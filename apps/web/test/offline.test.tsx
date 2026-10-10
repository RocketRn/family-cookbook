import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime, getRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * FE-12 / S6-6 (PRD 4.8, 6.3): without a connection. What was loaded stays readable; a note says
 * the connection is gone; a screen not loaded before says it will load when the connection is
 * back (not "Recipe not found" or "no recipes"); a tap that needs the server says so at once.
 */
const WAITING = 'No connection. This will load when the connection is back.';
const BANNER = /No connection\. You see what was already loaded/;

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
// What the browser does when the connection goes and comes back.
const offline = () => act(() => void window.dispatchEvent(new Event('offline')));
const online = () => act(() => void window.dispatchEvent(new Event('online')));

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
  onlineManager.setOnline(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe('without a connection', () => {
  it('a note says so on every screen, and goes when the connection is back', async () => {
    api();
    renderApp('/');
    await screen.findByRole('link', { name: /Голубцы/ });
    expect(screen.queryByText(BANNER)).toBeNull();
    offline();
    expect(await screen.findByText(BANNER)).toBeTruthy();
    // What was loaded stays.
    expect(screen.getByRole('link', { name: /Голубцы/ })).toBeTruthy();
    online();
    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
  });

  it('a recipe not loaded before: "it will load when the connection is back", not "not found"', async () => {
    api();
    renderApp('/');
    const link = await screen.findByRole('link', { name: /Голубцы/ });
    offline();
    fireEvent.click(link);
    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText('Recipe not found')).toBeNull();
    online();
    expect(await screen.findByRole('heading', { level: 1, name: 'Голубцы' })).toBeTruthy();
  });

  it('the book list not loaded before: not "no recipes yet"', async () => {
    api();
    renderApp('/profile');
    await screen.findByRole('heading', { name: 'Profile' });
    offline();
    fireEvent.click(screen.getByRole('link', { name: /Book/ }));
    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText('No recipes yet')).toBeNull();
    online();
    expect(await screen.findByRole('link', { name: /Голубцы/ })).toBeTruthy();
  });

  it('a tap that needs the server says at once that there is no connection (and buzzes)', async () => {
    api({
      'PATCH /api/me': () => {
        throw new TypeError('Failed to fetch'); // what fetch does without a connection
      },
    });
    renderApp('/profile');
    const section = await screen.findByRole('region', { name: 'Notifications' });
    const buzz = vi.fn();
    getRuntime().webApp.HapticFeedback.notificationOccurred = buzz;
    offline();
    fireEvent.click(within(section).getByRole('checkbox', { name: 'A new recipe in the book' }));
    expect(await screen.findByText('No connection. Check your network.')).toBeTruthy();
    expect(buzz).toHaveBeenCalledWith('error');
    // The switch goes back: nothing was saved.
    await waitFor(() =>
      expect(
        (
          within(section).getByRole('checkbox', {
            name: 'A new recipe in the book',
          }) as HTMLInputElement
        ).checked,
      ).toBe(false),
    );
  });
});
