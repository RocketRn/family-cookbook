import { createApiClient, type ApiClient } from './client';
import { getRuntime } from '../telegram/sdk';

export type UiLang = 'ru' | 'uk' | 'en' | 'sv';

export type Me = {
  id: string;
  tg_user_id: string;
  tg_username: string | null;
  first_name: string | null;
  photo_url: string | null;
  ui_lang: UiLang;
  bot_started: boolean;
  notify_prefs: Record<string, boolean>;
};

export type Member = {
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  first_name: string | null;
  tg_username: string | null;
  photo_url: string | null;
};

export type Book = {
  id: string;
  title: string;
  role: 'owner' | 'member';
  invite_code?: string;
  members: Member[];
};

let client: ApiClient | null = null;
export function api(): ApiClient {
  client ??= createApiClient({
    baseUrl: import.meta.env.VITE_API_URL ?? '/api',
    getInitData: () => getRuntime().webApp.initData,
  });
  return client;
}

export const getMe = () => api().request<Me>('GET', '/me');
/** PRD 4.9 PATCH /me: keeps the interface language in the profile (used by the bot, too). */
export const updateMe = (patch: { ui_lang: UiLang }) => api().request<Me>('PATCH', '/me', patch);
export const getCurrentBook = () => api().request<Book>('GET', '/books/current');
export const createBook = (title: string) =>
  api().request<{ id: string }>('POST', '/books', { title });
export const joinBook = (inviteCode: string) =>
  api().request<{ id: string }>('POST', '/books/join', { invite_code: inviteCode });
export const rotateInvite = () =>
  api().request<{ invite_code: string }>('POST', '/books/current/invite/rotate');
export const leaveBook = () => api().request<void>('POST', '/books/leave');
export const removeMember = (userId: string) =>
  api().request<void>('DELETE', `/books/current/members/${userId}`);
