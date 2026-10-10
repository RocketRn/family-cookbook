import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../src/App';
import { createQueryClient } from '../src/queryClient';

/** Shared by the screen tests: a fetch stub keyed by "METHOD /api/path", and the whole app. */
export type Handler = (init: RequestInit) => Response | Promise<Response>;
export const BOOK_LIST = 'GET /api/recipes?scope=book&limit=50';
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
export const ME = {
  id: 'u1',
  tg_user_id: '100000001',
  tg_username: 'dev_keeper',
  first_name: 'Dev Keeper',
  photo_url: null,
  ui_lang: 'ru',
  bot_started: false,
  notify_prefs: {},
};
export const BOOK = {
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

export function stubApi(routes: Record<string, Handler>) {
  const calls: Array<{ url: string; method: string; auth: string | null; body?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        auth: (init.headers as Record<string, string>)?.Authorization ?? null,
        body: typeof init.body === 'string' ? init.body : undefined,
      });
      const h = routes[`${method} ${url}`];
      return h
        ? h(init)
        : json(404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
    }),
  );
  return calls;
}

export function renderApp(path = '/') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
