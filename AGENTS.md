# Rules for agents working in this repository

Read `CONSTRAINTS.md` before writing code. Do not weaken it to make a change pass.

## Non-negotiables

1. **Never lower the bar.** No new `@ts-ignore`/`eslint-disable`/`istanbul ignore`, no skipped or
   deleted tests, no removed assertions, no `continue-on-error`, no check piped to `|| true`, no
   threshold moved down. `npm run check:constraints` blocks these; do not edit the guard to pass it.
2. **Never push to `main`.** Work on a branch. `main` is protected and needs review.
3. **Never commit a secret.** Public configuration goes in `.dev.vars` (git-ignored); platform
   values are injected on deploy. If a credential is ever committed, rotate it first, then purge.
4. **Ask before** adding a dependency, changing auth/session logic, changing CORS, adding rate
   limiting, or storing a new category of personal data.
5. **One checkpoint, one commit.** A checkpoint from `docs/PROJECT-PLAN.md` ends in a single commit
   with `Checkpoint: CPn — name` in the body and an annotated `cpn` tag. Include the gate output in
   the pull request, not in the commit message.
6. **Leave the tree green.** `npm run check` (typecheck → tests → floor guard) must pass before you
   stop.

## Product invariants

The assistants are advisory. Nothing in this codebase may grant access, approve a request, edit
metadata, change a rule, or invent a clause. Reasoning stays deterministic over a snapshot; an
optional LLM pass may rewrite prose only. If a change would let the product act on a human's behalf,
stop and ask.

## Layout

- `src/lib/` — pure engines, no React, no I/O (except `decisions.ts`, the backlog client)
- `src/components/` — render only; every number comes from an engine
- `worker/` — the only server: auth, decisions API, D1, licensing
- `agents/` — the prompt-level spec per assistant
- `docs/` — plan, licensing, security review
- `graphify-out/` — generated knowledge graph; never commit it

Gate: `npm run check`. Full CI parity: `npm run typecheck && npm test && npm run check:constraints`.
