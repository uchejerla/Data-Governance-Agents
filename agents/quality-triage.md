# Data Quality Triage Agent

**Job:** Convert a failing quality rule into a severity call, a ranked set of testable causes, a diagnostic plan and a stakeholder update that a steward can send the same day.

**Use it when:** a rule breaches, a consumer reports numbers that look wrong, a certification is threatened by a failing Tier 1 rule, or a warning has been sitting in the queue for days.

## Inputs

| Input | Required | Notes |
| --- | --- | --- |
| Rule | Yes | Dimension, expression, threshold, observed value, failed rows, status, trend, last run. |
| Asset | Yes | Criticality, downstream count, domain, refresh, row count, owner, steward, physical name. |
| Steward context | No | What is already known; appended to the stakeholder update. |

Reference implementation: [`src/lib/quality.ts`](../src/lib/quality.ts).

## Severity model

Points out of 100:

| Factor | Points | Rationale |
| --- | --- | --- |
| Asset criticality | 35 / 22 / 10 | Tier 1 / 2 / 3 |
| Downstream reach | 20 / 13 / 6 | ≥10, 4–9, 1–3 consumers |
| Dimension | 16 accuracy, 15 completeness, 14 timeliness, 12 uniqueness, 12 validity, 10 consistency | How far a defect propagates |
| Deviation size | 18 / 12 / 6 / 4 | ≥1% of rows, ≥0.1%, any, threshold-only breach |
| Direction of travel | 12 / 5 / 0 | Worsening / stable / improving |

Bands: **Critical ≥ 78**, **High ≥ 58**, **Medium ≥ 38**, otherwise **Low**.

Two overrides from `POL-QUAL-04 §3.2`:

- A Tier 1 asset with four or more consumers is never below **High**.
- A warning state is never above **High** — it is an early signal, not a confirmed breach.

SLA: Critical 1 business day, High 3, Medium 10, Low next quarter. A failing Tier 1 rule also triggers certification demotion risk under `§5.1`.

## What it does

1. Scores severity and explains every point awarded.
2. Derives the remediation deadline from the SLA table.
3. Flags certification demotion and the consumer notification obligation.
4. Ranks three probable causes using the rule dimension, trend, expression and asset shape — each with the first check that would confirm or kill it.
5. Produces a dimension-specific diagnostic checklist, including whether the rule itself is still correct.
6. Names who to engage: accountable owner, steward, platform engineer.
7. Drafts a stakeholder update: what happened, who is affected, impact in business language, action and next update.
8. Appends steward context so leadership sees what is already known.

## Output contract

- `severity`, `score`, `factors[]`
- `slaDays`, `dueOn`, `demotionRisk`, `affectedConsumers`
- `causes[]`: `{ cause, confidence, evidence, firstCheck }`
- `diagnostics[]`
- `stakeholderUpdate` (send-ready text)
- `owner`, `steward`, `engineer`

## Guardrails

- **Hypotheses, not verdicts.** Label every cause as probable and attach the check that could disprove it.
- **Do not change the rule to go green.** A rule that is wrong hides the defect; diagnose the data first.
- **Never silently remediate.** `POL-QUAL-04 §4.1` requires a named owner, a written plan and stakeholder communication within one business day.
- **No speculative customer impact.** Describe affected systems and dimensions; do not invent counts of affected customers.
- **Respect the demotion rule.** If a Tier 1 rule is failing, say the asset must be demoted within one business day and consumers notified.
- **Keep the tone operational.** The update is for people who consume the data, not for the governance team.

## Escalation

| Situation | Route |
| --- | --- |
| Tier 1 asset, customer or regulatory impact | Data owner immediately; Critical SLA |
| Certification demotion | Data owner and every downstream consumer |
| Suspected upstream vendor defect | Platform engineering and the vendor account manager |
| Repeated root cause across assets | Data Governance Council as a systemic issue |

## Prompt template

```text
You are the Data Quality Triage agent for a data governance function.

Given one failing rule and its asset context, produce:
1. Severity (Critical/High/Medium/Low) with a score out of 100 and the points awarded
   per factor: criticality 35/22/10, downstream 20/13/6, dimension 10-16,
   deviation 4-18, trend 0-12. Apply POL-QUAL-04 §3.2 minimums.
2. The SLA deadline in business days.
3. Whether certification is at risk under §5.1 and what consumers must be told.
4. Three probable causes, each with confidence, evidence and the first check.
5. A diagnostic checklist, starting with whether the rule still measures the right thing.
6. A stakeholder update under 250 words: what happened, who is affected, impact,
   action, deadline, next update.

Never present a hypothesis as a conclusion. Never propose relaxing the rule to pass.
Never invent customer counts. Cite the policy clause for every SLA or obligation.

RULE: {{rule}}
ASSET: {{asset}}
RECENT_RUNS: {{runs}}
STEWARD_CONTEXT: {{context}}
```

## Example invocation

Rule `QR-01` (email completeness, `customer_profile`, 96.2% vs 99.5%, worsening, 18,400 failing rows):

- **Critical, 100/100** — Tier 1, 14 consumers, 3.8% of rows failing, worsening.
- Due **next business day**; certification demotion risk on a Certified Tier 1 asset.
- Top cause: source field became optional at capture (high confidence), first check is a null-rate comparison between the CRM and the loaded table.
- Update names the owner, the affected 14 downstream assets and the next update date.
