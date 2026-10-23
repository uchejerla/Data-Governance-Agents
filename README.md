# Data Governance Agents

Agent assistants that help data stewards support and be productive at delivering value in data governance and stewardship.

Five focused assistants, each a form → structured, defensible output. The reasoning is deterministic over a seeded governance snapshot — no model, no API key, no cost — while the one piece that genuinely needs a server, the shared steward decision backlog, runs on a Cloudflare Worker with D1 and Sign in with Freebuff. The `agents/` folder holds the prompt-level specification behind each one, so the same logic can be pointed at a real catalog, quality tool or policy library, or handed to an LLM later.

## The assistants

| Assistant | Answers | Output |
| --- | --- | --- |
| **Catalog Curation** | Is this asset, glossary term or documentation actually governed? | Readiness score, gaps by severity, glossary collisions, a paste-ready curation note |
| **Data Quality Triage** | A rule failed — how bad is this, why, and who needs to know? | Severity, SLA and due date, ranked likely causes, owner, stakeholder update |
| **Policy & Control Q&A** | Can we do this, and which clause says so? | Coverage call, verbatim cited clauses, required controls, escalation route |
| **Access Review** | Should this request be approved? | Approve / conditions / escalate / deny, reasons per clause, expiry, reviewer note |
| **Stewardship Planner** | What should I do this month? | Now / Next / Later backlog with impact, effort, owner, dates and capacity check |

Catalog Curation covers glossary terms, asset metadata, documentation coverage and ownership in one place — it replaced the earlier standalone glossary curator, because in practice those are the same weekly job.

## Run it

```bash
npm install
npm run build          # static app into dist/
npm run dev:worker     # Worker + API + auth on http://localhost:8787 (serves dist/)
npm run dev            # UI on http://localhost:3000, proxying /api and /auth to the Worker
npm test               # engine, store and DOM tests
npm run typecheck
```

No secrets anywhere. `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` are public configuration: locally they live in `.dev.vars` (git-ignored, development client), and the platform injects the deployed ones. There is no client secret and no session secret to manage.

## The shared decision backlog

Every recommendation — a curation gap, a glossary finding, a triaged rule, an access review, a plan item — carries a stable key and one control surface:

- **Accept** records that the finding is agreed and being taken on.
- **Assign** accepts it and names the person who owns it.
- **Dismiss** records a considered no: the item drops out of the stewardship plan, its hours, and the exported Markdown, and moves to a *Dismissed* list where it can be restored.
- **Undo** withdraws the decision, if you were the steward who recorded it.

Decisions belong to the workspace, not the browser. Any signed-in steward sees the same backlog, and each row carries who decided it and when. Signed out, every screen still works — the assistants, the plan and the notes — but the controls show a sign-in prompt and nothing is written.

**Server.** [`worker/index.ts`](worker/index.ts) wraps a fetch handler with `@freebuff/auth` (OpenID Connect, PKCE, server-side session cookie) and serves:

| Route | Behaviour |
| --- | --- |
| `GET /api/me` | The signed-in steward, or 401 |
| `GET /api/decisions` | The shared map, or 401 |
| `GET /api/decisions/history?limit=200&before=<id>` | The append-only event log, newest first, paged by event id, or 401 |
| `PUT /api/decisions/:key` | Accept / dismiss / assign; same-origin only, validated, then upserted |
| `DELETE /api/decisions/:key` | Withdraw your own decision (403 if someone else recorded it) |

Identity comes only from the verified session — no user id or email is ever accepted from the request body. Mutations must pass `isSameOriginRequest`, and personalised responses are `private, no-store`.

**Database.** D1 holds `decisions` (one row per recommendation: status, assignee, decided-by, decided-at, updated-by, updated-at) and an append-only `decision_events` log, so overwriting a decision never erases who decided what, when. The schema is created by the Worker on first use (`CREATE TABLE IF NOT EXISTS`), because a Worker gets a binding, not a SQL console.

**Client.** [`src/lib/decisions.ts`](src/lib/decisions.ts) applies changes optimistically, settles on the server's row, reverts and shows the server's reason if a write is refused, refetches on window focus and every 30 seconds, and drops to read-only on a 401. That poll is deliberate: a shared backlog does not need sub-second latency, and a realtime channel is a separate decision.

**History.** *Decision history* (in the workspace nav) reads `decision_events` and groups it by recommendation, so an item that was accepted, re-assigned and later withdrawn still shows every step, the steward behind it and the timestamp — including decisions that no longer exist in the backlog table. Keys are resolved back to the wording stewards see by [`src/lib/history.ts`](src/lib/history.ts), which builds its index from the same engine helpers the assistants and planner use. The view filters by steward and by activity, and is only readable with a session because it carries identities. **Export CSV** pages through the whole trail — not just the 200 changes the screen loaded — keeping the filters in view, and writes an RFC 4180 table (item, detail, source, domain, activity, steward, assignee, UTC timestamp) ready to attach to a governance review pack; cells that a spreadsheet would evaluate as a formula are neutralised.

## How it is put together

```
agents/                 Markdown spec per assistant: role, inputs, rules, guardrails, prompt template
src/types.ts            Domain model: domains, assets, terms, rules, policy clauses, requests, people
src/data/seed.ts        Seeded snapshot of a mid-sized insurer's governance estate (dates relative to load)
worker/                 The only server: auth-wrapped fetch handler, decisions API, D1 schema
  index.ts
wrangler.jsonc          Local Worker config: assets, D1 binding, worker-first routing
deploy.json             Sites deployment manifest (prebuilt Worker bundle + dist/)
src/lib/                The engines — pure functions, no React, no I/O
  decisions.ts          Client half of the backlog: keys, API calls, optimistic store, hook
  history.ts            Key-to-recommendation index and audit-log grouping for the history view
  csv.ts                CSV escaping, formula hardening and the browser download
  catalog.ts            Asset review, glossary issue detection, curation note composition
  quality.ts            Rule triage, cause ranking, severity and SLA derivation
  policy.ts             Clause retrieval, coverage assessment, grounded answer composition
  access.ts             Access decision rules and reviewer note
  planner.ts            Cross-source backlog harvest, prioritisation, capacity check
  util.ts               Dates, business days, pluralisation, formatting
src/components/         App shell, design system primitives, one screen per assistant
  Decision.tsx          Accept / dismiss / assign controls and status chips
  History.tsx           Decision history: the audit trail, grouped per recommendation
```

The separation matters: **every recommendation is produced by a testable function**, and the UI only renders it. `planner.ts` imports the other four engines, so the monthly plan can never disagree with what the individual assistants report.

The snapshot is a realistic fictional insurer — Customer & Growth, Claims & Fraud, Finance & Risk and People domains, with tiered assets, a policy library, a live rule set, pending access requests and outstanding attestations. All dates are generated relative to load time so the demo never looks stale. Replace `src/data/seed.ts` with a real export and the assistant logic is unchanged.

## Design principles

- **Grounded, never generic.** Answers quote clause IDs (`ACC-2.5`, `QLT-3.2`, `CLS-5.1`), not adjectives. Policy Q&A says "not covered" instead of inventing a rule.
- **The human decides.** The hub recommends a level, a severity or a priority. It never grants access, approves a request or reclassifies data.
- **Every output is paste-ready.** Reviewer notes, stakeholder updates and backlog markdown are written to be dropped into a ticket, an email or a wiki — one click to copy.
- **Dense, not decorative.** The layout favours numbers, chips and checklists over prose so a steward can scan it between meetings.

## Adding an assistant

1. Write `agents/<name>.md` — role, inputs, decision rules with clause references, output contract, guardrails, prompt template.
2. Add the engine in `src/lib/<name>.ts` as a pure function over the snapshot.
3. Add a screen in `src/components/assistants/`, register it in `src/App.tsx` and the nav in `src/components/Shell.tsx`.
4. Add tests in `src/lib/engines.test.ts` covering each decision branch.
5. Feed its findings into `planner.ts` so they appear in the monthly backlog.

## Deploying

```bash
npm run build && npm run build:worker   # dist/ and worker-build/index.js
```

Then deploy `deploy.json` (compatibility date `2026-10-19`, ES module worker, `dist/` assets) to the platform environment. The deployed environment injects `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN`; the D1 binding `DB` is attached per environment. Nothing else is required, and no build step runs on the host.

Every environment gets its own database and its own registered callback (`<origin>/auth/freebuff/callback`). A deployment receipt is not proof the app works: check the HTML and asset content types, a 401 on the API when signed out, a 403 for a foreign `Origin`, then complete a real sign-in on the deployed origin.

## Next steps

- Corporate SSO: the same Worker design against Entra, Okta or Google Workspace instead of Freebuff identities.
- Realtime updates (Durable Object or a ticket-based channel) so a teammate's decision lands without the 30-second poll.
- Per-domain visibility if a single workspace-wide backlog stops being right — the schema already carries the actor, so scoping is a policy decision, not a migration.
- Connectors: Collibra / Purview / Alation for catalog, Great Expectations or dbt tests for quality, and an object store for the policy library.
- An optional LLM pass to rewrite composed notes in house voice — the citations and decisions stay deterministic.
