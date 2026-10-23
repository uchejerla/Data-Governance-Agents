# Stewardship Planner Agent

**Job:** Turn a domain's open governance debt into a sequenced, capacity-aware backlog — what to do now, next and later, with an owner, an effort estimate and a due date attached to every item.

**Use it when:** Monday planning, a monthly domain review, an audit finding needs a remediation plan, a new steward inherits a domain, or someone asks "where do we actually stand?".

## Inputs

| Input | Required | Notes |
| --- | --- | --- |
| Domain | Yes | Scopes every item; nothing outside the domain is planned. |
| Horizon | Yes | 14 / 30 / 60 / 90 days. Filters items, not buckets. |
| Weekly capacity | Yes | Hours per week the steward can realistically spend. |
| Governance snapshot | Yes | Catalog assets, rule results, glossary issues, pending access requests, outstanding attestations. |

Reference implementation: [`src/lib/planner.ts`](../src/lib/planner.ts). It reuses the other four agents' engines so the plan can never contradict a finding.

## What it harvests

| Source | Items | Impact base |
| --- | --- | --- |
| Catalog | Missing owner, missing steward, unclassified, thin description, missing columns, linked-term gaps, overdue review, missing profile | 30–92, plus a Tier-1/Tier-2 boost |
| Quality | Every failing or warning rule, severity inherited from triage | 34–94 |
| Access | Pending requests, impact rises with age | 58–88 |
| Glossary | Unowned terms, shared synonyms, near duplicates, stale proposals, thin definitions | 30–64 |
| Attestation | Outstanding policy attestations, impact rises with days overdue | 40–70 |

Effort: **S** = 2h, **M** = 6h, **L** = 16h.

## Sequencing

1. Filter to items due within the horizon.
2. Sort by impact descending, then by hours ascending — high impact, cheap wins first.
3. Bucket by due date: **Now** ≤ 14 days, **Next** ≤ 45, **Later** beyond.
4. Compare total hours against capacity (`weeklyHours × horizonDays ÷ 7`).
5. When the plan exceeds capacity, say so in the summary and name what to defer — do not present an overloaded plan as achievable.

## Output contract

- `now[]`, `next[]`, `later[]`, `items[]`
- Per item: `title`, `detail`, `source`, `impact`, `effort`, `hours`, `ownerName`, `dueOn`, `bucket`, `assistant`, optional `clauseId` / `assetId` / `termId` / `requestId`
- `totalHours`, `capacityHours`, `summary`
- `markdown` — a checkbox plan ready to paste into a ticket, email or wiki

Every item links back to the assistant that resolves it, so the plan is a work queue rather than a list of worries.

## Guardrails

- **One domain at a time.** Cross-domain items are out of scope; hand them to that domain's steward.
- **No orphan items.** An item without an owner is assigned to the domain steward and flagged, never left blank.
- **Dates are business days**, derived from severity (`Critical` 1 day, `High` 3–5, else 10–14), not invented.
- **Capacity is respected, or the overrun is stated.** Never imply a 90-hour backlog fits in 12 hours.
- **Impact scores must be reproducible** from the other engines' rules; no hand-tuned favourites.
- **Deferral is explicit.** When something is dropped for capacity, say which.
- **Never archive a finding to make the plan look green.**

## Handoffs

| Item type | Assistant to use |
| --- | --- |
| Catalog gap | Catalog Curation |
| Failing rule | Data Quality Triage |
| Pending request | Access Review |
| Glossary collision | Catalog Curation → glossary view |
| Policy question blocking an item | Policy & Control Q&A |

## Prompt template

```text
You are the Stewardship Planner agent for a data governance function.

Given a domain, a horizon in days, the steward's weekly capacity in hours, and the
governance snapshot, produce a prioritised plan.

Rules:
1. Only include items for the selected domain, due within the horizon.
2. Impact comes from the source finding's severity; do not invent scores.
3. Effort: S=2h, M=6h, L=16h. Sum hours and compare with capacity.
4. Sort by impact desc, then hours asc. Bucket: Now <=14d, Next <=45d, Later beyond.
5. Every item needs: title, one-line detail, source, impact, effort, owner, due date,
   and the clause ID where the obligation comes from.
6. If total hours exceed capacity, say which items you would defer and why.
7. Output markdown with checkbox items grouped by bucket, plus a one-paragraph summary.

Do not omit items to make the plan fit, do not assign work outside the domain, and do
not present the plan as approved — a steward or domain owner accepts it.

DOMAIN: {{domain}}
HORIZON_DAYS: {{horizon_days}}
WEEKLY_CAPACITY_HOURS: {{weekly_hours}}
FINDINGS: {{catalog_gaps_and_rule_results_and_requests_and_attestations}}
```

## Example invocation

Customer & Growth domain, 30-day horizon, 6 h/week (≈26 h capacity):

- **Now:** remediate `refund_reason` completeness (`QLT-3.2`, impact 94), classify `support_transcripts` (impact 86), clear `AR-2214` — 4 days old (impact 62).
- **Next:** link `customer_lifetime_value` to `G-1042` (impact 54), chase overdue attestation for `POL-PRV-02` (impact 47).
- **Summary:** 11 items, 3 high-impact, 58 hours against 26 hours of capacity — plan fit to capacity by deferring the three missing-profile items to the next horizon.
