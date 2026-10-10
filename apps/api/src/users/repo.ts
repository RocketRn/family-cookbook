import type { Tx } from '../db/tx.js';
import type { TelegramUser } from '../auth/initData.js';

export type UiLang = 'ru' | 'uk' | 'en' | 'sv';

export type User = {
  id: string;
  tg_user_id: string;
  tg_username: string | null;
  first_name: string | null;
  photo_url: string | null;
  ui_lang: UiLang;
  bot_started: boolean;
  notify_prefs: Record<string, boolean>;
  created_at: Date;
  last_seen_at: Date;
  deleted_at: Date | null;
};

const SUPPORTED: readonly UiLang[] = ['ru', 'uk', 'en', 'sv'];

/** PRD 4.3: ru, uk, en, sv; any other code (or none) falls back to en. */
export function uiLangFromTelegram(code: string | undefined): UiLang {
  const primary = code?.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.find((l) => l === primary) ?? 'en';
}

/**
 * Find-or-create by Telegram id; the profile is refreshed on every sign-in, ui_lang only on creation.
 * bot_started becomes true when Telegram's signed initData says the bot may write (PRD 4.5). Telegram
 * leaves the field out rather than sending false, so it never turns it off: a 403 from the bot does.
 * A soft-deleted (anonymised, PRD 7.1) account is never refreshed: that would write the name and
 * photo back into a profile that was deliberately erased. It is returned as is, and the caller rejects it.
 * The first sign-in stamps app_opened_at: from then on the bot reads recipes forwarded by this
 * person (S6-2, D-054).
 */
export async function upsertFromTelegram(tx: Tx, tg: TelegramUser): Promise<User> {
  const r = await tx.query<User>(
    `INSERT INTO users (tg_user_id, tg_username, first_name, photo_url, ui_lang, bot_started,
                        app_opened_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (tg_user_id) DO UPDATE
       SET tg_username = EXCLUDED.tg_username,
           first_name = EXCLUDED.first_name,
           photo_url = EXCLUDED.photo_url,
           bot_started = users.bot_started OR EXCLUDED.bot_started,
           app_opened_at = coalesce(users.app_opened_at, now()),
           last_seen_at = now()
       WHERE users.deleted_at IS NULL
     RETURNING *`,
    [
      tg.id,
      tg.username ?? null,
      tg.first_name || null,
      tg.photo_url ?? null,
      uiLangFromTelegram(tg.language_code),
      tg.allows_write_to_pm === true,
    ],
  );
  if (r.rows[0]) return r.rows[0];
  const existing = await tx.query<User>('SELECT * FROM users WHERE tg_user_id = $1', [tg.id]);
  return existing.rows[0]!;
}
