import { api } from './endpoints';

/** Cooking sessions (PRD 4.8): analytics only, so every call is best effort. */
export type CookSession = { id: string; state: 'active' | 'finished' | 'abandoned' };

export const startCookSession = (body: {
  recipe_id: string;
  recipe_version: number;
  scale_factor: number;
  /** A guest cooking a recipe shared by link (S6-3, D-055). */
  share_token?: string;
}) => api().request<CookSession>('POST', '/cook-sessions', body);

export const patchCookSession = (
  id: string,
  body: ({ max_step_index: number } | { state: 'finished' | 'abandoned' }) & {
    share_token?: string;
  },
) => api().request<CookSession>('PATCH', `/cook-sessions/${id}`, body);

/** A server timer (BE-09, D-040). Times are ISO strings by the server's clock. */
export type ServerTimer = {
  id: string;
  client_timer_id: string;
  recipe_id: string | null;
  step_id: string | null;
  cook_session_id: string | null;
  label: string;
  recipe_title: string | null;
  step_number: number | null;
  duration_sec: number;
  started_at: string;
  ends_at: string;
  status: 'running' | 'fired' | 'cancelled' | 'failed';
  fired_at: string | null;
  cancelled_at: string | null;
};
export type TimerAnswer = { timer: ServerTimer; server_now: string };

export const startTimer = (body: {
  client_timer_id: string;
  recipe_id: string;
  step_id?: string;
  cook_session_id?: string;
  duration_sec: number;
  label: string;
  /** Only for a timer started offline: when it really started (PRD 4.6 #6). */
  started_at?: string;
  /** A guest cooking a recipe shared by link (S6-3, D-055). */
  share_token?: string;
}) => api().request<TimerAnswer>('POST', '/timers', body);

export const listActiveTimers = () =>
  api().request<{ timers: ServerTimer[]; server_now: string }>('GET', '/timers?active=1');

export const extendTimer = (id: string, seconds: number) =>
  api().request<TimerAnswer>('POST', `/timers/${id}/extend`, { seconds });

export const cancelTimer = (id: string) => api().request<void>('DELETE', `/timers/${id}`);
