import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { migrateEnvProblems } from '../src/prodGuard.js';
import { loadWorkerConfig } from '../src/workerConfig.js';

/** The production files (deploy/gcp, D-045): least privilege, and placeholders that cannot start. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const compose = readFileSync(path.join(root, 'deploy/gcp/compose.yml'), 'utf8');
const example = Object.fromEntries(
  readFileSync(path.join(root, 'deploy/gcp/.env.example'), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

/** One service's block of compose.yml (two-space indented name up to the next one). */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, name).toBeGreaterThan(0);
  const rest = compose.slice(start + name.length + 5);
  const end = rest.search(/\n {2}[a-z0-9]+:\n|\n[a-z]+:\n/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('deploy/gcp/compose.yml', () => {
  it('only the database and the migration step get the database owner password', () => {
    for (const s of ['api', 'worker', 'web', 's3check']) {
      expect(service(s), s).not.toMatch(/POSTGRES_PASSWORD|MIGRATION_DATABASE_URL/);
    }
    expect(service('migrate')).toMatch(/MIGRATION_DATABASE_URL/);
  });

  it('the database is not reachable from outside; only Caddy opens ports', () => {
    expect(service('postgres')).not.toMatch(/ports:/);
    expect(service('api')).not.toMatch(/ports:/);
    expect(service('web')).toMatch(/ports: \['80:80', '443:443'\]/);
  });

  it('the worker can only reach the real Telegram API (no TELEGRAM_API_BASE in production)', () => {
    expect(service('worker')).not.toMatch(/^\s+TELEGRAM_API_BASE:/m);
    expect(service('worker')).toMatch(/NODE_ENV: production/);
  });

  it('every service has a memory limit (measured, D-045)', () => {
    for (const s of ['postgres', 'migrate', 'api', 'worker', 'web']) {
      expect(service(s), s).toMatch(/mem_limit: /);
    }
  });
});

describe('deploy/gcp/.env.example', () => {
  const db = (user: string, pw: string) => `postgres://${user}:${pw}@postgres:5432/cookbook`;
  // What compose.yml hands the API and the worker when .env is still the example.
  const asApi = {
    NODE_ENV: 'production',
    DATABASE_URL: db('cookbook_api', example.API_DB_PASSWORD!),
    BOT_TOKEN: example.BOT_TOKEN,
    BOT_USERNAME: example.BOT_USERNAME,
    MINI_APP_SHORT_NAME: example.MINI_APP_SHORT_NAME,
    S3_ENDPOINT: 'https://storage.googleapis.com',
    S3_REGION: 'auto',
    S3_BUCKET: 'family-cookbook-photos-4821',
    S3_ACCESS_KEY: example.S3_ACCESS_KEY,
    S3_SECRET_KEY: example.S3_SECRET_KEY,
  };

  it('holds only placeholders, never a real-looking secret', () => {
    for (const key of [
      'POSTGRES_PASSWORD',
      'API_DB_PASSWORD',
      'BOT_TOKEN',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'DUCKDNS_TOKEN',
    ]) {
      expect(example[key], key).toBe('CHANGE_ME');
    }
  });

  it('as it is, it can never start the API, the worker or the migrations', () => {
    expect(() => loadConfig(asApi)).toThrow(ConfigError);
    expect(() => loadWorkerConfig(asApi)).toThrow(ConfigError);
    expect(
      migrateEnvProblems({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: db('cookbook', example.POSTGRES_PASSWORD!),
        DATABASE_URL: asApi.DATABASE_URL,
      }).length,
    ).toBeGreaterThan(0);
  });
});
