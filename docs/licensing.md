# Licensing

Self-hosted Steward Desk is licensed per customer: a signed token names the packages,
seat and workspace limits, and the date it stops working. The installation holds only
a public key, so it can verify a licence offline but can never mint one.

> **Scope of this first slice.** Expiry and the audit-trail module are enforced on the
> server. Seats are modelled and exposed but not yet enforced, because there is no
> membership table — identity is still the Freebuff session. Module gating for the
> browser-rendered assistants is a UI decision until the catalog snapshot moves behind
> the API. [What is enforced](#what-is-enforced-where) has the exact list.

## Packages

| Tier | Modules | Default seats | Default workspaces |
| --- | --- | --- | --- |
| **Essential** | Catalog Curation, Policy & Control Q&A | 5 | 1 |
| **Professional** | + Quality Triage, Access Review, decision history and CSV export | 15 | 3 |
| **Enterprise** | + Stewardship Planner, SSO | 50 | 25 |

Tiers are nested: upgrading never removes a module. A deal can differ from the defaults —
seats and workspaces are carried in the token, and individual modules can be added with
`addons` without creating a new tier. The mapping lives in
[`worker/licence.ts`](../worker/licence.ts) (`PACKAGES`), and the navigation uses the same
list, so the two cannot drift silently.

## The token

A compact JWS, `header.payload.signature`, signed with **ES256 (ECDSA P-256 + SHA-256)**:

```json
{
  "v": 1,
  "lic": "LIC-2026-0007",
  "customer": "Northwind Insurance",
  "packages": ["professional"],
  "addons": ["sso"],
  "seats": 15,
  "workspaces": 3,
  "issued_at": "2026-10-23T00:00:00.000Z",
  "not_before": "2026-11-01T00:00:00.000Z",
  "not_after": "2027-10-22T23:59:59.000Z",
  "support": "business"
}
```

`not_before` and `addons` are optional. `not_after` must be after `issued_at`. Unknown
packages or modules are rejected rather than ignored, so a typo fails loudly at install
time instead of silently shipping an empty tier.

## Configuration

| Variable | Meaning |
| --- | --- |
| `LICENCE_KEY` | The signed token. Absent means evaluation mode. |
| `LICENCE_PUBLIC_KEY` | SPKI public key, base64url. Required to verify a token. |
| `LICENCE_KEY_ID` | Optional; when set, the token header's `kid` must match it. |
| `LICENCE_REQUIRED` | `true` makes a missing licence read-only instead of an evaluation. |

Set these the way the installation sets any other environment variable. They are not
secrets in the credential sense — the token is public and the key is public — but a
tampered token is worse than none, so keep them out of source control and audit changes.

Verification runs once per Worker isolate and is cached; changing the licence means a
redeploy (or a process restart on the Node build).

## Issuing a licence

```bash
# 1. Once per signing key. Keep the private key offline.
node scripts/issue-licence.mjs --generate --kid 2026-01 > signing-key.json

# 2. Per customer. Save the claims with the contract.
cat > northwind.json <<'JSON'
{
  "v": 1,
  "lic": "LIC-2026-0007",
  "customer": "Northwind Insurance",
  "packages": ["professional"],
  "seats": 15,
  "workspaces": 3,
  "issued_at": "2026-10-23T00:00:00.000Z",
  "not_after": "2027-10-22T23:59:59.000Z",
  "support": "business"
}
JSON

# 3. Sign it. Output goes to LICENCE_KEY.
node scripts/issue-licence.mjs --claims northwind.json --key signing-key.json
```

`npm run licence:issue -- --generate` and `npm run licence:issue -- --claims ... --key ...`
do the same thing. The CLI refuses claims that would fail verification later.

**Renewal** is a new token with a later `not_after`. **Rotation** is a new keypair: publish
the new public key and reissue at the same time, or run both keys for one renewal cycle
(`LICENCE_KEY_ID` exists for that, one key at a time).

## What an operator sees

- **Active, more than 30 days left** — nothing. The licence is not part of the daily UI.
- **Active, 30 days or fewer** — a warning strip: "Licence expires in N days".
- **Expired, not yet valid, or unverifiable** — a read-only strip explaining why, with the
  decision controls replaced by "Read-only — licence expired". Reads, the plan and the CSV
  export keep working, because a lapsed customer still needs their own history.
- **No licence, no `LICENCE_REQUIRED`** — evaluation mode: every module, writes allowed, a
  small note in the sidebar.
- **No licence, `LICENCE_REQUIRED=true`** — read-only, every module withdrawn.

## What is enforced where

| Concern | Enforced | Notes |
| --- | --- | --- |
| Expiry | **Server** | `PUT`/`DELETE /api/decisions/:key` return 403 before authentication when read-only. |
| Audit-trail module | **Server** | `GET /api/decisions/history` returns 403 when `audit-export` is not licensed; the CSV export reads through it, so it follows. |
| Package modules in the UI | Client | Nav and screens are filtered by the entitlement the server returns. |
| Seats | Modelled, not enforced | `canAddMember()` exists and is tested; there is no membership table to count yet. |
| Workspaces | Not enforced | One workspace per install in this build. |

When the catalog snapshot moves behind the API (the connector work), module gating becomes
data-level: an unlicensed module's data is simply not served, and the client-side filter
stops mattering.

## Honest limits

- **Not DRM.** The customer controls the machine, so a determined operator can patch a
  check out. Self-hosted licensing is a commercial control for the compliant case; the
  remedy for a customer who ignores it is contractual, not technical.
- **No revocation list.** Offline verification cannot consult one. Issue shorter terms
  (quarterly or annual) so a lapsed customer is corrected at renewal, and treat a
  chargeback by not reissuing.
- **Clock trust.** Expiry is compared to the server's clock. A machine with a rolled-back
  clock extends a licence; monitoring `not_after` in your support tooling catches the case
  that matters.
