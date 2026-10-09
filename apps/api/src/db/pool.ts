import pg from 'pg';

// bigint (int8) as string: Telegram ids fit in JS numbers today, but never risk precision.
pg.types.setTypeParser(20, (v) => v);
// numeric -> number. Our numeric columns (amounts, servings, portions) are well inside double precision.
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}
