import { describe, expect, it } from 'vitest';
import { D1DecisionStore } from './storage';

// The storage layer is the only place that knows a column name, so these tests
// check the contract it promises the routes: the statements it prepares, the
// parameters it binds, and the shape it hands back. Nothing here asserts on the
// strings of the TypeScript code, only on the SQL that would reach D1.

interface Statement {
  sql: string;
  params: unknown[];
  bind: (...values: unknown[]) => Statement;
  all: () => Promise<{ results: unknown[] }>;
  first: () => Promise<unknown>;
  run: () => Promise<{ success: boolean }>;
}

interface Answer {
  rows?: unknown[];
  first?: unknown;
  throws?: boolean;
}

/**
 * A D1 stand-in that records what the store prepares and batches. `answer` decides
 * what each statement returns, so a test can serve a row, an empty page, or an
 * error without a database.
 */
function makeDb(answer: (sql: string, params: unknown[]) => Answer = () => ({})) {
  const prepared: Statement[] = [];
  const batches: Statement[][] = [];

  const statement = (sql: string, params: unknown[] = []): Statement => ({
    sql,
    params,
    // D1 binds by returning a new prepared statement. The recorded entry shares this
    // array, so what a test reads back is what would have been sent.
    bind: (...values: unknown[]) => {
      params.splice(0, params.length, ...values);
      return statement(sql, params);
    },
    all: async () => {
      const result = answer(sql, params);
      if (result.throws) throw new Error('D1_ERROR: no such table');
      return { results: result.rows ?? [] };
    },
    first: async () => {
      const result = answer(sql, params);
      if (result.throws) throw new Error('D1_ERROR: no such table');
      return result.first ?? null;
    },
    run: async () => ({ success: true }),
  });

  const db = {
    prepared,
    batches,
    prepare(sql: string) {
      const created = statement(sql);
      prepared.push(created);
      return created;
    },
    async batch(statements: Statement[]) {
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };

  return db;
}

const asStore = (db: ReturnType<typeof makeDb>): D1DecisionStore =>
  new D1DecisionStore(db as unknown as D1Database);

const DECISION_ROW = {
  key: 'asset-1-gap-2',
  status: 'accepted',
  assignee_id: 'p-7',
  decided_by: 'u-1',
  decided_by_name: 'Priya Raman',
  decided_at: '2026-10-23T09:00:00.000Z',
  updated_by: 'u-1',
  updated_by_name: 'Priya Raman',
  updated_at: '2026-10-23T09:00:00.000Z',
};

const EVENT_ROW = {
  id: 4,
  key: 'asset-1-gap-2',
  action: 'dismissed',
  assignee_id: null,
  actor_id: 'u-1',
  actor_name: 'Priya Raman',
  created_at: '2026-10-23T09:00:00.000Z',
};

describe('decision storage', () => {
  it('lists the backlog newest first and maps rows to domain objects', async () => {
    const db = makeDb(() => ({ rows: [DECISION_ROW] }));
    const decisions = await asStore(db).listDecisions();

    expect(db.prepared[0].sql).toContain('FROM decisions ORDER BY updated_at DESC');
    expect(decisions).toEqual([
      {
        key: 'asset-1-gap-2',
        status: 'accepted',
        assigneeId: 'p-7',
        decidedBy: 'u-1',
        decidedByName: 'Priya Raman',
        decidedAt: '2026-10-23T09:00:00.000Z',
        updatedBy: 'u-1',
        updatedByName: 'Priya Raman',
        updatedAt: '2026-10-23T09:00:00.000Z',
      },
    ]);
  });

  it('finds one decision by key, binding the key as a parameter', async () => {
    const db = makeDb(() => ({ first: DECISION_ROW }));

    const found = await asStore(db).findDecision('asset-1-gap-2');

    expect(found?.key).toBe('asset-1-gap-2');
    expect(db.prepared[0].sql).toContain('WHERE key = ?');
    expect(db.prepared[0].params).toEqual(['asset-1-gap-2']);
  });

  it('writes the decision and its event in one batch', async () => {
    const db = makeDb((sql) => (sql.startsWith('SELECT') ? { first: DECISION_ROW } : {}));
    const store = asStore(db);

    await store.recordDecision({
      key: 'asset-1-gap-2',
      status: 'accepted',
      assigneeId: 'p-7',
      actor: { id: 'u-1', name: 'Priya Raman', email: 'priya@example.com' },
      at: '2026-10-23T09:00:00.000Z',
    });

    // One transaction, two statements: a decision without its event would make the
    // audit trail describe a state that never existed.
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(2);
    const [decision, event] = db.batches[0];

    expect(decision.sql).toContain('INSERT INTO decisions');
    expect(decision.sql).toContain('ON CONFLICT(key) DO UPDATE');
    // Re-assigning an accepted item keeps the original decision attribution.
    expect(decision.sql).toContain(
      'CASE WHEN decisions.status = excluded.status THEN decisions.decided_by',
    );
    expect(decision.params).toEqual([
      'asset-1-gap-2',
      'accepted',
      'p-7',
      'u-1',
      'Priya Raman',
      '2026-10-23T09:00:00.000Z',
      'u-1',
      'Priya Raman',
      '2026-10-23T09:00:00.000Z',
    ]);

    expect(event.sql).toContain('INSERT INTO decision_events');
    expect(event.params).toEqual([
      'asset-1-gap-2',
      'accepted',
      'accepted',
      'p-7',
      'u-1',
      'Priya Raman',
      'priya@example.com',
      '2026-10-23T09:00:00.000Z',
    ]);
  });

  it('returns the stored decision after writing it', async () => {
    const db = makeDb((sql) => (sql.startsWith('SELECT') ? { first: DECISION_ROW } : {}));

    const stored = await asStore(db).recordDecision({
      key: 'asset-1-gap-2',
      status: 'accepted',
      assigneeId: null,
      actor: { id: 'u-1', name: 'Priya Raman', email: null },
      at: '2026-10-23T09:00:00.000Z',
    });

    expect(stored).toMatchObject({ key: 'asset-1-gap-2', status: 'accepted' });
  });

  it('withdraws only the caller own decision and logs that it was cleared', async () => {
    const db = makeDb();

    await asStore(db).withdrawDecision({
      key: 'asset-1-gap-2',
      actor: { id: 'u-1', name: 'Priya Raman', email: null },
      at: '2026-10-23T10:00:00.000Z',
    });

    const [remove, event] = db.batches[0];
    expect(remove.sql).toBe('DELETE FROM decisions WHERE key = ? AND updated_by = ?');
    expect(remove.params).toEqual(['asset-1-gap-2', 'u-1']);
    expect(event.sql).toContain(`'cleared'`);
    expect(event.params).toEqual(['asset-1-gap-2', 'u-1', 'Priya Raman', null, '2026-10-23T10:00:00.000Z']);
  });

  it('pages history by cursor rather than offset', async () => {
    const db = makeDb(() => ({ rows: [EVENT_ROW] }));
    const store = asStore(db);

    await store.listEvents({ limit: 5, before: null });
    expect(db.prepared[0].sql).not.toContain('WHERE id <');
    expect(db.prepared[0].params).toEqual([5]);

    await store.listEvents({ limit: 5, before: 9 });
    expect(db.prepared[1].sql).toContain('WHERE id < ?');
    expect(db.prepared[1].params).toEqual([9, 5]);
  });

  it('maps an event row, keeping the actor and the action', async () => {
    const db = makeDb(() => ({ rows: [EVENT_ROW] }));

    const [event] = await asStore(db).listEvents({ limit: 5, before: null });

    expect(event).toEqual({
      id: 4,
      key: 'asset-1-gap-2',
      action: 'dismissed',
      assigneeId: null,
      actorId: 'u-1',
      actorName: 'Priya Raman',
      at: '2026-10-23T09:00:00.000Z',
    });
  });

  it('refuses to coerce a row the schema does not allow', async () => {
    const db = makeDb(() => ({ rows: [{ ...DECISION_ROW, status: 'approved' }] }));

    await expect(asStore(db).listDecisions()).rejects.toThrow('Unexpected decision status');
  });

  it('reports the database as unavailable instead of throwing from a probe', async () => {
    const healthy = makeDb(() => ({ first: { ok: 1 } }));
    expect(await asStore(healthy).ping()).toBe(true);

    const broken = makeDb(() => ({ throws: true }));
    await expect(asStore(broken).ping()).resolves.toBe(false);
  });
});
