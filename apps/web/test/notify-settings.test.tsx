import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { BOOK, json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * Notification settings in the Profile (PRD 3.2 notify_prefs; D-049). Owner's Sprint 5 answers:
 * "someone cooked my recipe" on by default with a quiet mode; "a new recipe in the book" off.
 */
const PREFS = { timers: true, cooked: true, new_recipe: false, mute_social: false };

function api(patch?: Handler) {
  let prefs = { ...PREFS };
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en', notify_prefs: prefs }),
    'GET /api/books/current': () => json(200, BOOK),
    'PATCH /api/me':
      patch ??
      ((init) => {
        const body = JSON.parse(String(init.body));
        prefs = { ...prefs, ...body.notify_prefs };
        return json(200, { ...ME, ui_lang: 'en', notify_prefs: prefs });
      }),
  });
}
const section = () => screen.findByRole('region', { name: 'Notifications' });
const box = async (name: string) =>
  within(await section()).getByRole('checkbox', { name }) as HTMLInputElement;
const patches = (calls: ReturnType<typeof api>) =>
  calls.filter((c) => c.method === 'PATCH' && c.url === '/api/me').map((c) => JSON.parse(c.body!));

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('notification settings in the Profile', () => {
  it('show the current choice: "cooked" on, "new recipe" off, quiet mode off', async () => {
    api();
    renderApp('/profile');
    await section();
    expect((await box('Someone cooked my recipe')).checked).toBe(true);
    expect((await box('A new recipe in the book')).checked).toBe(false);
    expect((await box('Quiet mode')).checked).toBe(false);
    expect(screen.getByText(/Timer messages always arrive/)).toBeTruthy();
  });

  it('a switch saves at once (only that setting) and stays as chosen', async () => {
    const calls = api();
    renderApp('/profile');
    fireEvent.click(await box('A new recipe in the book'));
    await waitFor(() => expect(patches(calls)).toEqual([{ notify_prefs: { new_recipe: true } }]));
    await waitFor(async () => expect((await box('A new recipe in the book')).checked).toBe(true));
    // Away and back: still on.
    fireEvent.click(screen.getByRole('link', { name: /Book/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Profile/ }));
    expect((await box('A new recipe in the book')).checked).toBe(true);
  });

  it('quiet mode turns off the messages about other people; the two switches show it', async () => {
    const calls = api();
    renderApp('/profile');
    fireEvent.click(await box('Quiet mode'));
    await waitFor(() => expect(patches(calls)).toEqual([{ notify_prefs: { mute_social: true } }]));
    await waitFor(async () => expect((await box('Someone cooked my recipe')).disabled).toBe(true));
    expect((await box('A new recipe in the book')).disabled).toBe(true);
  });

  it('if saving fails, it says so and the switch goes back', async () => {
    api(() => json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } }));
    renderApp('/profile');
    fireEvent.click(await box('Someone cooked my recipe'));
    expect(await screen.findByRole('status')).toBeTruthy();
    await waitFor(async () => expect((await box('Someone cooked my recipe')).checked).toBe(true));
  });
});
