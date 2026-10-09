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

export function createTelegramClient(o: ClientOptions): TelegramClient {
  const url = new URL(o.baseUrl);
  const real = url.hostname === 'api.telegram.org';
  if (real && !o.allowReal) {
    throw new Error(
      'Refusing to call the real Telegram API: only the production worker may (TELEGRAM_API_BASE)',
    );
  }
  if (real && url.protocol !== 'https:')
    throw new Error('The Telegram API must be called over HTTPS');
  if (!real && !o.allowLocal) {
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
