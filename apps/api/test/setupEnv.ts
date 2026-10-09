import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fake, committed values (.env.test). A DATABASE_URL already in the environment wins (CI sets it).
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.test') });
