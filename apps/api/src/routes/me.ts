import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/plugin.js';

export function registerMe(app: FastifyInstance): void {
  app.get('/me', async (req) => {
    const u = currentUser(req);
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
  });
}
