import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser } from '../db/tx.js';
import type { User } from '../users/repo.js';

/**
 * PRD 4.9 PATCH /me: the interface language and the notification settings (PRD 3.2 notify_prefs;
 * D-049). Only the settings sent change; quiet mode (mute_social) turns off the messages about
 * other people ("cooked", "new recipe"); personal timer messages are not affected.
 */
const notifyPrefs = z
  .object({
    timers: z.boolean(),
    cooked: z.boolean(),
    new_recipe: z.boolean(),
    mute_social: z.boolean(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'at least one setting');
const patchMeBody = z
  .object({
    ui_lang: z.enum(['ru', 'uk', 'en', 'sv']).optional(),
    notify_prefs: notifyPrefs.optional(),
  })
  .strict()
  .refine((b) => b.ui_lang !== undefined || b.notify_prefs !== undefined, 'nothing to change');

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
    const b = patchMeBody.parse(req.body);
    const prefs = await withUser(db, { userId: u.id }, async (tx) => {
      if (b.ui_lang)
        await tx.query('UPDATE users SET ui_lang = $1 WHERE id = app_user_id()', [b.ui_lang]);
      if (!b.notify_prefs) return u.notify_prefs;
      const r = await tx.query<{ p: User['notify_prefs'] }>(
        'SELECT update_notify_prefs($1::jsonb) AS p',
        [JSON.stringify(b.notify_prefs)],
      );
      return r.rows[0]!.p;
    });
    return meView({ ...u, ui_lang: b.ui_lang ?? u.ui_lang, notify_prefs: prefs });
  });
}
