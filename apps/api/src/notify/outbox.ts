import type { Db } from '../db/pool.js';
import { withWorker, type Tx } from '../db/tx.js';
import type { SendResult, TelegramClient } from './telegram.js';
import { renderMessage, type Lang, type Links, type Rendered } from './templates.js';

/**
 * BE-08 outbox sender (PRD 4.4; D-039). Each call takes a batch of due messages and sends them.
 *
 * - Several workers may run at once: a message is claimed with FOR UPDATE SKIP LOCKED and marked
 *   "sending" with a lease. If its worker dies, the lease runs out and another worker sends it,
 *   so nothing is lost on a restart (delivery is at least once: a crash between Telegram's answer
 *   and our update can repeat one message).
 * - Telegram's limits are shared through the database (outbox_gates): one message per chat per
 *   second, and a global pace for the whole bot. A 429 pauses the chat and the whole bot for
 *   retry_after seconds and does not count as a failed attempt.
 * - S6-5 (QA-03; D-058): a wait of up to a second for the whole bot's pace is waited out here; a
 *   message is put off (back to "pending") only for its own chat's pace or a longer pause. And
 *   while a full batch was due, sendWhileBusy takes the next one at once instead of idling.
 * - 403: the bot may not write to this person. Their messages stop, bot_started becomes false,
 *   and the timers behind those messages become "failed" (PRD 4.4).
 * - Other errors are retried after 1 s, 5 s, 30 s and 5 min; after 5 attempts the message (and
 *   its timer) is "failed". A message Telegram refuses outright (400) is not retried.
 */
export type SenderOptions = {
  links: Links;
  /** Messages per call. */
  batch?: number;
  leaseSec?: number;
  /** Per chat (Telegram: about 1 a second). */
  chatIntervalMs?: number;
  /** For the whole bot (Telegram: about 30 a second; 40 ms = 25 a second leaves a margin). */
  globalIntervalMs?: number;
  backoffSec?: number[];
  maxAttempts?: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
  /** sendWhileBusy: how long to keep taking full batches before giving the poll its turn. */
  busyForMs?: number;
  /**
   * BE-10: a link Telegram can fetch for a stored photo (a signed link to its full copy). Without
   * it, a message with a photo goes as text.
   */
  photoUrl?: (storageKey: string) => Promise<string>;
};

export type SendStats = {
  /** Messages taken in this call (a full batch means more may be due). */
  claimed: number;
  sent: number;
  deferred: number;
  retried: number;
  failed: number;
  blocked: number;
};

type Claimed = {
  id: string;
  type: string;
  payload: { timer_id?: string } & Record<string, unknown>;
  attempts: number;
  priority: number;
  run_at: Date;
  recipient_user_id: string;
  chat_id: string;
  ui_lang: Lang;
  deleted_at: Date | null;
};

const BACKOFF = [1, 5, 30, 300];

/** PRD 4.4: more than this many "new recipe" messages for one person become one message. */
const COLLAPSE_OVER = 3;

/**
 * PRD 4.4 new_recipe: when more than three are due for one person together (they wait five
 * minutes after publishing, so a burst of recipes arrives together), the first claimed one says
 * "New recipes in the book: N" and the others are marked done without a message of their own.
 * Messages another worker holds right now are left to it.
 */
async function collapseNewRecipes(
  db: Db,
  claimed: Claimed[],
): Promise<{ skip: Set<string>; count: Map<string, number> }> {
  const skip = new Set<string>();
  const count = new Map<string, number>();
  const byRecipient = new Map<string, Claimed[]>();
  for (const m of claimed) {
    if (m.type !== 'new_recipe') continue;
    byRecipient.set(m.recipient_user_id, [...(byRecipient.get(m.recipient_user_id) ?? []), m]);
  }
  for (const [recipient, [first, ...rest]] of byRecipient) {
    await withWorker(db, async (tx) => {
      const others = await tx.query<{ id: string }>(
        `SELECT id FROM notification_outbox
          WHERE type = 'new_recipe' AND recipient_user_id = $1 AND id <> $2
            AND (id = ANY($3::uuid[])
                 OR (status = 'pending' AND created_at > now() - interval '10 minutes'))
          FOR UPDATE SKIP LOCKED`,
        [recipient, first!.id, rest.map((r) => r.id)],
      );
      const n = others.rows.length + 1;
      if (n <= COLLAPSE_OVER) return;
      await tx.query(
        `UPDATE notification_outbox
            SET status = 'sent', sent_at = now(), locked_until = NULL,
                last_error = 'collapsed into one message'
          WHERE id = ANY($1::uuid[])`,
        [others.rows.map((r) => r.id)],
      );
      count.set(first!.id, n);
      for (const r of others.rows) skip.add(r.id);
    });
  }
  return { skip, count };
}

/**
 * A message with a photo ("I cooked it") goes as the photo with the text as its caption. If the
 * photo cannot be used (no link, or Telegram refuses it), the text still goes, alone.
 */
async function deliver(
  telegram: TelegramClient,
  m: Claimed,
  rendered: Rendered,
  opts: SenderOptions,
  log: NonNullable<SenderOptions['log']>,
): Promise<SendResult> {
  const extra = { reply_markup: rendered.reply_markup };
  const key = typeof m.payload.photo_key === 'string' ? m.payload.photo_key : null;
  if (key && opts.photoUrl && telegram.sendPhoto) {
    let url: string | null = null;
    try {
      url = await opts.photoUrl(key);
    } catch (err) {
      log('warn', 'no link for the photo; sending the text alone', { error: String(err) });
    }
    if (url) {
      const r = await telegram.sendPhoto(m.chat_id, url, rendered.text, extra);
      if (r.ok || r.kind !== 'rejected') return r;
      log('warn', 'Telegram refused the photo; sending the text alone', { reason: r.description });
    }
  }
  return telegram.sendMessage(m.chat_id, rendered.text, extra);
}

class GateClosed extends Error {
  constructor(
    readonly key: string,
    readonly until: Date,
    /** How long until it opens, by the database's clock. */
    readonly waitMs: number,
  ) {
    super('gate closed');
  }
}

/** The longest wait for the whole bot's pace that is waited out rather than put off. */
const MAX_GLOBAL_WAIT_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GATE_TIME = `SELECT next_at,
         greatest(0, extract(epoch FROM next_at - clock_timestamp()) * 1000)::float8 AS wait_ms
    FROM outbox_gates WHERE key = $1`;

/** Opens a gate if its time has come (and moves it on), or throws GateClosed with its time. */
async function passGate(tx: Tx, key: string, intervalMs: number): Promise<void> {
  const closed = async () => {
    const r = await tx.query<{ next_at: Date; wait_ms: number }>(GATE_TIME, [key]);
    return new GateClosed(key, r.rows[0]!.next_at, r.rows[0]!.wait_ms);
  };
  if (intervalMs <= 0) {
    // No regular pace, but a pause after a 429 still holds.
    const paused = await tx.query('SELECT 1 FROM outbox_gates WHERE key = $1 AND next_at > now()', [
      key,
    ]);
    if (paused.rowCount) throw await closed();
    return;
  }
  const opened = await tx.query(
    `INSERT INTO outbox_gates (key, next_at) VALUES ($1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET next_at = now() + make_interval(secs => $2)
       WHERE outbox_gates.next_at <= now()
     RETURNING next_at`,
    [key, intervalMs / 1000],
  );
  if (opened.rowCount) return;
  throw await closed();
}

/** After a 429: nothing is sent to this chat, or by the bot at all, until `seconds` have passed. */
async function pause(tx: Tx, keys: string[], seconds: number): Promise<void> {
  for (const key of keys) {
    await tx.query(
      `INSERT INTO outbox_gates (key, next_at) VALUES ($1, now() + make_interval(secs => $2))
       ON CONFLICT (key) DO UPDATE
         SET next_at = greatest(outbox_gates.next_at, now() + make_interval(secs => $2))`,
      [key, seconds],
    );
  }
}

const failTimer = (tx: Tx, timerId: string | undefined) =>
  timerId
    ? tx.query(`UPDATE timers SET status = 'failed' WHERE id = $1 AND status = 'fired'`, [timerId])
    : Promise.resolve();

export async function sendDueMessages(
  db: Db,
  telegram: TelegramClient,
  opts: SenderOptions,
): Promise<SendStats> {
  const stats: SendStats = { claimed: 0, sent: 0, deferred: 0, retried: 0, failed: 0, blocked: 0 };
  const chatMs = opts.chatIntervalMs ?? 1000;
  const globalMs = opts.globalIntervalMs ?? 40;
  const backoff = opts.backoffSec ?? BACKOFF;
  const maxAttempts = opts.maxAttempts ?? 5;
  const log = opts.log ?? (() => undefined);
  const leaseSec = opts.leaseSec ?? 30;
  // Waiting for the bot's pace never runs into the lease (another worker would take the message).
  const waitUntil = Date.now() + (leaseSec * 1000) / 2;

  const claimed = await withWorker(db, async (tx) => {
    const r = await tx.query<Claimed>(
      `UPDATE notification_outbox o
          SET status = 'sending', locked_until = now() + make_interval(secs => $2)
         FROM users u
        WHERE o.id IN (
                SELECT id FROM notification_outbox
                 WHERE (status = 'pending' AND run_at <= now())
                    OR (status = 'sending' AND locked_until < now())
                 ORDER BY priority, run_at
                 LIMIT $1
                   FOR UPDATE SKIP LOCKED)
          AND u.id = o.recipient_user_id
       RETURNING o.id, o.type, o.payload, o.attempts, o.priority, o.run_at, o.recipient_user_id,
                 u.tg_user_id::text AS chat_id, u.ui_lang, u.deleted_at`,
      [opts.batch ?? 20, leaseSec],
    );
    return r.rows.sort(
      (a, b) => a.priority - b.priority || a.run_at.getTime() - b.run_at.getTime(),
    );
  });

  stats.claimed = claimed.length;
  const collapsed = await collapseNewRecipes(db, claimed);
  const blockedUsers = new Set<string>();
  for (const m of claimed) {
    if (collapsed.skip.has(m.id)) continue; // part of a "New recipes in the book: N" message
    if (blockedUsers.has(m.recipient_user_id)) continue; // already marked "blocked" below
    const done = (sql: string, params: unknown[], extra?: (tx: Tx) => Promise<unknown>) =>
      withWorker(db, async (tx) => {
        await tx.query(sql, params);
        if (extra) await extra(tx);
      });
    const fail = (why: string) =>
      done(
        `UPDATE notification_outbox SET status = 'failed', locked_until = NULL, attempts = attempts + 1,
                last_error = $2
          WHERE id = $1 AND status = 'sending'`,
        [m.id, why],
        (tx) => failTimer(tx, m.payload.timer_id),
      );

    const n = collapsed.count.get(m.id);
    const payload = n ? { ...m.payload, collapsed: n } : m.payload;
    const rendered = m.deleted_at ? null : renderMessage(m.type, payload, m.ui_lang, opts.links);
    if (!rendered) {
      await fail(m.deleted_at ? 'recipient deleted' : `no template for ${m.type}`);
      stats.failed++;
      continue;
    }

    let putOff: Date | null = null;
    for (;;) {
      try {
        await withWorker(db, async (tx) => {
          await passGate(tx, `chat:${m.chat_id}`, chatMs);
          await passGate(tx, 'global', globalMs);
        });
        break;
      } catch (err) {
        if (!(err instanceof GateClosed)) throw err;
        // The whole bot's pace (another message, perhaps another worker's, went just now):
        // wait the few milliseconds. This chat's own pace, or a long pause: put it off.
        if (err.key !== 'global' || err.waitMs > MAX_GLOBAL_WAIT_MS || Date.now() > waitUntil) {
          putOff = err.until;
          break;
        }
        await sleep(Math.max(5, Math.ceil(err.waitMs)));
      }
    }
    if (putOff) {
      await done(
        `UPDATE notification_outbox SET status = 'pending', locked_until = NULL, run_at = $2
          WHERE id = $1 AND status = 'sending'`,
        [m.id, putOff],
      );
      stats.deferred++;
      continue;
    }

    const result = await deliver(telegram, m, rendered, opts, log);
    if (result.ok) {
      await done(
        `UPDATE notification_outbox SET status = 'sent', sent_at = now(), locked_until = NULL,
                attempts = attempts + 1, last_error = NULL
          WHERE id = $1 AND status = 'sending'`,
        [m.id],
        (tx) =>
          m.payload.timer_id
            ? tx.query('UPDATE timers SET attempts = $2 WHERE id = $1', [
                m.payload.timer_id,
                m.attempts + 1,
              ])
            : Promise.resolve(),
      );
      stats.sent++;
      // S6-4 (D-057): how late a timer message is, from the timer's end to Telegram's answer.
      const endsAt = Date.parse(String(m.payload.ends_at ?? ''));
      if (m.type === 'timer_fired' && Number.isFinite(endsAt))
        log('info', 'timer message sent', {
          timerId: m.payload.timer_id,
          delayMs: Math.max(0, Date.now() - endsAt),
        });
    } else if (result.kind === 'rate_limited') {
      await done(
        `UPDATE notification_outbox SET status = 'pending', locked_until = NULL,
                run_at = now() + make_interval(secs => $2), last_error = $3
          WHERE id = $1 AND status = 'sending'`,
        [m.id, result.retryAfter, result.description],
        (tx) => pause(tx, [`chat:${m.chat_id}`, 'global'], result.retryAfter),
      );
      log('warn', 'telegram rate limit', { retryAfter: result.retryAfter });
      stats.deferred++;
    } else if (result.kind === 'blocked') {
      const n = await withWorker(db, async (tx) => {
        const r = await tx.query<{ payload: { timer_id?: string } }>(
          `UPDATE notification_outbox SET status = 'blocked', locked_until = NULL, last_error = $2,
                  attempts = attempts + (id = $3)::int
            WHERE recipient_user_id = $1 AND status IN ('pending', 'sending')
           RETURNING payload`,
          [m.recipient_user_id, result.description, m.id],
        );
        for (const row of r.rows) await failTimer(tx, row.payload.timer_id);
        await tx.query('UPDATE users SET bot_started = false WHERE id = $1', [m.recipient_user_id]);
        return r.rowCount ?? 0;
      });
      blockedUsers.add(m.recipient_user_id);
      log('info', 'bot may not write to this user; their messages stop', { messages: n });
      stats.blocked += n;
    } else if (result.kind === 'rejected' || m.attempts + 1 >= maxAttempts) {
      await fail(result.description);
      log('warn', 'message failed', { type: m.type, reason: result.description });
      stats.failed++;
    } else {
      const wait = backoff[Math.min(m.attempts, backoff.length - 1)]!;
      await done(
        `UPDATE notification_outbox SET status = 'pending', locked_until = NULL, attempts = attempts + 1,
                run_at = now() + make_interval(secs => $2), last_error = $3
          WHERE id = $1 AND status = 'sending'`,
        [m.id, wait, result.description],
      );
      stats.retried++;
    }
  }
  return stats;
}

/**
 * S6-5 (QA-03; D-058): sends batch after batch while each one was full (more may be due), for up to
 * `busyForMs` (5 s by default), so a burst does not wait for the next poll between batches.
 */
export async function sendWhileBusy(
  db: Db,
  telegram: TelegramClient,
  opts: SenderOptions,
): Promise<SendStats> {
  const total: SendStats = { claimed: 0, sent: 0, deferred: 0, retried: 0, failed: 0, blocked: 0 };
  const batch = opts.batch ?? 20;
  const until = Date.now() + (opts.busyForMs ?? 5000);
  for (;;) {
    const s = await sendDueMessages(db, telegram, opts);
    for (const k of Object.keys(total) as Array<keyof SendStats>) total[k] += s[k];
    if (s.claimed < batch || Date.now() >= until) return total;
  }
}
