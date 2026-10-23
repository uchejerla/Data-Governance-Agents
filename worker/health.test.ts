import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION } from './migrations';
import { APP_VERSION } from './version';
import type { Env } from './index';

// A probe has no session, so these two endpoints are the only API surface reachable
// signed out besides `/api/licence`. They must answer without a cookie and without
// describing the installation to anyone who asks.

const state = vi.hoisted(() => ({
  getUserCalls: 0,
}));

vi.mock('@freebuff/auth', () => ({
  createFreebuffAuth: () => ({
    getUser: async () => {
      state.getUserCalls += 1;
      return null;
    },
    wrap: (route: (request: Request, env: unknown) => Promise<Response>) => route,
  }),
  isSameOriginRequest: () => true,
}));

const APP_ORIGIN = 'https://desk.example';

function makeDb(options: { fail?: boolean } = {}) {
  const prepared: string[] = [];
  const statement = (sql: string) => {
    prepared.push(sql);
    return {
      bind: () => statement(sql),
      all: async () => {
        if (options.fail) throw new Error('D1_ERROR: binding DB is not configured at /var/secret');
        return { results: [] };
      },
      first: async () => {
        if (options.fail) throw new Error('D1_ERROR: binding DB is not configured at /var/secret');
        return { ok: 1 };
      },
      run: async () => ({ success: true }),
    };
  };
  return {
    prepared,
    prepare: statement,
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  };
}

function makeEnv(db: ReturnType<typeof makeDb>): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    DB: db,
    FREEBUFF_CLIENT_ID: 'test-client',
    APP_ORIGIN,
  } as unknown as Env;
}

async function callWorker(env: Env, path: string): Promise<Response> {
  vi.resetModules();
  const worker = (await import('./index')).default;
  return worker.fetch(new Request(`${APP_ORIGIN}${path}`), env);
}

beforeEach(() => {
  state.getUserCalls = 0;
});

describe('health endpoint', () => {
  it('answers without a session and reports the version and schema', async () => {
    const db = makeDb();

    const response = await callWorker(makeEnv(db), '/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      version: APP_VERSION,
      schema: SCHEMA_VERSION,
      database: 'ok',
    });
    // No cookie was needed, and the probe ran no migration.
    expect(state.getUserCalls).toBe(0);
    expect(db.prepared).toEqual(['SELECT 1 AS ok']);
  });

  it('reports a database that cannot answer as 503 rather than 500', async () => {
    const response = await callWorker(makeEnv(makeDb({ fail: true })), '/api/health');

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'degraded', database: 'unavailable' });
    // The binding name and the path from the driver's message stay server-side.
    const text = JSON.stringify(body);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('D1_ERROR');
  });
});

describe('version endpoint', () => {
  it('reports the build without touching the database', async () => {
    const db = makeDb();

    const response = await callWorker(makeEnv(db), '/api/version');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: APP_VERSION, schema: SCHEMA_VERSION });
    expect(db.prepared).toEqual([]);
    expect(state.getUserCalls).toBe(0);
  });

  it('only answers GET', async () => {
    const env = makeEnv(makeDb());
    vi.resetModules();
    const worker = (await import('./index')).default;

    const response = await worker.fetch(
      new Request(`${APP_ORIGIN}/api/version`, { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(404);
  });
});
