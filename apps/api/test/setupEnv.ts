import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeTestEnv } from './helpers/safeEnv.js';

// Fake, committed values (.env.test). A DATABASE_URL already in the environment wins (CI sets it).
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.test') });
// S5-2: never with production settings (also checked once in globalSetup.ts, before migrations).
assertSafeTestEnv(process.env);
