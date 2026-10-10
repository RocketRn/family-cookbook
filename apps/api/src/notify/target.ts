import { isRealLookingToken } from '../config.js';
import { isLocalStandIn, REAL_TELEGRAM, type ClientOptions } from './telegram.js';

export type TelegramTarget = Required<Omit<ClientOptions, 'timeoutMs'>>;
type Env = {
  NODE_ENV?: string;
  BOT_TOKEN?: string;
  TELEGRAM_API_BASE?: string;
  TELEGRAM_LIVE?: string;
};

const sameApi = (raw: string) => raw.replace(/\/+$/, '') === REAL_TELEGRAM;

/**
 * Where Bot API calls may go (D-039, S5-2), for the worker and the webhook command. Production:
 * only api.telegram.org, armed with TELEGRAM_LIVE=yes, with a real-looking token. Elsewhere: only a
 * local stand-in. Problems go to `issue` (named by setting, never with the value); the answer is
 * the target, or null when no Bot API is set (development without the stand-in).
 */
export function telegramTarget(
  env: Env,
  issue: (path: string, message: string) => void,
): TelegramTarget | null {
  if (env.NODE_ENV === 'production') {
    if (env.TELEGRAM_LIVE !== 'yes') {
      issue(
        'TELEGRAM_LIVE',
        'must be "yes" for the worker to send real Telegram messages; write it only in .env on the real server (docs/DEPLOY-GCP.ru.md, 9.5)',
      );
    }
    if (!env.BOT_TOKEN || !isRealLookingToken(env.BOT_TOKEN)) {
      issue(
        'BOT_TOKEN',
        'must be the real token from @BotFather in production (missing, a placeholder or malformed)',
      );
    }
    if (env.TELEGRAM_API_BASE && !sameApi(env.TELEGRAM_API_BASE)) {
      issue('TELEGRAM_API_BASE', `must be ${REAL_TELEGRAM} in production (or left unset)`);
    }
    return env.BOT_TOKEN
      ? { baseUrl: REAL_TELEGRAM, token: env.BOT_TOKEN, allowReal: true, allowLocal: false }
      : null;
  }
  if (!env.TELEGRAM_API_BASE) return null;
  if (!isLocalStandIn(env.TELEGRAM_API_BASE) || sameApi(env.TELEGRAM_API_BASE)) {
    issue(
      'TELEGRAM_API_BASE',
      'outside production only a local stand-in is allowed (e.g. http://127.0.0.1:8081)',
    );
  }
  if (!env.BOT_TOKEN) issue('BOT_TOKEN', 'the stand-in needs a (fake) token');
  return env.BOT_TOKEN
    ? { baseUrl: env.TELEGRAM_API_BASE, token: env.BOT_TOKEN, allowReal: false, allowLocal: true }
    : null;
}

/**
 * S6-3b (D-056): the API prepares shared messages (savePreparedInlineMessage). Same rules as the
 * worker, but not required: a production server without TELEGRAM_LIVE=yes, or with a problem in
 * these settings, simply has none, and "Share" falls back to the link.
 */
export function apiTelegramTarget(env: Env): TelegramTarget | null {
  if (env.NODE_ENV === 'production' && env.TELEGRAM_LIVE !== 'yes') return null;
  let ok = true;
  const target = telegramTarget(env, () => {
    ok = false;
  });
  return ok ? target : null;
}
