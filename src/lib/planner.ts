import type { DecisionMap, DecisionStatus, DomainId, GovernanceSnapshot } from '../types';
import { glossaryIssues, reviewCatalogAsset } from './catalog';
import { recKey } from './decisions';
import { triageRule } from './quality';
import { addBusinessDays, daysSince, formatDate, isoDate, plural } from './util';

export type PlanSource = 'Catalog' | 'Quality' | 'Access' | 'Glossary' | 'Attestation';
export type PlanBucket = 'Now' | 'Next' | 'Later';
export type PlanAssistant = 'catalog' | 'quality' | 'access' | 'planner';

export interface PlanItem {
  id: string;
  title: string;
  detail: string;
  source: PlanSource;
  impact: number;
  effort: 'S' | 'M' | 'L';
  hours: number;
  ownerName: string;
  assetId?: string;
  termId?: string;
  requestId?: string;
  dueInDays: number;
  dueOn: string;
  bucket: PlanBucket;
  assistant: PlanAssistant;
  clauseId?: string;
  decision?: DecisionStatus;
  assigneeName?: string;
}

export interface StewardshipPlan {
  domainName: string;
  horizonDays: number;
  weeklyHours: number;
  items: PlanItem[];
  now: PlanItem[];
  next: PlanItem[];
  later: PlanItem[];
  dismissed: PlanItem[];
  totalHours: number;
  capacityHours: number;
  summary: string;
  markdown: string;
}

const HOURS: Record<PlanItem['effort'], number> = { S: 2, M: 6, L: 16 };

function bucketFor(dueInDays: number): PlanBucket {
  if (dueInDays <= 14) return 'Now';
  if (dueInDays <= 45) return 'Next';
  return 'Later';
}

export function buildPlan(
  domainId: DomainId,
  horizonDays: number,
  weeklyHours: number,
  snapshot: GovernanceSnapshot,
  decisions: DecisionMap = {},
): StewardshipPlan {
  const domain = snapshot.domains.find((d) => d.id === domainId) ?? snapshot.domains[0];
  const assets = snapshot.assets.filter((a) => a.domainId === domainId);
  const domainPeople = snapshot.people.filter((p) => p.domainId === domainId);
  const domainSteward = domainPeople.find((p) => p.role === 'Data Steward');
  const domainTerms = snapshot.terms.filter((t) => t.domainId === domainId);
  const termIds = new Set(domainTerms.map((t) => t.id));
  const items: PlanItem[] = [];

  const personName = (id?: string) => snapshot.people.find((p) => p.id === id)?.name;

  for (const asset of assets) {
    const review = reviewCatalogAsset(asset.id, snapshot);
    const stewardName = personName(asset.stewardId) ?? domainSteward?.name ?? 'Unassigned steward';
    const tierImpact = asset.criticality === 'Tier 1' ? 12 : asset.criticality === 'Tier 2' ? 4 : 0;

    for (const gap of review.gaps) {
      if (gap.id === 'quality') continue; // handled from rule results below
      const impactBase: Record<string, number> = {
        owner: 80 + tierImpact,
        steward: 66 + tierImpact,
        classification: 74 + tierImpact,
        description: 46 + tierImpact,
        terms: 30 + tierImpact,
        columns: 38,
        review: 42,
        profile: 32,
      };
      const effort: PlanItem['effort'] =
        gap.id === 'description' || gap.id === 'columns' ? 'M' : 'S';
      const dueInDays = gap.severity === 'Critical' ? 1 : gap.severity === 'High' ? 3 : 10;
      items.push({
        id: recKey.catalogGap(asset.id, gap.id),
        title: gap.label,
        detail: `${asset.name} — ${gap.detail}`,
        source: 'Catalog',
        impact: Math.min(96, impactBase[gap.id] ?? 40),
        effort,
        hours: HOURS[effort],
        ownerName: stewardName,
        assetId: asset.id,
        dueInDays,
        dueOn: isoDate(addBusinessDays(dueInDays)),
        bucket: bucketFor(dueInDays),
        assistant: 'catalog',
        clauseId: gap.clauseId,
      });
    }

    const failingRules = snapshot.rules.filter(
      (r) => r.assetId === asset.id && (r.status === 'Failing' || r.status === 'Warning'),
    );
    for (const rule of failingRules) {
      const triage = triageRule(rule.id, snapshot);
      const impact =
        triage.severity === 'Critical' ? 94 : triage.severity === 'High' ? 76 : triage.severity === 'Medium' ? 54 : 34;
      items.push({
        id: recKey.rule(rule.id),
        title: `Remediate ${rule.name.toLowerCase()}`,
        detail: `${asset.name} — ${rule.observed} against ${rule.threshold}. ${triage.severity} under POL-QUAL-04 §3.2.`,
        source: 'Quality',
        impact,
        effort: 'M',
        hours: HOURS.M,
        ownerName: personName(asset.ownerId) ?? stewardName,
        assetId: asset.id,
        dueInDays: triage.slaDays,
        dueOn: triage.dueOn,
        bucket: bucketFor(triage.slaDays),
        assistant: 'quality',
        clauseId: 'QLT-3.2',
      });
    }
  }

  for (const request of snapshot.pendingAccessRequests) {
    const asset = snapshot.assets.find((a) => a.id === request.assetId);
    if (!asset || asset.domainId !== domainId) continue;
    const age = daysSince(request.requestedOn) ?? 0;
    const dueInDays = Math.max(0, 5 - age);
    items.push({
      id: recKey.accessRequest(request.id),
      title: `Clear access request ${request.id}`,
      detail: `${personName(request.requesterId)} requested ${request.requestedLevel} on ${asset.name} ${age} days ago: ${request.purpose}.`,
      source: 'Access',
      impact: Math.min(88, 58 + age),
      effort: 'S',
      hours: HOURS.S,
      ownerName: domainSteward?.name ?? 'Domain steward',
      assetId: asset.id,
      requestId: request.id,
      dueInDays,
      dueOn: isoDate(addBusinessDays(dueInDays)),
      bucket: bucketFor(dueInDays),
      assistant: 'access',
      clauseId: 'ACC-2.3',
    });
  }

  for (const issue of glossaryIssues(snapshot)) {
    const issueTermIds = Array.from(issue.terms.join(' ').matchAll(/G-\d+/g)).map((m) => m[0]);
    if (!issueTermIds.some((id) => termIds.has(id))) continue;
    const impactByKind: Record<string, number> = {
      'No owner': 64,
      'Shared synonym': 56,
      'Near duplicate': 48,
      'Proposed too long': 34,
      'Thin definition': 30,
    };
    const effort: PlanItem['effort'] = issue.kind === 'Near duplicate' ? 'M' : 'S';
    items.push({
      id: recKey.glossaryIssue(issue.id),
      title: issue.action,
      detail: `${issue.terms.join(' vs ')} — ${issue.detail}`,
      source: 'Glossary',
      impact: impactByKind[issue.kind] ?? 35,
      effort,
      hours: HOURS[effort],
      ownerName: domainSteward?.name ?? 'Domain steward',
      termId: issueTermIds[0],
      dueInDays: issue.severity === 'High' ? 5 : 14,
      dueOn: isoDate(addBusinessDays(issue.severity === 'High' ? 5 : 14)),
      bucket: bucketFor(issue.severity === 'High' ? 5 : 14),
      assistant: 'catalog',
    });
  }

  for (const attestation of snapshot.attestations) {
    if (attestation.status !== 'Outstanding') continue;
    const person = snapshot.people.find((p) => p.id === attestation.personId);
    if (!person || person.domainId !== domainId) continue;
    const overdue = daysSince(attestation.dueOn) ?? 0;
    items.push({
      id: recKey.attestation(attestation.personId, attestation.policyCode),
      title: `Chase policy attestation — ${attestation.policyCode}`,
      detail: `${person.name} has not attested ${attestation.policyCode}${overdue > 0 ? ` (${overdue} days overdue)` : `; due ${formatDate(attestation.dueOn)}`}.`,
      source: 'Attestation',
      impact: Math.min(70, 40 + Math.max(0, overdue)),
      effort: 'S',
      hours: HOURS.S,
      ownerName: domainSteward?.name ?? 'Domain steward',
      dueInDays: overdue > 0 ? 0 : Math.max(0, -overdue),
      dueOn: isoDate(addBusinessDays(overdue > 0 ? 0 : Math.max(0, -overdue))),
      bucket: 'Now',
      assistant: 'planner',
    });
  }

  const inHorizon = items.filter((item) => item.dueInDays <= horizonDays);
  const ordered = inHorizon.sort((a, b) => b.impact - a.impact || a.hours - b.hours);

  // Dismissed items leave the plan rather than being silently re-proposed every
  // week. Accepted items stay, marked, so the plan doubles as a record of what
  // the steward has already taken on.
  const dismissed = ordered.filter((item) => decisions[item.id]?.status === 'dismissed');
  const sorted = ordered
    .filter((item) => decisions[item.id]?.status !== 'dismissed')
    .map((item) => {
      const decision = decisions[item.id];
      if (decision?.status !== 'accepted') return item;
      return {
        ...item,
        decision: 'accepted' as DecisionStatus,
        assigneeName: personName(decision.assigneeId) ?? item.ownerName,
      };
    });

  const now = sorted.filter((i) => i.bucket === 'Now');
  const next = sorted.filter((i) => i.bucket === 'Next');
  const later = sorted.filter((i) => i.bucket === 'Later');
  const totalHours = sorted.reduce((sum, i) => sum + i.hours, 0);
  const capacityHours = Math.round((weeklyHours * horizonDays) / 7);
  const criticalCount = sorted.filter((i) => i.impact >= 80).length;
  const dismissedNote =
    dismissed.length > 0
      ? ` ${plural(dismissed.length, 'item')} dismissed by the steward and excluded.`
      : '';

  const summary =
    (sorted.length === 0
      ? `No outstanding work found for ${domain.name} in the next ${horizonDays} days.`
      : `${plural(sorted.length, 'item')} in ${domain.name} over ${horizonDays} days: ${plural(criticalCount, 'high-impact item')}, ${totalHours} hours against a ${capacityHours}-hour capacity.`) +
    dismissedNote;

  const md: string[] = [
    `# Stewardship plan — ${domain.name}`,
    `Horizon: next ${horizonDays} days · Capacity: ${weeklyHours} h/week (${capacityHours} h) · Generated ${formatDate(new Date())}`,
    '',
    summary,
    '',
  ];
  const sections: [string, PlanItem[]][] = [
    ['Now — due within 14 days', now],
    ['Next — due within 45 days', next],
    ['Later — inside the horizon', later],
  ];
  for (const [heading, sectionItems] of sections) {
    if (sectionItems.length === 0) continue;
    md.push(`## ${heading}`);
    for (const item of sectionItems) {
      const accepted = item.decision === 'accepted';
      md.push(
        `- [${accepted ? 'x' : ' '}] **${item.title}** — ${item.detail} _(impact ${item.impact}, ${item.hours}h, owner ${item.ownerName}, due ${formatDate(item.dueOn)}${item.clauseId ? `, ${item.clauseId}` : ''}${accepted ? `, accepted${item.assigneeName ? ` by ${item.assigneeName}` : ''}` : ''})_`,
      );
    }
    md.push('');
  }
  if (dismissed.length > 0) {
    md.push('## Dismissed — excluded from this plan');
    for (const item of dismissed) {
      md.push(`- ~~${item.title}~~ — dismissed by the steward, not planned (${item.source})`);
    }
    md.push('');
  }

  return {
    domainName: domain.name,
    horizonDays,
    weeklyHours,
    items: sorted,
    now,
    next,
    later,
    dismissed,
    totalHours,
    capacityHours,
    summary,
    markdown: md.join('\n'),
  };
}
