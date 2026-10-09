import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo-root .env, regardless of the process cwd. Existing process env always wins.
config({ path: path.resolve(here, '../../../.env') });
