# Contributing

Thanks for helping. This is a small codebase with strong conventions; the fastest way to get a
change accepted is to keep it inside them.

## Setup

Requires Node **≥ 22.22** and npm. [`.nvmrc`](.nvmrc) pins it, so `nvm use` is the quickest way
there; `npm test` refuses to start below the floor rather than dying inside undici.

```bash
npm ci                                  # exact dependencies from the lockfile
cp .dev.vars.example .dev.vars          # public local config; fill in the dev client id
npm run build                           # the Worker serves dist/
npm run dev                             # UI on :3000, proxying /api and /auth to :8787
```

Run the Worker alongside it (`npm run dev:worker`) when you touch the API, auth or D1. For the
deployed shape — one origin serving both assets and the API — use
`npm run build && npm run dev:worker` and open `http://localhost:8787`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server, proxy to the Worker |
| `npm run dev:worker` | Worker + API + auth on `:8787` |
| `npm run build` | Typecheck, then bundle the app into `dist/` |
| `npm run build:worker` | Bundle the Worker into `worker-build/` (deploy input) |
| `npm run typecheck` | `tsc -b --noEmit` across app, config and Worker |
| `npm test` | Vitest: engines, API contract, CSV, jsdom flows |

## Ground rules

1. **Engines are pure.** Everything in `src/lib/` except `decisions.ts` reasons over a snapshot
   with no React, no network and no storage. If it needs I/O, it does not belong there.
2. **Screens render; they don't decide.** If the same number appears in two places, it comes from
   one exported function. Policy wording, severities, SLA days and plan ordering all live in an
   engine, never in JSX.
3. **Recommendation keys are a contract.** `recKey.*` values are stored in D1 and the audit log;
   changing one silently orphans history. Add a helper to `recKey`, never build a key by string
   concatenation in a component.
4. **Identity comes from the session.** Never accept a user id, email or tenant from a request
   body, query string or header. Writes must pass `isSameOriginRequest`.
5. **No secrets in the repository.** Public configuration goes in `.dev.vars` (git-ignored);
   deployed values are injected by the platform. A PR containing a key will be closed.
6. **The server stays boring.** Validate input, parameterise SQL, return `private, no-store` for
   anything personalised.

## Tests

Add tests with the change, not after it:

- **Engine behaviour** — a new scoring rule, severity branch or ordering needs a case in
  `src/lib/engines.test.ts`.
- **API contract** — a new route or payload change needs a case in `src/lib/decisions.test.ts`
  using the `stubApi` helper, asserting what the client sent *and* what it did with the reply.
- **Interaction that persists** — dismiss/accept/assign/expiry flows belong in
  `src/components/decisions.dom.test.tsx`, which drives the real components in jsdom.
- **Worker gates** — auth, origin and licence enforcement on a route belongs in
  `worker/routes.test.ts` (stub `@freebuff/auth` and the D1 binding); licence verification
  itself lives in `worker/licence.test.ts`.
- **CSV** — escaping and formula handling live in `src/lib/csv.test.ts`.

Before pushing: `npm run typecheck && npm test`. CI runs both on every push to `main` from a
clean `npm ci`, so a change that depends on a locally installed package will fail there.

## Commits

- Imperative subject, ≤ 72 characters: "Add expiry banner to the licence card", not "added".
- Body explains **why**, not what the diff already says.
- One logical change per commit; don't mix a refactor with a behaviour change.
- Reference the issue when there is one.

## Pull requests

Include:

1. **What changed** and **why** — the user-visible effect first.
2. **How it was verified** — the commands you ran and the manual steps, including the signed-out
   and signed-in paths if you touched the backlog.
3. **Screenshots** for any UI change (before/after helps).

Keep diffs focused. Add dependencies only when the standard library or an existing package cannot
do the job, and say why in the PR.

## Adding an assistant

See [README → Adding an assistant](README.md#adding-an-assistant). The short version: spec in
`agents/<name>.md`, pure engine in `src/lib/<name>.ts`, screen in
`src/components/assistants/`, tests for every decision branch, findings fed into `planner.ts` so
they reach the monthly plan.

## Security

Do not open a public issue for a vulnerability — follow [SECURITY.md](SECURITY.md).
