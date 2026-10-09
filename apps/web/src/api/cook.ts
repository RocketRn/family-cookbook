import { api } from './endpoints';

/** Cooking sessions (PRD 4.8): analytics only, so every call is best effort. */
export type CookSession = { id: string; state: 'active' | 'finished' | 'abandoned' };

export const startCookSession = (body: {
  recipe_id: string;
  recipe_version: number;
  scale_factor: number;
}) => api().request<CookSession>('POST', '/cook-sessions', body);

export const patchCookSession = (
  id: string,
  body: { max_step_index: number } | { state: 'finished' | 'abandoned' },
) => api().request<CookSession>('PATCH', `/cook-sessions/${id}`, body);
