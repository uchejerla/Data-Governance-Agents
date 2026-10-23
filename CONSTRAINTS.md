# Constraints

**Last reviewed:** 2026-10-23 · **Owner:** @uchejerla · **Enforced by:** `npm run check`

The bar for this repository, written down so it survives the session that set it. Every agent —
human or model — reads this before writing code. **Do not weaken it to make a change pass.** If a
constraint is genuinely wrong, change it in its own commit with a reason, not in the commit that was
failing.

## Floor (always enforced, no setup required)

- No new suppression comments: `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `istanbul ignore`, `nosemgrep`, `gitleaks:allow`
- No disabled gates: `continue-on-error` in CI, `--passWithNoTests`, `--no-verify`, a check piped to `|| true`
- No skipped or deleted tests without the reason in the commit message
- No removed assertions from a test that stays
- No unimplemented stubs (`throw new Error("Not implemented")`, empty `catch {}`) and no new `TODO`
- No secrets in source; `.dev.vars` and key material stay ignored
- No new dependency without a stated reason in the pull request
- No auth, CORS, rate-limit or data-storage change without human approval
- Never push to `main`; checkpoints are commits plus annotated tags, reviewed before merge
- This file does not get weakened to make a change pass

Checked by `scripts/check-constraints.mjs`, which diffs the branch against its merge base. It reports
a rule and a location, never a matched value. Exit `1` blocks the change; exit `2` means the guard
could not run and never counts as clean.

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
| --- | --- | --- | --- |
| Types | Zero type errors, app + config + Worker | `npm run typecheck` (`tsc -b --noEmit`) | every edit, CI |
| Tests | All tests pass: **73 in 8 files** | `npm test` (`vitest run`) | every edit, CI |
| Floor | No move that lowers the bar | `npm run check:constraints` | every task, CI |
| Worker gates | Licence, origin and auth enforcement covered | `worker/routes.test.ts` | every edit, CI |
| Build | Production bundle builds | `npm run build` | checkpoint, CI |
| Node | **≥ 22.22** (locked jsdom 30 requirement) | `node -v` | setup |
| Secrets | No credential material staged | staged-diff scan in the PR checklist | every commit |
| Dependencies | No high or critical advisory reachable at runtime | `npm audit --audit-level=high` | CI from CP2 |

## Measured, not yet enforced

Ratchet only: these must not get worse. Update the recorded value when it improves.

| Metric | Today (2026-10-23) | Direction |
| --- | --- | --- |
| Tests | 73 passing, 8 files | must not fall |
| Bundle, main JS | 390.73 kB (117.55 kB gzip) | must not grow without a stated reason |
| Bundle, CSS | 22.38 kB (5.37 kB gzip) | must not grow without a stated reason |
| Type coverage | `strict` on, zero `any` in `src/lib` at review time | must not regress |
| Test coverage | not measured yet | measure at CP3, then hold |
| Dependency advisories | 3 (2 critical, 1 moderate) via `vitest → tinypool` / `@vitest/mocker`, development-only | **must reach 0 at CP2** |

The three advisories are dev-time (test runner), not in `dist/` or the Worker bundle, so they are not
a runtime exposure; they are a CI exposure and block the audit gate until the vitest 5 upgrade lands
at CP2. Forced remediation is never applied automatically.

## Exceptions

Add a row only to unblock work that has an owner and a date. The guard flags every new row.

| ID | Rule | Path | Reason | Owner | Expires |
| --- | --- | --- | --- | --- | --- |
| — | — | — | none open | — | — |

## Checkpoints

Each checkpoint in `docs/PROJECT-PLAN.md` ends in one commit and one annotated tag, and may not borrow
the next checkpoint's work. A checkpoint that cannot pass its gate stays open; the gate is never
relaxed to close it.

```bash
npm run check          # typecheck → tests → floor guard
git tag -a cp5 -m "CP5: tenancy and seats"
```
