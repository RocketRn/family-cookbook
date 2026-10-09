import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BOT_TOKEN: '1:real-looking',
  S3_ENDPOINT: 'https://s3.example.com',
  S3_BUCKET: 'cookbook-media',
  S3_ACCESS_KEY: 'AKIAREALLOOKINGKEY01',
  S3_SECRET_KEY: 'real-looking-secret-0123456789',
};
/** What production needs besides: a strong database password and the real bot name (D-045). */
const prodBase = {
  ...base,
  NODE_ENV: 'production',
  BOT_TOKEN: '7000000001:AAEhBP0av28eZqAbCdEfGhIjKlMnOpQrStU',
  BOT_USERNAME: 'family_cookbook_bot',
  DATABASE_URL: 'postgres://cookbook_api:3f9c1e7a5b2d4c6e8f0a1b3c5d7e9f21@postgres:5432/cookbook',
};

describe('loadConfig', () => {
  it('fails fast with a clear message when required vars are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({})).toThrow(/BOT_TOKEN/);
  });

  it('applies defaults', () => {
    const c = loadConfig({ ...base });
    expect(c.port).toBe(3000);
    expect(c.host).toBe('0.0.0.0'); // containers; the local demo sets HOST=127.0.0.1
    expect(loadConfig({ ...base, HOST: '127.0.0.1' }).host).toBe('127.0.0.1');
    expect(c.initDataMaxAgeSeconds).toBe(86_400);
    expect(c.initDataTokens).toEqual(['1:real-looking']);
  });

  it('adds the dev token only in development with the flag', () => {
    const dev = {
      ...base,
      NODE_ENV: 'development',
      ALLOW_DEV_INIT_DATA: 'true',
      DEV_BOT_TOKEN: '0:fake',
    };
    expect(loadConfig(dev).initDataTokens).toEqual(['1:real-looking', '0:fake']);
    expect(loadConfig({ ...dev, ALLOW_DEV_INIT_DATA: 'false' }).initDataTokens).toEqual([
      '1:real-looking',
    ]);
  });

  it('REFUSES to boot with ALLOW_DEV_INIT_DATA=true outside development (production path impossible)', () => {
    for (const NODE_ENV of ['production', 'test']) {
      expect(() =>
        loadConfig({ ...base, NODE_ENV, ALLOW_DEV_INIT_DATA: 'true', DEV_BOT_TOKEN: '0:fake' }),
      ).toThrow(/only permitted when NODE_ENV=development/);
    }
  });

  it('REFUSES a placeholder or malformed BOT_TOKEN in production', () => {
    const prod = prodBase;
    for (const BOT_TOKEN of [
      '000000:placeholder-not-a-real-token',
      '000000:DEV-ONLY-FAKE-TOKEN',
      '123456:TEST-FAKE-TOKEN-FOR-UNIT-TESTS',
      'not-a-token',
      '123:short',
    ]) {
      expect(() => loadConfig({ ...prod, BOT_TOKEN }), BOT_TOKEN).toThrow(
        /real token from @BotFather/,
      );
    }
    // A well-formed token (random letters, not a real one) is accepted.
    expect(() =>
      loadConfig({ ...prod, BOT_TOKEN: '7000000001:AAEhBP0av28eZqAbCdEfGhIjKlMnOpQrStU' }),
    ).not.toThrow();
  });

  it('REFUSES the local demo database passwords, placeholders and the placeholder bot name in production (D-045)', () => {
    expect(() => loadConfig(prodBase)).not.toThrow();
    for (const DATABASE_URL of [
      'postgres://cookbook_api:cookbook_api@postgres:5432/cookbook',
      'postgres://cookbook_api:cookbook@postgres:5432/cookbook',
      'postgres://cookbook_api@postgres:5432/cookbook',
      'postgres://cookbook_api:short-password@postgres:5432/cookbook',
      'postgres://cookbook_api:CHANGE_ME_to_a_long_random_value@postgres:5432/cookbook',
    ]) {
      expect(() => loadConfig({ ...prodBase, DATABASE_URL }), DATABASE_URL).toThrow(/DATABASE_URL/);
      try {
        loadConfig({ ...prodBase, DATABASE_URL });
      } catch (err) {
        expect(String(err)).not.toContain('short-password'); // never printed
      }
    }
    for (const BOT_USERNAME of [undefined, 'your_cookbook_bot'])
      expect(() => loadConfig({ ...prodBase, BOT_USERNAME })).toThrow(/BOT_USERNAME/);
    expect(() => loadConfig({ ...prodBase, S3_SECRET_KEY: 'CHANGE_ME' })).toThrow(/S3_SECRET_KEY/);
    expect(() => loadConfig({ ...prodBase, S3_ACCESS_KEY: 'cookbook-dev' })).toThrow(
      /S3_ACCESS_KEY/,
    );
  });

  it('rejects DEV_BOT_TOKEN equal to BOT_TOKEN', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'development',
        ALLOW_DEV_INIT_DATA: 'true',
        DEV_BOT_TOKEN: base.BOT_TOKEN,
      }),
    ).toThrow(/must differ/);
  });

  it('requires DEV_BOT_TOKEN when the dev flag is on', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'development', ALLOW_DEV_INIT_DATA: 'true' }),
    ).toThrow(/DEV_BOT_TOKEN/);
  });

  it('rejects a bad flag value', () => {
    expect(() => loadConfig({ ...base, ALLOW_DEV_INIT_DATA: 'yes' })).toThrow(ConfigError);
  });
});
