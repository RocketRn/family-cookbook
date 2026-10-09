import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ApiError } from '../src/api/client';
import { recipeApi } from '../src/api/recipeApi';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';

type Handler = (init: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ME = {
  id: 'u1',
  tg_user_id: '100000001',
  tg_username: 'dev_keeper',
  first_name: 'Dev Keeper',
  photo_url: null,
  ui_lang: 'ru',
  bot_started: false,
  notify_prefs: {},
};
const BOOK = {
  id: 'b1',
  title: 'Семья',
  role: 'owner',
  invite_code: 'devinvitecode',
  members: [
    {
      user_id: 'u1',
      role: 'owner',
      joined_at: '',
      first_name: 'Dev Keeper',
      tg_username: 'dev_keeper',
      photo_url: null,
    },
    {
      user_id: 'u2',
      role: 'member',
      joined_at: '',
      first_name: 'Dev Member',
      tg_username: 'dev_member',
      photo_url: null,
    },
  ],
};

function stubApi(routes: Record<string, Handler>) {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        auth: (init.headers as Record<string, string>)?.Authorization ?? null,
      });
      const h = routes[`${method} ${url}`];
      return h
        ? h(init)
        : json(404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
    }),
  );
  return calls;
}

function renderApp(path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetTelegramRuntime();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('demo: sign-in through Telegram (dev mock) against the API contract', () => {
  it('signs in with a freshly signed initData, applies the profile language and lists the book', async () => {
    const calls = stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Семья' })).toBeTruthy();
    expect(await screen.findByText('Голубцы')).toBeTruthy();
    expect(screen.getByText('Борщ по-мамински')).toBeTruthy();

    const me = calls.find((c) => c.url === '/api/me')!;
    expect(me.auth).toMatch(/^tma .*hash=[0-9a-f]{64}$/);
    expect(document.documentElement.lang).toBe('ru'); // ui_lang from /me
  });

  it('search narrows the list by ingredient', async () => {
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp();
    await screen.findByText('Голубцы');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'фарш' } });
    await waitFor(() => expect(screen.queryByText('Борщ по-мамински')).toBeNull());
    expect(await screen.findByText('Голубцы')).toBeTruthy();
  });

  it('shows onboarding when the user is not in a book, and creates one', async () => {
    await setLanguage('en');
    let created = false;
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () =>
        created
          ? json(200, { ...BOOK, title: 'Family' })
          : json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
      'POST /api/books': () => {
        created = true;
        return json(201, { id: 'b1', title: 'Family', role: 'owner', invite_code: 'c' });
      },
    });
    renderApp();
    fireEvent.change(await screen.findByLabelText('Book name'), { target: { value: 'Family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create book' }));
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy();
  });

  it('shows a retryable error when sign-in fails', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () =>
        json(401, { error: { code: 'UNAUTHORIZED', message: 'x', request_id: 'r' } }),
    });
    renderApp();
    expect(await screen.findByText("Couldn't sign in")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('boots once: navigating between tabs does not sign in again or restart the app', async () => {
    await setLanguage('en');
    const calls = stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp();
    await screen.findByRole('heading', { name: 'Семья' });
    fireEvent.click(screen.getByRole('link', { name: /Saved/ }));
    await screen.findByRole('heading', { name: 'Saved' });
    fireEvent.click(screen.getByRole('link', { name: /Profile/ }));
    await screen.findByRole('heading', { name: 'Profile' });
    expect(calls.filter((c) => c.url === '/api/me')).toHaveLength(1);
    expect(screen.queryByText('Signing in…')).toBeNull();
  });

  it('after joining through a deep link the user lands on the book (start_param is not replayed)', async () => {
    await setLanguage('en');
    window.history.replaceState({}, '', '/?startapp=join_devinvitecode');
    let joined = false;
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () =>
        joined
          ? json(200, BOOK)
          : json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
      'POST /api/books/join': () => {
        joined = true;
        return json(201, { id: 'b1', title: 'Семья', role: 'member' });
      },
    });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Join the book' }));
    expect(await screen.findByRole('heading', { name: 'Семья' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Join this book?' })).toBeNull();
  });

  it('follows a join_ deep link from start_param', async () => {
    await setLanguage('en');
    window.history.replaceState({}, '', '/?startapp=join_devinvitecode');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () =>
        json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
    });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Join this book?' })).toBeTruthy();
  });

  it('sets the document title from the UI language', async () => {
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp();
    await screen.findByRole('heading', { name: 'Семья' });
    expect(document.title).toBe('Семейная кулинарная книга');
  });
});

describe('error states (review round 2)', () => {
  const serverError = () =>
    json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } });

  it('Profile shows the error and a retry when the book fails to load, not "not in a book"', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': serverError,
    });
    renderApp('/profile');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('You are not in a book yet.')).toBeNull();
  });

  it('Book tab shows the error message, not a bare button', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': serverError,
    });
    renderApp('/');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  });

  it('Saved shows a network error with retry, and recovers', async () => {
    await setLanguage('en');
    const spy = vi
      .spyOn(recipeApi, 'list')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp('/saved');
    expect(await screen.findByText('No connection. Check your network.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Syrniki')).toBeTruthy();
    spy.mockRestore();
  });

  it('a failed recipe load is not reported as "Recipe not found"', async () => {
    await setLanguage('en');
    const spy = vi
      .spyOn(recipeApi, 'get')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp('/recipe/mock-pie');
    expect(await screen.findByText('No connection. Check your network.')).toBeTruthy();
    expect(screen.queryByText('Recipe not found')).toBeNull();
    spy.mockRestore();
  });
});

describe('Telegram BackButton (review round 2)', () => {
  it('on the first screen of the session it goes to the book, never out of the app', async () => {
    // Browser history from before the Mini App opened (window.history.length > 1).
    window.history.pushState({}, '', '/somewhere-before-the-app');
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp('/recipe/mock-pie');
    await screen.findByRole('heading', { name: 'Apple pie' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid=mock-back-button]')!);
    expect(await screen.findByRole('heading', { name: 'Семья' })).toBeTruthy();
  });

  it('after in-app navigation it goes back one step', async () => {
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp('/saved');
    fireEvent.click(await screen.findByText('Syrniki'));
    await screen.findByRole('heading', { name: 'Syrniki' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid=mock-back-button]')!);
    expect(await screen.findByRole('heading', { name: 'Сохранённое' })).toBeTruthy();
  });
});
