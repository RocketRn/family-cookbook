import { isRealLookingToken } from '../config.js';

/**
 * The Bot API calls the worker makes (sendMessage), with Telegram's answers turned into what the
 * outbox needs to decide (D-039). The token is only ever part of the request path: it is never
 * logged or returned in an error.
 */
export type SendResult =
  | { ok: true }
  | { ok: false; kind: 'rate_limited'; retryAfter: number; description: string }
  /** 403: the user blocked the bot, or never allowed it to write (PRD 4.5). */
  | { ok: false; kind: 'blocked'; description: string }
  /** 400 / 404: Telegram will never accept this message; retrying is pointless. */
  | { ok: false; kind: 'rejected'; description: string }
  /** 5xx, network, timeout, 401: worth another try later. */
  | { ok: false; kind: 'temporary'; description: string };

export interface TelegramClient {
  sendMessage(
    chatId: string,
    text: string,
    extra?: { reply_markup?: unknown },
  ): Promise<SendResult>;
}

export const REAL_TELEGRAM = 'https://api.telegram.org';

export type ClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** Required to call the real api.telegram.org (production only, see the worker's config). */
  allowReal?: boolean;
  /** Required to call anything else (the local stand-in in development, the demo and tests). */
  allowLocal?: boolean;
};

/**
 * A local stand-in for the Bot API (apps/fakebot): this computer, or a container on the same
 * Docker network (a one-word host name such as "fakebot"). Nothing else gets the token outside
 * production.
 */
export function isLocalStandIn(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname;
  return (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '[::1]' ||
    /^[a-z][a-z0-9-]{0,62}$/.test(host)
  );
}

type Env = Record<string, string | undefined>;

/**
 * Why the real Bot API must not be called, or null when it may (S5-2). Checked here as well as in
 * the worker's settings, so that no other path (a script, a test, a later feature) reaches
 * Telegram by mistake: only an armed production process (TELEGRAM_LIVE=yes) with a real-looking
 * token may. The answer never contains the token.
 */
export function realApiRefusal(o: ClientOptions, env: Env = process.env): string | null {
  if (!o.allowReal) return 'only the production worker may (TELEGRAM_API_BASE)';
  if (env.VITEST || env.NODE_ENV === 'test') return 'never from a test run';
  if (env.NODE_ENV !== 'production') return 'only in production (NODE_ENV)';
  if (env.TELEGRAM_LIVE !== 'yes') return 'the worker is not armed (TELEGRAM_LIVE=yes)';
  if (!isRealLookingToken(o.token))
    return 'the bot token is a placeholder, a test value or malformed';
  return null;
}

export function createTelegramClient(o: ClientOptions): TelegramClient {
  const url = new URL(o.baseUrl);
  // Any Telegram address counts as the real one, however it is written.
  const real = /(^|\.)telegram\.org\.?$/.test(url.hostname);
  if (real) {
    const why = realApiRefusal(o);
    if (why) throw new Error(`Refusing to call the real Telegram API: ${why}`);
    if (url.protocol !== 'https:') throw new Error('The Telegram API must be called over HTTPS');
  } else if (!o.allowLocal || !isLocalStandIn(o.baseUrl)) {
    throw new Error(
      `Refusing to send the bot token to ${url.host}: only a local stand-in is allowed outside production`,
    );
  }
  const base = o.baseUrl.replace(/\/+$/, '');
  const timeoutMs = o.timeoutMs ?? 10_000;

  return {
    async sendMessage(chatId, text, extra = {}) {
      let res: Response;
      try {
        res = await fetch(`${base}/bot${o.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const name = (err as { name?: string }).name;
        return {
          ok: false,
          kind: 'temporary',
          description: name === 'TimeoutError' ? 'timeout' : 'network error',
        };
      }
      let body: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        /* not JSON: judged by the status alone */
      }
      const description = String(body.description ?? `HTTP ${res.status}`).slice(0, 300);
      if (res.ok && body.ok) return { ok: true };
      if (res.status === 429) {
        const retryAfter = Number(body.parameters?.retry_after);
        return {
          ok: false,
          kind: 'rate_limited',
          retryAfter:
            Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : 5,
          description,
        };
      }
      if (res.status === 403) return { ok: false, kind: 'blocked', description };
      if (res.status === 400 || res.status === 404)
        return { ok: false, kind: 'rejected', description };
      return { ok: false, kind: 'temporary', description };
    },
  };
}
