import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionMap } from '../types';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Minimal fetch stub: handlers answer by URL, and every call is recorded so the
// tests can assert what the client actually sent.
function stubApi(handler: (call: Call) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string'
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    };
    calls.push(call);
    const response = handler(call);
    if (!response) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    return response;
  });
  return calls;
}

const VIEWER = { id: 'u-1', name: 'Priya Raman' };

const REMOTE_ACCEPTED = {
  key: 'QR-01-remediate',
  status: 'accepted' as const,
  assigneeId: 'P-01',
  decidedBy: 'u-2',
  decidedByName: 'Daniel Okafor',
  decidedAt: '2026-10-20T09:00:00.000Z',
  updatedByName: 'Daniel Okafor',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

async function loadStore() {
  vi.resetModules();
  return import('./decisions');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared backlog client', () => {
  it('reports a read-only state when the session is missing', async () => {
    const calls = stubApi((call) =>
      call.url === '/api/me' ? json({ error: 'Sign in required' }, 401) : undefined,
    );
    const store = await loadStore();

    await store.refreshDecisions();

    expect(store.getDecisionState()).toMatchObject({
      status: 'signed-out',
      viewer: null,
      decisions: {},
    });
    expect(calls.map((c) => c.url)).toEqual(['/api/me']);
  });

  it('loads the shared backlog with who decided each item', async () => {
    stubApi((call) => {
      if (call.url === '/api/me') return json({ user: VIEWER });
      if (call.url === '/api/decisions') return json({ decisions: [REMOTE_ACCEPTED] });
      return undefined;
    });
    const store = await loadStore();

    await store.refreshDecisions();

    const state = store.getDecisionState();
    expect(state.status).toBe('ready');
    expect(state.viewer).toEqual(VIEWER);
    expect(state.decisions['QR-01-remediate']).toEqual({
      status: 'accepted',
      at: '2026-10-20T09:00:00.000Z',
      assigneeId: 'P-01',
      by: 'Daniel Okafor',
      byId: 'u-2',
    });
  });

  it('records an acceptance optimistically and settles on the server row', async () => {
    const calls = stubApi((call) => {
      if (call.url === '/api/me') return json({ user: VIEWER });
      if (call.url === '/api/decisions') return json({ decisions: [] });
      if (call.method === 'PUT') {
        return json({
          decision: {
            ...REMOTE_ACCEPTED,
            key: 'AST-1050-classification',
            status: 'accepted',
            assigneeId: null,
            decidedBy: VIEWER.id,
            decidedByName: VIEWER.name,
          },
        });
      }
      return undefined;
    });
    const store = await loadStore();
    await store.refreshDecisions();

    store.acceptDecision('AST-1050-classification');

    // Optimistic: the control shows the decision before the round trip finishes.
    expect(store.getDecisionState().decisions['AST-1050-classification']).toMatchObject({
      status: 'accepted',
      by: VIEWER.name,
    });
    expect(store.getDecisionState().pending).toEqual(['AST-1050-classification']);

    await vi.waitFor(() => expect(store.getDecisionState().pending).toEqual([]));

    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toBe('/api/decisions/AST-1050-classification');
    expect(put?.body).toEqual({ status: 'accepted' });
    expect(store.getDecisionState().decisions['AST-1050-classification'].status).toBe('accepted');
    expect(store.getDecisionState().error).toBeNull();
  });

  it('reverts an optimistic change and surfaces the server reason when a write is refused', async () => {
    stubApi((call) => {
      if (call.url === '/api/me') return json({ user: VIEWER });
      if (call.url === '/api/decisions') return json({ decisions: [REMOTE_ACCEPTED] });
      if (call.method === 'DELETE') {
        return json({ error: 'Only Daniel Okafor can withdraw this decision' }, 403);
      }
      return undefined;
    });
    const store = await loadStore();
    await store.refreshDecisions();

    store.clearDecision('QR-01-remediate');
    expect(store.getDecisionState().decisions['QR-01-remediate']).toBeUndefined();

    await vi.waitFor(() => expect(store.getDecisionState().pending).toEqual([]));

    expect(store.getDecisionState().decisions['QR-01-remediate']).toMatchObject({
      status: 'accepted',
      by: 'Daniel Okafor',
    });
    expect(store.getDecisionState().error).toContain('Only Daniel Okafor');
  });

  it('sends assignment as an acceptance carrying the assignee', async () => {
    const calls = stubApi((call) => {
      if (call.url === '/api/me') return json({ user: VIEWER });
      if (call.url === '/api/decisions') return json({ decisions: [] });
      if (call.method === 'PUT') {
        const body = call.body as { status: string; assigneeId?: string };
        return json({
          decision: {
            ...REMOTE_ACCEPTED,
            key: 'AR-2205-review',
            status: 'accepted',
            assigneeId: body.assigneeId ?? null,
            decidedBy: VIEWER.id,
            decidedByName: VIEWER.name,
          },
        });
      }
      return undefined;
    });
    const store = await loadStore();
    await store.refreshDecisions();

    store.assignDecision('AR-2205-review', 'P-02');
    await vi.waitFor(() => expect(store.getDecisionState().pending).toEqual([]));
    expect(calls.filter((c) => c.method === 'PUT')[0].body).toEqual({
      status: 'accepted',
      assigneeId: 'P-02',
    });
    expect(store.getDecisionState().decisions['AR-2205-review'].assigneeId).toBe('P-02');

    store.assignDecision('AR-2205-review', '');
    await vi.waitFor(() => expect(store.getDecisionState().pending).toEqual([]));
    expect(calls.filter((c) => c.method === 'PUT')[1].body).toEqual({ status: 'accepted' });
  });

  it('drops the session when a write comes back 401', async () => {
    stubApi((call) => {
      if (call.url === '/api/me') return json({ user: VIEWER });
      if (call.url === '/api/decisions') return json({ decisions: [] });
      if (call.method === 'PUT') return json({ error: 'Sign in required' }, 401);
      return undefined;
    });
    const store = await loadStore();
    await store.refreshDecisions();

    store.dismissDecision('QR-04-remediate');
    await vi.waitFor(() => expect(store.getDecisionState().status).toBe('signed-out'));

    expect(store.getDecisionState().decisions).toEqual({});
    expect(store.getDecisionState().viewer).toBeNull();
  });

  it('refuses to write while signed out', async () => {
    const calls = stubApi((call) =>
      call.url === '/api/me' ? json({ error: 'Sign in required' }, 401) : undefined,
    );
    const store = await loadStore();
    await store.refreshDecisions();

    store.acceptDecision('AST-1041-owner');

    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    expect(store.getDecisionState().decisions).toEqual({});
  });

  it('reads the audit trail with the actor behind each change', async () => {
    const calls = stubApi((call) =>
      call.url.startsWith('/api/decisions/history')
        ? json({
            events: [
              {
                id: 7,
                key: 'QR-01-remediate',
                action: 'cleared',
                assigneeId: null,
                actorId: 'u-2',
                actorName: 'Daniel Okafor',
                at: '2026-10-21T11:30:00.000Z',
              },
            ],
          })
        : undefined,
    );
    const store = await loadStore();

    const result = await store.fetchDecisionHistory(50);

    expect(calls.map((call) => call.url)).toEqual(['/api/decisions/history?limit=50']);
    expect(result).toEqual({
      ok: true,
      nextBefore: null,
      events: [
        {
          id: 7,
          key: 'QR-01-remediate',
          action: 'cleared',
          assigneeId: null,
          actorId: 'u-2',
          actorName: 'Daniel Okafor',
          at: '2026-10-21T11:30:00.000Z',
        },
      ],
    });
  });

  it('pages through the whole trail by event id for an export', async () => {
    const calls = stubApi((call) => {
      if (call.url === '/api/decisions/history?limit=500') {
        return json({
          events: [
            { id: 9, key: 'a', action: 'accepted', assigneeId: null, actorId: 'u-1', actorName: 'P', at: '2026-10-22T09:00:00.000Z' },
            { id: 8, key: 'b', action: 'dismissed', assigneeId: null, actorId: 'u-1', actorName: 'P', at: '2026-10-21T09:00:00.000Z' },
          ],
          nextBefore: 8,
        });
      }
      if (call.url === '/api/decisions/history?limit=500&before=8') {
        return json({
          events: [
            { id: 7, key: 'c', action: 'cleared', assigneeId: null, actorId: 'u-2', actorName: 'D', at: '2026-10-20T09:00:00.000Z' },
          ],
          nextBefore: null,
        });
      }
      return undefined;
    });
    const store = await loadStore();

    const result = await store.fetchAllDecisionHistory();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.complete).toBe(true);
    expect(result.events.map((event) => event.id)).toEqual([9, 8, 7]);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/decisions/history?limit=500',
      '/api/decisions/history?limit=500&before=8',
    ]);
  });

  it('stops after the page backstop instead of paging forever', async () => {
    stubApi((call) => {
      const before = new URL(call.url, 'http://local').searchParams.get('before');
      const id = before ? Number(before) : 10;
      return json({
        events: [
          { id, key: 'a', action: 'accepted', assigneeId: null, actorId: 'u-1', actorName: 'P', at: '2026-10-22T09:00:00.000Z' },
        ],
        nextBefore: id - 1,
      });
    });
    const store = await loadStore();

    const result = await store.fetchAllDecisionHistory(1, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.complete).toBe(false);
    expect(result.events.map((event) => event.id)).toEqual([10, 9, 8]);
  });

  it('reports a signed-out history read with its status', async () => {
    stubApi((call) =>
      call.url.startsWith('/api/decisions/history')
        ? json({ error: 'Sign in required' }, 401)
        : undefined,
    );
    const store = await loadStore();

    expect(await store.fetchDecisionHistory()).toEqual({
      ok: false,
      status: 401,
      error: 'Sign in required',
    });
  });

  it('maps remote rows and counts the shared map', async () => {
    const store = await loadStore();
    const map: DecisionMap = store.toDecisionMap([REMOTE_ACCEPTED]);
    expect(map['QR-01-remediate'].by).toBe('Daniel Okafor');

    expect(
      store.decisionCounts({
        a: { status: 'accepted', at: '2026-10-20T09:00:00.000Z', assigneeId: 'P-01' },
        b: { status: 'accepted', at: '2026-10-20T09:00:00.000Z' },
        c: { status: 'dismissed', at: '2026-10-20T09:00:00.000Z' },
      }),
    ).toEqual({ accepted: 2, dismissed: 1, assigned: 1 });
  });
});
