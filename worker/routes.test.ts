import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenceClaims } from './licence';
import type { Env } from './index';

// Route-level tests for the licence gates. The licence core is covered in
// `licence.test.ts`; what is exercised here is where the Worker applies it:
// expiry blocks writes before authentication, the audit-trail module blocks the
// history route for a signed-in steward, and neither gate leaks customer
// identity. Sessions are stubbed so the real ordering can be observed, and each
// test re-imports the Worker because it caches auth, schema and entitlement per
// isolate.

const state = vi.hoisted(() => ({
  user: null as { sub: string; name?: string; email?: string } | null,
  getUserCalls: 0,
}));

vi.mock('@freebuff/auth', () => ({
  createFreebuffAuth: () => ({
    getUser: async () => {
      state.getUserCalls += 1;
      return state.user;
    },
    // The real wrapper handles /auth/* and then calls the route. These tests only
    // cover /api/*, so the identity wrapper is the whole contract.
    wrap: (route: (request: Request, env: unknown) => Promise<Response>) =>
      (request: Request, env: unknown) => route(request, env),
  }),
  isSameOriginRequest: (request: Request, origin: string) =>
    request.headers.get('origin') === origin,
}));

const APP_ORIGIN = 'https://desk.example';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function segment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function makeKeyPair() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = (await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer;
  return { privateKey: pair.privateKey, publicKey: toBase64Url(new Uint8Array(spki)) };
}

async function sign(claims: LicenceClaims, privateKey: CryptoKey): Promise<string> {
  const header = segment({ alg: 'ES256', typ: 'licence+jws', kid: 'test-2026-01' });
  const payload = segment(claims);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: 1,
    lic: 'LIC-2026-0001',
    customer: 'Northwind Insurance',
    packages: ['professional'],
    seats: 15,
    workspaces: 3,
    issued_at: '2026-10-01T00:00:00.000Z',
    not_after: '2027-10-01T00:00:00.000Z',
    ...overrides,
  };
}

/** An expired token: professional modules kept, every write refused. */
async function expiredLicence() {
  const { privateKey, publicKey } = await makeKeyPair();
  const token = await sign(
    claims({ issued_at: '2026-01-01T00:00:00.000Z', not_after: '2026-06-01T00:00:00.000Z' }),
    privateKey,
  );
  return { LICENCE_KEY: token, LICENCE_PUBLIC_KEY: publicKey };
}

async function licenceFor(packages: LicenceClaims['packages']) {
  const { privateKey, publicKey } = await makeKeyPair();
  const token = await sign(claims({ packages }), privateKey);
  return { LICENCE_KEY: token, LICENCE_PUBLIC_KEY: publicKey };
}

/**
 * A D1 stand-in that records every prepared statement instead of running it.
 * `ensureSchema` runs before the API handler, so the gate must be observable as
 * "no INSERT/UPDATE/DELETE was ever prepared".
 */
function makeDb() {
  const prepared: string[] = [];

  const statement = (sql: string) => {
    prepared.push(sql);
    return {
      bind: () => statement(sql),
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => ({ results: [], success: true, meta: {} }),
      first: async () => null,
    };
  };

  return {
    prepared,
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
    prepare: statement,
  };
}

function makeEnv(db: ReturnType<typeof makeDb>, licence: Record<string, string> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    DB: db,
    FREEBUFF_CLIENT_ID: 'test-client',
    APP_ORIGIN,
    ...licence,
  } as unknown as Env;
}

async function callWorker(env: Env, request: Request): Promise<Response> {
  vi.resetModules();
  const worker = (await import('./index')).default;
  return worker.fetch(request, env);
}

function writeRequest(method: 'PUT' | 'DELETE', key = 'asset-1-gap-2') {
  return new Request(`${APP_ORIGIN}/api/decisions/${key}`, {
    method,
    headers: { Origin: APP_ORIGIN, 'content-type': 'application/json' },
    ...(method === 'PUT' ? { body: JSON.stringify({ status: 'accepted' }) } : {}),
  });
}

function historyRequest() {
  return new Request(`${APP_ORIGIN}/api/decisions/history?limit=5`);
}

beforeEach(() => {
  state.user = null;
  state.getUserCalls = 0;
});

describe('licence endpoints', () => {
  it('publishes the entitlement without the customer or licence id', async () => {
    const licence = await expiredLicence();
    const env = makeEnv(makeDb(), licence);

    const response = await callWorker(
      env,
      new Request(`${APP_ORIGIN}/api/licence`),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const summary = body.licence as Record<string, unknown>;
    expect(summary).toMatchObject({
      status: 'expired',
      source: 'licence',
      readOnly: true,
      packages: ['professional'],
      seats: 15,
    });
    // A lapsed licence keeps its modules: reads and export still work.
    expect(summary.modules).toContain('audit-export');
    expect(summary).not.toHaveProperty('customer');
    expect(summary).not.toHaveProperty('licenceId');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('read-only write gate', () => {
  it('refuses a write before authentication, even for a signed-in steward', async () => {
    state.user = { sub: 'u-1', name: 'Priya Raman', email: 'priya@example.com' };
    const db = makeDb();
    const env = makeEnv(db, await expiredLicence());

    const response = await callWorker(env, writeRequest('PUT'));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('read-only');
    // The session was never consulted, so no steward could have been authorised.
    expect(state.getUserCalls).toBe(0);
    expect(db.prepared.some((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toBe(false);
  });

  it('refuses a withdraw while read-only', async () => {
    const db = makeDb();
    const env = makeEnv(db, await expiredLicence());

    const response = await callWorker(env, writeRequest('DELETE'));

    expect(response.status).toBe(403);
    expect(db.prepared.some((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toBe(false);
  });

  it('lets a write reach authentication when the licence is valid', async () => {
    const db = makeDb();
    const env = makeEnv(db, await licenceFor(['professional']));

    const response = await callWorker(env, writeRequest('PUT'));

    // 401 rather than 403 proves the gate is about the licence, not the request.
    expect(response.status).toBe(401);
    expect(state.getUserCalls).toBe(1);
  });

  it('does not require a licence to refuse a cross-origin write', async () => {
    const env = makeEnv(makeDb());
    const request = new Request(`${APP_ORIGIN}/api/decisions/asset-1-gap-2`, {
      method: 'PUT',
      headers: { Origin: 'https://evil.example' },
      body: JSON.stringify({ status: 'accepted' }),
    });

    const response = await callWorker(env, request);

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toContain('Cross-origin');
    // Evaluation mode allows writes, so this 403 can only be the origin check.
    expect(state.getUserCalls).toBe(0);
  });
});

describe('audit-trail module gate', () => {
  it('refuses the history route when the package excludes the audit trail', async () => {
    state.user = { sub: 'u-1', name: 'Priya Raman' };
    const db = makeDb();
    const env = makeEnv(db, await licenceFor(['essential']));

    const response = await callWorker(env, historyRequest());

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toContain('audit trail');
    expect(db.prepared.some((sql) => sql.includes('FROM decision_events'))).toBe(false);
  });

  it('serves the history route when the package includes the audit trail', async () => {
    state.user = { sub: 'u-1', name: 'Priya Raman' };
    const db = makeDb();
    const env = makeEnv(db, await licenceFor(['professional']));

    const response = await callWorker(env, historyRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [], nextBefore: null });
    expect(db.prepared.some((sql) => sql.includes('FROM decision_events'))).toBe(true);
  });

  it('asks a signed-out caller to sign in before it mentions the licence', async () => {
    const env = makeEnv(makeDb(), await licenceFor(['essential']));

    const response = await callWorker(env, historyRequest());

    expect(response.status).toBe(401);
  });
});
