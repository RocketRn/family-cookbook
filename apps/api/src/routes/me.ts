import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser } from '../db/tx.js';
import type { User } from '../users/repo.js';

/** PRD 4.9 PATCH /me. Sprint 2 syncs the interface language; notify_prefs arrive with BE-08. */
const patchMeBody = z.object({ ui_lang: z.enum(['ru', 'uk', 'en', 'sv']) }).strict();

function meView(u: User) {
  return {
    id: u.id,
    tg_user_id: u.tg_user_id,
    tg_username: u.tg_username,
    first_name: u.first_name,
    photo_url: u.photo_url,
    ui_lang: u.ui_lang,
    bot_started: u.bot_started,
    notify_prefs: u.notify_prefs,
  };
}

export function registerMe(app: FastifyInstance, db: Db): void {
  app.get('/me', async (req) => meView(currentUser(req)));

  app.patch('/me', async (req) => {
    const u = currentUser(req);
    const { ui_lang } = patchMeBody.parse(req.body);
    await withUser(db, { userId: u.id }, (tx) =>
      tx.query('UPDATE users SET ui_lang = $1 WHERE id = app_user_id()', [ui_lang]),
    );
    return meView({ ...u, ui_lang });
  });
}
