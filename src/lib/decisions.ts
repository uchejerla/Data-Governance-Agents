import { useSyncExternalStore } from 'react';
import type { Decision, DecisionMap, DecisionStatus, GovernanceSnapshot, Person } from '../types';

// Steward decisions live on the server so a whole domain team shares one
// backlog. This module is the client half: it loads the shared map, applies
// changes optimistically, and keeps other tabs and teammates in view with a
// focus refresh plus a slow poll. Every mutation is authorised server-side.

export const recKey = {
  catalogGap: (assetId: string, gapId: string) => `${assetId}-${gapId}`,
  glossaryIssue: (issueId: string) => `${issueId}-glossary`,
  rule: (ruleId: string) => `${ruleId}-remediate`,
  accessRequest: (requestId: string) => `${requestId}-review`,
  attestation: (personId: string, policyCode: string) => `${personId}-${policyCode}-attest`,
} as const;

export interface Viewer {
  id: string;
  name: string;
  email?: string | null;
  picture?: string | null;
}

export type SyncStatus = 'loading' | 'ready' | 'signed-out' | 'error';

export interface DecisionState {
  status: SyncStatus;
  decisions: DecisionMap;
  viewer: Viewer | null;
  error: string | null;
  /** Recommendation keys with a write in flight. */
  pending: string[];
  syncedAt: string | null;
}

export interface DecisionEvent {
  id: number;
  key: string;
  /** 'cleared' is a withdrawal: the decision was removed, not changed. */
  action: DecisionStatus | 'cleared';
  assigneeId: string | null;
  actorId: string;
  actorName: string | null;
  /** ISO timestamp from the server. */
  at: string;
}

export type HistoryResult =
  | { ok: true; events: DecisionEvent[]; nextBefore: number | null }
  | { ok: false; status: number; error: string };

export type FullHistoryResult =
  | { ok: true; events: DecisionEvent[]; complete: boolean }
  | { ok: false; status: number; error: string };

interface RemoteDecision {
  key: string;
  status: DecisionStatus;
  assigneeId: string | null;
  decidedBy: string;
  decidedByName: string | null;
  decidedAt: string;
  updatedByName: string | null;
  updatedAt: string;
}

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

const initialState: DecisionState = {
  status: 'loading',
  decisions: {},
  viewer: null,
  error: null,
  pending: [],
  syncedAt: null,
};

let state: DecisionState = initialState;
const listeners = new Set<() => void>();

function emit(patch: Partial<DecisionState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getDecisionState(): DecisionState {
  return state;
}

export function subscribeDecisions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDecisions(): DecisionState {
  return useSyncExternalStore(subscribeDecisions, getDecisionState, getDecisionState);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (response.ok) return { ok: true, data: (await response.json()) as T };
    let error = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) error = body.error;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    return { ok: false, status: response.status, error };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the steward service' };
  }
}

function fromRemote(record: RemoteDecision): Decision {
  return {
    status: record.status,
    at: record.decidedAt,
    ...(record.assigneeId ? { assigneeId: record.assigneeId } : {}),
    ...(record.decidedByName ? { by: record.decidedByName } : {}),
    byId: record.decidedBy,
  };
}

export function toDecisionMap(records: RemoteDecision[]): DecisionMap {
  const decisions: DecisionMap = {};
  for (const record of records) decisions[record.key] = fromRemote(record);
  return decisions;
}

// The append-only audit trail. Served separately from the backlog because it
// grows with every change, including decisions later overwritten or withdrawn.
export async function fetchDecisionHistory(limit = 200, before?: number): Promise<HistoryResult> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set('before', String(before));
  const result = await requestJson<{ events: DecisionEvent[]; nextBefore?: number | null }>(
    `/api/decisions/history?${params.toString()}`,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    events: result.data.events ?? [],
    nextBefore: result.data.nextBefore ?? null,
  };
}

// The export needs the whole trail, not the page in view. Walk the id cursor
// until the log ends, keeping each request small enough for D1 and the Worker.
// `maxPages` is a backstop so a runaway log cannot spin forever; `complete`
// tells the caller whether it stopped early.
export async function fetchAllDecisionHistory(
  pageSize = 500,
  maxPages = 40,
): Promise<FullHistoryResult> {
  const events: DecisionEvent[] = [];
  let before: number | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchDecisionHistory(pageSize, before);
    if (!result.ok) return result;
    events.push(...result.events);
    if (result.nextBefore === null || result.events.length === 0) {
      return { ok: true, events, complete: true };
    }
    before = result.nextBefore;
  }

  return { ok: true, events, complete: false };
}

export async function refreshDecisions(): Promise<void> {
  if (state.pending.length > 0) return;

  const me = await requestJson<{ user: Viewer }>('/api/me');
  if (!me.ok) {
    if (me.status === 401) {
      emit({ status: 'signed-out', viewer: null, decisions: {}, error: null, syncedAt: new Date().toISOString() });
      return;
    }
    emit({ status: 'error', viewer: null, error: me.error });
    return;
  }

  const list = await requestJson<{ decisions: RemoteDecision[] }>('/api/decisions');
  if (!list.ok) {
    if (list.status === 401) {
      emit({ status: 'signed-out', viewer: null, decisions: {} });
      return;
    }
    emit({ status: 'error', viewer: me.data.user, error: list.error });
    return;
  }

  emit({
    status: 'ready',
    viewer: me.data.user,
    decisions: toDecisionMap(list.data.decisions ?? []),
    error: null,
    syncedAt: new Date().toISOString(),
  });
}

let started = false;

export function startDecisionSync(): void {
  if (started) return;
  started = true;
  void refreshDecisions();
  if (typeof window === 'undefined') return;

  // Teammates' decisions arrive on focus and on a slow poll; a realtime channel
  // would be the next step, but a shared backlog does not need sub-second latency.
  window.addEventListener('focus', () => void refreshDecisions());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshDecisions();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshDecisions();
  }, 30_000);
}

function beginWrite(key: string, next: Decision | null): boolean {
  if (state.status !== 'ready' || state.pending.includes(key)) return false;
  const optimistic = { ...state.decisions };
  if (next) optimistic[key] = next;
  else delete optimistic[key];
  emit({ decisions: optimistic, pending: [...state.pending, key], error: null });
  return true;
}

function settleWrite(
  key: string,
  previous: Decision | undefined,
  result: { ok: true } | { ok: false; status: number; error: string },
  apply: (settled: DecisionMap) => void,
) {
  const pending = state.pending.filter((pendingKey) => pendingKey !== key);

  if (result.ok) {
    const settled = { ...state.decisions };
    apply(settled);
    emit({ decisions: settled, pending, syncedAt: new Date().toISOString() });
    return;
  }

  const reverted = { ...state.decisions };
  if (previous) reverted[key] = previous;
  else delete reverted[key];
  emit({
    decisions: reverted,
    pending,
    error: result.error,
    ...(result.status === 401 ? { status: 'signed-out' as SyncStatus, viewer: null } : {}),
  });
}

async function write(
  key: string,
  next: Decision | null,
  method: 'PUT' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<void> {
  const previous = state.decisions[key];
  if (!beginWrite(key, next)) return;
  const path = `/api/decisions/${encodeURIComponent(key)}`;

  if (method === 'PUT') {
    const result = await requestJson<{ decision: RemoteDecision | null }>(path, {
      method: 'PUT',
      body: JSON.stringify(body ?? {}),
    });
    settleWrite(key, previous, result, (settled) => {
      if (result.ok && result.data.decision) settled[key] = fromRemote(result.data.decision);
    });
    return;
  }

  const result = await requestJson<{ cleared: string }>(path, { method: 'DELETE' });
  settleWrite(key, previous, result, (settled) => {
    delete settled[key];
  });
}

function actor(): Pick<Decision, 'by' | 'byId'> {
  return state.viewer ? { by: state.viewer.name, byId: state.viewer.id } : {};
}

export function acceptDecision(key: string): void {
  const assigneeId = state.decisions[key]?.assigneeId;
  void write(
    key,
    { status: 'accepted', at: new Date().toISOString(), ...actor(), ...(assigneeId ? { assigneeId } : {}) },
    'PUT',
    { status: 'accepted', ...(assigneeId ? { assigneeId } : {}) },
  );
}

export function dismissDecision(key: string): void {
  void write(
    key,
    { status: 'dismissed', at: new Date().toISOString(), ...actor() },
    'PUT',
    { status: 'dismissed' },
  );
}

export function assignDecision(key: string, assigneeId: string): void {
  const existing = state.decisions[key];
  void write(
    key,
    {
      status: 'accepted',
      at: existing?.status === 'accepted' ? existing.at : new Date().toISOString(),
      ...actor(),
      ...(assigneeId ? { assigneeId } : {}),
    },
    'PUT',
    { status: 'accepted', ...(assigneeId ? { assigneeId } : {}) },
  );
}

export function clearDecision(key: string): void {
  void write(key, null, 'DELETE');
}

const ASSIGNABLE_ROLES = new Set<Person['role']>([
  'Data Steward',
  'Data Owner',
  'Compliance Officer',
  'Data Engineer',
]);

export function assignablePeople(
  snapshot: GovernanceSnapshot,
  domainId?: Person['domainId'],
  includeEngineers = false,
): Person[] {
  return snapshot.people.filter((person) => {
    if (!ASSIGNABLE_ROLES.has(person.role)) return false;
    if (person.role === 'Data Engineer' && !includeEngineers) return false;
    if (!domainId) return true;
    return person.domainId === domainId || person.domainId === 'platform' || person.domainId === 'risk';
  });
}

export function decisionCounts(decisions: DecisionMap, keys?: Iterable<string>) {
  const counts = { accepted: 0, dismissed: 0, assigned: 0 };
  const scope = keys ? new Set(keys) : null;
  for (const [key, decision] of Object.entries(decisions)) {
    if (scope && !scope.has(key)) continue;
    if (decision.status === 'accepted') counts.accepted += 1;
    else counts.dismissed += 1;
    if (decision.assigneeId) counts.assigned += 1;
  }
  return counts;
}

export function signInHref(returnTo = '/'): string {
  return `/auth/freebuff/signin?returnTo=${encodeURIComponent(returnTo)}`;
}
