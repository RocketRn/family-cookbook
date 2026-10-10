import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteWebhook,
  loadWebhookCliConfig,
  runWebhookCli,
  setWebhook,
  webhookInfo,
} from '../src/bot/webhookCli.js';
import { ConfigError } from '../src/config.js';

/**
 * BE-07: the command that tells Telegram where to deliver the bot's updates (setWebhook), run once
 * on the server: `docker compose run --rm webhook`. It follows the same safety rules as the worker
 * (S5-2): the real API only when armed, in production, with a real-looking token; elsewhere only
 * the local stand-in. Tokens here are made up.
 */
const REAL_SHAPE = '987654321:AAG7kQ2mX9pL4vR8sT1wY6zB3nC5dF0hJ2k';
const SECRET = 'a3f9c1e7b5d2c4e6f8a0b1c3d5e7f921a3f9c1e7b5d2c4e6';
const prod = {
  NODE_ENV: 'production',
  TELEGRAM_LIVE: 'yes',
  BOT_TOKEN: REAL_SHAPE,
  BOT_WEBHOOK_SECRET: SECRET,
  DOMAIN: 'family-cookbook.duckdns.org',
};
const TOKEN = '123456:webhook-cli-test-token';
const LOCAL_HOOK = 'http://127.0.0.1:3000/bot/webhook';

describe('settings in production', () => {
  it('the address is always https://<DOMAIN>/api/bot/webhook, to the real API', () => {
    expect(loadWebhookCliConfig(prod)).toEqual({
      telegram: {
        baseUrl: 'https://api.telegram.org',
        token: REAL_SHAPE,
        allowReal: true,
        allowLocal: false,
      },
      url: 'https://family-cookbook.duckdns.org/api/bot/webhook',
      secret: SECRET,
    });
  });

  it.each([
    [{ TELEGRAM_LIVE: undefined }, /TELEGRAM_LIVE/],
    [{ BOT_TOKEN: '000000:placeholder-not-a-real-token' }, /BOT_TOKEN/],
    [{ TELEGRAM_API_BASE: 'http://127.0.0.1:8081' }, /TELEGRAM_API_BASE/],
    [{ DOMAIN: undefined }, /DOMAIN/],
    [{ DOMAIN: 'CHANGE_ME.duckdns.org' }, /DOMAIN/],
    [{ DOMAIN: 'https://family-cookbook.duckdns.org' }, /DOMAIN/],
    [{ DOMAIN: 'evil.example/x?' }, /DOMAIN/],
    [{ BOT_WEBHOOK_SECRET: 'CHANGE_ME' }, /BOT_WEBHOOK_SECRET/],
    [{ BOT_WEBHOOK_SECRET: undefined }, /BOT_WEBHOOK_SECRET/],
    [{ WEBHOOK_URL: 'https://elsewhere.example/hook' }, /WEBHOOK_URL/],
  ])('refuses %j', (over, field) => {
    expect(() => loadWebhookCliConfig({ ...prod, ...over })).toThrow(ConfigError);
    expect(() => loadWebhookCliConfig({ ...prod, ...over })).toThrow(field);
  });

  it('never prints the token or the secret in its error', () => {
    try {
      loadWebhookCliConfig({ ...prod, TELEGRAM_LIVE: 'no', DOMAIN: 'CHANGE_ME' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain(REAL_SHAPE.split(':')[1]);
      expect(String(err)).not.toContain(SECRET);
    }
  });
});

describe('settings outside production (the demo, tests)', () => {
  const dev = {
    NODE_ENV: 'development',
    BOT_TOKEN: TOKEN,
    BOT_WEBHOOK_SECRET: 'local-webhook-secret-123',
    TELEGRAM_API_BASE: 'http://127.0.0.1:8081',
    WEBHOOK_URL: LOCAL_HOOK,
  };

  it('only the local stand-in, delivering to this computer', () => {
    expect(loadWebhookCliConfig(dev)).toMatchObject({
      telegram: { baseUrl: 'http://127.0.0.1:8081', allowReal: false, allowLocal: true },
      url: LOCAL_HOOK,
    });
  });

  it.each([
    [{ TELEGRAM_API_BASE: undefined }, /TELEGRAM_API_BASE/],
    [{ TELEGRAM_API_BASE: 'https://api.telegram.org' }, /TELEGRAM_API_BASE/],
    [{ WEBHOOK_URL: undefined }, /WEBHOOK_URL/],
    [{ WEBHOOK_URL: 'https://family-cookbook.duckdns.org/api/bot/webhook' }, /WEBHOOK_URL/],
    [{ BOT_WEBHOOK_SECRET: 'short' }, /BOT_WEBHOOK_SECRET/],
  ])('refuses %j', (over, field) => {
    expect(() => loadWebhookCliConfig({ ...dev, ...over })).toThrow(field);
  });
});

describe('against the local stand-in', () => {
  let bot: FakeTelegram;
  const target = () => ({ baseUrl: bot.url, token: TOKEN, allowLocal: true });
  beforeAll(async () => {
    bot = await startFakeTelegram({ token: TOKEN });
  });
  afterAll(() => bot.close());
  beforeEach(() => bot.clear());

  it('sets the webhook with the secret and only the updates the bot handles', async () => {
    await setWebhook(target(), { url: LOCAL_HOOK, secret: 'local-webhook-secret-123' });
    expect(bot.webhook).toEqual({
      url: LOCAL_HOOK,
      secret: 'local-webhook-secret-123',
      allowed_updates: ['message', 'my_chat_member'],
    });
    expect(await webhookInfo(target())).toMatchObject({ url: LOCAL_HOOK, pending_update_count: 0 });
    await deleteWebhook(target());
    expect(bot.webhook).toBeNull();
  });

  it('the command: set, info, delete; a wrong word shows how to use it', async () => {
    const env = {
      NODE_ENV: 'development',
      BOT_TOKEN: TOKEN,
      BOT_WEBHOOK_SECRET: 'local-webhook-secret-123',
      TELEGRAM_API_BASE: bot.url,
      WEBHOOK_URL: LOCAL_HOOK,
    };
    const lines: string[] = [];
    const out = (s: string) => lines.push(s);
    expect(await runWebhookCli(['set'], env, out)).toBe(0);
    expect(bot.webhook?.url).toBe(LOCAL_HOOK);
    expect(await runWebhookCli(['info'], env, out)).toBe(0);
    expect(lines.join('\n')).toContain(LOCAL_HOOK);
    expect(await runWebhookCli(['delete'], env, out)).toBe(0);
    expect(bot.webhook).toBeNull();
    expect(await runWebhookCli(['what'], env, out)).toBe(2);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain('local-webhook-secret-123');
  });

  it('bad settings: exit code 1 and the reasons, nothing sent', async () => {
    const lines: string[] = [];
    const code = await runWebhookCli(['set'], { NODE_ENV: 'development' }, (s) => lines.push(s));
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/TELEGRAM_API_BASE/);
    expect(bot.calls).toBe(0);
  });

  it('in this test run even an armed production setting cannot reach Telegram', async () => {
    const lines: string[] = [];
    expect(await runWebhookCli(['set'], prod, (s) => lines.push(s))).toBe(1);
    expect(lines.join('\n')).toMatch(/Refusing to call the real Telegram API/);
  });
});
