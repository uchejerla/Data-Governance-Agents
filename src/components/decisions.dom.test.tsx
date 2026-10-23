// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the real components in a DOM against an in-memory stand-in for the
// Worker API, then reloads the module graph: the closest simulation of a browser
// refresh available here. The real routes are exercised separately in workerd.

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  key: string;
  status: 'accepted' | 'dismissed';
  assigneeId: string | null;
  decidedBy: string;
  decidedByName: string;
  decidedAt: string;
  updatedByName: string;
  updatedAt: string;
}

interface LoggedEvent {
  id: number;
  key: string;
  action: 'accepted' | 'dismissed' | 'cleared';
  assigneeId: string | null;
  actorId: string;
  actorName: string;
  at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ALL_MODULE_IDS = [
  'catalog-curation',
  'quality-triage',
  'policy-qa',
  'access-review',
  'stewardship-planner',
  'audit-export',
  'sso',
];

const ACTIVE_LICENCE = {
  status: 'active',
  source: 'licence',
  readOnly: false,
  packages: ['enterprise'],
  modules: ALL_MODULE_IDS,
  seats: 50,
  workspaces: 25,
  notAfter: '2027-10-22T23:59:59.000Z',
  daysRemaining: 364,
  reason: null,
};

function installApi(
  licenceOverrides: Record<string, unknown> = {},
  viewer = { id: 'u-1', name: 'Priya Raman' },
) {
  const licence = { ...ACTIVE_LICENCE, ...licenceOverrides };
  const rows = new Map<string, Row>();
  const events: LoggedEvent[] = [];
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  let signedIn = true;

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url, ...(body ? { body } : {}) });

    if (url === '/api/licence') {
      return json({ licence });
    }
    if (url === '/api/me') {
      return signedIn ? json({ user: viewer }) : json({ error: 'Sign in required' }, 401);
    }
    if (url === '/api/decisions' && method === 'GET') {
      return json({ decisions: [...rows.values()] });
    }
    if (url.startsWith('/api/decisions/history') && method === 'GET') {
      const params = new URL(url, 'http://local').searchParams;
      const limit = Number(params.get('limit') ?? 200);
      const beforeRaw = params.get('before');
      const before = beforeRaw === null ? null : Number(beforeRaw);
      const page = [...events]
        .reverse()
        .filter((event) => before === null || event.id < before)
        .slice(0, limit);
      return json({
        events: page,
        nextBefore: page.length === limit ? page[page.length - 1].id : null,
      });
    }
    const match = /^\/api\/decisions\/(.+)$/.exec(url);
    if (match) {
      const key = decodeURIComponent(match[1]);
      if (method === 'PUT') {
        const now = new Date().toISOString();
        const row: Row = {
          key,
          status: body?.status === 'dismissed' ? 'dismissed' : 'accepted',
          assigneeId: typeof body?.assigneeId === 'string' ? body.assigneeId : null,
          decidedBy: viewer.id,
          decidedByName: viewer.name,
          decidedAt: now,
          updatedByName: viewer.name,
          updatedAt: now,
        };
        rows.set(key, row);
        events.push({
          id: events.length + 1,
          key,
          action: row.status,
          assigneeId: row.assigneeId,
          actorId: viewer.id,
          actorName: viewer.name,
          at: now,
        });
        return json({ decision: row });
      }
      if (method === 'DELETE') {
        rows.delete(key);
        events.push({
          id: events.length + 1,
          key,
          action: 'cleared',
          assigneeId: null,
          actorId: viewer.id,
          actorName: viewer.name,
          at: new Date().toISOString(),
        });
        return json({ cleared: key });
      }
    }
    return json({ error: 'Not found' }, 404);
  });

  return { rows, events, calls, signOut: () => { signedIn = false; } };
}

function buttonIn(element: Element, label: string): HTMLButtonElement {
  const match = Array.from(element.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No "${label}" button in element`);
  return match as HTMLButtonElement;
}

function planItems(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.plan-item'));
}

function planTitles(container: HTMLElement) {
  return planItems(container).map((item) =>
    (item.querySelector('.plan-item-title')?.textContent ?? '').trim(),
  );
}

function planItem(container: HTMLElement, title: string) {
  const match = planItems(container).find(
    (item) => (item.querySelector('.plan-item-title')?.textContent ?? '').trim() === title,
  );
  if (!match) throw new Error(`No plan item titled "${title}"`);
  return match;
}

async function renderPlanner(container: HTMLElement) {
  const [{ act }, { createRoot }, store, licenceStore, { PlannerPage }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../lib/decisions'),
    import('../lib/licence'),
    import('./assistants/Planner'),
  ]);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PlannerPage domainId="customer" onNavigate={() => {}} />);
  });
  await act(async () => {
    await licenceStore.refreshLicence();
  });
  await act(async () => {
    await store.refreshDecisions();
  });
  return { root, act };
}

async function renderHistory(container: HTMLElement) {
  const [{ act }, { createRoot }, store, { HistoryPage }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../lib/decisions'),
    import('./History'),
  ]);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HistoryPage />);
  });
  await act(async () => {
    await store.refreshDecisions();
  });
  // The history request is fired from an effect, so let it settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  return { root, act };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('shared decision backlog in the browser', () => {
  // Drives a full reload — unmount, reset the module graph, re-render — so it needs
  // more than the default 5s on a loaded machine. The assertions are unchanged.
  it('keeps dismiss and accept/assign after a reload, attributed to the steward', async () => {
    const api = installApi();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, act } = await renderPlanner(container);

    const titles = planTitles(container);
    expect(titles.length).toBeGreaterThan(2);
    const dismissTitle = titles[0];
    const acceptTitle = titles[1];

    await act(async () => {
      buttonIn(planItem(container, dismissTitle), 'Dismiss').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(planTitles(container)).not.toContain(dismissTitle);
    expect(container.textContent).toContain('Dismissed from the plan');

    const acceptTarget = planItem(container, acceptTitle);
    await act(async () => {
      buttonIn(acceptTarget, 'Accept').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    const select = acceptTarget.querySelector('select.decision-assign') as HTMLSelectElement;
    const assignee = Array.from(select.options).find((option) => option.value)!;
    const assigneeName = (assignee.textContent ?? '').split(' · ')[0];
    await act(async () => {
      select.value = assignee.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(acceptTarget.querySelector('.decision-chip')?.textContent).toContain(
      `Accepted · ${assigneeName}`,
    );
    expect(api.rows.size).toBe(2);
    expect([...api.rows.values()].map((row) => row.decidedByName)).toEqual([
      'Priya Raman',
      'Priya Raman',
    ]);

    // Reload: tear down the tree and the whole module graph, then refetch.
    await act(async () => {
      root.unmount();
    });
    vi.resetModules();

    const reloaded = document.createElement('div');
    document.body.appendChild(reloaded);
    const second = await renderPlanner(reloaded);

    expect(planTitles(reloaded)).not.toContain(dismissTitle);
    expect(planTitles(reloaded)).toContain(acceptTitle);
    expect(planItem(reloaded, acceptTitle).querySelector('.decision-chip')?.textContent).toContain(
      assigneeName,
    );

    const dismissedCard = Array.from(reloaded.querySelectorAll('.card')).find((card) =>
      card.textContent?.includes('Dismissed from the plan'),
    );
    expect(dismissedCard?.textContent).toContain(dismissTitle);

    const markdown = Array.from(reloaded.querySelectorAll('pre'))
      .map((pre) => pre.textContent ?? '')
      .find((text) => text.includes('# Stewardship plan'));
    expect(markdown).toContain(`- [x] **${acceptTitle}**`);
    expect(markdown).toContain('## Dismissed — excluded from this plan');
    expect(markdown).not.toContain(`**${dismissTitle}**`);

    await act(async () => {
      second.root.unmount();
    });
  }, 20_000);

  it('shows the backlog read-only, with a sign-in link, when there is no session', async () => {
    const api = installApi();
    api.signOut();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, act } = await renderPlanner(container);

    const bar = container.querySelector('.decision-bar');
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain('Sign in to record a decision');

    const signIn = bar!.querySelector('a[href^="/auth/freebuff/signin"]') as HTMLAnchorElement;
    expect(signIn).toBeTruthy();
    expect(signIn.textContent).toContain('Sign in with Freebuff');

    expect(Array.from(bar!.querySelectorAll('button')).map((b) => b.textContent?.trim())).not.toContain(
      'Accept',
    );
    expect(api.rows.size).toBe(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('records who changed a decision and when, and filters by steward', async () => {
    const api = installApi();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, act } = await renderPlanner(container);

    const titles = planTitles(container);
    const dismissTitle = titles[0];
    const acceptTitle = titles[1];

    await act(async () => {
      buttonIn(planItem(container, dismissTitle), 'Dismiss').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await act(async () => {
      buttonIn(planItem(container, acceptTitle), 'Accept').click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    await act(async () => {
      root.unmount();
    });
    vi.resetModules();

    const history = document.createElement('div');
    document.body.appendChild(history);
    const page = await renderHistory(history);

    // One entry per change, both attributed to the signed-in steward.
    expect(history.querySelectorAll('.history-event')).toHaveLength(2);
    expect(history.textContent).toContain('Priya Raman');
    expect(history.textContent).toContain(acceptTitle);
    expect(history.textContent).toContain(dismissTitle);
    expect(history.textContent).toContain('Accepted');
    expect(history.textContent).toContain('Dismissed');
    expect(api.events).toHaveLength(2);

    const actor = history.querySelector('#history-actor') as HTMLSelectElement;
    expect(Array.from(actor.options).map((option) => option.textContent)).toContain(
      'Priya Raman · 2',
    );

    // Filtering by activity narrows the trail without losing the actor attribution.
    const action = history.querySelector('#history-action') as HTMLSelectElement;
    await act(async () => {
      action.value = 'dismissed';
      action.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(history.querySelectorAll('.history-event')).toHaveLength(1);
    expect(history.textContent).toContain(dismissTitle);
    expect(history.textContent).not.toContain(acceptTitle);

    // Export follows what is on screen: one entry, the dismissal.
    const blobs: Blob[] = [];
    const createObjectUrl = URL.createObjectURL;
    const revokeObjectUrl = URL.revokeObjectURL;
    const anchorClick = HTMLAnchorElement.prototype.click;
    let filename = '';
    URL.createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      filename = this.download;
    };
    try {
      await act(async () => {
        buttonIn(history, 'Export CSV').click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    } finally {
      URL.createObjectURL = createObjectUrl;
      URL.revokeObjectURL = revokeObjectUrl;
      HTMLAnchorElement.prototype.click = anchorClick;
    }

    expect(filename).toMatch(/^steward-decisions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(blobs).toHaveLength(1);
    const csv = (await blobs[0].text()).replace(/^\uFEFF/, '');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Item key,Item,Detail,Source,Domain,Activity,Steward,Assignee,Recorded at (UTC)',
    );
    expect(lines.filter(Boolean)).toHaveLength(2);
    expect(csv).toContain(dismissTitle);
    expect(csv).toContain('Dismissed');
    expect(csv).toContain('Priya Raman');
    expect(csv).not.toContain(acceptTitle);

    await act(async () => {
      page.root.unmount();
    });
  });

  it('exports the whole trail even when the page shows only the newest changes', async () => {
    const api = installApi();
    for (let id = 1; id <= 205; id += 1) {
      api.events.push({
        id,
        key: 'QR-01-remediate',
        action: 'accepted',
        assigneeId: null,
        actorId: 'u-2',
        actorName: 'Daniel Okafor',
        at: new Date(Date.UTC(2026, 9, 1, 9, id % 60)).toISOString(),
      });
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const page = await renderHistory(container);

    // The page itself is capped at one request's worth of changes.
    expect(container.querySelectorAll('.history-event')).toHaveLength(200);
    expect(container.textContent).toContain('most recent 200 changes');

    const blobs: Blob[] = [];
    const createObjectUrl = URL.createObjectURL;
    const revokeObjectUrl = URL.revokeObjectURL;
    const anchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try {
      await page.act(async () => {
        buttonIn(container, 'Export CSV').click();
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
    } finally {
      URL.createObjectURL = createObjectUrl;
      URL.revokeObjectURL = revokeObjectUrl;
      HTMLAnchorElement.prototype.click = anchorClick;
    }

    const csv = (await blobs[0].text()).replace(/^\uFEFF/, '');
    // Header plus all 205 changes, including the five older than the page.
    expect(csv.trimEnd().split('\r\n')).toHaveLength(206);
    expect(csv).toContain('Daniel Okafor');
    expect(container.textContent).toContain('Exported the full trail: 205 entries.');

    await page.act(async () => {
      page.root.unmount();
    });
  });

  it('goes read-only and withdraws the planner when the licence has lapsed', async () => {
    const api = installApi({
      status: 'expired',
      readOnly: true,
      daysRemaining: 0,
      packages: ['professional'],
      modules: ['catalog-curation', 'policy-qa', 'quality-triage', 'access-review', 'audit-export'],
      reason:
        'Licence expired on 20 Oct 2026. The workspace is read-only: decisions are refused until it is renewed, while reading and exporting stay available.',
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const { root, act } = await renderPlanner(container);

    const bar = container.querySelector('.decision-bar');
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain('Read-only');
    expect(bar!.textContent).toContain('licence expired');
    const buttons = Array.from(bar!.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(buttons).not.toContain('Accept');
    expect(buttons).not.toContain('Dismiss');
    // Nothing was sent: the UI mirrors the server's refusal instead of trying.
    expect(api.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });

    // The shell states why, and a module outside the licence disappears from the nav.
    const shellHost = document.createElement('div');
    document.body.appendChild(shellHost);
    const [{ createRoot }, { Shell }] = await Promise.all([
      import('react-dom/client'),
      import('./Shell'),
    ]);
    const shellRoot = createRoot(shellHost);
    await act(async () => {
      shellRoot.render(
        <Shell
          view="overview"
          onNavigate={() => {}}
          domainId="customer"
          onDomainChange={() => {}}
        >
          <div />
        </Shell>,
      );
    });

    expect(shellHost.querySelector('.licence-banner-blocked')?.textContent).toContain(
      'expired on 20 Oct 2026',
    );
    const navLabels = Array.from(shellHost.querySelectorAll('.nav-item')).map(
      (item) => item.textContent ?? '',
    );
    expect(navLabels.some((label) => label.includes('Stewardship Plan'))).toBe(false);
    expect(navLabels.some((label) => label.includes('Decision history'))).toBe(true);

    await act(async () => {
      shellRoot.unmount();
    });
  });
});
