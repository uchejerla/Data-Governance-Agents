import { describe, expect, it } from 'vitest';
import { snapshot } from '../data/seed';
import { findCollisions, glossaryIssues, reviewCatalogAsset } from './catalog';
import { triageRule } from './quality';
import { answerPolicyQuestion } from './policy';
import { reviewAccessRequest } from './access';
import { buildPlan } from './planner';

describe('catalog curation', () => {
  it('scores a well-curated certified asset and isolates the quality blocker', () => {
    const review = reviewCatalogAsset('AST-1041', snapshot);
    expect(review.score).toBeGreaterThanOrEqual(85);
    expect(review.band).toBe('Healthy');
    expect(review.gaps.map((g) => g.id)).toEqual(['quality']);
    expect(review.classificationMismatch).toBe(false);
    expect(review.recommendedClassification).toBe('Confidential');
    expect(review.definitionDraft).toContain('customer_profile');
  });

  it('flags an unclassified asset with sensitive columns and recommends Confidential', () => {
    const review = reviewCatalogAsset('AST-1050', snapshot);
    expect(review.gaps.map((g) => g.id)).toContain('classification');
    expect(review.classificationMismatch).toBe(false);
    expect(review.recommendedClassification).toBe('Confidential');
    expect(review.piiFindings.some((f) => f.column === 'ip_address')).toBe(true);
    expect(review.score).toBeLessThan(60);
  });

  it('treats health-bearing claims data as Restricted', () => {
    const review = reviewCatalogAsset('AST-1046', snapshot);
    expect(review.recommendedClassification).toBe('Restricted');
    expect(review.piiFindings.some((f) => f.kind === 'Health')).toBe(true);
  });

  it('detects duplicate and synonym collisions for a proposed term', () => {
    const collisions = findCollisions('member', snapshot.terms);
    const ids = collisions.map((c) => c.termId);
    expect(ids).toContain('G-110');
    expect(ids).toContain('G-105');
    const duplicate = collisions.find((c) => c.termId === 'G-110');
    expect(duplicate?.kind).toBe('Duplicate term');
  });

  it('reports glossary hygiene findings', () => {
    const issues = glossaryIssues(snapshot);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.kind === 'No owner')).toBe(true);
    expect(issues.some((i) => i.kind === 'Thin definition')).toBe(true);
  });
});

describe('quality triage', () => {
  it('scores a worsening Tier 1 completeness failure as Critical with a one-day SLA', () => {
    const triage = triageRule('QR-01', snapshot);
    expect(triage.severity).toBe('Critical');
    expect(triage.score).toBeLessThanOrEqual(100);
    expect(triage.slaDays).toBe(1);
    expect(triage.demotionRisk).toBe(true);
    expect(triage.causes).toHaveLength(3);
    expect(triage.stakeholderUpdate).toContain('customer_profile');
    expect(triage.stakeholderUpdate).toContain('POL-QUAL-04');
    expect(triage.owner?.name).toBe('Daniel Okafor');
  });

  it('never returns a Low severity for a Tier 1 asset with meaningful reach', () => {
    for (const rule of snapshot.rules.filter((r) => r.status !== 'Passing')) {
      const triage = triageRule(rule.id, snapshot);
      if (triage.asset.criticality === 'Tier 1' && triage.asset.downstreamCount >= 4) {
        expect(['Critical', 'High']).toContain(triage.severity);
      }
      expect(triage.score).toBeGreaterThan(0);
      expect(triage.diagnostics.length).toBeGreaterThan(3);
    }
  });

  it('appends the steward context to the stakeholder update', () => {
    const triage = triageRule('QR-01', snapshot, 'Vendor fix lands Thursday.');
    expect(triage.stakeholderUpdate).toContain('Vendor fix lands Thursday.');
  });
});

describe('policy Q&A', () => {
  it('cites the retention clause for a consent evidence question', () => {
    const answer = answerPolicyQuestion(
      'How long can we keep marketing consent evidence after someone opts out?',
      snapshot,
    );
    expect(answer.matches.length).toBeGreaterThan(0);
    expect(answer.matches.map((m) => m.clause.id)).toContain('RET-3.4');
    expect(['Answered', 'Partial']).toContain(answer.coverage);
    expect(answer.composed).toContain('Basis:');
  });

  it('routes a vendor sharing question to third-party policy and privacy', () => {
    const answer = answerPolicyQuestion(
      'Can we share customer email addresses with our analytics vendor?',
      snapshot,
    );
    const docs = answer.matches.map((m) => m.clause.docCode);
    expect(docs.some((d) => d === 'POL-TPR-06' || d === 'POL-PRIV-02')).toBe(true);
    expect(answer.checks.length).toBeGreaterThan(0);
  });

  it('does not invent an answer when policy is silent', () => {
    const answer = answerPolicyQuestion('What is the cafeteria menu rotation for Tuesday?', snapshot);
    expect(answer.coverage).toBe('Not covered');
    expect(answer.escalateTo).toBeTruthy();
    expect(answer.composed).toContain('Not conclusive');
  });
});

describe('access review', () => {
  it('denies a request that duplicates access already held', () => {
    const review = reviewAccessRequest('AR-2204', snapshot);
    expect(review.decision).toBe('Deny');
    expect(review.duplicate).toBe(true);
    expect(review.blockers.length).toBeGreaterThan(0);
    expect(review.reviewerNote).toContain('AR-2204');
  });

  it('denies an unclassified asset request that exceeds clearance', () => {
    const review = reviewAccessRequest('AR-2201', snapshot);
    expect(review.decision).toBe('Deny');
    expect(review.blockers.join(' ')).toContain('Clearance gap');
    expect(review.rationale.some((r) => r.clauseId === 'CLS-5.1')).toBe(true);
  });

  it('escalates Restricted export requests to owner and Privacy Office', () => {
    const review = reviewAccessRequest('AR-2205', snapshot);
    expect(review.decision).toBe('Escalate');
    expect(review.routeTo.some((r) => r.includes('Privacy Office'))).toBe(true);
    expect(review.conditions.join(' ')).toContain('case reference');
    expect(review.maskingRequired).toBe(false);
  });

  it('approves a clean request with an explicit expiry', () => {
    const review = reviewAccessRequest('AR-2207', snapshot);
    expect(review.decision).toBe('Approve');
    expect(review.conditions).toHaveLength(0);
    expect(review.expiresOn).toBeTruthy();
    expect(review.reviewerNote).toContain('APPROVE');
  });

  it('caps contractor grants at 90 days', () => {
    const review = reviewAccessRequest('AR-2203', snapshot);
    expect(review.conditions.join(' ')).toContain('90 days');
    expect(review.requester.role).toBe('Contractor');
  });
});

describe('stewardship planner', () => {
  it('builds a dated, domain-scoped backlog inside the horizon', () => {
    const plan = buildPlan('customer', 30, 12, snapshot);
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.items.every((i) => i.dueInDays <= 30)).toBe(true);
    expect(plan.now.every((i) => i.bucket === 'Now')).toBe(true);
    expect(plan.totalHours).toBe(plan.items.reduce((sum, i) => sum + i.hours, 0));
    expect(plan.capacityHours).toBe(51);
    expect(plan.items.every((i) => !i.assetId || snapshot.assets.find((a) => a.id === i.assetId)?.domainId === 'customer')).toBe(true);
    expect(plan.markdown).toContain('# Stewardship plan');
  });

  it('surfaces unreviewed or unowned assets with high impact', () => {
    const plan = buildPlan('customer', 60, 12, snapshot);
    expect(plan.items.some((i) => i.title.toLowerCase().includes('owner'))).toBe(true);
    expect(plan.items.some((i) => i.source === 'Access')).toBe(true);
    expect(Math.max(...plan.items.map((i) => i.impact))).toBeGreaterThanOrEqual(70);
  });

  it('fits a smaller horizon than a wider one', () => {
    const short = buildPlan('claims', 30, 12, snapshot);
    const long = buildPlan('claims', 90, 12, snapshot);
    expect(long.items.length).toBeGreaterThanOrEqual(short.items.length);
    expect(long.capacityHours).toBeGreaterThan(short.capacityHours);
  });

  it('drops dismissed items from the plan, its hours and its Markdown', () => {
    const base = buildPlan('customer', 60, 12, snapshot);
    const target = base.items[0];
    const plan = buildPlan('customer', 60, 12, snapshot, {
      [target.id]: { status: 'dismissed', at: '2026-01-05T09:00:00.000Z' },
    });

    expect(plan.items.map((i) => i.id)).not.toContain(target.id);
    expect(plan.dismissed.map((i) => i.id)).toContain(target.id);
    expect(plan.items).toHaveLength(base.items.length - 1);
    expect(plan.totalHours).toBe(base.totalHours - target.hours);
    expect(plan.summary).toContain('dismissed by the steward');
    expect(plan.markdown).not.toContain(`**${target.title}**`);
    expect(plan.markdown).toContain('## Dismissed — excluded from this plan');
  });

  it('keeps accepted items in the plan, ticked and attributed', () => {
    const base = buildPlan('customer', 60, 12, snapshot);
    const target = base.items[0];
    const plan = buildPlan('customer', 60, 12, snapshot, {
      [target.id]: {
        status: 'accepted',
        at: '2026-01-05T09:00:00.000Z',
        assigneeId: 'P-08',
      },
    });

    const item = plan.items.find((i) => i.id === target.id);
    expect(item?.decision).toBe('accepted');
    expect(item?.assigneeName).toBeTruthy();
    expect(plan.markdown).toContain(`- [x] **${target.title}**`);
    expect(plan.markdown).toContain(`accepted by ${item?.assigneeName}`);
  });
});
