#!/usr/bin/env node
// Prints a FRESH, validly signed initData for a seeded dev user, for curl-ing the local API.
// Uses the FAKE dev token (DEV_BOT_TOKEN in .env, default below). Development only: the API accepts
// this token only when NODE_ENV=development and ALLOW_DEV_INIT_DATA=true.
//   curl -H "Authorization: tma $(node scripts/dev-init-data.mjs 1)" localhost:3000/me
import { DEV_USERS, devInitData } from './lib/dev-init-data.mjs';

const key = process.argv[2] ?? '1';
if (!DEV_USERS[key]) {
  console.error('Usage: node scripts/dev-init-data.mjs [1|2|3]');
  process.exit(1);
}
console.log(devInitData(key));
