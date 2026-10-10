import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser } from '../db/tx.js';
import { AppError, notFound } from '../errors.js';
import type { TelegramTarget } from '../notify/target.js';
import { botApiCall } from '../notify/telegram.js';
import { appLink, recipeLink, renderShared, type Links } from '../notify/templates.js';
import type { ObjectStorage } from '../storage/storage.js';
import { findRecipe } from './repo.js';
import { view } from './routes.js';

const idParams = z.object({ id: z.string().uuid() });

/**
 * BE-12 / S6-3b (PRD 4.7, R1; D-056): POST /recipes/:id/share. A link to the recipe, and, when the
 * Bot API is set up, a message prepared with savePreparedInlineMessage (Bot API 8.0): the recipe's
 * photo or title and an "Open the recipe" button. The app sends it with WebApp.shareMessage, so
 * the chat shows the recipe, not the app's generic card. A book recipe's link opens it for members
 * of the book; a recipe shared by link, for anyone (`for`). Drafts and private recipes: 409.
 * If Telegram is not set up or refuses, the answer still has the link: the app falls back to
 * Telegram's share screen with it.
 */
export function registerShare(
  app: FastifyInstance,
  db: Db,
  storage: ObjectStorage,
  links: Links,
  telegram: TelegramTarget | null,
): void {
  app.post('/recipes/:id/share', async (req) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    const recipe = await withUser(db, { userId: user.id }, async (tx) => {
      const row = await findRecipe(tx, id);
      return row ? view(tx, storage, row, user.id) : null;
    });
    if (!recipe) throw notFound('Recipe not found');
    if (recipe.status !== 'published' || recipe.visibility === 'private')
      throw new AppError(
        409,
        'NOT_SHAREABLE',
        'Only a published recipe in the book or shared by link can be shared',
      );
    const byLink = recipe.visibility === 'link' && typeof recipe.share_token === 'string';
    // Only the author's view carries the token; members share a link recipe by its token too.
    const token = byLink ? recipe.share_token : await shareTokenOf(db, user.id, id);
    const link = token ? appLink(links, `r_${token}`) : recipeLink(links, id);

    let prepared: string | null = null;
    if (telegram) {
      const msg = renderShared(
        { title: recipe.title, author_name: recipe.author.name },
        user.ui_lang,
        link,
      );
      const cover = recipe.cover as { url: string; thumb_url: string } | null;
      const result = cover
        ? {
            type: 'photo',
            id: randomUUID(),
            photo_url: cover.url,
            thumbnail_url: cover.thumb_url,
            title: recipe.title,
            caption: msg.text,
            parse_mode: 'HTML',
            reply_markup: msg.reply_markup,
          }
        : {
            type: 'article',
            id: randomUUID(),
            title: recipe.title,
            input_message_content: {
              message_text: msg.text,
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true },
            },
            reply_markup: msg.reply_markup,
          };
      const answer = await botApiCall(telegram, 'savePreparedInlineMessage', {
        user_id: user.tg_user_id,
        result,
        allow_user_chats: true,
        allow_group_chats: true,
      });
      const r = answer.result as { id?: unknown } | undefined;
      if (answer.ok && typeof r?.id === 'string') prepared = r.id;
      else req.log.warn({ description: answer.description }, 'share: no prepared message');
    }
    return { link, prepared_message_id: prepared, for: token ? 'anyone' : 'book' };
  });
}

/** A recipe shared by link: its token, read as the caller (the recipes' row-level security). */
async function shareTokenOf(db: Db, userId: string, id: string): Promise<string | null> {
  return withUser(db, { userId }, async (tx) => {
    const r = await tx.query<{ share_token: string | null }>(
      `SELECT share_token FROM recipes WHERE id = $1 AND visibility = 'link' AND status = 'published'`,
      [id],
    );
    return r.rows[0]?.share_token ?? null;
  });
}
