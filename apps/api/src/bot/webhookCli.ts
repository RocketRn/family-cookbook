import { ConfigError } from '../config.js';
import { telegramTarget, type TelegramTarget } from '../notify/target.js';
import { botApiCall, isLocalStandIn, type ClientOptions } from '../notify/telegram.js';
import { isPlaceholder, webhookSecretProblem } from '../prodGuard.js';

/**
 * BE-07 (D-047): tells Telegram where to deliver the bot's updates. On the server it runs once,
 * `docker compose run --rm webhook` (docs/DEPLOY-GCP.ru.md 9.8); the demo runs it against the
 * local stand-in. The S5-2 rules apply: the real API only from an armed production setting.
 */
export type WebhookCliConfig = { telegram: TelegramTarget; url: string; secret: string };

/** Caddy sends /api/* to the API without the prefix: the route itself is POST /bot/webhook. */
export const WEBHOOK_PATH = '/api/bot/webhook';
/** Only what the bot handles; anything else Telegram keeps to itself. */
export const ALLOWED_UPDATES = ['message', 'my_chat_member'];
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function loadWebhookCliConfig(env: Record<string, string | undefined>): WebhookCliConfig {
  const problems: string[] = [];
  const issue = (path: string, message: string) => problems.push(`  - ${path}: ${message}`);
  const prod = env.NODE_ENV === 'production';
  const telegram = telegramTarget(env, issue);
  if (!prod && !env.TELEGRAM_API_BASE) {
    issue(
      'TELEGRAM_API_BASE',
      'outside production this command only talks to a local stand-in (e.g. http://127.0.0.1:8081)',
    );
  }
  const secret = env.BOT_WEBHOOK_SECRET;
  const secretProblem = webhookSecretProblem(secret, prod) ?? (secret ? null : 'is required');
  if (secretProblem) issue('BOT_WEBHOOK_SECRET', secretProblem);

  let url = '';
  if (prod) {
    if (env.WEBHOOK_URL) {
      issue(
        'WEBHOOK_URL',
        `is not used in production: the address is https://<DOMAIN>${WEBHOOK_PATH}`,
      );
    }
    const domain = env.DOMAIN ?? '';
    if (!HOST.test(domain) || isPlaceholder(domain)) {
      issue(
        'DOMAIN',
        'must be the app’s address, e.g. family-cookbook.duckdns.org (without https://)',
      );
    } else {
      url = `https://${domain.toLowerCase()}${WEBHOOK_PATH}`;
    }
  } else if (!env.WEBHOOK_URL || !isLocalStandIn(env.WEBHOOK_URL)) {
    issue(
      'WEBHOOK_URL',
      'outside production: the API on this computer, e.g. http://127.0.0.1:3000/bot/webhook',
    );
  } else {
    url = env.WEBHOOK_URL;
  }

  if (problems.length || !telegram || !secret) {
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return { telegram, url, secret };
}

async function call(o: ClientOptions, method: string, params: Record<string, unknown> = {}) {
  const r = await botApiCall(o, method, params);
  if (!r.ok) throw new Error(`Telegram refused ${method}: ${r.description ?? 'no reason given'}`);
  return r.result;
}

export async function setWebhook(
  o: ClientOptions,
  w: { url: string; secret: string },
): Promise<void> {
  await call(o, 'setWebhook', {
    url: w.url,
    secret_token: w.secret,
    allowed_updates: ALLOWED_UPDATES,
    // A family's bot: a few connections at once are plenty for the small server.
    max_connections: 10,
  });
}

export type WebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
};

export async function webhookInfo(o: ClientOptions): Promise<WebhookInfo> {
  return (await call(o, 'getWebhookInfo')) as WebhookInfo;
}

export async function deleteWebhook(o: ClientOptions): Promise<void> {
  await call(o, 'deleteWebhook');
}

const USAGE = [
  'Как пользоваться / Usage:',
  '  set     сообщить Telegram адрес бота / register the webhook (the default)',
  '  info    показать, что Telegram знает об адресе / show the webhook status',
  '  delete  убрать адрес: бот перестанет получать сообщения / remove the webhook',
].join('\n');

/** The command: prints plain lines for the owner; never the token or the secret. 0 = done. */
export async function runWebhookCli(
  argv: string[],
  env: Record<string, string | undefined>,
  out: (line: string) => void,
): Promise<number> {
  const command = argv[0] ?? 'set';
  if (!['set', 'info', 'delete'].includes(command)) {
    out(USAGE);
    return 2;
  }
  let cfg: WebhookCliConfig;
  try {
    cfg = loadWebhookCliConfig(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    out(err.message);
    return 1;
  }
  try {
    if (command === 'set') {
      await setWebhook(cfg.telegram, cfg);
      out(`Готово: Telegram будет доставлять сообщения боту на ${cfg.url}`);
      out(`Done: Telegram delivers the bot's updates to ${cfg.url}`);
    } else if (command === 'info') {
      const i = await webhookInfo(cfg.telegram);
      out(`Адрес / URL: ${i.url || '(не задан / not set)'}`);
      out(`Ждут доставки / pending: ${i.pending_update_count}`);
      if (i.last_error_message) {
        const when = i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : '';
        out(`Последняя ошибка / last error: ${i.last_error_message} ${when}`.trim());
      } else {
        out('Ошибок нет / no errors');
      }
    } else {
      await deleteWebhook(cfg.telegram);
      out('Готово: адрес убран, бот больше не получает сообщения / webhook removed');
    }
    return 0;
  } catch (err) {
    out(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
