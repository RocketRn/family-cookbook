import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime, getRuntime } from '../src/telegram/sdk';
import { GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, json, ME, renderApp, stubApi, type Handler } from './harness';

/**
 * BE-12 / FE-11, S6-3b (PRD 4.7, R1; D-056): "Share" on a card. The server prepares a message with
 * the recipe and its button; Telegram's shareMessage sends it to a chat. Without it (an older
 * Telegram, or the bot not set up) Telegram's share screen gets the link. "Copy link" too.
 */
const HEX = GOLUBTSY_ID.replace(/-/g, '');
const BOOK_LINK = `https://t.me/your_cookbook_bot/cookbook?startapp=rc_${HEX}`;
const ANYONE_LINK = 'https://t.me/your_cookbook_bot/cookbook?startapp=r_tokenAbcdefghijklmnop';

function api(recipe: object = GOLUBTSY, share: Handler = () => json(200, {})) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, recipe),
    [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () =>
      json(404, { error: { code: 'NOT_FOUND', message: 'n', request_id: 'r' } }),
    'GET /api/timers?active=1': () =>
      json(200, { timers: [], server_now: new Date().toISOString() }),
    [`POST /api/recipes/${GOLUBTSY_ID}/share`]: share,
  });
}
const prepared =
  (over: object = {}) =>
  () =>
    json(200, { link: BOOK_LINK, prepared_message_id: 'prepared-1', for: 'book', ...over });

async function openSheet() {
  renderApp(`/recipe/${GOLUBTSY_ID}`);
  fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
  return screen.findByRole('dialog', { name: 'Share the recipe' });
}

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('sharing a recipe', () => {
  it('"Send to a chat": Telegram’s chat picker with the message the server prepared', async () => {
    const calls = api(GOLUBTSY, prepared());
    const share = vi.fn((_id: string, cb?: (sent: boolean) => void) => cb?.(true));
    const sheet = await openSheet();
    getRuntime().webApp.shareMessage = share;
    expect(within(sheet).getByText(/Only members of your book can open it/)).toBeTruthy();
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Send to a chat' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith('prepared-1', expect.any(Function)));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('without a prepared message: Telegram’s share screen with the link and the title', async () => {
    api(GOLUBTSY, prepared({ prepared_message_id: null }));
    const sheet = await openSheet();
    const open = vi.fn();
    getRuntime().webApp.openTelegramLink = open;
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Send to a chat' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        `https://t.me/share/url?url=${encodeURIComponent(BOOK_LINK)}&text=${encodeURIComponent('Голубцы')}`,
      ),
    );
  });

  it('an older Telegram without shareMessage: the share screen too', async () => {
    api(GOLUBTSY, prepared());
    const sheet = await openSheet();
    const share = vi.fn();
    const open = vi.fn();
    Object.assign(getRuntime().webApp, {
      shareMessage: share,
      openTelegramLink: open,
      isVersionAtLeast: (v: string) => v !== '8.0',
    });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Send to a chat' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(share).not.toHaveBeenCalled();
  });

  it('"Copy link" copies it', async () => {
    api(GOLUBTSY, prepared());
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
    const sheet = await openSheet();
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(BOOK_LINK));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('a recipe shared by link: the sheet says anyone with the link can open it', async () => {
    api(
      { ...GOLUBTSY, visibility: 'link', share_token: 'tokenAbcdefghijklmnop' },
      prepared({ link: ANYONE_LINK, for: 'anyone' }),
    );
    const sheet = await openSheet();
    expect(within(sheet).getByText(/Anyone with the link can open it/)).toBeTruthy();
  });

  it.each([
    ['a draft', { status: 'draft' }],
    ['a private recipe', { visibility: 'private' }],
  ])('%s has no "Share"', async (_why, over) => {
    api({ ...GOLUBTSY, ...over });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Голубцы' });
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
