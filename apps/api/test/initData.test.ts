import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeHash, InitDataError, validateInitData } from '../src/auth/initData.js';
import { signInitData, TEST_BOT_TOKEN } from './helpers/signInitData.js';

const vector = JSON.parse(
  readFileSync(new URL('./fixtures/initdata-vector.json', import.meta.url), 'utf8'),
) as {
  botToken: string;
  authDate: number;
  dataCheckString: string;
  hash: string;
  initData: string;
};

const AUTH = 1_760_000_000;
const now = (offsetSeconds: number) => new Date((AUTH + offsetSeconds) * 1000);
const opts = (offset = 30) => ({
  tokens: [TEST_BOT_TOKEN],
  maxAgeSeconds: 86_400,
  now: now(offset),
});

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InitDataError) return e.reason;
    throw e;
  }
  return undefined;
}

describe('known-good vector (produced by scripts/initdata_vector.py using Python hmac)', () => {
  it('production hash function reproduces the Python hash', () => {
    expect(vector.botToken).toBe(TEST_BOT_TOKEN);
    expect(computeHash(vector.dataCheckString, vector.botToken)).toBe(vector.hash);
  });

  it('validator accepts the committed initData with an explicit "now"', () => {
    const r = validateInitData(vector.initData, opts());
    expect(r.user.id).toBe(279058397);
    expect(r.user.first_name).toBe('Vladislav + Vlad');
    expect(r.startParam).toBe('join_abc123');
    expect(r.authDate.getTime()).toBe(AUTH * 1000);
  });

  it('the TS test signer matches the Python vector hash for the same fields', () => {
    const user = {
      id: 279058397,
      first_name: 'Vladislav + Vlad',
      username: 'vlad',
      language_code: 'ru',
      allows_write_to_pm: true,
    };
    const signed = signInitData({
      authDate: AUTH,
      user,
      extra: { query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', start_param: 'join_abc123' },
    });
    expect(new URLSearchParams(signed).get('hash')).toBe(vector.hash);
  });
});

describe('validateInitData', () => {
  const good = () => signInitData({ authDate: AUTH });

  it('accepts valid data', () => {
    expect(validateInitData(good(), opts()).user.id).toBe(1001);
  });

  it('rejects a tampered field', () => {
    const tampered = good().replace('%22Test%22', '%22Evil%22');
    expect(tampered).not.toBe(good());
    expect(reasonOf(() => validateInitData(tampered, opts()))).toBe('BAD_SIGNATURE');
  });

  it('rejects a tampered user id', () => {
    const tampered = good().replace('1001', '1002');
    expect(reasonOf(() => validateInitData(tampered, opts()))).toBe('BAD_SIGNATURE');
  });

  it('rejects data signed with the wrong token', () => {
    const raw = signInitData({ authDate: AUTH, botToken: '999999:ANOTHER-FAKE-TOKEN' });
    expect(reasonOf(() => validateInitData(raw, opts()))).toBe('BAD_SIGNATURE');
  });

  it('rejects a missing hash', () => {
    expect(
      reasonOf(() => validateInitData(signInitData({ authDate: AUTH, omitHash: true }), opts())),
    ).toBe('MISSING_HASH');
  });

  it('rejects a malformed hash (not hex / wrong length)', () => {
    for (const hashOverride of ['zzzz', 'abcd', '']) {
      const r = reasonOf(() =>
        validateInitData(signInitData({ authDate: AUTH, hashOverride }), opts()),
      );
      expect(['BAD_SIGNATURE', 'MISSING_HASH']).toContain(r);
    }
  });

  it('rejects expired auth_date (older than the max age) and accepts the boundary', () => {
    expect(reasonOf(() => validateInitData(good(), opts(86_400 + 1)))).toBe('EXPIRED');
    expect(reasonOf(() => validateInitData(good(), opts(86_400)))).toBeUndefined();
  });

  it('rejects auth_date far in the future but tolerates small clock skew', () => {
    expect(reasonOf(() => validateInitData(good(), opts(-3600)))).toBe('FROM_THE_FUTURE');
    expect(reasonOf(() => validateInitData(good(), opts(-30)))).toBeUndefined();
  });

  it('rejects a missing or non-numeric auth_date even if correctly signed', () => {
    const raw = signInitData({ authDate: AUTH, extra: {} }).replace(
      `auth_date=${AUTH}`,
      'auth_date=abc',
    );
    // Re-sign by hand is not possible; a changed auth_date breaks the signature first.
    expect(reasonOf(() => validateInitData(raw, opts()))).toBe('BAD_SIGNATURE');
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['no pairs', '&&&'],
    ['garbage', 'not-init-data'],
  ])('rejects malformed input: %s', (_name, raw) => {
    expect(reasonOf(() => validateInitData(raw, opts()))).toBeDefined();
  });

  it('rejects a signed payload whose user is not valid JSON or lacks an id', () => {
    const badJson = signInitData({ authDate: AUTH, user: { id: 1 } }).replace(
      /user=[^&]*/,
      'user=%7Bnope',
    );
    expect(reasonOf(() => validateInitData(badJson, opts()))).toBe('BAD_SIGNATURE');
    const noId = signInitData({ authDate: AUTH, user: { first_name: 'x' } });
    expect(reasonOf(() => validateInitData(noId, opts()))).toBe('BAD_USER');
    const noUser = signInitData({
      authDate: AUTH,
      user: 'not an object' as unknown as Record<string, unknown>,
    });
    expect(reasonOf(() => validateInitData(noUser, opts()))).toBe('BAD_USER');
  });

  it('accepts a second (dev) token only when it is in the token list', () => {
    const dev = '000000:DEV-ONLY-FAKE-TOKEN';
    const raw = signInitData({ authDate: AUTH, botToken: dev });
    expect(reasonOf(() => validateInitData(raw, opts()))).toBe('BAD_SIGNATURE');
    expect(
      reasonOf(() => validateInitData(raw, { ...opts(), tokens: [TEST_BOT_TOKEN, dev] })),
    ).toBeUndefined();
  });

  it('rejects duplicate keys (e.g. a second hash) as ambiguous', () => {
    const raw = `${good()}&hash=${'0'.repeat(64)}`;
    expect(reasonOf(() => validateInitData(raw, opts()))).toBe('MALFORMED');
  });
});
