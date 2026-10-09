import { describe, expect, it } from 'vitest';
import { dbUrlProblem, migrateEnvProblems } from '../src/prodGuard.js';

/** Production refuses local-demo and placeholder secrets (owner's Sprint 4 rule; D-045). */
const STRONG = '3f9c1e7a5b2d4c6e8f0a1b3c5d7e9f21';

describe('database passwords in production', () => {
  it('accepts a long random password', () => {
    expect(dbUrlProblem(`postgres://cookbook:${STRONG}@postgres:5432/cookbook`)).toBeNull();
  });

  it.each([
    ['postgres://cookbook:cookbook@postgres:5432/cookbook', /local demo/],
    ['postgres://cookbook_api:cookbook_api@postgres:5432/cookbook', /local demo/],
    ['postgres://cookbook@postgres:5432/cookbook', /no password/],
    ['postgres://cookbook:CHANGE_ME_long_enough_value@postgres/cookbook', /placeholder/],
    ['postgres://cookbook:tooshort@postgres/cookbook', /at least 16/],
    ['not a url', /not a valid/],
  ])('refuses %s', (url, why) => {
    const problem = dbUrlProblem(url);
    expect(problem).toMatch(why);
    expect(problem).not.toContain('tooshort');
  });

  it('the migration tool checks both database users in production only', () => {
    const owner = `postgres://cookbook:${STRONG}@postgres:5432/cookbook`;
    const api = `postgres://cookbook_api:${STRONG}a@postgres:5432/cookbook`;
    expect(
      migrateEnvProblems({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: owner,
        DATABASE_URL: api,
      }),
    ).toEqual([]);
    expect(
      migrateEnvProblems({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: 'postgres://cookbook:cookbook@postgres:5432/cookbook',
        DATABASE_URL: api,
      }),
    ).toEqual([expect.stringMatching(/^MIGRATION_DATABASE_URL .*local demo/)]);
    expect(
      migrateEnvProblems({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: owner,
        DATABASE_URL: owner,
      }),
    ).toEqual([expect.stringMatching(/must be two different/)]);
    // The local demo and the tests keep their fake passwords.
    expect(
      migrateEnvProblems({
        NODE_ENV: 'development',
        MIGRATION_DATABASE_URL: 'postgres://cookbook:cookbook@localhost:5432/cookbook',
        DATABASE_URL: 'postgres://cookbook_api:cookbook_api@localhost:5432/cookbook',
      }),
    ).toEqual([]);
  });
});
