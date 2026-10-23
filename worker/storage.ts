// The storage boundary for the shared decision backlog.
//
// Routes speak in these types; nothing outside this file builds SQL or knows a
// column name. That keeps the query set small enough to review on one screen, and
// confines the D1-specific parts — `batch()`, prepared statements, snake_case rows
// — to the code a different database has to replace (CP4).

export type DecisionStatus = 'accepted' | 'dismissed';
export type EventAction = DecisionStatus | 'cleared';

export interface DecisionActor {
  id: string;
  name: string;
  email: string | null;
}

export interface StoredDecision {
  key: string;
  status: DecisionStatus;
  assigneeId: string | null;
  decidedBy: string;
  decidedByName: string | null;
  decidedAt: string;
  updatedBy: string;
  updatedByName: string | null;
  updatedAt: string;
}

export interface StoredEvent {
  id: number;
  key: string;
  action: EventAction;
  assigneeId: string | null;
  actorId: string;
  actorName: string | null;
  at: string;
}

export interface RecordDecisionInput {
  key: string;
  status: DecisionStatus;
  assigneeId: string | null;
  actor: DecisionActor;
  /** ISO timestamp, passed in so a caller can keep the decision and its event in step. */
  at: string;
}

export interface WithdrawDecisionInput {
  key: string;
  actor: DecisionActor;
  at: string;
}

export interface ListEventsOptions {
  limit: number;
  /** Exclusive cursor: return events with an id below this, newest first. */
  before: number | null;
}

export interface DecisionStore {
  listDecisions(): Promise<StoredDecision[]>;
  findDecision(key: string): Promise<StoredDecision | null>;
  recordDecision(input: RecordDecisionInput): Promise<StoredDecision | null>;
  withdrawDecision(input: WithdrawDecisionInput): Promise<void>;
  listEvents(options: ListEventsOptions): Promise<StoredEvent[]>;
  /** True when the database answers; never throws, so a probe cannot 500. */
  ping(): Promise<boolean>;
}

// Rows as D1 returns them.
interface DecisionRow {
  key: string;
  status: string;
  assignee_id: string | null;
  decided_by: string;
  decided_by_name: string | null;
  decided_at: string;
  updated_by: string;
  updated_by_name: string | null;
  updated_at: string;
}

interface EventRow {
  id: number;
  key: string;
  action: string;
  assignee_id: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
}

const DECISION_COLUMNS = `key, status, assignee_id, decided_by, decided_by_name, decided_at,
  updated_by, updated_by_name, updated_at`;

const EVENT_COLUMNS = 'id, key, action, assignee_id, actor_id, actor_name, created_at';

// A database row is only as trustworthy as its CHECK constraint. These narrow the
// two enums instead of casting, and reject rather than coerce: a hand-edited row
// must surface as a failed request, not as a steward's decision quietly restated.
const toStatus = (value: string): DecisionStatus => {
  if (value !== 'accepted' && value !== 'dismissed') {
    throw new Error('Unexpected decision status in storage');
  }
  return value;
};

const toAction = (value: string): EventAction => {
  if (value !== 'accepted' && value !== 'dismissed' && value !== 'cleared') {
    throw new Error('Unexpected event action in storage');
  }
  return value;
};

function toDecision(row: DecisionRow): StoredDecision {
  return {
    key: row.key,
    status: toStatus(row.status),
    assigneeId: row.assignee_id ?? null,
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name ?? null,
    decidedAt: row.decided_at,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    key: row.key,
    action: toAction(row.action),
    assigneeId: row.assignee_id ?? null,
    actorId: row.actor_id,
    actorName: row.actor_name ?? null,
    at: row.created_at,
  };
}

export class D1DecisionStore implements DecisionStore {
  constructor(private readonly db: D1Database) {}

  async listDecisions(): Promise<StoredDecision[]> {
    const { results } = await this.db
      .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions ORDER BY updated_at DESC LIMIT 500`)
      .all<DecisionRow>();
    return (results ?? []).map(toDecision);
  }

  async findDecision(key: string): Promise<StoredDecision | null> {
    const row = await this.db
      .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions WHERE key = ?`)
      .bind(key)
      .first<DecisionRow>();
    return row ? toDecision(row) : null;
  }

  /**
   * Write the current decision and append the event that records it, in one batch.
   * A decision without its event — or an event with no decision — would make the
   * audit trail describe a state that never existed.
   */
  async recordDecision(input: RecordDecisionInput): Promise<StoredDecision | null> {
    const { key, status, assigneeId, actor, at } = input;

    // A status change re-stamps the deciding actor; re-accepting or re-assigning an
    // already-accepted item keeps the original decision attribution.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO decisions (
            key, status, assignee_id, decided_by, decided_by_name, decided_at,
            updated_by, updated_by_name, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            status = excluded.status,
            assignee_id = excluded.assignee_id,
            updated_by = excluded.updated_by,
            updated_by_name = excluded.updated_by_name,
            updated_at = excluded.updated_at,
            decided_by = CASE WHEN decisions.status = excluded.status THEN decisions.decided_by ELSE excluded.decided_by END,
            decided_by_name = CASE WHEN decisions.status = excluded.status THEN decisions.decided_by_name ELSE excluded.decided_by_name END,
            decided_at = CASE WHEN decisions.status = excluded.status THEN decisions.decided_at ELSE excluded.decided_at END`,
        )
        .bind(key, status, assigneeId, actor.id, actor.name, at, actor.id, actor.name, at),
      this.db
        .prepare(
          `INSERT INTO decision_events (key, action, status, assignee_id, actor_id, actor_name, actor_email, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(key, status, status, assigneeId, actor.id, actor.name, actor.email, at),
    ]);

    return this.findDecision(key);
  }

  /** Withdraw only the caller's own decision, and log that it was cleared. */
  async withdrawDecision(input: WithdrawDecisionInput): Promise<void> {
    const { key, actor, at } = input;
    await this.db.batch([
      this.db.prepare('DELETE FROM decisions WHERE key = ? AND updated_by = ?').bind(key, actor.id),
      this.db
        .prepare(
          `INSERT INTO decision_events (key, action, status, assignee_id, actor_id, actor_name, actor_email, created_at)
           VALUES (?, 'cleared', NULL, NULL, ?, ?, ?, ?)`,
        )
        .bind(key, actor.id, actor.name, actor.email, at),
    ]);
  }

  /**
   * The append-only log, newest first. Pages descend by event id (`before`), so a
   * cursor rather than an offset keeps paging stable while other stewards are
   * writing: a new event at the top can never shift a page boundary.
   */
  async listEvents({ limit, before }: ListEventsOptions): Promise<StoredEvent[]> {
    const statement =
      before === null
        ? this.db.prepare(`SELECT ${EVENT_COLUMNS} FROM decision_events ORDER BY id DESC LIMIT ?`).bind(limit)
        : this.db
            .prepare(`SELECT ${EVENT_COLUMNS} FROM decision_events WHERE id < ? ORDER BY id DESC LIMIT ?`)
            .bind(before, limit);
    const { results } = await statement.all<EventRow>();
    return (results ?? []).map(toEvent);
  }

  async ping(): Promise<boolean> {
    try {
      const row = await this.db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      return row?.ok === 1;
    } catch {
      return false;
    }
  }
}
