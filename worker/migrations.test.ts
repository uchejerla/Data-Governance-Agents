import { describe, expect, it } from 'vitest';
import { applyMigrations, MIGRATIONS, SCHEMA_VERSION } from './migrations';

// Migrations are the only part of the schema with a lifetime longer than a deploy.
// What matters is that re-running them is harmless — that is what makes a cold
// start, an install created before migrations existed, and a retry after a failed
// boot converge on the same schema.

function makeDb(options: { failOn?: string } = {}) {
  const batches: { sql: string }[][] = [];
  const prepare = (sql: string) => ({
    sql,
    bind: () => prepare(sql),
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ success: true }),
  });

  return {
    batches,
    prepare,
    async batch(statements: { sql: string }[]) {
      if (options.failOn && statements.some((statement) => statement.sql.includes(options.failOn!))) {
        throw new Error('D1_ERROR: migration failed');
      }
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };
}

const asD1 = (db: ReturnType<typeof makeDb>) => db as unknown as D1Database;

describe('migrations', () => {
  it('has ordered, unique ids and reports the last one as the schema version', () => {
    const ids = MIGRATIONS.map((migration) => migration.id);

    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(SCHEMA_VERSION).toBe(ids[ids.length - 1]);
  });

  it('is idempotent by construction: every statement can run twice', () => {
    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) {
        expect(statement).toMatch(/IF NOT EXISTS/);
      }
    }
  });

  it('applies each migration as its own transaction, in order', async () => {
    const db = makeDb();

    await applyMigrations(asD1(db));

    expect(db.batches).toHaveLength(MIGRATIONS.length);
    db.batches.forEach((batch, index) => {
      expect(batch.map((statement) => statement.sql)).toEqual(MIGRATIONS[index].statements);
    });
  });

  it('prepares the same statements on a second run, so a retry is safe', async () => {
    const db = makeDb();

    await applyMigrations(asD1(db));
    await applyMigrations(asD1(db));

    const first = db.batches.slice(0, MIGRATIONS.length);
    const second = db.batches.slice(MIGRATIONS.length);
    expect(second.map((batch) => batch.map((statement) => statement.sql))).toEqual(
      first.map((batch) => batch.map((statement) => statement.sql)),
    );
  });

  it('stops at the migration that fails instead of reporting success', async () => {
    const db = makeDb({ failOn: 'decision_events_key' });

    await expect(applyMigrations(asD1(db))).rejects.toThrow('migration failed');
    // The two migrations before the failure did land; the failing one did not.
    expect(db.batches).toHaveLength(2);
  });
});
