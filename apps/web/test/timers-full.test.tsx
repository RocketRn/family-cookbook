import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSound } from '../src/cook/sound';
import { cookKey, type CookState } from '../src/cook/state';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime, getRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi } from './harness';

/**
 * FE-09, full version (PRD 2.4 steps 7-11, 4.4, 4.6; D-050): timers on the recipe card outside
 * cooking mode, "message not delivered" when the bot could not write (status failed), and a
 * sound when a timer reaches zero on screen.
 */
const SESSION = '5e551011-0000-4000-8000-000000000001';
const TIMER = '71e70000-0000-4000-8000-000000000001';
const STEP2 = GOLUBTSY.steps[1]!;
const iso = (ms: number) => new Date(ms).toISOString();

type ServerTimer = Record<string, unknown> & { id: string; ends_at: string };
let list: ServerTimer[] = [];
let listCalls = 0;
/** How long the server says a started timer runs (the sound test wants a short one). */
let startedRunsMs = 5400_000;
const serverTimer = (over: Partial<ServerTimer> = {}): ServerTimer => ({
  id: TIMER,
  client_timer_id: '00000000-0000-4000-8000-0000000000aa',
  recipe_id: GOLUBTSY_ID,
  step_id: STEP2.id,
  cook_session_id: null,
  label: 'Тушить',
  recipe_title: 'Голубцы',
  step_number: 2,
  duration_sec: 5400,
  started_at: iso(Date.now()),
  ends_at: iso(Date.now() + 5400_000),
  status: 'running',
  fired_at: null,
  cancelled_at: null,
  ...over,
});

function api() {
  listCalls = 0;
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () => json(404, {}),
    [`PATCH /api/cook-sessions/${SESSION}`]: () => json(200, { id: SESSION }),
    'GET /api/timers?active=1': () => {
      listCalls++;
      return json(200, { timers: list, server_now: iso(Date.now()) });
    },
    'POST /api/timers': (init) => {
      const body = JSON.parse(String(init.body));
      const t = serverTimer({
        client_timer_id: body.client_timer_id,
        ends_at: iso(Date.now() + startedRunsMs),
      });
      list = [...list, t];
      return json(201, { timer: t, server_now: iso(Date.now()) });
    },
    [`DELETE /api/timers/${TIMER}`]: () => {
      list = [];
      return new Response(null, { status: 204 });
    },
  });
}
const bodies = (calls: ReturnType<typeof api>, what: string) =>
  calls.filter((c) => `${c.method} ${c.url}` === what).map((c) => JSON.parse(c.body ?? '{}'));

/** A stand-in for the Web Audio API: records what the alarm plays. */
const audio = { created: 0, resumed: 0, tones: 0 };
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  constructor() {
    audio.created++;
  }
  resume() {
    audio.resumed++;
    return Promise.resolve();
  }
  createOscillator() {
    return {
      frequency: { value: 0 },
      type: 'sine',
      connect: (n: unknown) => n,
      start: () => {
        audio.tones++;
      },
      stop: () => undefined,
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: (n: unknown) => n,
    };
  }
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
  list = [];
  Object.assign(audio, { created: 0, resumed: 0, tones: 0 });
  startedRunsMs = 5400_000;
  __resetSound();
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

describe('timers on the recipe card (outside cooking mode)', () => {
  it('a step’s timer starts from the card; the running timer shows on the card', async () => {
    const calls = api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' }));
    const region = await screen.findByRole('region', { name: 'Timers' });
    expect(
      await within(region).findByRole('button', { name: /^⏱ Тушить · 1:(30:00|29:59)$/ }),
    ).toBeTruthy();
    expect(bodies(calls, 'POST /api/timers')).toEqual([
      {
        client_timer_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        recipe_id: GOLUBTSY_ID,
        step_id: STEP2.id,
        duration_sec: 5400,
        label: 'Тушить',
      },
    ]);
    // Running: the same timer cannot be started twice from the card.
    expect(
      (screen.getByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('no timers running: no timers panel on the card', async () => {
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    await screen.findByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' });
    await waitFor(() => expect(listCalls).toBeGreaterThan(0));
    expect(screen.queryByRole('region', { name: 'Timers' })).toBeNull();
  });

  it('a timer that had already ended before the card opened is not kept on it; one that ends on the card stays as "ready!"', async () => {
    // Found by the browser tests (S5-9): a timer stays in the server's list for 15 minutes after
    // it ends, and the panel kept at the bottom of every card covered the card's buttons.
    const before = iso(Date.now() - 60_000);
    list = [serverTimer({ label: 'Духовка', status: 'fired', ends_at: before, fired_at: before })];
    api();
    startedRunsMs = 1500;
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    await waitFor(() => expect(listCalls).toBeGreaterThan(0));
    await expect(
      screen.findByRole('region', { name: 'Timers' }, { timeout: 500 }),
    ).rejects.toThrow();
    fireEvent.click(await screen.findByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' }));
    await screen.findByRole('alert', {}, { timeout: 6000 });
    const region = screen.getByRole('region', { name: 'Timers' });
    expect(within(region).getByRole('button', { name: '✅ Тушить · ready!' })).toBeTruthy();
    expect(within(region).queryByRole('button', { name: /Духовка/ })).toBeNull();
  }, 15_000);

  it('a timer started in cooking mode shows on the card too, with +1 min and Cancel', async () => {
    list = [serverTimer()];
    const calls = api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const region = await screen.findByRole('region', { name: 'Timers' });
    fireEvent.click(await within(region).findByRole('button', { name: /^⏱ Тушить/ }));
    fireEvent.click(within(region).getByRole('button', { name: 'Cancel timer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('"message not delivered" (PRD 4.4: the bot could not write)', () => {
  it('a timer the bot could not announce says so, with a way to open the bot', async () => {
    list = [
      serverTimer({
        status: 'failed',
        ends_at: iso(Date.now() - 10_000),
        fired_at: iso(Date.now() - 10_000),
      }),
    ];
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const region = await screen.findByRole('region', { name: 'Timers' });
    expect(
      await within(region).findByRole('button', { name: '⚠️ Тушить · message not delivered' }),
    ).toBeTruthy();
    expect(within(region).getByText(/could not send you the message/)).toBeTruthy();
    const open = vi.fn();
    getRuntime().webApp.openTelegramLink = open;
    fireEvent.click(within(region).getByRole('button', { name: 'Open the bot' }));
    expect(open).toHaveBeenCalledWith('https://t.me/your_cookbook_bot');
  });

  it('after a timer reaches zero on screen, the app asks the server again to learn whether the message went', async () => {
    list = [serverTimer({ label: 'Духовка', ends_at: iso(Date.now() + 1200) })];
    api();
    const state: CookState = {
      v: 1,
      recipe_id: GOLUBTSY_ID,
      recipe_version: 1,
      scale: null,
      step_index: 0,
      checked_ingredients: [],
      timers: [],
      started: true,
      session_id: SESSION,
      recipe: GOLUBTSY,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state));
    renderApp(`/cook/${GOLUBTSY_ID}?step=1`);
    await screen.findByRole('alert', {}, { timeout: 4000 });
    const before = listCalls;
    list = [{ ...list[0]!, status: 'failed', fired_at: iso(Date.now()) }];
    await waitFor(() => expect(listCalls).toBeGreaterThan(before), { timeout: 8000 });
    expect(
      await within(screen.getByRole('region', { name: 'Timers' })).findByRole('button', {
        name: '⚠️ Духовка · message not delivered',
      }),
    ).toBeTruthy();
  }, 15_000);
});

describe('sound at zero', () => {
  it('starting a timer prepares the sound (a tap allows it); zero plays it', async () => {
    api();
    startedRunsMs = 1500; // the server answers with a timer that ends very soon
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' }));
    expect(audio.created).toBe(1);
    expect(audio.resumed).toBeGreaterThan(0);
    expect(audio.tones).toBe(0);
    await screen.findByRole('alert', {}, { timeout: 6000 });
    expect(audio.tones).toBeGreaterThan(0);
  }, 15_000);

  it('without the Web Audio API the alarm still shows, silently', async () => {
    vi.stubGlobal('AudioContext', undefined);
    list = [serverTimer({ label: 'Духовка', ends_at: iso(Date.now() + 1200) })];
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toBeTruthy();
  });
});
