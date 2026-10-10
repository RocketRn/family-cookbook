import type { Lang } from '@cookbook/recipe-core';
import type { FastifyBaseLogger } from 'fastify';
import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { asSystem, asUser, withSystem, type Tx } from '../db/tx.js';
import type { ImportParser } from '../import/parserPool.js';
import { createImportedDraft } from '../import/routes.js';

/**
 * S6-2 (PRD 2.2 variant B, UC-02; D-054): a recipe forwarded (or written) to the bot becomes a
 * private draft of the sender, read by the same parser as "Paste", and the bot answers with a
 * button that opens "Check the recipe". The text is untrusted (owner's Sprint 6 addition):
 *
 * - only text is read (photos, captions, files and stickers get "I can see no text");
 * - at most Telegram's own 4096 characters; longer is refused without being read;
 * - only for people who already opened the app (app_opened_at, stamped by the app's sign-in);
 *   a person known only from /start is asked to open the app first; strangers get nothing;
 * - at most 30 forwarded recipes an hour per person (deleted ones count), then one answer an hour;
 * - the parser runs in its worker pool with the same time limit as "Paste" (D-033);
 * - the draft is written as the sender, under row-level security, and is private.
 *
 * The update is recorded, the draft written and the answer queued in one transaction, so each
 * update is handled once (D-047). The text itself is never logged.
 */
export const FORWARD_MAX_CHARS = 4096;
export const FORWARDS_PER_HOUR = 30;

export type ReplyKind =
  | 'draft_saved'
  | 'draft_exists'
  | 'no_text'
  | 'too_long'
  | 'too_many'
  | 'not_read'
  | 'open_app_first';
type Reply = { kind: ReplyKind; recipe_id?: string; title?: string };

type Sender = { id: string; ui_lang: Lang; app_opened_at: Date | null };

/** Records the update; false when it was handled already (or is being handled right now). */
async function firstTime(tx: Tx, updateId: number): Promise<boolean> {
  const r = await tx.query(
    'INSERT INTO tg_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [updateId],
  );
  return !!r.rowCount;
}

async function queueReply(tx: Tx, userId: string, reply: Reply, dedupeKey: string): Promise<void> {
  // Priority 0, like the answer to /start: the person is waiting for it.
  await tx.query(
    `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key, priority)
     VALUES ('bot_reply', $1, $2, $3, 0) ON CONFLICT DO NOTHING`,
    [userId, reply, dedupeKey],
  );
}

/** Only records the update, and answers when there is someone to answer. */
function answerOnly(
  db: Db,
  updateId: number,
  to: Sender | null,
  reply: Reply | null,
  key?: string,
) {
  return withSystem(db, async (tx) => {
    if (!(await firstTime(tx, updateId)) || !to || !reply) return;
    await queueReply(tx, to.id, reply, key ?? `reply:${updateId}`);
  });
}

export async function receiveText(
  db: Db,
  parser: ImportParser,
  updateId: number,
  tgUserId: number,
  text: string | undefined,
  log: FastifyBaseLogger,
): Promise<void> {
  const sha = text === undefined ? null : createHash('sha256').update(text).digest('hex');
  const seen = await withSystem(db, async (tx) => {
    const u = await tx.query<Sender & { deleted_at: Date | null }>(
      'SELECT id, ui_lang, app_opened_at, deleted_at FROM users WHERE tg_user_id = $1',
      [tgUserId],
    );
    const sender = u.rows[0] && !u.rows[0].deleted_at ? u.rows[0] : null;
    if (!sender || !sha) return { sender, recent: 0, same: null };
    const recent = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM recipes
        WHERE author_id = $1 AND source_type = 'bot_forward' AND created_at > now() - interval '1 hour'`,
      [sender.id],
    );
    const same = await tx.query<{ id: string; title: string }>(
      `SELECT id, title FROM recipes
        WHERE author_id = $1 AND source_type = 'bot_forward' AND deleted_at IS NULL
          AND source_ref ->> 'text_sha256' = $2
        ORDER BY created_at DESC LIMIT 1`,
      [sender.id, sha],
    );
    return { sender, recent: recent.rows[0]!.n, same: same.rows[0] ?? null };
  });

  const { sender } = seen;
  // A stranger: nothing is stored about them and nothing is sent.
  if (!sender) return answerOnly(db, updateId, null, null);
  if (!sender.app_opened_at) return answerOnly(db, updateId, sender, { kind: 'open_app_first' });
  if (text === undefined || !text.trim())
    return answerOnly(db, updateId, sender, { kind: 'no_text' });
  // Commands other than /start (handled elsewhere) are not recipes.
  if (text.trimStart().startsWith('/')) return answerOnly(db, updateId, null, null);
  if (text.length > FORWARD_MAX_CHARS)
    return answerOnly(db, updateId, sender, { kind: 'too_long' });
  if (seen.same)
    return answerOnly(db, updateId, sender, {
      kind: 'draft_exists',
      recipe_id: seen.same.id,
      title: seen.same.title,
    });
  if (seen.recent >= FORWARDS_PER_HOUR) {
    const hour = new Date().toISOString().slice(0, 13);
    return answerOnly(
      db,
      updateId,
      sender,
      { kind: 'too_many' },
      `forward-limit:${sender.id}:${hour}`,
    );
  }

  let parsed;
  try {
    parsed = await parser.parse(text, sender.ui_lang);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'bot forward: the text could not be read');
    return answerOnly(db, updateId, sender, { kind: 'not_read' });
  }

  await withSystem(db, async (tx) => {
    if (!(await firstTime(tx, updateId))) return;
    await asUser(tx, { userId: sender.id });
    const draft = await createImportedDraft(tx, {
      authorId: sender.id,
      text,
      parsed,
      uiLang: sender.ui_lang,
      sourceType: 'bot_forward',
      sourceRef: { text_sha256: sha },
    });
    await asSystem(tx);
    await queueReply(
      tx,
      sender.id,
      { kind: 'draft_saved', recipe_id: draft.id, title: draft.title },
      `reply:${updateId}`,
    );
    log.info({ recipeId: draft.id }, 'bot forward: draft saved');
  });
}
