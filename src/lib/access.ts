import type {
  AccessLevel,
  Asset,
  GovernanceSnapshot,
  PendingAccessRequest,
  Person,
  Severity,
} from '../types';
import {
  addBusinessDays,
  classificationRank,
  formatDate,
  isoDate,
  plural,
} from './util';

export type AccessDecision = 'Approve' | 'Approve with conditions' | 'Escalate' | 'Deny';

export interface Rationale {
  text: string;
  clauseId?: string;
  severity: Severity;
}

export interface AccessReview {
  request: PendingAccessRequest;
  requester: Person;
  asset: Asset;
  owner?: Person;
  decision: AccessDecision;
  riskScore: number;
  rationale: Rationale[];
  conditions: string[];
  blockers: string[];
  routeTo: string[];
  expiresOn: string;
  recommendedLevel: AccessLevel;
  maskingRequired: boolean;
  trainingGap: boolean;
  duplicate: boolean;
  reviewerNote: string;
  headline: string;
}

const LEVEL_RANK: Record<AccessLevel, number> = { Read: 1, 'Read + export': 2, Write: 3 };

const RE_IDENTIFICATION_PURPOSE = /fraud|investigat|case|re-identif|audit|compliance|incident/i;
const MARKETING_PURPOSE = /marketing|campaign|audience|targeting|acquisition|prospect/i;

function hasPii(asset: Asset, kind: string): boolean {
  return asset.columns.some((c) => c.pii === kind);
}

export function reviewAccessRequest(
  requestId: string,
  snapshot: GovernanceSnapshot,
): AccessReview {
  const request =
    snapshot.pendingAccessRequests.find((r) => r.id === requestId) ?? snapshot.pendingAccessRequests[0];
  const requester = snapshot.people.find((p) => p.id === request.requesterId) ?? snapshot.people[0];
  const asset = snapshot.assets.find((a) => a.id === request.assetId) ?? snapshot.assets[0];
  const owner = snapshot.people.find((p) => p.id === asset.ownerId);

  const effectiveClassification = asset.classification ?? 'Confidential';
  const requiresRestricted = effectiveClassification === 'Restricted';
  const exportRequested = request.requestedLevel !== 'Read';
  const writeRequested = request.requestedLevel === 'Write';
  const directIdentifiers = hasPii(asset, 'Direct identifier');
  const healthData = hasPii(asset, 'Health');
  const contractor = requester.role === 'Contractor';
  const marketingPurpose = MARKETING_PURPOSE.test(`${request.purpose} ${request.businessJustification}`);
  const reIdentificationPurpose = RE_IDENTIFICATION_PURPOSE.test(
    `${request.purpose} ${request.businessJustification}`,
  );

  const rationale: Rationale[] = [];
  const conditions: string[] = [];
  const blockers: string[] = [];
  const routeTo: string[] = [];

  // 1. Duplicate / already-held access.
  const existing = snapshot.accessGrants.find((g) => {
    if (g.personId !== requester.id || g.assetId !== asset.id) return false;
    const expired = g.expiresOn ? new Date(g.expiresOn) < new Date() : false;
    return !expired;
  });
  const duplicate =
    Boolean(existing) && LEVEL_RANK[existing!.level] >= LEVEL_RANK[request.requestedLevel];

  if (duplicate && existing) {
    blockers.push(
      `${requester.name} already holds ${existing.level} on ${asset.name} under grant ${existing.id}, valid to ${formatDate(existing.expiresOn)}.`,
    );
    rationale.push({
      text: `Access already granted at or above the requested level. Re-provisioning would widen standing access without a new justification, contrary to least privilege.`,
      clauseId: 'ACC-2.1',
      severity: 'High',
    });
  }

  // 2. Classification versus clearance.
  if (classificationRank(requester.clearance) < classificationRank(effectiveClassification)) {
    blockers.push(
      `Clearance gap: requester is cleared to ${requester.clearance}, the asset is ${effectiveClassification}.`,
    );
    rationale.push({
      text: `${asset.name} is ${effectiveClassification}${asset.classification ? '' : ' by default because it is unlabelled (POL-CLS-01 §5.1)'}. ${requester.name} holds ${requester.clearance} clearance, so this request cannot be approved at steward level.`,
      clauseId: asset.classification ? 'CLS-2.1' : 'CLS-5.1',
      severity: 'High',
    });
  } else {
    rationale.push({
      text: `Clearance is sufficient: ${requester.clearance} covers ${effectiveClassification}.`,
      clauseId: 'CLS-2.1',
      severity: 'Low',
    });
  }

  // 3. Unlabelled asset.
  if (!asset.classification) {
    conditions.push(
      'Do not provision until the asset is classified by the data owner; label it and re-run this review.',
    );
    rationale.push({
      text: 'The asset has no classification. Unclassified data is treated as Confidential and blocked from broad access until labelled.',
      clauseId: 'CLS-5.1',
      severity: 'High',
    });
  }

  // 4. Restricted data needs dual approval regardless of seniority.
  if (requiresRestricted) {
    routeTo.push('Data owner', 'Privacy Office');
    rationale.push({
      text: `${asset.name} is Restricted. Owner and Privacy Office approval are both required before provisioning, whatever the requester's seniority.`,
      clauseId: 'ACC-2.5',
      severity: 'High',
    });
  } else {
    routeTo.push(owner ? `${owner.name} (data owner)` : 'Data owner — currently unassigned');
  }

  // 5. Training prerequisite.
  const trainingGap = !requester.trainingCurrent;
  if (trainingGap) {
    conditions.push(
      'Complete the annual data handling training before access is activated (POL-ACC-05 §3.2).',
    );
    rationale.push({
      text: `${requester.name}'s annual data handling training is out of date. Training blocks activation, not the decision itself.`,
      clauseId: 'ACC-3.2',
      severity: 'Medium',
    });
  }

  // 6. Export entitlements.
  let maskingRequired = false;
  if (exportRequested && (directIdentifiers || healthData)) {
    maskingRequired = !reIdentificationPurpose;
    if (maskingRequired) {
      conditions.push(
        'Export must mask direct identifiers, or a re-identification approval must be attached to the ticket (POL-ACC-05 §5.1; POL-CLS-01 §4.2).',
      );
      rationale.push({
        text: 'Export is a separate entitlement and this extract would contain direct identifiers. Without an approved re-identification basis, masked columns are the maximum permissible.',
        clauseId: 'ACC-5.1',
        severity: 'High',
      });
    } else {
      conditions.push(
        'Log the case or audit reference against the export and delete the extract when the case closes (POL-RET-03 §3.6).',
      );
    }
  }

  // 7. Purpose-specific prohibitions and requirements.
  if (marketingPurpose && healthData) {
    blockers.push('Health data may never be used for marketing or audience targeting.');
    rationale.push({
      text: 'The stated purpose reads as marketing or audience targeting and the asset carries health indicators. This use is prohibited outright, not conditionally.',
      clauseId: 'PRV-2.4',
      severity: 'Critical',
    });
  } else if (marketingPurpose) {
    conditions.push(
      'Restrict the audience to customers with an active channel-level opt-in from the consent ledger; withdrawals must apply within 24 hours (POL-PRIV-02 §2.4).',
    );
    rationale.push({
      text: 'Marketing use requires an active opt-in for the channel; health and special-category data are excluded entirely.',
      clauseId: 'PRV-2.4',
      severity: 'Medium',
    });
  }

  if (healthData && !reIdentificationPurpose && !requiresRestricted) {
    conditions.push('Attach a DPIA reference before any new processing of the health data.');
    rationale.push({
      text: 'Health-derived data requires a DPIA before new processing, including new derived features.',
      clauseId: 'PRV-5.2',
      severity: 'Medium',
    });
  }

  if (/fraud|investigat|case/i.test(`${request.purpose} ${request.businessJustification}`)) {
    conditions.push(
      'Record the case reference on the grant; access is reviewed monthly and revoked when the case closes (POL-CLM-02 §2.4).',
    );
    rationale.push({
      text: 'Fraud investigation access is case-by-case, logged to a case reference and reviewed monthly.',
      clauseId: 'CLM-2.4',
      severity: 'Medium',
    });
  }

  // 8. Time limits.
  const maxDays = contractor ? 90 : 365;
  const requestedDuration = 365;
  const grantedDays = Math.min(requestedDuration, maxDays);
  if (contractor) {
    conditions.push('Contractor grants are capped at 90 days and must not roll over automatically (POL-ACC-05 §2.7).');
    rationale.push({
      text: `${requester.name} is engaged as a contractor. Third-party grants expire after a maximum of 90 days.`,
      clauseId: 'ACC-2.7',
      severity: 'Medium',
    });
  }

  // 9. Purpose quality.
  const purposeLength = request.businessJustification.trim().length;
  if (purposeLength < 60) {
    conditions.push('Record a specific business purpose and the intended output before provisioning.');
    rationale.push({
      text: 'The justification is too thin to test against least privilege.',
      clauseId: 'ACC-2.1',
      severity: 'Low',
    });
  }

  // 10. Write access to sensitive data.
  if (writeRequested && requiresRestricted) {
    routeTo.push('Privacy Office');
    rationale.push({
      text: 'Write access to a Restricted asset needs both owner and Privacy approval, and should be limited to the system of record rather than a copy.',
      clauseId: 'ACC-2.5',
      severity: 'High',
    });
  }

  if (exportRequested && requiresRestricted) {
    routeTo.push('Privacy Office');
  }

  let decision: AccessDecision;
  if (blockers.length > 0) {
    decision = 'Deny';
  } else if (requiresRestricted || routeTo.some((r) => r.includes('Privacy'))) {
    decision = 'Escalate';
  } else if (conditions.length > 0) {
    decision = 'Approve with conditions';
  } else {
    decision = 'Approve';
  }

  const recommendedLevel: AccessLevel =
    maskingRequired && request.requestedLevel === 'Read + export' && !writeRequested
      ? 'Read'
      : request.requestedLevel;

  const riskScore = Math.min(
    100,
    12 +
      (requiresRestricted ? 28 : effectiveClassification === 'Confidential' ? 16 : 4) +
      (healthData ? 14 : 0) +
      (exportRequested ? 10 : 0) +
      (contractor ? 8 : 0) +
      (trainingGap ? 6 : 0) +
      (asset.classification ? 0 : 10) +
      (duplicate ? 12 : 0),
  );

  const decisionLine =
    decision === 'Deny'
      ? 'Not approved at steward level.'
      : decision === 'Escalate'
        ? 'Escalated for the approvals this request requires.'
        : decision === 'Approve with conditions'
          ? 'Recommended for approval subject to the conditions below.'
          : 'Recommended for approval.';

  const reviewerNote = [
    `Access review — ${request.id}`,
    `Asset: ${asset.name} (${asset.physicalName}) · ${effectiveClassification} · ${asset.criticality}`,
    `Requester: ${requester.name} (${requester.role}, clearance ${requester.clearance})`,
    `Requested: ${request.requestedLevel} → recommended ${recommendedLevel}`,
    `Purpose: ${request.purpose}`,
    '',
    `Decision: ${decision.toUpperCase()} — ${decisionLine}`,
    '',
    'Reasons',
    ...rationale.map((r) => `• ${r.text}${r.clauseId ? ` [${r.clauseId}]` : ''}`),
    '',
    'Conditions',
    ...(conditions.length > 0 ? conditions.map((c, i) => `${i + 1}. ${c}`) : ['None.']),
    '',
    `Approvals required: ${routeTo.length > 0 ? routeTo.join('; ') : 'Data owner'}`,
    `Expiry: ${formatDate(isoDate(addBusinessDays(grantedDays)))}`,
    `Prepared: ${formatDate(new Date())} · basis POL-ACC-05 v2.1, POL-CLS-01 v4.2, POL-PRIV-02 v3.0`,
  ].join('\n');

  const headline =
    decision === 'Deny'
      ? `Do not approve — ${blockers.length} blocking issue${blockers.length === 1 ? '' : 's'}`
      : decision === 'Escalate'
        ? 'Escalate — approvals outside steward authority'
        : decision === 'Approve with conditions'
          ? `Approve with ${plural(conditions.length, 'condition')}`
          : 'Approve as requested';

  return {
    request,
    requester,
    asset,
    owner,
    decision,
    riskScore,
    rationale,
    conditions,
    blockers,
    routeTo: Array.from(new Set(routeTo)),
    expiresOn: isoDate(addBusinessDays(grantedDays)),
    recommendedLevel,
    maskingRequired,
    trainingGap,
    duplicate,
    reviewerNote,
    headline,
  };
}

export function accessQueueStats(snapshot: GovernanceSnapshot) {
  const open = snapshot.pendingAccessRequests;
  const ages = open.map((r) => {
    const days = Math.floor((Date.now() - new Date(r.requestedOn).getTime()) / 86_400_000);
    return { id: r.id, days };
  });
  const oldest = ages.reduce((max, cur) => (cur.days > max.days ? cur : max), { id: '', days: 0 });
  const stale = ages.filter((a) => a.days > 5);
  return { open: open.length, oldest, stale: stale.length };
}
