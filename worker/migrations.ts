// Schema migrations for the decisions database.
//
// A migration is an ordered, named step. The runner applies the whole list before
// the first `/api/` request that needs a table, and every statement in a step is
// sent as one `batch()`, which D1 runs as a transaction: a step either lands whole
// or not at all.
//
// There is deliberately no `schema_migrations` ledger yet. Every step so far is a
// `CREATE ... IF NOT EXISTS`, so re-running the list is a no-op and a missed ledger
// cannot leave an install in a state nobody can reproduce. The first step that is
// not re-runnable — an `ALTER TABLE ... ADD COLUMN`, which SQLite cannot guard with
// `IF NOT EXISTS` — has to bring the ledger with it, because from then on "did this
// run?" stops being answerable from the schema itself. That is flagged for CP5,
// where tenancy adds the first column.

export interface Migration {
  /** Stable, ordered id. Reported by `/api/version` as the schema version. */
  id: string;
  /** Idempotent statements applied together. */
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_decisions',
    statements: [
      `CREATE TABLE IF NOT EXISTS decisions (
        key TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'dismissed')),
        assignee_id TEXT,
        decided_by TEXT NOT NULL,
        decided_by_name TEXT,
        decided_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_by_name TEXT,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '0002_decision_events',
    statements: [
      // The append-only log behind every decision: who changed what, and when.
      // `actor_email` is personal data with a retention story still to write (SR-04).
      `CREATE TABLE IF NOT EXISTS decision_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT,
        assignee_id TEXT,
        actor_id TEXT NOT NULL,
        actor_name TEXT,
        actor_email TEXT,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: '0003_decision_events_key',
    statements: [
      // History pages descend by event id; the key index serves per-item lookups.
      `CREATE INDEX IF NOT EXISTS decision_events_key ON decision_events (key, created_at)`,
    ],
  },
];

/** The id of the last step in the list: what this build expects the schema to be. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;

/**
 * Apply every migration, in order, one transaction per step.
 *
 * Idempotent by construction: each step is re-runnable, so a cold database, an
 * existing install created before migrations existed, and a retry after a failed
 * cold start all converge on the same schema.
 */
export async function applyMigrations(db: D1Database): Promise<void> {
  for (const migration of MIGRATIONS) {
    await db.batch(migration.statements.map((statement) => db.prepare(statement)));
  }
}
