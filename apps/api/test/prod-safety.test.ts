import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, isRealLookingToken, loadConfig } from '../src/config.js';
import { createTelegramClient, realApiRefusal } from '../src/notify/telegram.js';
import { loadWorkerConfig } from '../src/workerConfig.js';

/**
 * S5-2: the production safety guard, after the Sprint 4 near miss. A measurement worker was
 * restarted in production mode with a made-up token shaped like a real one; nothing was due, so
 * nothing was sent. From now on reaching the real Telegram API needs production mode AND an
 * explicit TELEGRAM_LIVE=yes AND a token that is not a known fake, and never from a test run.
 * Nothing here calls Telegram. The real-looking tokens below are made up.
 */
const REAL_SHAPE = '987654321:AAG7kQ2mX9pL4vR8sT1wY6zB3nC5dF0hJ2k';
// What the near miss had: random, real-looking, and nobody meant it to reach Telegram.
const MADE_UP = '4382811905:AAHx7Qe2Lm9Pz4Rt8Vw1Ky6Bn3Cd5Fg0Hj2';
const live = { NODE_ENV: 'production', TELEGRAM_LIVE: 'yes' };
const prodWorker = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://cookbook_api:3f9c1e7a5b2d4c6e8f0a1b3c5d7e9f21@postgres:5432/cookbook',
  BOT_TOKEN: REAL_SHAPE,
  BOT_USERNAME: 'family_cookbook_bot',
  MINI_APP_SHORT_NAME: 'cook',
  S3_ENDPOINT: 'https://storage.googleapis.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'family-cookbook-photos-4821',
  S3_ACCESS_KEY: 'GOOG1EREALLOOKINGKEY',
  S3_SECRET_KEY: 'real-looking-secret-0123456789',
};

describe('the production worker sends to Telegram only when armed with TELEGRAM_LIVE=yes', () => {
  it('starts when armed', () => {
    expect(loadWorkerConfig({ ...prodWorker, TELEGRAM_LIVE: 'yes' }).telegram).toMatchObject({
      baseUrl: 'https://api.telegram.org',
      allowReal: true,
    });
  });

  it.each([[undefined], ['no'], ['CHANGE_ME'], ['true'], ['1'], ['YES'], [' yes'], ['']])(
    'refuses to start with TELEGRAM_LIVE=%j (the near miss: production mode alone)',
    (TELEGRAM_LIVE) => {
      const env = { ...prodWorker, BOT_TOKEN: MADE_UP, TELEGRAM_LIVE };
      expect(() => loadWorkerConfig(env)).toThrow(ConfigError);
      expect(() => loadWorkerConfig(env)).toThrow(/TELEGRAM_LIVE/);
    },
  );

  it('names the problem without printing the token', () => {
    try {
      loadWorkerConfig({ ...prodWorker, BOT_TOKEN: MADE_UP });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain(MADE_UP);
      expect(String(err)).not.toContain(MADE_UP.split(':')[1]);
    }
  });
});

describe('the Telegram client checks again, apart from the settings', () => {
  it('may call the real API only from an armed production process with a real-looking token', () => {
    expect(realApiRefusal({ baseUrl: '', token: REAL_SHAPE, allowReal: true }, live)).toBeNull();
  });

  it.each([
    ['not allowed by the settings', { allowReal: false }, live],
    ['not armed', {}, { NODE_ENV: 'production' }],
    ['armed with something other than yes', {}, { ...live, TELEGRAM_LIVE: 'true' }],
    ['not production', {}, { ...live, NODE_ENV: 'development' }],
    ['a test run (NODE_ENV)', {}, { ...live, NODE_ENV: 'test' }],
    ['a test run (Vitest)', {}, { ...live, VITEST: 'true' }],
    ['a placeholder token', { token: '000000:placeholder-not-a-real-token' }, live],
    ['the dev token', { token: '000000:DEV-ONLY-FAKE-TOKEN' }, live],
    ['a malformed token', { token: 'CHANGE_ME' }, live],
    ['a filler token', { token: '1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, live],
  ])('refuses: %s', (_why, over, env) => {
    const o = { baseUrl: 'https://api.telegram.org', token: REAL_SHAPE, allowReal: true, ...over };
    const why = realApiRefusal(o, env);
    expect(why).toEqual(expect.any(String));
    expect(why).not.toContain(o.token);
  });

  it.each([
    ['https://api.telegram.org./'],
    ['https://API.Telegram.org'],
    ['https://core.telegram.org'],
    ['http://149.154.167.220'],
    ['https://example.com'],
  ])(
    'sends the token to a stand-in only on this computer or its Docker network, not %s',
    (baseUrl) => {
      expect(() => createTelegramClient({ baseUrl, token: REAL_SHAPE, allowLocal: true })).toThrow(
        /Refusing/,
      );
    },
  );

  it('cannot be made for the real API inside this test run, even when told it may', () => {
    for (const token of [REAL_SHAPE, MADE_UP]) {
      expect(() =>
        createTelegramClient({ baseUrl: 'https://api.telegram.org', token, allowReal: true }),
      ).toThrow(/real Telegram/);
    }
  });
});

describe('fake tokens', () => {
  it.each([
    '000000:placeholder-not-a-real-token',
    '000000:DEV-ONLY-FAKE-TOKEN',
    '123456:TEST-FAKE-TOKEN-FOR-UNIT-TESTS',
    '1234567890:not-a-real-token-0123456789abcdefghij',
    '1234567890:dummy-0123456789abcdefghijklmnopqrstu',
    '1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '7000000001:CHANGE_ME_0123456789abcdefghijklmnop',
    'CHANGE_ME',
  ])('%s is never taken for the real token', (token) => {
    expect(isRealLookingToken(token)).toBe(false);
  });

  it('a real-looking token is taken for one', () => {
    expect(isRealLookingToken(REAL_SHAPE)).toBe(true);
    expect(isRealLookingToken(MADE_UP)).toBe(true); // which is why the arming switch exists
  });

  // Every token written into a setup that can start the app (env files, scripts, compose files,
  // workflows, the apps' own code and test helpers) must be one production refuses.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const setupFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(
      (f) =>
        /(^|\/)\.env[^/]*$/.test(f) ||
        /\.(sh|ya?ml|py|mjs)$/.test(f) ||
        /(^|\/)Dockerfile[^/]*$/.test(f) ||
        /^apps\/[^/]+\/src\//.test(f) ||
        /^apps\/[^/]+\/test\/helpers\//.test(f),
    );
  const TOKEN_LIKE = /\b\d{3,}:(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{6,}/g;
  const found = new Map<string, string>();
  for (const f of setupFiles) {
    for (const m of readFileSync(path.join(root, f), 'utf8').matchAll(TOKEN_LIKE)) {
      found.set(m[0], f);
    }
  }

  it('the scan finds the tokens the setups use', () => {
    expect([...found.keys()]).toEqual(
      expect.arrayContaining([
        '000000:placeholder-not-a-real-token',
        '000000:DEV-ONLY-FAKE-TOKEN',
        '123456:TEST-FAKE-TOKEN-FOR-UNIT-TESTS',
      ]),
    );
  });

  it('every token in the setups is refused in production, by the API and by the worker', () => {
    const api = {
      NODE_ENV: 'production',
      DATABASE_URL: prodWorker.DATABASE_URL,
      BOT_USERNAME: 'family_cookbook_bot',
      MINI_APP_SHORT_NAME: 'cook',
      CORS_ORIGIN: 'https://family-cookbook.duckdns.org',
      S3_ENDPOINT: prodWorker.S3_ENDPOINT,
      S3_REGION: 'auto',
      S3_BUCKET: prodWorker.S3_BUCKET,
      S3_ACCESS_KEY: prodWorker.S3_ACCESS_KEY,
      S3_SECRET_KEY: prodWorker.S3_SECRET_KEY,
    };
    expect(() => loadConfig({ ...api, BOT_TOKEN: REAL_SHAPE })).not.toThrow();
    for (const [token, file] of found) {
      expect(isRealLookingToken(token), `${token} in ${file}`).toBe(false);
      expect(() => loadConfig({ ...api, BOT_TOKEN: token }), file).toThrow(/BOT_TOKEN/);
      expect(
        () => loadWorkerConfig({ ...prodWorker, TELEGRAM_LIVE: 'yes', BOT_TOKEN: token }),
        file,
      ).toThrow(/BOT_TOKEN/);
    }
  });
});
