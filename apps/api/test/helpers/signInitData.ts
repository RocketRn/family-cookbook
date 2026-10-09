import { createHmac } from 'node:crypto';

/**
 * TEST-ONLY signer for Telegram initData. Written independently of src/auth/initData.ts
 * (and cross-checked once against scripts/initdata_vector.py, see initdata-vector.json) so
 * the validator tests are not circular.
 */
export const TEST_BOT_TOKEN = '123456:TEST-FAKE-TOKEN-FOR-UNIT-TESTS';

export type SignOptions = {
  botToken?: string;
  /** `null` omits the field entirely (to test a missing user). */
  user?: Record<string, unknown> | null;
  /** Unix seconds; a string is sent verbatim; `null` omits the field. */
  authDate: number | string | null;
  extra?: Record<string, string>;
  /** Replace the computed hash (to simulate tampering). */
  hashOverride?: string;
  omitHash?: boolean;
};

export function signInitData(opts: SignOptions): string {
  const token = opts.botToken ?? TEST_BOT_TOKEN;
  const user =
    opts.user === undefined ? { id: 1001, first_name: 'Test', language_code: 'en' } : opts.user;
  const fields: Array<[string, string]> = [
    ...(opts.authDate === null ? [] : [['auth_date', String(opts.authDate)] as [string, string]]),
    ...(user === null ? [] : [['user', JSON.stringify(user)] as [string, string]]),
    ...Object.entries(opts.extra ?? {}),
  ];

  const lines = fields.map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac('sha256', Buffer.from('WebAppData', 'utf8'))
    .update(token, 'utf8')
    .digest();
  const hash = createHmac('sha256', secret).update(lines.join('\n'), 'utf8').digest('hex');

  const usp = new URLSearchParams();
  for (const [k, v] of fields) usp.append(k, v);
  if (!opts.omitHash) usp.append('hash', opts.hashOverride ?? hash);
  return usp.toString();
}
