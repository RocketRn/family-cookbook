import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../src/api/types';
import { cookKey, readCook, type CookState } from '../src/cook/state';
import { setLanguage } from '../src/i18n';
import { writeRecalc } from '../src/recipe/recalc';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi } from './harness';

/** FE-08 cooking mode (PRD 2.4, 4.8; D-041). */
const SESSION = '5e551011-0000-4000-8000-000000000001';
const [, MINCE] = GOLUBTSY.ingredients;
const STEP2 = GOLUBTSY.steps[1]!;

function api(over: { recipe?: () => Response } = {}) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: over.recipe ?? (() => json(200, GOLUBTSY)),
    'POST /api/cook-sessions': () => json(201, { id: SESSION, state: 'active', max_step_index: 0 }),
    [`PATCH /api/cook-sessions/${SESSION}`]: () => json(200, { id: SESSION }),
    'GET /api/timers?active=1': () =>
      json(200, { timers: [], server_now: new Date().toISOString() }),
  });
}
const saved = () => JSON.parse(localStorage.getItem(cookKey(GOLUBTSY_ID)) ?? 'null') as CookState;
const bodies = (calls: ReturnType<typeof api>, what: string) =>
  calls.filter((c) => `${c.method} ${c.url}` === what).map((c) => JSON.parse(c.body ?? '{}'));
const stepText = () => document.querySelector('.cook__text')?.textContent;
const state = (over: Partial<CookState> = {}): CookState => ({
  v: 1,
  recipe_id: GOLUBTSY_ID,
  recipe_version: 1,
  scale: null,
  step_index: 1,
  checked_ingredients: [],
  timers: [],
  started: true,
  session_id: SESSION,
  recipe: GOLUBTSY,
  updated_at: new Date().toISOString(),
  ...over,
});

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cooking mode', () => {
  it('Cook on the card opens Preparation with the recalculated list; ticks are kept', async () => {
    writeRecalc(GOLUBTSY_ID, { v: 1, mode: 'servings', servings: 8, k: 2 });
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cook' }));
    expect(await screen.findByRole('heading', { name: 'Cooking: Голубцы' })).toBeTruthy();
    const prep = screen.getByRole('region', { name: 'Do you have everything?' });
    expect(within(prep).getByText('Servings: 8')).toBeTruthy();
    const mince = within(prep).getByRole('checkbox', { name: /Говяжий фарш/ });
    expect(mince.closest('label')!.textContent).toContain('1600 г');
    fireEvent.click(mince);
    expect(saved()).toMatchObject({
      v: 1,
      recipe_id: GOLUBTSY_ID,
      recipe_version: 1,
      started: false,
      checked_ingredients: [MINCE!.id],
      scale: { mode: 'servings', servings: 8, k: 2 },
    });
  });

  it('Start: a cooking session, one step per screen, Next / Back and swipes; progress is saved', async () => {
    writeRecalc(GOLUBTSY_ID, { v: 1, mode: 'servings', servings: 8, k: 2 });
    const calls = api();
    renderApp(`/cook/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Start cooking' }));
    expect(await screen.findByText('Step 1 of 2')).toBeTruthy();
    expect(bodies(calls, 'POST /api/cook-sessions')).toEqual([
      { recipe_id: GOLUBTSY_ID, recipe_version: 1, scale_factor: 2 },
    ]);
    // Amounts follow the recalculation, in the step's list and in its text (D-029).
    expect(stepText()).toBe('Смешайте 1600 г фарша и ½ стакана риса. <b>не HTML</b>');
    const ings = screen.getByRole('list', { name: 'Ingredients for this step' });
    expect(ings.textContent).toContain('1600 г');
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saved()).toMatchObject({ started: true, step_index: 0, session_id: SESSION });

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(stepText()).toBe('Заверните и тушите.');
    expect(saved().step_index).toBe(1);
    // The step's timer, video and photo.
    expect(screen.getByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '▶ Video at this step' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Photo for step 2' })).toBeTruthy();

    // A swipe to the right goes back; a short or mostly vertical one does nothing.
    const swipe = (dx: number, dy = 0) => {
      const zone = document.querySelector('[data-swipe-zone]')!; // each step has its own
      fireEvent.touchStart(zone, { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchEnd(zone, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    };
    swipe(30);
    swipe(150, 200);
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    swipe(150);
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    swipe(-150);
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    // The furthest step reaches the server too (best effort, after a short pause).
    await vi.waitFor(() =>
      expect(bodies(calls, `PATCH /api/cook-sessions/${SESSION}`)).toContainEqual({
        max_step_index: 1,
      }),
    );
  });

  it('Finish: the Done screen closes the session and clears the progress and the recalculation', async () => {
    writeRecalc(GOLUBTSY_ID, { v: 1, mode: 'servings', servings: 8, k: 2 });
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state()));
    const calls = api();
    renderApp(`/cook/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(await screen.findByRole('heading', { name: 'Done!' })).toBeTruthy();
    expect(localStorage.getItem(cookKey(GOLUBTSY_ID))).toBeNull();
    expect(localStorage.getItem(`recalc:${GOLUBTSY_ID}`)).toBeNull();
    await vi.waitFor(() =>
      expect(bodies(calls, `PATCH /api/cook-sessions/${SESSION}`)).toContainEqual({
        state: 'finished',
      }),
    );
    // "My version" is hidden for now (owner's answer); "I cooked it" arrives with reactions.
    expect(screen.queryByRole('button', { name: /My version/ })).toBeNull();
    expect(
      (screen.getByRole('button', { name: /I cooked it/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: "🔁 I'll cook it again" }));
    expect(screen.getByRole('button', { name: 'Start cooking' })).toBeTruthy();
  });

  it('an unfinished session offers to continue from its step, or to start over', async () => {
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ step_index: 1 })));
    api();
    renderApp(`/cook/${GOLUBTSY_ID}`);
    expect(await screen.findByText('You stopped at step 2 of 2.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByRole('button', { name: 'Start cooking' })).toBeTruthy();
    expect(saved()).toMatchObject({ started: false, step_index: 0, session_id: null });
  });

  it('progress older than 24 hours is dropped (PRD 4.8)', async () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ updated_at: old })));
    expect(readCook(GOLUBTSY_ID)).toBeNull();
    expect(localStorage.getItem(cookKey(GOLUBTSY_ID))).toBeNull();
    localStorage.setItem(cookKey(GOLUBTSY_ID), '{oops');
    expect(readCook(GOLUBTSY_ID)).toBeNull();
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify({ ...state(), step_index: -1 }));
    expect(readCook(GOLUBTSY_ID)).toBeNull();
  });

  it('a timer message link opens the step it came from, without the dialog', async () => {
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ step_index: 0 })));
    api();
    renderApp(`/cook/${GOLUBTSY_ID}?step=2`);
    expect(await screen.findByText('Step 2 of 2')).toBeTruthy();
    expect(screen.queryByText(/You stopped at/)).toBeNull();
    expect(saved().step_index).toBe(1);
  });

  it('a recipe changed while cooking: cooking finishes on the version it started with', async () => {
    const changed: Recipe = {
      ...GOLUBTSY,
      version: 2,
      steps: [{ ...STEP2, body: 'Совсем другой текст.' }],
    };
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ step_index: 1 })));
    api({ recipe: () => json(200, changed) });
    renderApp(`/cook/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(stepText()).toBe('Заверните и тушите.');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(
      await screen.findByText(/The author changed this recipe while you were cooking/),
    ).toBeTruthy();
  });

  it('without a connection, cooking goes on from the copy saved on this device', async () => {
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ step_index: 1 })));
    api({ recipe: () => Promise.reject(new TypeError('Failed to fetch')) as never });
    renderApp(`/cook/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(stepText()).toBe('Заверните и тушите.');
  });

  it('keeps the screen on while cooking, asks again when the app comes back', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release, addEventListener: vi.fn() }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    try {
      localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ step_index: 0 })));
      api();
      const view = renderApp(`/cook/${GOLUBTSY_ID}?step=1`);
      await screen.findByText('Step 1 of 2');
      await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(request).toHaveBeenCalledTimes(2);
      view.unmount();
      await vi.waitFor(() => expect(release).toHaveBeenCalled());
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    }
  });

  it('without Wake Lock, one notice asks to turn off auto-lock', async () => {
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state({ step_index: 0 })));
    api();
    renderApp(`/cook/${GOLUBTSY_ID}?step=1`);
    expect(await screen.findByText(/Turn off auto-lock while you cook/)).toBeTruthy();
  });
});
