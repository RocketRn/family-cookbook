import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { withSystem, type Tx } from '../db/tx.js';
import { unauthorized } from '../errors.js';
import type { ImportParser } from '../import/parserPool.js';
import { uiLangFromTelegram } from '../users/repo.js';
import { receiveText } from './forward.js';

/**
 * BE-07 (PRD 4.4 "Incoming"; D-047): Telegram's updates for the bot, POST /bot/webhook (through
 * Caddy: /api/bot/webhook). No sign-in: Telegram proves itself with the secret token given to
 * setWebhook. Each update is handled once (tg_updates), in one transaction with what it changes:
 *
 * - /start [payload] in a private chat: the person is created or refreshed, the bot may now write
 *   to them (bot_started), and the answer is queued in the outbox (sent by the worker). A payload
 *   from a link (join_<code> from an invitation) is passed on to the app's button.
 * - my_chat_member in a private chat: blocked ("kicked") or unblocked ("member").
 * - Any other message in a private chat from a person: a recipe forwarded (or written) to the bot
 *   becomes a private draft (S6-2, forward.ts, D-054).
 * - Anything else is recorded and ignored.
 */
const update = z.object({ update_id: z.number().int().nonnegative() }).passthrough();
const tgUser = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean(),
  first_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(35).optional(),
});
const chat = z.object({ id: z.number().int(), type: z.string() });
const textMessage = z.object({ chat, from: tgUser, text: z.string().max(4096) });
/** Any message: its text may be missing (a photo, a sticker) or too long; forward.ts decides. */
const anyMessage = z.object({ chat, from: tgUser, text: z.string().optional() });
const memberChange = z.object({ chat, new_chat_member: z.object({ status: z.string() }) });

const START = /^\/start(?:@[A-Za-z0-9_]{1,64})?(?:\s+([\s\S]*))?$/;
/** Telegram's alphabet for start parameters (also the app's startapp, PRD 4.7). */
const PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/;

/** `/start`, `/start <payload>` or `/start@bot <payload>`; null for any other text. */
export function startCommand(text: string): { start: string | null } | null {
  const m = START.exec(text);
  if (!m) return null;
  const arg = (m[1] ?? '').trim();
  return { start: PAYLOAD.test(arg) ? arg : null };
}

function sameSecret(given: unknown, secret: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function answerStart(
  tx: Tx,
  updateId: number,
  from: z.infer<typeof tgUser>,
  start: { start: string | null },
): Promise<void> {
  // Like sign-in (users/repo.ts): a deleted account is neither refreshed nor answered.
  const r = await tx.query<{ id: string }>(
    `INSERT INTO users (tg_user_id, tg_username, first_name, ui_lang, bot_started)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (tg_user_id) DO UPDATE
       SET tg_username = EXCLUDED.tg_username,
           first_name = EXCLUDED.first_name,
           bot_started = true,
           last_seen_at = now()
       WHERE users.deleted_at IS NULL
     RETURNING id`,
    [
      from.id,
      from.username ?? null,
      from.first_name || null,
      uiLangFromTelegram(from.language_code),
    ],
  );
  const user = r.rows[0];
  if (!user) return;
  // Priority 0, like timers: a person is waiting for this answer.
  await tx.query(
    `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key, priority)
     VALUES ('bot_start', $1, $2, $3, 0)`,
    [user.id, start, `start:${updateId}`],
  );
}

async function handle(tx: Tx, u: z.infer<typeof update>): Promise<void> {
  const fresh = await tx.query(
    'INSERT INTO tg_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [u.update_id],
  );
  if (!fresh.rowCount) return; // delivered again: handled already (or right now, by another request)

  const msg = textMessage.safeParse(u.message);
  if (msg.success) {
    const m = msg.data;
    const start = startCommand(m.text);
    if (start && m.chat.type === 'private' && !m.from.is_bot)
      await answerStart(tx, u.update_id, m.from, start);
    return;
  }
  const member = memberChange.safeParse(u.my_chat_member);
  if (member.success && member.data.chat.type === 'private') {
    const status = member.data.new_chat_member.status;
    if (status !== 'kicked' && status !== 'member') return;
    // In a private chat the chat id is the person's Telegram id. Nobody is created here.
    await tx.query(
      'UPDATE users SET bot_started = $2 WHERE tg_user_id = $1 AND deleted_at IS NULL',
      [member.data.chat.id, status === 'member'],
    );
  }
}

export function registerBotWebhook(
  app: FastifyInstance,
  db: Db,
  secret: string | null,
  /** Counts a wrong secret; may throw 429 (the same limit as failed sign-ins). */
  onRejected: (req: FastifyRequest) => Promise<void>,
  /** The import parser (worker pool with its time limit), for recipes forwarded to the bot. */
  parser: ImportParser,
): void {
  if (!secret) return; // no secret configured: there is no webhook (404)
  app.post('/bot/webhook', async (req) => {
    if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'], secret)) {
      req.log.warn('bot webhook: wrong or missing secret token');
      await onRejected(req);
      throw unauthorized('Wrong secret token');
    }
    const u = update.parse(req.body);
    const m = anyMessage.safeParse(u.message);
    if (
      m.success &&
      m.data.chat.type === 'private' &&
      !m.data.from.is_bot &&
      !(m.data.text !== undefined && startCommand(m.data.text))
    ) {
      await receiveText(db, parser, u.update_id, m.data.from.id, m.data.text, req.log);
      return { ok: true };
    }
    await withSystem(db, (tx) => handle(tx, u));
    return { ok: true };
  });
}
