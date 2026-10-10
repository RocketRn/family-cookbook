import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cookKey, type CookState } from '../src/cook/state';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID, MEMBER } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * FE-10 (PRD 2.4 steps 12-14, 3.2; D-044, D-048): reactions on the recipe card and the
 * "I cooked it" screen with an optional photo and words for the author. Owner's Sprint 5 answers:
 * "cooked N times"; no message for your own recipe; "My version" stays hidden.
 */
const SESSION = '5e551011-0000-4000-8000-000000000001';
const THEIRS = { ...GOLUBTSY, is_mine: false, can_edit: false, author: MEMBER };
const REACTIONS = `/api/recipes/${GOLUBTSY_ID}/reactions`;
type Summary = {
  counts: Record<string, number>;
  mine: Record<string, string | number | null>;
  cooked: unknown[];
};
const summary = (over: Partial<Summary> = {}): Summary => ({
  counts: { heart: 0, yum: 0, fire: 0, idea: 0, curious: 0, cook_again: 0, cooked: 0 },
  mine: {
    heart: null,
    yum: null,
    fire: null,
    idea: null,
    curious: null,
    cook_again: null,
    cooked: 0,
  },
  cooked: [],
  ...over,
});
const PHOTO = {
  id: 'ph000000-0000-4000-8000-000000000001',
  width: 300,
  height: 300,
  url: 'http://localhost:8333/full.jpg',
  thumb_url: 'http://localhost:8333/thumb.jpg',
};

let current: Summary;
function api(over: Record<string, Handler> = {}, recipe: object = THEIRS) {
  current = summary();
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, recipe),
    [`GET ${REACTIONS}`]: () => json(200, current),
    [`POST ${REACTIONS}`]: (init) => {
      const b = JSON.parse(String(init.body));
      const id = `r-${b.kind}`;
      if (b.kind === 'cooked') {
        current = {
          ...current,
          counts: { ...current.counts, cooked: current.counts.cooked! + 1 },
          mine: { ...current.mine, cooked: Number(current.mine.cooked) + 1 },
        };
      } else {
        current = {
          ...current,
          counts: { ...current.counts, [b.kind]: current.counts[b.kind]! + 1 },
          mine: { ...current.mine, [b.kind]: id },
        };
      }
      return json(201, {
        reaction: { id, kind: b.kind, note: b.note ?? null, photo: null, created_at: '' },
        summary: current,
      });
    },
    'DELETE /api/reactions/r-heart': () => {
      current = {
        ...current,
        counts: { ...current.counts, heart: current.counts.heart! - 1 },
        mine: { ...current.mine, heart: null },
      };
      return new Response(null, { status: 204 });
    },
    'POST /api/media': () => json(201, PHOTO),
    [`PATCH /api/cook-sessions/${SESSION}`]: () => json(200, { id: SESSION }),
    'GET /api/timers?active=1': () =>
      json(200, { timers: [], server_now: new Date().toISOString() }),
    ...over,
  });
}
const bodies = (calls: ReturnType<typeof api>, what: string) =>
  calls.filter((c) => `${c.method} ${c.url}` === what).map((c) => JSON.parse(c.body ?? '{}'));
const reactionsBlock = async () => screen.findByRole('region', { name: 'Reactions' });

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('reactions on the card', () => {
  it('show their counts; a tap adds yours, another tap removes it', async () => {
    const calls = api();
    current.counts.heart = 2;
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const block = await reactionsBlock();
    const heart = await within(block).findByRole('button', { name: 'Love it: 2' });
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(heart);
    const mine = await within(block).findByRole('button', { name: 'Love it: 3' });
    expect(mine.getAttribute('aria-pressed')).toBe('true');
    expect(bodies(calls, `POST ${REACTIONS}`)).toEqual([{ kind: 'heart' }]);
    fireEvent.click(mine);
    await within(block).findByRole('button', { name: 'Love it: 2' });
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/reactions/r-heart')).toBe(
      true,
    );
  });

  it('"I’ll cook it again" counts too; "My version" is not there; nothing says "later"', async () => {
    api();
    current.counts.cook_again = 1;
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const block = await reactionsBlock();
    expect(await within(block).findByRole('button', { name: 'Cook again: 1' })).toBeTruthy();
    expect(within(block).queryByRole('button', { name: /My version/ })).toBeNull();
    expect(within(block).queryByText(/later version/)).toBeNull();
  });

  it('"Cooked N times", and how often you did', async () => {
    api();
    current.counts.cooked = 3;
    current.mine.cooked = 1;
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const block = await reactionsBlock();
    expect(await within(block).findByText('👨‍🍳 Cooked 3 times')).toBeTruthy();
    expect(within(block).getByText('You cooked it 1 time')).toBeTruthy();
  });

  it('the author sees who cooked it, with the photo and the words', async () => {
    api({}, GOLUBTSY);
    current.counts.cooked = 1;
    current.cooked = [
      {
        id: 'c1',
        cook_name: 'Dev Member',
        note: 'Чуть пересолила, но вкусно!',
        photo: PHOTO,
        created_at: '2026-10-09T12:00:00Z',
        mine: false,
      },
    ];
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const list = await screen.findByRole('list', { name: 'Who cooked it' });
    expect(within(list).getByText('Dev Member')).toBeTruthy();
    expect(within(list).getByText('Чуть пересолила, но вкусно!')).toBeTruthy();
    expect(within(list).getByRole('img', { name: 'Dev Member’s dish' })).toBeTruthy();
  });

  it('a failed tap says so and changes nothing', async () => {
    api({
      [`POST ${REACTIONS}`]: () =>
        json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } }),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const block = await reactionsBlock();
    fireEvent.click(await within(block).findByRole('button', { name: 'Yummy: 0' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(
      within(block).getByRole('button', { name: 'Yummy: 0' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('"I cooked it"', () => {
  it('from the card: a photo and words for the author, then "Sent!"', async () => {
    const calls = api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(
      await within(await reactionsBlock()).findByRole('button', { name: '👨‍🍳 I cooked it' }),
    );
    expect(await screen.findByRole('heading', { name: 'You cooked “Голубцы”' })).toBeTruthy();
    expect(screen.getByText(/Dev Member gets them in a message from the bot/)).toBeTruthy();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'dish.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
    await screen.findByRole('img', { name: 'Your dish' });
    const words = screen.getByRole('textbox', { name: 'A few words for the author' });
    expect(words.getAttribute('maxlength')).toBe('500');
    fireEvent.change(words, { target: { value: '  Очень вкусно!  ' } });
    expect(screen.getByText('17 / 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { name: 'Sent!' })).toBeTruthy();
    expect(bodies(calls, `POST ${REACTIONS}`)).toEqual([
      { kind: 'cooked', note: 'Очень вкусно!', photo_media_id: PHOTO.id },
    ]);
    expect(screen.getByText(/Dev Member will get a message/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the recipe' }));
    expect(await within(await reactionsBlock()).findByText('👨‍🍳 Cooked 1 time')).toBeTruthy();
  });

  it('"Without a photo or words" sends the mark at once', async () => {
    const calls = api();
    renderApp(`/recipe/${GOLUBTSY_ID}/cooked`);
    fireEvent.click(await screen.findByRole('button', { name: 'Without a photo or words' }));
    expect(await screen.findByRole('heading', { name: 'Sent!' })).toBeTruthy();
    expect(bodies(calls, `POST ${REACTIONS}`)).toEqual([{ kind: 'cooked' }]);
  });

  it('your own recipe: the mark is kept and nobody gets a message', async () => {
    api({}, GOLUBTSY);
    renderApp(`/recipe/${GOLUBTSY_ID}/cooked`);
    expect(await screen.findByText(/This is your own recipe/)).toBeTruthy();
    expect(screen.queryByText(/gets them in a message/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/nobody gets a message/)).toBeTruthy();
  });

  it('from the Done screen of cooking, tied to that cooking session', async () => {
    const state: CookState = {
      v: 1,
      recipe_id: GOLUBTSY_ID,
      recipe_version: 1,
      scale: null,
      step_index: 1,
      checked_ingredients: [],
      timers: [],
      started: true,
      session_id: SESSION,
      recipe: THEIRS,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(cookKey(GOLUBTSY_ID), JSON.stringify(state));
    const calls = api();
    renderApp(`/cook/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: '👨‍🍳 I cooked it' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await screen.findByRole('heading', { name: 'Sent!' });
    expect(bodies(calls, `POST ${REACTIONS}`)).toEqual([
      { kind: 'cooked', cook_session_id: SESSION },
    ]);
  });

  it('if sending fails, it says so and keeps what you wrote', async () => {
    api({
      [`POST ${REACTIONS}`]: () =>
        json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } }),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}/cooked`);
    const words = await screen.findByRole('textbox', { name: 'A few words for the author' });
    fireEvent.change(words, { target: { value: 'Вкусно' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Sent!' })).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: 'A few words for the author' }) as HTMLTextAreaElement)
        .value,
    ).toBe('Вкусно');
  });
});
