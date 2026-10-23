# Security policy

## Supported versions

Only `main` is supported. Fixes are released there and deployed from there; there are no
maintained release branches yet.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:

**Security → Report a vulnerability** →
[open a private advisory](https://github.com/uchejerla/Data-Governance-Agents/security/advisories/new)

Include what you did, the affected route or file, the impact you believe it has, and a minimal
reproduction. We aim to acknowledge within five working days and will agree a disclosure
timeline with you before anything is published.

## In scope

- Authentication and session handling (`/auth/freebuff/*`, session cookie lifetime and renewal).
- Authorization boundaries: anything that lets a signed-out caller read or write, or lets one
  steward perform an action reserved for another (withdrawing someone else's decision, editing
  history).
- Cross-site request forgery and origin checks on state-changing requests.
- Audit-log integrity: changes to decisions that do not produce an event, or events that can be
  altered or deleted by a client.
- CSV injection in the history export, or any output that can execute when opened elsewhere.
- Vulnerabilities in dependencies that ship in the Worker bundle or the app.

## Out of scope

- **The seeded data.** Assets, rules, policies, people and domains are fictional.
- **The documented lack of application-level rate limiting.** The platform's limits apply, but the
  app itself does not throttle. It is listed as a limitation in the README, so it is not a
  vulnerability report.
- Attacks that require a compromised browser, a malicious extension or the user's own credentials.
- Denial of service by volume against the hosting platform.
- Social engineering of maintainers.

## What the application stores

- The decision a steward recorded: status, assignee, deciding actor id, name and email, and
  timestamps.
- An append-only event log of the same, including decisions later overwritten or withdrawn.
- Nothing else. In this build, catalog assets, quality results and policy text are bundled into
  the client and never sent to the server.

Data is stored per environment. Preview and production have separate D1 databases and separate
sign-in callbacks, so a decision recorded in one is invisible in the other.

## Secrets

There are none in this repository, and there is no client secret or session secret to rotate:
`FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` are public configuration. `.dev.vars` is
git-ignored. If you believe a credential was committed, report it privately rather than opening an
issue; the fix is to rotate it at the source and purge it from history, not to delete the line.

## Hardening already in place

- Identity is read only from the verified OIDC session; no actor identifiers are accepted from
  request input.
- State-changing requests must pass a same-origin check, then validation of the key and body.
- SQL is parameterised throughout; keys and bodies are bounded in length and shape.
- Personalised responses are `Cache-Control: private, no-store`.
- Withdrawal is restricted to the steward who recorded the decision, enforced server-side.
