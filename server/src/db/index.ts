import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** The single row a query must return (inserts with returning(), lookups by primary key). */
export function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('Expected a row');
  return row;
}

/**
 * Opens the database and applies pending migrations.
 * A postgres:// URL connects to Postgres (production). Anything else is a PGlite data directory,
 * an embedded Postgres used for local development; "memory://" keeps it in memory (tests).
 */
export async function openDatabase(url: string): Promise<Database> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  if (!url.includes('://')) mkdirSync(url, { recursive: true });
  const client = new PGlite(url);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
