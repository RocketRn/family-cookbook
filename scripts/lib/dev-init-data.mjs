// Signs initData for a seeded dev user with the FAKE dev token (development only: the API accepts
// it only when NODE_ENV=development and ALLOW_DEV_INIT_DATA=true). Shared by the dev scripts.
import { createHmac } from 'node:crypto';

export const DEV_USERS = {
  1: { id: 100000001, first_name: 'Dev Keeper', username: 'dev_keeper', language_code: 'ru' },
  2: { id: 100000002, first_name: 'Dev Member', username: 'dev_member', language_code: 'en' },
  3: { id: 100000003, first_name: 'Ny Användare', username: 'dev_new', language_code: 'sv' },
};

export function devInitData(
  userKey = '1',
  token = process.env.DEV_BOT_TOKEN ?? '000000:DEV-ONLY-FAKE-TOKEN',
) {
  const user = DEV_USERS[userKey];
  if (!user) throw new Error(`Unknown dev user "${userKey}" (use 1, 2 or 3)`);
  // `signature` mirrors real clients; for the HMAC method it is signed like any other field.
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
    signature: 'DEV-SCRIPT-SIGNATURE-not-verified-by-the-hmac-method',
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
