# Security review — Steward Desk

**Reviewed:** 2026-10-23 · **Commit:** `1e7ee61` · **Reviewer:** agent-assisted, human sign-off required
**Method:** code read of `worker/`, `src/lib/`, CI and docs; live probes against a local Worker with
an expired and an essential-only licence; dependency inspection of the lockfile.

This review has two halves. The first is the product: what an attacker can reach, and what stops
them. The second is the thing this plan is also about — **no agent, ours or a model's, may act
outside the product's contract**. Both are treated as security requirements, not documentation.

---

## 1. Assets and trust boundaries

```
browser (React app, bundled snapshot)
   │  ① HTTPS + session cookie         ② fetch /api/* with Origin header
   ▼
Cloudflare Worker  ── ③ D1 (decisions, decision_events: actor name + email)
   │
   ├─ ④ licence env (LICENCE_KEY, LICENCE_PUBLIC_KEY, LICENCE_REQUIRED) — public config, integrity-critical
   ├─ ⑤ CI ↔ npm registry / GitHub Actions (supply chain)
   └─ ⑥ future: catalog connectors (outbound HTTP) and an optional LLM pass
```

| # | Boundary | Untrusted input | Assets behind it |
| --- | --- | --- | --- |
| ① | Browser ↔ Worker | cookies, `Origin` | session, decision writes |
| ② | `/api/*` | path keys, JSON bodies, query params | backlog, audit log, entitlement |
| ③ | Worker ↔ D1 | SQL parameters | decisions, actor identity and email |
| ④ | Operator ↔ install | `LICENCE_*` env values | module gating, write access |
| ⑤ | CI ↔ registry | package tarballs, install scripts | build integrity, secrets |
| ⑥ | Worker ↔ third parties (planned) | catalog JSON, model output | tenant data, egress |

**STRIDE, condensed.** Spoofing: OIDC only, identity never read from input. Tampering: licence is
signed (ES256); SQL is parameterised; decisions are append-logged. Repudiation: `decision_events`
records actor id, name and email per change. Information disclosure: no customer identity on the
public entitlement; personalised responses are `private, no-store`. Denial of service: **no
application-level limiter** (SR-02). Elevation: withdrawal is restricted to the recording steward;
module gates are enforced server-side.

---

## 2. Findings

| ID | Severity | Finding | Evidence | Fix | Target |
| --- | --- | --- | --- | --- | --- |
| **SR-01** | **Medium** | No security headers: no CSP, HSTS, `frame-ancestors`, `nosniff`, referrer policy. An XSS or a hostile iframe has nothing in the way. | Was: `worker/index.ts` `HEADERS` set only `Content-Type` and `Cache-Control` | **Mitigated at CP2.** `withSecurityHeaders` wraps every response — API, assets, auth redirects — with CSP (`default-src 'self'`, no framing, no plugins), HSTS, `nosniff`, `DENY`, a referrer policy and a permissions policy. Four route tests cover it, including that a sign-in `Set-Cookie` survives | CP2 |
| **SR-02** | **Medium** | No rate limiting on `/api/*`. Writes, history paging and `/api/licence` can be hammered; D1 writes cost money. | README Limitations; no limiter in `worker/index.ts` | Platform rate-limit rule first, then a Durable Object counter for per-steward limits | CP7 |
| **SR-03** | **Medium** | No dependency or secret gate in CI. Dependabot opens PRs, but nothing blocks merging a vulnerable or secret-bearing change. | Was: CI ran typecheck + tests only | **Partially mitigated at CP2.** `npm audit --audit-level=high` is a required step after `npm ci`. Secret scanning still needs enabling in repository settings — an owner action, not a code change | CP2 |
| **SR-04** | **Medium** | Audit log stores actor email with **no retention limit and no erasure path**. A deletion request cannot be honoured, and the log outlives the contract. | `decision_events.actor_email`; SECURITY.md lists it; no delete/export code | Retention window per workspace, subject export, erasure that keeps the decision but clears the identity, documented in SECURITY.md | CP7 |
| **SR-05** | **Medium** | `main` is pushable by any collaborator or agent; no CODEOWNERS, no required review. A regression or a silent gate change can land unreviewed. | Was: no `.github/CODEOWNERS` | **Partially mitigated at CP2.** `.github/CODEOWNERS` requires the maintainer on every path, with the sensitive ones named. Protected `main`, required checks and no force-push are repository settings the owner must still enable | CP2 |
| **SR-06** | Low | `/api/licence` is public and reveals package names, module list, seats and workspace counts. | `worker/index.ts` route; live probe showed no customer/licence id | Accepted: this is what drives the signed-out banner. Keep customer and licence id server-side (already done) | — |
| **SR-07** | Low | Expiry trusts the server clock; a rolled-back clock extends a licence. | `worker/licence.ts` compares to `Date.now()`; documented in `docs/licensing.md` | Accepted with monitoring: alert when `notAfter` passes while the token still verifies | CP2 (alert) |
| **SR-08** | **High if unmitigated** | Planned connectors fetch customer-supplied URLs → SSRF into the cluster or cloud metadata. | Not implemented yet (roadmap) | Allowlist scheme + host, resolve all DNS records and reject private/link-local/loopback, no redirects, egress proxy; read-only tokens only | CP8 (pre-condition) |
| **SR-09** | **High if naive** | Planned LLM pass would put catalog text and policy clauses into a prompt and model output back into notes. Prompt injection and output handling are new trust boundaries. | Not implemented yet (roadmap) | Output parsed as text only, never executed or fed to SQL/HTML; deterministic citations retained; token/rate caps; key from env only; injection test suite | CP10b (pre-condition) |
| **SR-10** | Low | Error bodies are generic, but there is no central error handler — a future route could leak a stack trace. | Was: `json({ error })` per route, no catch at the boundary | **Mitigated at CP2.** The Worker catches at its boundary: the error goes to the platform log, the client gets `{ error: 'Something went wrong' }` with 500 and the usual headers | CP2 |
| **SR-11** | **Medium** | Three advisories in the dev test toolchain: `vitest@3.2.7` pulls `tinypool` (critical, prototype-pollution gadget to RCE) and `@vitest/mocker` (moderate, path traversal / arbitrary file read). Not in the shipped bundle, but CI executes test code, so a crafted test can reach files in the runner. | Was: `npm audit` reported 3 (2 critical, 1 moderate) | **Mitigated at CP2.** vitest 5.0.5 (Vite 7 is within its peer range) removes `tinypool`; `npm audit --audit-level=high` reports 0, and no forced remediation was used | CP2 |

### Verified controls (keep them; they are why the findings above are not worse)

- SQL is parameterised everywhere; keys and bodies are bounded (`KEY_PATTERN`, 2 KB body cap).
- Identity comes only from the verified session — no actor id, email or tenant is accepted from input.
- Writes require `isSameOriginRequest`; withdrawal is restricted to the steward who recorded it.
- Licence fails closed: unverifiable → invalid → read-only; expiry blocks writes **before**
  authentication and before any SQL (proven by `worker/routes.test.ts`).
- Licence dates are formatted in UTC, so an expiry is never reported a day early.
- CSV export neutralises spreadsheet formula injection.
- Runtime dependencies (`react`, `react-dom`, `@freebuff/auth`) carry no advisories; `npm audit --audit-level=high` now reports 0 across the tree.
- Every response carries the security headers, including static assets and auth redirects, and unexpected errors are generic 500s.
- Personalised responses are `Cache-Control: private, no-store`.
- `/api/health` and `/api/version` are reachable signed out by design (a probe has no session) and
  disclose only the app version, the schema id and whether the database answered — no binding
  name, licence, customer or driver message. A failed probe returns 503 with a generic body
  (`worker/health.test.ts`).
- No secrets in the repository; `.dev.vars` is ignored and holds public configuration only.

---

## 3. Guardrails: no agent goes rogue

There are two kinds of agent here, and both need a written contract with teeth.

### 3.1 The product's assistants (the five agents customers use)

The product is already advisory by design. These are the invariants, and they are testable:

1. **Advisory only.** No assistant grants access, approves a request, edits metadata, changes a rule
   or writes to a catalog. Output is a recommendation plus a reviewer note.
2. **Grounded or silent.** Every governance claim cites a clause or a recorded catalog fact; policy
   Q&A says "not covered" instead of inventing a rule.
3. **Deterministic.** Reasoning is a pure function over a snapshot — no model, no network, no key.
   An optional LLM pass may rewrite prose only, never the verdict or the citations.
4. **No silent widening.** A recommendation may not raise a clearance, lower a classification or
   extend an expiry.
5. **Human decides.** The UI never presents a decision as made; a steward or owner signs the note.

**Enforcement (today and planned):** engine purity is reviewable in `src/lib`; `planner.ts` can only
recombine the other four engines, so the plan cannot contradict a finding; licence gates are
server-side; connectors will be read-only with an allowlist; the LLM pass is licence-flagged and its
output never reaches SQL, the DOM or a shell. Each new assistant follows `README → Adding an
assistant` and adds branch tests before it ships.

### 3.2 Development agents (us)

The risk is not malice, it is the cheapest road to green: a skipped test, a `@ts-ignore`, a gate
quietly removed from CI. `CONSTRAINTS.md` is the written bar and `scripts/check-constraints.mjs` is
the diff-scoped guard that enforces it.

| Move that lowers the bar | Detected by |
| --- | --- |
| New suppression comment (`@ts-ignore`, `eslint-disable`, `istanbul ignore`, `nosemgrep`) | floor guard |
| Test made easier (`skip`, `todo`, `xit`, deleted test file, removed assertion) | floor guard |
| Unfinished work (`Not implemented` stub, empty `catch`, new `TODO`) | floor guard |
| Gate disabled in CI or a script (`continue-on-error`, `--passWithNoTests`, `|| true`, `--no-verify`) | floor guard |
| `CONSTRAINTS.md` rule removed, exception added, or threshold loosened | floor guard |
| Behaviour changed without a test | review + checkpoint gate |
| Dependency added silently | PR checklist; new deps need a stated reason |

**Non-negotiables for any agent working here:** never weaken `CONSTRAINTS.md`; never push to `main`
(tags and protected branches only); never commit a secret; never add an auth, CORS, rate-limit or
data-storage change without human approval; commit at every checkpoint; leave the working tree green.

**Kill switches:** `LICENCE_REQUIRED=true` makes an unlicensed install read-only; modules can be
withdrawn by reissuing a token; connectors and the LLM pass ship behind feature flags, so a fault can
be switched off without a redeploy of the engine.

---

## 4. Residual risk (accepted)

- Self-hosted licensing is a commercial control, not DRM: a determined operator can patch a check.
  The remedy is contractual; `docs/licensing.md` says so plainly.
- Clock trust on expiry (SR-07) is accepted with monitoring.
- The seeded snapshot is fictional; real catalog data behind connectors inherits the connector
  controls in SR-08.
- A compromised browser or extension has the steward's session. Out of scope, as stated in
  SECURITY.md.

## 5. Re-running this review

```bash
npm ci && npm run check                      # typecheck, tests, constraint floor
npm run dev:worker                            # then probe:
curl -s localhost:8787/api/licence            # entitlement, no identity
curl -s -X PUT -H "Origin: http://localhost:8787" -d '{}' \
  localhost:8787/api/decisions/test-key       # 403 read-only when the licence has lapsed
curl -s -X PUT -H "Origin: https://evil.example" -d '{}' \
  localhost:8787/api/decisions/test-key       # 403 cross-origin
```

Repeat at every checkpoint. Any new trust boundary (connector, LLM, upload, webhook) must be added to
section 1 before code is written, not after.
