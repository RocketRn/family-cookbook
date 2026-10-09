import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cookKey, type CookState } from '../src/cook/state';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime, getRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi, type Handler } from './harness';

/** FE-09 timers in cooking mode (PRD 2.4 steps 7-11, 4.6 "client synchronization"; D-042). */
const SESSION = '5e551011-0000-4000-8000-000000000001';
const TIMER = '71e70000-0000-4000-8000-000000000001';
const STEP2 = GOLUBTSY.steps[1]!;
/** The phone's clock is an hour behind the server: the countdown must follow the server. */
const SKEW = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const serverNow = () => Date.now() + SKEW;

type ServerTimer = Record<string, unknown> & { id: string; ends_at: string };
let list: ServerTimer[] = [];
const serverTimer = (over: Partial<ServerTimer> = {}): ServerTimer => ({
  id: TIMER,
  client_timer_id: '00000000-0000-4000-8000-0000000000aa',
  recipe_id: GOLUBTSY_ID,
  step_id: STEP2.id,
  cook_session_id: SESSION,
  label: 'Тушить',
  recipe_title: 'Голубцы',
  step_number: 2,
  duration_sec: 5400,
  started_at: iso(serverNow()),
  ends_at: iso(serverNow() + 5400_000),
  status: 'running',
  fired_at: null,
  cancelled_at: null,
  ...over,
});

const created: Handler = (init) => {
  const body = JSON.parse(String(init.body));
  const t = serverTimer({ client_timer_id: body.client_timer_id });
  list = [t];
  return json(201, { timer: t, server_now: iso(serverNow()) });
};

function api(over: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    [`PATCH /api/cook-sessions/${SESSION}`]: () => json(200, { id: SESSION }),
    'GET /api/timers?active=1': () => json(200, { timers: list, server_now: iso(serverNow()) }),
    'POST /api/timers': created,
    [`POST /api/timers/${TIMER}/extend`]: (init) => {
      const { seconds } = JSON.parse(String(init.body));
      const t = list[0]!;
      const moved = {
        ...t,
        duration_sec: Number(t.duration_sec) + seconds,
        ends_at: iso(Date.parse(t.ends_at) + seconds * 1000),
      };
      list = [moved];
      return json(200, { timer: moved, server_now: iso(serverNow()) });
    },
    [`DELETE /api/timers/${TIMER}`]: () => {
      list = [];
      return new Response(null, { status: 204 });
    },
    ...over,
  });
}

const cooking = (stepIndex: number): CookState => ({
  v: 1,
  recipe_id: GOLUBTSY_ID,
  recipe_version: 1,
  scale: null,
  step_index: stepIndex,
  checked_ingredients: [],
  timers: [],
  started: true,
  session_id: SESSION,
  recipe: GOLUBTSY,
  updated_at: new Date().toISOString(),
});
const saved = () => JSON.parse(localStorage.getItem(cookKey(GOLUBTSY_ID)) ?? 'null') as CookState;
const bodies = (calls: ReturnType<typeof api>, what: string) =>
  calls.filter((c) => `${c.method} ${c.url}` === what).map((c) => JSON.parse(c.body ?? '{}'));
const timersRegion = () => screen.getByRole('region', { name: 'Timers' });
const startButton = () => screen.getByRole('button', { name: '⏱ Start timer: Тушить, 1:30:00' });

async function openAtStep(n: number) {
  localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(cooking(n - 1)));
  renderApp(`/cook/${GOLUBTSY_ID}?step=${n}`);
  await screen.findByText(`Step ${n} of 2`);
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
  list = [];
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('timers in cooking mode', () => {
  it("starts the step's timer on the server and counts down by the server's clock", async () => {
    const calls = api();
    await openAtStep(2);
    fireEvent.click(startButton());
    const chip = await within(timersRegion()).findByRole('button', {
      name: /^⏱ Тушить · 1:(30:00|29:59)$/,
    });
    expect(chip).toBeTruthy();
    expect(bodies(calls, 'POST /api/timers')).toEqual([
      {
        client_timer_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        recipe_id: GOLUBTSY_ID,
        step_id: STEP2.id,
        duration_sec: 5400,
        label: 'Тушить',
        cook_session_id: SESSION,
      },
    ]);
    // Running already: a second tap cannot start the same timer twice.
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(saved().timers).toMatchObject([
      { server_id: TIMER, step_id: STEP2.id, label: 'Тушить', synced: true },
    ]);
    // The chips are on every step.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(within(timersRegion()).getByRole('button', { name: /^⏱ Тушить · 1:/ })).toBeTruthy();
    expect(within(timersRegion()).getByText(/the bot sends you a message/)).toBeTruthy();
  });

  it('a list of timers that was asked for before the start, but answers after it, does not erase it', async () => {
    let release: (() => void) | undefined;
    api({
      // The list as the server had it when asked (before the start), answered later.
      'GET /api/timers?active=1': () => {
        const then = [...list];
        return new Promise<Response>((resolve) => {
          release = () => resolve(json(200, { timers: then, server_now: iso(serverNow()) }));
        });
      },
    });
    await openAtStep(2);
    await vi.waitFor(() => expect(release).toBeDefined());
    fireEvent.click(startButton());
    await vi.waitFor(() => expect(saved().timers).toMatchObject([{ synced: true }]));
    await act(async () => release!());
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(saved().timers).toMatchObject([{ server_id: TIMER, synced: true }]);
    expect(within(timersRegion()).getByRole('button', { name: /^⏱ Тушить · 1:/ })).toBeTruthy();
  });

  it('after a reload the chips are rebuilt from the server (GET /timers?active=1)', async () => {
    list = [serverTimer({ label: 'Духовка', ends_at: iso(serverNow() + 600_000) })];
    api();
    await openAtStep(1);
    expect(
      await within(timersRegion()).findByRole('button', { name: /^⏱ Духовка · (10:00|9:59)$/ }),
    ).toBeTruthy();
  });

  it('+1 min moves the end; Cancel stops it', async () => {
    const calls = api();
    await openAtStep(2);
    fireEvent.click(startButton());
    fireEvent.click(await within(timersRegion()).findByRole('button', { name: /^⏱ Тушить/ }));
    fireEvent.click(screen.getByRole('button', { name: '+1 min' }));
    expect(
      await within(timersRegion()).findByRole('button', { name: /^⏱ Тушить · 1:(31:00|30:59)$/ }),
    ).toBeTruthy();
    expect(bodies(calls, `POST /api/timers/${TIMER}/extend`)).toEqual([{ seconds: 60 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel timer' }));
    await vi.waitFor(() =>
      expect(within(timersRegion()).queryByRole('button', { name: /^⏱ Тушить/ })).toBeNull(),
    );
    expect(calls.some((c) => c.method === 'DELETE' && c.url === `/api/timers/${TIMER}`)).toBe(true);
    expect(saved().timers).toEqual([]);
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('at zero: a large notice and a vibration; the chip says it is ready', async () => {
    list = [serverTimer({ label: 'Духовка', ends_at: iso(serverNow() + 1200) })];
    api();
    await openAtStep(1);
    const vibrate = vi.fn();
    getRuntime().webApp.HapticFeedback.notificationOccurred = vibrate;
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert.textContent).toContain('✅ Духовка · ready!');
    expect(vibrate).toHaveBeenCalledWith('warning');
    expect(
      within(timersRegion()).getByRole('button', { name: '✅ Духовка · ready!' }),
    ).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('without a connection: a local timer with a notice; it syncs when the connection is back', async () => {
    let online = false;
    const calls = api({
      'POST /api/timers': (init) =>
        online ? created(init) : Promise.reject(new TypeError('Failed to fetch')),
    });
    await openAtStep(2);
    fireEvent.click(startButton());
    expect(
      await screen.findByText(/No connection: this timer runs only on this screen/),
    ).toBeTruthy();
    // Never more than its length, even with no countdown running before it started.
    expect(
      within(timersRegion()).getByRole('button', { name: /^⏱ Тушить · 1:(30:00|29:59)$/ }),
    ).toBeTruthy();
    const local = saved().timers[0]!;
    expect(local).toMatchObject({ synced: false, server_id: null, label: 'Тушить' });

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() =>
      expect(saved().timers[0]).toMatchObject({ synced: true, server_id: TIMER }),
    );
    const posts = bodies(calls, 'POST /api/timers');
    // The same timer, counted from when it really started (PRD 4.6 #6).
    expect(posts[1]).toMatchObject({
      client_timer_id: local.client_timer_id,
      started_at: local.started_at,
    });
    expect(screen.queryByText(/No connection/)).toBeNull();
  });

  it('a timer that ended while the app was closed does not ring again; the server is the truth', async () => {
    const vibrate = vi.fn();
    // This device remembers it running (it was moved on another device, then fired there).
    const remembered = {
      client_timer_id: '00000000-0000-4000-8000-0000000000aa',
      server_id: TIMER,
      step_id: STEP2.id,
      label: 'Духовка',
      duration_sec: 5400,
      started_at: iso(Date.now()),
      ends_at: iso(Date.now() + 5400_000),
      synced: true,
    };
    localStorage.setItem(
      cookKey(GOLUBTSY_ID),
      JSON.stringify({ ...cooking(0), timers: [remembered] }),
    );
    list = [
      serverTimer({
        label: 'Духовка',
        status: 'fired',
        ends_at: iso(serverNow() - 60_000),
        fired_at: iso(serverNow() - 59_000),
      }),
    ];
    api();
    renderApp(`/cook/${GOLUBTSY_ID}?step=1`);
    await screen.findByText('Step 1 of 2');
    getRuntime().webApp.HapticFeedback.notificationOccurred = vibrate;
    expect(
      await within(timersRegion()).findByRole('button', { name: '✅ Духовка · ready!' }),
    ).toBeTruthy();
    await act(async () => new Promise((r) => setTimeout(r, 1200)));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
    expect(saved().timers[0]!.ends_at).toBe(list[0]!.ends_at);
  });

  it('a refused start says why and leaves no chip', async () => {
    api({
      'POST /api/timers': () =>
        json(409, { error: { code: 'TOO_MANY_TIMERS', message: 'x', request_id: 'r' } }),
    });
    await openAtStep(2);
    fireEvent.click(startButton());
    expect(
      await screen.findByText('At most 10 timers can run at once. Stop one of them first.'),
    ).toBeTruthy();
    expect(within(timersRegion()).queryByRole('button', { name: /^⏱ Тушить/ })).toBeNull();
    expect(saved().timers).toEqual([]);
  });
});

describe('the bot may not write yet (PRD 4.5)', () => {
  beforeEach(() => {
    // Dev user 3 has not allowed the bot to write (allows_write_to_pm: false).
    window.history.replaceState({}, '', '/?devUser=3');
  });

  it('before the first timer, explains and asks Telegram; the timer starts either way', async () => {
    const calls = api();
    await openAtStep(2);
    const ask = vi.fn((cb?: (granted: boolean) => void) => cb?.(true));
    getRuntime().webApp.requestWriteAccess = ask;
    fireEvent.click(startButton());
    const sheet = screen.getByRole('dialog', { name: 'Messages from the bot' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Allow messages' }));
    expect(ask).toHaveBeenCalled();
    await within(timersRegion()).findByRole('button', { name: /^⏱ Тушить/ });
    expect(bodies(calls, 'POST /api/timers')).toHaveLength(1);
    expect(within(timersRegion()).getByText(/the bot sends you a message/)).toBeTruthy();
  });

  it('refused: the timer still runs, with a way to open the bot', async () => {
    api();
    await openAtStep(2);
    getRuntime().webApp.requestWriteAccess = (cb) => cb?.(false);
    const open = vi.fn();
    getRuntime().webApp.openTelegramLink = open;
    fireEvent.click(startButton());
    fireEvent.click(screen.getByRole('button', { name: 'Allow messages' }));
    await within(timersRegion()).findByRole('button', { name: /^⏱ Тушить/ });
    expect(within(timersRegion()).getByText(/no Telegram message will arrive/)).toBeTruthy();
    fireEvent.click(within(timersRegion()).getByRole('button', { name: 'Open the bot' }));
    expect(open).toHaveBeenCalledWith('https://t.me/your_cookbook_bot');
  });
});
