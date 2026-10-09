#!/usr/bin/env node
// Prints a FRESH, validly signed initData for a seeded dev user, for curl-ing the local API.
// Uses the FAKE dev token (DEV_BOT_TOKEN in .env, default below). Development only: the API accepts
// this token only when NODE_ENV=development and ALLOW_DEV_INIT_DATA=true.
//   curl -H "Authorization: tma $(node scripts/dev-init-data.mjs 1)" localhost:3000/me
import { createHmac } from 'node:crypto';

const token = process.env.DEV_BOT_TOKEN ?? '000000:DEV-ONLY-FAKE-TOKEN';
const users = {
  1: { id: 100000001, first_name: 'Dev Keeper', username: 'dev_keeper', language_code: 'ru' },
  2: { id: 100000002, first_name: 'Dev Member', username: 'dev_member', language_code: 'en' },
  3: { id: 100000003, first_name: 'Ny Användare', username: 'dev_new', language_code: 'sv' },
};
const user = users[process.argv[2] ?? '1'];
if (!user) {
  console.error('Usage: node scripts/dev-init-data.mjs [1|2|3]');
  process.exit(1);
}

const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) };
const dcs = Object.keys(fields)
  .sort()
  .map((k) => `${k}=${fields[k]}`)
  .join('\n');
const secret = createHmac('sha256', 'WebAppData').update(token).digest();
const hash = createHmac('sha256', secret).update(dcs).digest('hex');
console.log(new URLSearchParams({ ...fields, hash }).toString());
