import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { authHeader } from './db.js';

/** Sprint 4 fixtures: a family book with a published two-step recipe, and an outsider. */
export const KEEPER = 9101;
export const MEMBER = 9102;
export const OUTSIDER = 9103;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export const caller =
  (app: FastifyInstance) => (method: Method, url: string, tg: number, payload?: object) =>
    app.inject({ method, url, headers: authHeader(tg), ...(payload ? { payload } : {}) });

export type Family = { bookRecipeId: string; stepIds: string[]; outsiderRecipeId: string };

export async function family(app: FastifyInstance): Promise<Family> {
  const call = caller(app);
  const book = (await call('POST', '/books', KEEPER, { title: 'Семья' })).json();
  await call('POST', '/books/join', MEMBER, { invite_code: book.invite_code });
  await call('POST', '/books', OUTSIDER, { title: 'Другие' });
  const recipe = (
    await call('POST', '/recipes', KEEPER, {
      title: 'Голубцы',
      servings: 4,
      language: 'ru',
      status: 'published',
      visibility: 'book',
      ingredients: [{ ref: 'a', name: 'фарш', qty_kind: 'exact', amount_min: 800, unit_code: 'g' }],
      steps: [
        { body: 'Смешайте фарш.' },
        { body: 'Тушите 90 минут.', timers: [{ label: 'Тушить', duration_sec: 5400 }] },
      ],
    })
  ).json();
  const own = (
    await call('POST', '/recipes', OUTSIDER, { title: 'Секрет', steps: [{ body: 'x' }] })
  ).json();
  return {
    bookRecipeId: recipe.id,
    stepIds: recipe.steps.map((s: { id: string }) => s.id),
    outsiderRecipeId: own.id,
  };
}

export const timerBody = (over: Record<string, unknown> = {}) => ({
  client_timer_id: randomUUID(),
  duration_sec: 600,
  label: 'Тушить',
  ...over,
});
