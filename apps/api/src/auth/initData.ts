import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Telegram Mini App initData validation (PRD 4.3), bot-token HMAC method.
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 * data_check_string = ALL received fields except `hash`, sorted by key, as `key=<value>`, joined by "\n".
 * `signature` stays in the data-check-string: removing it applies only to the third-party Ed25519
 * method, which we do not use. Source: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * (docs/ASSUMPTIONS.md A-01b, confirmed by the product owner).
 */

export type InitDataFailure =
  | 'EMPTY'
  | 'MALFORMED'
  | 'MISSING_HASH'
  | 'BAD_SIGNATURE'
  | 'MISSING_AUTH_DATE'
  | 'BAD_AUTH_DATE'
  | 'EXPIRED'
  | 'FROM_THE_FUTURE'
  | 'BAD_USER';

export class InitDataError extends Error {
  constructor(readonly reason: InitDataFailure) {
    super(`Invalid initData: ${reason}`);
  }
}

const userSchema = z.object({
  // Telegram ids fit in 52 bits; anything beyond a safe integer cannot be a real id.
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().default(''),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  photo_url: z.string().optional(),
  allows_write_to_pm: z.boolean().optional(),
});

export type TelegramUser = z.infer<typeof userSchema>;

export type ValidInitData = {
  user: TelegramUser;
  authDate: Date;
  startParam: string | null;
};

export type ValidateOptions = {
  /** Bot tokens the data may be signed with (production token, plus the dev token in development). */
  tokens: string[];
  maxAgeSeconds: number;
  /** Injected clock: tests pass an explicit "now". */
  now: Date;
  /** Tolerated clock skew for an auth_date slightly in the future. */
  futureSkewSeconds?: number;
};

export function computeHash(dataCheckString: string, botToken: string): string {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

/** Only `hash` is excluded (NOT `signature`): see the header comment. */
export function buildDataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function validateInitData(raw: string, opts: ValidateOptions): ValidInitData {
  if (!raw || !raw.trim()) throw new InitDataError('EMPTY');

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    throw new InitDataError('MALFORMED');
  }
  const keys = [...params.keys()];
  if (keys.length === 0) throw new InitDataError('MALFORMED');
  // Telegram never repeats a key; a duplicate (e.g. a second `hash`) is ambiguous, so refuse it.
  if (new Set(keys).size !== keys.length) throw new InitDataError('MALFORMED');

  const hash = params.get('hash');
  if (!hash) throw new InitDataError('MISSING_HASH');

  const dataCheckString = buildDataCheckString(params);
  // Evaluate every token (no early exit) so timing does not reveal which one matched.
  const matches = opts.tokens.map((t) =>
    constantTimeEqualHex(hash, computeHash(dataCheckString, t)),
  );
  if (!matches.some(Boolean)) throw new InitDataError('BAD_SIGNATURE');

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) throw new InitDataError('MISSING_AUTH_DATE');
  // Unix seconds as plain digits. Bound it so a huge value cannot become NaN / Invalid Date,
  // which would make both freshness comparisons false and silently pass.
  const authSeconds = /^\d{1,12}$/.test(authDateRaw) ? Number(authDateRaw) : NaN;
  const authDate = new Date(authSeconds * 1000);
  if (!Number.isFinite(authDate.getTime())) throw new InitDataError('BAD_AUTH_DATE');
  const ageSeconds = (opts.now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > opts.maxAgeSeconds) throw new InitDataError('EXPIRED');
  if (ageSeconds < -(opts.futureSkewSeconds ?? 60)) throw new InitDataError('FROM_THE_FUTURE');

  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataError('BAD_USER');
  let userJson: unknown;
  try {
    userJson = JSON.parse(userRaw);
  } catch {
    throw new InitDataError('BAD_USER');
  }
  const user = userSchema.safeParse(userJson);
  if (!user.success) throw new InitDataError('BAD_USER');

  return { user: user.data, authDate, startParam: params.get('start_param') };
}
