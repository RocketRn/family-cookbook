import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID, KEEPER } from './fixtures';
import { json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * FE-11 / S6-3 (PRD UC-08, 3.3; owner's Sprint 6 answer 2; D-055): someone outside the book who
 * opens a "by link" recipe reads it, recalculates it and cooks it with timers. No saving and no
 * reactions for now. Their timers and cooking session carry the link's token.
 */
const TOKEN = 'linkTokenAbcdefghijklm';
const SHARED = {
  ...GOLUBTSY,
  is_mine: false,
  can_edit: false,
  author: KEEPER,
  visibility: 'link' as const,
  is_saved: false,
};
const NOT_FOUND = () => json(404, { error: { code: 'NOT_FOUND', message: 'n', request_id: 'r' } });
const STEP2 = GOLUBTSY.steps[1]!;

function api(over: Record<string, Handler> = {}) {
  const now = () => new Date().toISOString();
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en', bot_started: true }),
    'GET /api/books/current': () =>
      json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
    [`GET /api/r/${TOKEN}`]: () => json(200, SHARED),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: NOT_FOUND, // not in the book: only the link opens it
    [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: NOT_FOUND,
    'GET /api/timers?active=1': () => json(200, { timers: [], server_now: now() }),
    'POST /api/timers': (init) => {
      const b = JSON.parse(String(init.body));
      return json(201, {
        timer: {
          id: '71e70000-0000-4000-8000-000000000001',
          client_timer_id: b.client_timer_id,
          recipe_id: GOLUBTSY_ID,
          step_id: b.step_id ?? null,
          cook_session_id: b.cook_session_id ?? null,
          label: b.label,
          recipe_title: 'Голубцы',
          step_number: 2,
          duration_sec: b.duration_sec,
          started_at: now(),
          ends_at: new Date(Date.now() + b.duration_sec * 1000).toISOString(),
          status: 'running',
          fired_at: null,
          cancelled_at: null,
        },
        server_now: now(),
      });
    },
    'POST /api/cook-sessions': () =>
      json(201, { id: '5e551011-0000-4000-8000-000000000001', state: 'active' }),
    'PATCH /api/cook-sessions/5e551011-0000-4000-8000-000000000001': () =>
      json(200, { id: '5e551011-0000-4000-8000-000000000001' }),
    ...over,
  });
}
const bodies = (calls: ReturnType<typeof api>, what: string) =>
  calls.filter((c) => `${c.method} ${c.url}` === what).map((c) => JSON.parse(c.body ?? '{}'));

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('a recipe opened by its link, by someone outside the book', () => {
  it('reads it, with Recalculate and Cook; no Save, no reactions, no editing', async () => {
    api();
    renderApp(`/r/${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Голубцы' })).toBeTruthy();
    expect(screen.getByText('by Dev Keeper')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cook' })).toBeTruthy();
    expect(screen.getByText(/shared with you by link/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /🔖/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Reactions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /I cooked it/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('a step’s timer from the card carries the link’s token', async () => {
    const calls = api();
    renderApp(`/r/${TOKEN}`);
    fireEvent.click(await screen.findByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' }));
    await waitFor(() => expect(bodies(calls, 'POST /api/timers')).toHaveLength(1));
    expect(bodies(calls, 'POST /api/timers')[0]).toMatchObject({
      recipe_id: GOLUBTSY_ID,
      step_id: STEP2.id,
      share_token: TOKEN,
    });
  });

  it('cooks it: cooking mode reads it by the link; the session and timers carry the token; Done has no "I cooked it"', async () => {
    const calls = api();
    renderApp(`/r/${TOKEN}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cook' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start cooking' }));
    await waitFor(() => expect(bodies(calls, 'POST /api/cook-sessions')).toHaveLength(1));
    expect(bodies(calls, 'POST /api/cook-sessions')[0]).toMatchObject({
      recipe_id: GOLUBTSY_ID,
      share_token: TOKEN,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(await screen.findByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' }));
    await waitFor(() => expect(bodies(calls, 'POST /api/timers')).toHaveLength(1));
    expect(bodies(calls, 'POST /api/timers')[0]).toMatchObject({ share_token: TOKEN });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByRole('heading', { name: 'Done!' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /I cooked it/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the recipe' }));
    expect(await screen.findByText(/shared with you by link/i)).toBeTruthy();
  });

  it('cooking opened again later (e.g. from the timer’s message) still reads it by the link', async () => {
    const calls = api();
    renderApp(`/r/${TOKEN}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cook' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start cooking' }));
    await screen.findByText('Step 1 of 2');
    const saved = JSON.parse(localStorage.getItem(`cook:${GOLUBTSY_ID}`)!);
    expect(saved.share_token).toBe(TOKEN);
    expect(calls.some((c) => c.url === `/api/r/${TOKEN}`)).toBe(true);
  });
});

describe('the same link, opened by the author or a member of the book', () => {
  it('opens the usual card (with Save and reactions)', async () => {
    api({
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, SHARED),
      [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () =>
        json(200, { counts: {}, mine: [], cooked: { total: 0, mine: 0 }, cooked_by: [] }),
    });
    renderApp(`/r/${TOKEN}`);
    expect(await screen.findByRole('button', { name: '🔖 Save' })).toBeTruthy();
    expect(screen.queryByText(/shared with you by link/i)).toBeNull();
  });
});

describe('a link that no longer works', () => {
  it('says so, instead of an error', async () => {
    api({ [`GET /api/r/${TOKEN}`]: NOT_FOUND });
    renderApp(`/r/${TOKEN}`);
    expect(await screen.findByText('This link no longer works')).toBeTruthy();
    expect(screen.getByText(/stopped sharing it/)).toBeTruthy();
  });
});
