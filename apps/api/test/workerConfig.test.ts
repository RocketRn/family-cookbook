import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { loadWorkerConfig } from '../src/workerConfig.js';

/** The worker's settings, and what it refuses (D-039, D-040). Tokens here are made up. */
const REAL_SHAPE = '123456789:AAHq3Zk7mN2pQ4rS6tU8vW0xY1zA3bC5dE7';
const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  S3_ENDPOINT: 'https://storage.googleapis.com',
  S3_BUCKET: 'cookbook-media',
  S3_ACCESS_KEY: 'GOOG1EXAMPLEKEY',
  S3_SECRET_KEY: 'secret-value',
};
const prod = {
  ...base,
  NODE_ENV: 'production',
  BOT_TOKEN: REAL_SHAPE,
  BOT_USERNAME: 'family_cookbook_bot',
  MINI_APP_SHORT_NAME: 'cook',
};

describe('the worker in production', () => {
  it('sends only to the real Telegram API, with the real token', () => {
    const c = loadWorkerConfig(prod);
    expect(c.telegram).toEqual({
      baseUrl: 'https://api.telegram.org',
      token: REAL_SHAPE,
      allowReal: true,
      allowLocal: false,
    });
    expect(c.links).toEqual({ botUsername: 'family_cookbook_bot', appShortName: 'cook' });
  });

  it.each([
    [{ BOT_TOKEN: undefined }, /BOT_TOKEN/],
    [{ BOT_TOKEN: '000000:placeholder-not-a-real-token' }, /BOT_TOKEN/],
    [{ BOT_TOKEN: 'not-a-token' }, /BOT_TOKEN/],
    [{ S3_ACCESS_KEY: 'cookbook-dev' }, /S3_ACCESS_KEY/],
    [{ TELEGRAM_API_BASE: 'http://127.0.0.1:8081' }, /TELEGRAM_API_BASE/],
    [{ TELEGRAM_API_BASE: 'http://api.telegram.org' }, /TELEGRAM_API_BASE/],
    [{ BOT_USERNAME: undefined }, /BOT_USERNAME/],
    [{ BOT_USERNAME: 'your_cookbook_bot' }, /BOT_USERNAME/],
  ])('refuses to start with %j', (over, field) => {
    expect(() => loadWorkerConfig({ ...prod, ...over })).toThrow(ConfigError);
    expect(() => loadWorkerConfig({ ...prod, ...over })).toThrow(field);
  });

  it('never prints the token in its error', () => {
    try {
      loadWorkerConfig({ ...prod, TELEGRAM_API_BASE: 'https://evil.example' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain(REAL_SHAPE);
    }
  });
});

describe('the worker outside production (development, the demo, tests)', () => {
  const dev = {
    ...base,
    NODE_ENV: 'development',
    BOT_TOKEN: '000000:placeholder-not-a-real-token',
  };

  it('sends nothing unless a local stand-in is given', () => {
    expect(loadWorkerConfig(dev).telegram).toBeNull();
    expect(loadWorkerConfig({ ...dev, BOT_TOKEN: undefined }).telegram).toBeNull();
  });

  it('sends to a local stand-in (this computer, or a container on the same network)', () => {
    for (const TELEGRAM_API_BASE of [
      'http://127.0.0.1:8081',
      'http://localhost:8081/',
      'http://[::1]:8081',
      'http://fakebot:8081',
    ]) {
      expect(loadWorkerConfig({ ...dev, TELEGRAM_API_BASE }).telegram).toMatchObject({
        baseUrl: TELEGRAM_API_BASE,
        allowReal: false,
        allowLocal: true,
      });
    }
  });

  it.each([
    ['https://api.telegram.org'],
    ['https://api.telegram.org.example.com'],
    ['https://example.com'],
    ['http://10.0.0.5:8081'],
    ['ftp://127.0.0.1'],
  ])('never sends the token to %s', (TELEGRAM_API_BASE) => {
    expect(() => loadWorkerConfig({ ...dev, TELEGRAM_API_BASE })).toThrow(/TELEGRAM_API_BASE/);
  });

  it('a stand-in needs a token to put in the address', () => {
    expect(() =>
      loadWorkerConfig({
        ...dev,
        BOT_TOKEN: undefined,
        TELEGRAM_API_BASE: 'http://127.0.0.1:8081',
      }),
    ).toThrow(/BOT_TOKEN/);
  });

  it('applies the default pace', () => {
    const c = loadWorkerConfig(dev);
    expect(c).toMatchObject({ timerPollMs: 1000, outboxPollMs: 500, mediaCleanupMin: 60 });
  });
});
