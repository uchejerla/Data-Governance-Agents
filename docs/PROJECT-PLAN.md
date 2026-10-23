# Project plan — Steward Desk

**Status:** proposed · **Owner:** @uchejerla · **Horizon:** 12 weeks, 26 Oct 2026 → 15 Jan 2027
**Reviewed:** 2026-10-23 · **Checkpoints:** CP0–CP10, one commit per checkpoint

This plan is the working order for turning a strong demo into a product that an enterprise data
governance team can install, license and defend in an audit. It is deliberately narrower than the
list of everything that could be built: the features below are the ones that compound on what
already exists, and each is sized to land inside a week with a green gate.

---

## 1. Where the product stands (scan, 2026-10-23)

| Area | Reality today |
| --- | --- |
| Surface | 12,035 lines of TypeScript across `src/`, `worker/`, `scripts/` — five assistants, shared backlog, decision history, CSV export |
| Runtime | React 19 + Vite 7 on a Cloudflare Worker; three runtime dependencies (`@freebuff/auth`, `react`, `react-dom`) |
| Reasoning | Deterministic engines in `src/lib` over a bundled snapshot; no model, no network, no key |
| Server | One Worker: OIDC session, `/api/decisions*`, `/api/licence`, D1 (`decisions`, `decision_events`) |
| Licensing | Signed ES256 token, packages, expiry and audit-trail module enforced server-side; seats modelled, not enforced |
| Tests | 99 tests in 9 files, including route-level gate and response-header tests and the constraint guard; CI runs the dependency audit, typecheck, tests and the floor guard on every push and pull request |
| Docs | README, CONTRIBUTING, SECURITY, `agents/` specs, `docs/licensing.md`, issue and PR templates |

**What is missing, ranked by how much it blocks revenue or trust**

1. No self-hosted distribution — the roadmap's own first item, and the only way licensing is more
   than a browser-side gesture.
2. One workspace, no tenant column, seats not enforceable.
3. Identity is Freebuff-only; an enterprise install needs its own IdP.
4. No connectors, so every buyer re-keys their catalog by hand.
5. Thin operational security: no response headers, no rate limiting, no dependency or secret gate.
6. The audit log stores actor email with no retention or erasure path.

---

## 2. What "amazing" means for this product

The assistants are easy to copy; **defensibility is the product**. A steward keeps using Steward
Desk because every recommendation cites the clause it came from, every decision records who made
it and when, and the whole chain survives an audit. So the plan spends its weeks on the four things
that make that claim true at a customer site — installability, tenancy, identity and provenance —
and only then on model features.

**Adopted (this plan)**

| # | Bet | Why it compounds | Size |
| --- | --- | --- | --- |
| B1 | Self-hosted distribution (Node + Postgres, container) | Turns licensing, SSO and connectors into real features | L |
| B2 | Tenancy + seat enforcement | The commercial unit; unblocks per-workspace data | M |
| B3 | SSO per install (OIDC → group/role) | Enterprise procurement gate | M |
| B4 | Read-only connectors (snapshot ingest) | Removes the re-keying objection | L |
| B5 | Privacy depth (retention, export, erasure) | Makes the audit log defensible under GDPR | M |
| B6 | Realtime decisions (SSE) | Kills the 30-second poll; small, visible | S |
| B7 | Guarded LLM pass (licence-flagged) | Language polish without touching provenance | S |

**Considered and deliberately deferred** — a second assistant family (contracts, lineage),
marketplace of templates, mobile shell, self-serve billing, benchmarking against peers. Each is a
new surface to secure and support before the install story is finished; revisit after CP10.

---

## 3. Dependency graph

```
CP0  plan + security review + constraints            (this commit)
 │
CP1  floor guard wired into CI ──────────────┐
 │                                           │
CP2  response headers, dep/secret gates,      │  (security work, no product dependency)
 │   CODEOWNERS + branch protection            │
 │                                           │
 ├──> CP3  DB abstraction + migrations ──> CP4  self-hosted parity (Node, Postgres, Docker)
 │                                              │
 │                                              ├──> CP5  tenancy + seats
 │                                              │        │
 │                                              │        ├──> CP6  SSO per install
 │                                              │        │
 │                                              │        └──> CP8  connectors v1
 │                                              │                 │
 │                                              │                 └──> CP9  connectors v2
 │                                              │
 │                                              └──> CP7  privacy depth + rate limiting
 │
 └──> CP10 realtime (CP6.5, any free week) ──> release 1.0

CP10b guarded LLM pass — depends on CP8 (needs a real snapshot source to polish)
```

Why this order: the database abstraction (CP3) is the single highest-leverage refactor — every later
epic assumes it. Tenancy (CP5) must precede SSO (CP6) because roles are per workspace, and precede
connectors (CP8) because ingested snapshots are per tenant. Privacy work (CP7) can run in parallel
with CP5/CP6 since it only needs the existing D1 schema, but erasure needs the membership model to
know whose data it is, so it lands after CP5.

---

## 4. Timeline

Twelve weeks, one focused engineer with agent assistance, one checkpoint per week at most. Dates are
estimates, not commitments; a checkpoint that misses its week moves to the next free slot rather
than opening a second stream.

| Week | Dates | Checkpoint | Scope | Exit gate |
| --- | --- | --- | --- | --- |
| — | 23 Oct | **CP0** | This plan, security review, constraints contract, agent rules | Docs reviewed; `check:constraints` script specified |
| 1 | 26–30 Oct | **CP1** | Floor guard enforcing `CONSTRAINTS.md`; CI job on every PR | Guard blocks a seeded suppression and passes the clean tree |
| 2 | 2–6 Nov | **CP2** | Response headers (CSP, HSTS, frame-ancestors, nosniff, referrer), dependency audit gate, secret scan, CODEOWNERS, protected `main` | Header tests; audit gate green; a direct push to `main` is refused |
| 3 | 9–13 Nov | **CP3** | Storage interface over D1, migration runner, health/version endpoints | The existing suite passes unchanged against the interface; migrations are idempotent |
| 4 | 16–20 Nov | **CP4** | Node server target, Postgres adapter, Dockerfile + compose, session portability | `docker compose up` serves the app; decisions API parity proven by the route tests |
| 5 | 23–27 Nov | **CP5** | `workspace_id` on decisions/events, query scoping, membership table, seat enforcement | Two workspaces cannot see each other's backlog (test); seat limit refuses the 16th member |
| 6 | 30 Nov–4 Dec | **CP6** | SSO per install: OIDC discovery, group → role map, admin settings | Sign-in against a local IdP; a role change takes effect on next request |
| 7 | 7–11 Dec | **CP7** | Audit-log retention + subject export/erasure, rate limiting | Erasure removes a steward's rows and keeps the decision; limiter returns 429 under load |
| 8 | 14–18 Dec | **CP8** | Connector v1 (CSV + one catalog API), read-only ingest, SSRF allowlist, feature flag | Ingest a fixture catalog; a blocked host is refused; flag off means no network |
| 9 | 21–25 Dec | **CP9** | Connector v2 (second catalog + dbt), snapshot diffing, cache | Two sources ingest into one workspace; re-ingest is idempotent |
| 10 | 28 Dec–1 Jan | **CP10** | Realtime decisions (SSE) replacing the poll; perf budget check | Two clients see a decision within 2 s; bundle budget held |
| 11 | 4–8 Jan | buffer | Slip, hardening, docs | — |
| 12 | 11–15 Jan | **Release 1.0** | Guarded LLM pass behind a licence flag **or** cut 1.0 without it | Prompt-injection test suite; release checklist |

**Parallel-safe:** CP10 (realtime) can slot into any free week; CP7's retention half can start
alongside CP5. **Must stay sequential:** CP3 → CP4 → CP5 → CP6, and CP8 → CP9.

---

## 5. Checkpoint protocol

A checkpoint is a verified state, not a date. Each one ends with exactly one commit and an
annotated tag, so any checkpoint can be checked out and demonstrated.

1. Run the gate: `npm run check` (typecheck → tests → constraints floor).
2. Update the docs the change invalidates — README claims are part of the gate.
3. Commit with the checkpoint in the body:

   ```
   Add tenancy scoping to the decisions API

   Checkpoint: CP5 — tenancy and seats
   ```
4. Tag it: `git tag -a cp5 -m "CP5: tenancy and seats"`.
5. The annotated `cpn` tag is the checkpoint's status: `git tag -n` lists what has landed,
   and the table above shows what remains. There is no separate board to fall out of sync.

**A checkpoint may not be skipped or merged with another.** If a checkpoint fails its gate, the fix
lands in the same checkpoint; a follow-up commit inside a checkpoint is fine, a weakened gate is not
(see `CONSTRAINTS.md`).

**Definition of done for every checkpoint**

- [ ] `npm run check` green
- [ ] New behaviour covered by a test that fails without it
- [ ] Docs updated (`README`, `docs/`, `agents/` specs as applicable)
- [ ] Security review re-read; new trust boundaries added to `docs/SECURITY-REVIEW.md`
- [ ] Commit body records the checkpoint id
- [ ] No secrets, no new dependency without a stated reason

---

## 6. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Self-hosted port (CP3–CP4) is bigger than a week | High | Storage interface first, Postgres second; keep D1 path working throughout |
| Auth is tied to `@freebuff/auth` | High | Portability shim at CP4; keep the session contract minimal (user id, name, email) |
| Connectors turn the Worker into an SSRF surface | High | Allowlist + DNS checks at CP8 before any URL is fetched; read-only by construction |
| Tenancy retrofit breaks existing decisions | Medium | Migration writes a default workspace; backups before migrate; idempotent migrations |
| LLM pass erodes the deterministic-citation promise | High | Licence-flagged, output never executed, citations stay deterministic (CP10b) |
| Seat enforcement surprises a customer mid-term | Medium | Enforcement lands with the membership table, announced in the changelog |
| One engineer, twelve weeks | Medium | One stream, weekly checkpoints, explicit buffer week |

---

## 7. Decisions needed from the product owner

1. **Hosting shape for 1.0** — Docker Compose only, or Kubernetes manifests too? *(default: Compose + a Helm chart stub)*
2. **Database floor** — Postgres 15+ acceptable? *(default: yes, 15+)*
3. **SSO priority** — generic OIDC first, SAML later? *(default: OIDC first, SAML behind a flag)*
4. **Seat enforcement timing** — with the membership table (CP5), or after SSO exposes real users? *(default: CP5)*
5. **Connector order** — Collibra, Purview, or dbt first? *(default: dbt + CSV, because both are testable offline)*
6. **1.0 gate** — ship without the LLM pass? *(default: yes; it is a polish feature, not a launch blocker)*

Answers change the ordering above, not the shape of it.
