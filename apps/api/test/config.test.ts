import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BOT_TOKEN: '1:real-looking',
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

  it('requires DEV_BOT_TOKEN when the dev flag is on', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'development', ALLOW_DEV_INIT_DATA: 'true' }),
    ).toThrow(/DEV_BOT_TOKEN/);
  });

  it('rejects a bad flag value', () => {
    expect(() => loadConfig({ ...base, ALLOW_DEV_INIT_DATA: 'yes' })).toThrow(ConfigError);
  });
});
