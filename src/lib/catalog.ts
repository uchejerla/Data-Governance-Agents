import type {
  Asset,
  Classification,
  GovernanceSnapshot,
  GlossaryTerm,
  Person,
  Severity,
} from '../types';
import {
  clamp,
  daysSince,
  jaccard,
  percent,
  plural,
  tokenize,
  unique,
} from './util';

export interface CatalogCheck {
  label: string;
  passed: boolean;
  weight: number;
  earned: number;
  detail: string;
}

export interface CatalogGap {
  id: string;
  label: string;
  detail: string;
  severity: Severity;
  action: string;
  clauseId?: string;
}

export interface TermCollision {
  termId: string;
  term: string;
  similarity: number;
  kind: 'Duplicate term' | 'Overlapping term' | 'Synonym clash';
  recommendation: string;
}

export interface PiiFinding {
  column: string;
  kind: string;
  reason: string;
  action: string;
}

export interface CatalogReview {
  asset: Asset;
  owner?: Person;
  steward?: Person;
  score: number;
  band: 'Healthy' | 'Needs curation' | 'At risk';
  checks: CatalogCheck[];
  gaps: CatalogGap[];
  recommendedClassification: Classification;
  classificationRationale: string[];
  classificationMismatch: boolean;
  piiFindings: PiiFinding[];
  collisions: TermCollision[];
  linkedTerms: GlossaryTerm[];
  suggestedTerms: GlossaryTerm[];
  relatedAssets: Asset[];
  definitionDraft: string;
  grain: string;
}

const TIER_SEVERITY: Record<Asset['criticality'], Severity> = {
  'Tier 1': 'Critical',
  'Tier 2': 'High',
  'Tier 3': 'Medium',
};

export function grainFor(asset: Asset): string {
  const cols = asset.columns.map((c) => c.name);
  const entity = cols.find((c) => c.endsWith('_id'))?.replace(/_id$/, '').replace(/_/g, ' ');
  const dateCol = cols.find((c) => /^(valid_from|fiscal_month|scored_at|period|event_at)$/.test(c));

  if (cols.includes('valid_from') && cols.includes('valid_to')) {
    return `one row per ${entity ?? 'entity'} per validity period, closed by valid_to`;
  }
  if (entity && dateCol) return `one row per ${entity} per ${dateCol}`;
  if (entity) return `one row per ${entity}`;
  if (dateCol) return `one row per ${dateCol}`;
  return 'one row per record (confirm the natural key)';
}

function recommendClassification(asset: Asset): { level: Classification; rationale: string[] } {
  const rationale: string[] = [];
  const kinds = new Set(asset.columns.map((c) => c.pii).filter(Boolean));

  if (kinds.has('Health')) {
    rationale.push(
      'The asset carries health or diagnosis attributes. POL-CLM-02 §2.1 makes health-bearing claims data Restricted regardless of aggregation.',
    );
    return { level: 'Restricted', rationale };
  }
  if (kinds.has('Sensitive free text')) {
    rationale.push(
      'Free-text notes can contain health, vulnerability or complaint detail. Sample the field for special-category content before settling on Confidential.',
    );
  }
  if (kinds.has('Direct identifier') || kinds.has('Contact')) {
    rationale.push(
      'Direct identifiers (names, identifiers, contact details) make the asset personal data, which cannot sit below Confidential under POL-CLS-01 §2.1.',
    );
  }
  if (kinds.has('Financial')) {
    rationale.push('Financial attributes widen the blast radius and push handling to Confidential.');
  }
  if (kinds.has('Quasi identifier')) {
    rationale.push(
      'Quasi identifiers (postcode, date of birth) carry re-identification risk; treat as Confidential when combined with other attributes.',
    );
  }
  if (rationale.length === 0) {
    rationale.push('No personal, financial or health attributes were detected at column level, so Internal is sufficient.');
  }

  const level: Classification = kinds.has('Direct identifier') || kinds.has('Financial') || kinds.has('Contact')
    ? 'Confidential'
    : 'Internal';
  return { level, rationale };
}

function termTokens(term: GlossaryTerm): string[] {
  return unique([...tokenize(term.term), ...term.synonyms.flatMap(tokenize)]);
}

export function findCollisions(
  candidate: string,
  terms: GlossaryTerm[],
  domainId?: string,
): TermCollision[] {
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return [];

  const results: TermCollision[] = [];
  for (const term of terms) {
    const nameTokens = tokenize(term.term);
    const synonymTokens = term.synonyms.flatMap(tokenize);
    const allTokens = termTokens(term);

    const exact = candidate.trim().toLowerCase() === term.term.toLowerCase();
    const synonymHit = synonymTokens.includes(candidateTokens.join(' ')) ||
      term.synonyms.some((s) => s.toLowerCase() === candidate.trim().toLowerCase());
    const similarity = jaccard(candidateTokens, allTokens);
    const nameSimilarity = jaccard(candidateTokens, nameTokens);
    const containment =
      candidateTokens.every((t) => allTokens.includes(t)) || allTokens.every((t) => candidateTokens.includes(t));

    if (!exact && !synonymHit && !containment && similarity < 0.34) continue;

    const kind: TermCollision['kind'] = exact
      ? 'Duplicate term'
      : synonymHit
        ? 'Synonym clash'
        : 'Overlapping term';

    const recommendation =
      kind === 'Duplicate term'
        ? `Do not publish a second "${term.term}". Link the asset to ${term.id} or propose a change to its definition.`
        : kind === 'Synonym clash'
          ? `"${candidate.trim()}" is already a synonym of ${term.term} (${term.id}). Align the wording rather than creating a new term.`
          : `Reads as a variant of ${term.term} (${term.id}). Decide whether this is the same concept; if it is narrower, make it a child term with the distinction stated.`;

    const domainBoost = domainId && term.domainId === domainId ? 0.08 : 0;
    results.push({
      termId: term.id,
      term: term.term,
      similarity: clamp(Math.round((Math.max(similarity, nameSimilarity) + domainBoost) * 100) / 100, 0, 1),
      kind,
      recommendation,
    });
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

export function reviewCatalogAsset(
  assetId: string,
  snapshot: GovernanceSnapshot,
  proposedTerm = '',
): CatalogReview {
  const asset = snapshot.assets.find((a) => a.id === assetId) ?? snapshot.assets[0];
  const owner = snapshot.people.find((p) => p.id === asset.ownerId);
  const steward = snapshot.people.find((p) => p.id === asset.stewardId);
  const descriptionLength = asset.description?.trim().length ?? 0;
  const describedColumns = asset.columns.filter((c) => c.description).length;
  const columnCoverage = describedColumns / asset.columns.length;
  const profiledAgo = daysSince(asset.lastProfiled);
  const reviewedAgo = daysSince(asset.lastReviewed);
  const linkedTerms = snapshot.terms.filter((t) => asset.glossaryTermIds.includes(t.id));
  const failingTier1 = snapshot.rules.filter(
    (r) => r.assetId === asset.id && r.status === 'Failing' && asset.criticality === 'Tier 1',
  );

  const checks: CatalogCheck[] = [
    {
      label: 'Business description',
      passed: descriptionLength >= 80,
      weight: 14,
      earned: descriptionLength >= 80 ? 14 : descriptionLength >= 40 ? 7 : 0,
      detail:
        descriptionLength >= 80
          ? `${descriptionLength} characters — enough for a consumer to judge fitness.`
          : descriptionLength > 0
            ? `Only ${descriptionLength} characters. Say what the asset contains, its grain and what it excludes.`
            : 'No description. Consumers cannot judge fitness for use.',
    },
    {
      label: 'Accountable owner',
      passed: Boolean(owner),
      weight: 14,
      earned: owner ? 14 : 0,
      detail: owner ? `${owner.name} (${owner.role})` : 'No data owner assigned — approval and certification have no authority.',
    },
    {
      label: 'Assigned steward',
      passed: Boolean(steward),
      weight: 8,
      earned: steward ? 8 : 0,
      detail: steward ? `${steward.name}` : 'No steward. Curation work has no named owner.',
    },
    {
      label: 'Classification recorded',
      passed: Boolean(asset.classification),
      weight: 14,
      earned: asset.classification ? 14 : 0,
      detail: asset.classification
        ? `Recorded as ${asset.classification}.`
        : 'Unlabelled assets default to Confidential and cannot be certified (POL-CLS-01 §5.1).',
    },
    {
      label: 'Glossary linkage',
      passed: linkedTerms.length > 0,
      weight: 10,
      earned: linkedTerms.length > 0 ? 10 : 0,
      detail:
        linkedTerms.length > 0
          ? `Linked to ${plural(linkedTerms.length, 'term')}: ${linkedTerms.map((t) => t.term).join(', ')}.`
          : 'No business terms linked, so the asset is not discoverable by business meaning.',
    },
    {
      label: 'Column documentation',
      passed: columnCoverage >= 0.8,
      weight: 12,
      earned: Math.round(columnCoverage * 12),
      detail: `${describedColumns} of ${plural(asset.columns.length, 'column')} described (${percent(describedColumns, asset.columns.length)}%).`,
    },
    {
      label: 'Recent profiling',
      passed: profiledAgo !== null && profiledAgo <= 90,
      weight: 14,
      earned: profiledAgo !== null && profiledAgo <= 90 ? 14 : profiledAgo !== null && profiledAgo <= 180 ? 7 : 0,
      detail: profiledAgo === null ? 'Never profiled.' : `Last profiled ${profiledAgo} days ago.`,
    },
    {
      label: 'Steward review',
      passed: reviewedAgo !== null && reviewedAgo <= 180,
      weight: 8,
      earned: reviewedAgo !== null && reviewedAgo <= 180 ? 8 : 0,
      detail: reviewedAgo === null ? 'No recorded review.' : `Last reviewed ${reviewedAgo} days ago.`,
    },
    {
      label: 'Certification readiness',
      passed: failingTier1.length === 0,
      weight: 6,
      earned: failingTier1.length === 0 ? 6 : 0,
      detail:
        failingTier1.length === 0
          ? 'No failing Tier 1 quality rules.'
          : `${plural(failingTier1.length, 'failing Tier 1 rule')} would demote this asset (POL-QUAL-04 §5.1).`,
    },
  ];

  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  const score = Math.round((earned / 100) * 100);
  const band = score >= 85 ? 'Healthy' : score >= 60 ? 'Needs curation' : 'At risk';

  const gaps: CatalogGap[] = [];
  if (!asset.ownerId) {
    gaps.push({
      id: 'owner',
      label: 'Assign an accountable owner',
      detail: 'No owner means nobody can approve access or certify the asset.',
      severity: TIER_SEVERITY[asset.criticality],
      action: `Ask ${snapshot.domains.find((d) => d.id === asset.domainId)?.executive ?? 'the domain executive'} to name an owner this week.`,
      clauseId: 'CLS-3.1',
    });
  }
  if (!asset.stewardId) {
    gaps.push({
      id: 'steward',
      label: 'Name a steward',
      detail: 'Curation, quality follow-up and term linkage need a named steward.',
      severity: asset.criticality === 'Tier 1' ? 'High' : 'Medium',
      action: 'Assign to the domain steward rota and record it in the catalog.',
    });
  }
  if (!asset.classification) {
    gaps.push({
      id: 'classification',
      label: 'Record a classification',
      detail: 'Unlabelled data is treated as Confidential and blocked from certification and broad access.',
      severity: 'High',
      action: 'Confirm the suggested level with the owner, then label the asset.',
      clauseId: 'CLS-5.1',
    });
  }
  if (descriptionLength < 80) {
    gaps.push({
      id: 'description',
      label: 'Write the business description',
      detail: 'Consumers cannot tell what the asset contains or when it should not be used.',
      severity: asset.criticality === 'Tier 1' ? 'High' : 'Medium',
      action: 'Use the definition draft below as a starting point, then add exclusions.',
    });
  }
  if (linkedTerms.length === 0) {
    gaps.push({
      id: 'terms',
      label: 'Link at least one glossary term',
      detail: 'An unlinked asset cannot be found by business meaning.',
      severity: 'Medium',
      action: 'Link the best-fitting term, or propose a new term if none fits.',
    });
  }
  if (columnCoverage < 0.8) {
    gaps.push({
      id: 'columns',
      label: 'Document the remaining columns',
      detail: `${asset.columns.length - describedColumns} columns have no description.`,
      severity: 'Medium',
      action: 'Prioritise any identifier, financial or health column first.',
    });
  }
  if (failingTier1.length > 0) {
    gaps.push({
      id: 'quality',
      label: 'Resolve failing Tier 1 rules',
      detail: `${failingTier1.map((r) => r.name).join(', ')} ${failingTier1.length === 1 ? 'is' : 'are'} failing.`,
      severity: 'High',
      action: 'Triage in Data Quality Triage, then re-run certification.',
      clauseId: 'QLT-5.1',
    });
  }
  if (reviewedAgo !== null && reviewedAgo > 180) {
    gaps.push({
      id: 'review',
      label: 'Re-certify the catalog entry',
      detail: `Last steward review was ${reviewedAgo} days ago.`,
      severity: 'Medium',
      action: 'Confirm description, owner and classification, then record the review.',
    });
  }
  if (profiledAgo !== null && profiledAgo > 90) {
    gaps.push({
      id: 'profile',
      label: 'Re-profile the data',
      detail: `Profile is ${profiledAgo} days old; PII and distribution claims may be stale.`,
      severity: 'Medium',
      action: 'Schedule a profiling run and compare column-level PII against this review.',
    });
  }

  gaps.sort((a, b) => severityRankLocal(b.severity) - severityRankLocal(a.severity));

  const piiFindings: PiiFinding[] = asset.columns
    .filter((c) => c.pii)
    .map((c) => ({
      column: c.name,
      kind: c.pii as string,
      reason: c.description ?? 'Detected from the column name and type.',
      action: piiAction(c.pii as string),
    }));

  const { level, rationale } = recommendClassification(asset);
  const classificationMismatch =
    Boolean(asset.classification) &&
    classificationRankLocal(asset.classification) < classificationRankLocal(level);

  const candidate = proposedTerm.trim() || asset.name.replace(/_/g, ' ');
  const collisions = findCollisions(candidate, snapshot.terms, asset.domainId);

  const assetTokens = new Set(asset.columns.map((c) => c.name));
  const relatedAssets = snapshot.assets
    .filter((a) => a.id !== asset.id)
    .map((a) => {
      const sharedTags = a.tags.filter((t) => asset.tags.includes(t)).length;
      const sharedColumns = a.columns.filter((c) => assetTokens.has(c.name)).length;
      return { asset: a, overlap: sharedTags * 2 + sharedColumns };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3)
    .map((x) => x.asset);

  const assetNameTokens = tokenize(asset.name);
  const suggestedTerms = snapshot.terms
    .filter((t) => !asset.glossaryTermIds.includes(t.id))
    .map((t) => ({ term: t, score: jaccard(assetNameTokens, termTokens(t)) }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.term);

  const grain = grainFor(asset);
  const keyColumns = asset.columns.slice(0, 3).map((c) => c.name).join(', ');
  const draft = [
    `${asset.name} records ${grain}. It holds ${asset.columns.length} attributes including ${keyColumns}, sourced from ${asset.sourceSystem} and refreshed ${asset.refresh.toLowerCase()}.`,
    asset.description ? `Current documented scope: ${asset.description}` : '',
    `Known consumers: ${plural(asset.downstreamCount, 'downstream asset')}. Exclusions: [confirm what this asset deliberately does not cover].`,
    `Handling: ${asset.classification ?? level}${asset.classification ? '' : ' (suggested)'}. Owner: ${owner?.name ?? '[assign owner]'}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    asset,
    owner,
    steward,
    score,
    band,
    checks,
    gaps,
    recommendedClassification: level,
    classificationRationale: rationale,
    classificationMismatch,
    piiFindings,
    collisions,
    linkedTerms,
    suggestedTerms,
    relatedAssets,
    definitionDraft: draft,
    grain,
  };
}

function severityRankLocal(severity: Severity): number {
  return severity === 'Critical' ? 4 : severity === 'High' ? 3 : severity === 'Medium' ? 2 : 1;
}

function classificationRankLocal(c?: Classification): number {
  return c === 'Restricted' ? 3 : c === 'Confidential' ? 2 : c === 'Internal' ? 1 : 0;
}

function piiAction(kind: string): string {
  switch (kind) {
    case 'Direct identifier':
      return 'Mask or pseudonymise outside production; restrict export and require masking approval (POL-CLS-01 §4.2, POL-ACC-05 §5.1).';
    case 'Contact':
      return 'Expose only to consumers with a contactable purpose; mask in sandboxes and analytics extracts.';
    case 'Financial':
      return 'Handle as Confidential at minimum, restrict export and record the lawful basis for any new use.';
    case 'Health':
      return 'Handle as Restricted; a DPIA is required before any new processing or derived feature (POL-PRIV-02 §5.2).';
    case 'Quasi identifier':
      return 'Assess re-identification risk when combined with other attributes; require a fairness assessment if used as a model feature (POL-AI-07 §3.2).';
    case 'Sensitive free text':
      return 'Redact before broad sharing and sample for special-category content; treat as Restricted where health or vulnerability appears.';
    default:
      return 'Confirm handling with the data owner.';
  }
}

export interface GlossaryIssue {
  id: string;
  kind: 'No owner' | 'Thin definition' | 'Proposed too long' | 'Shared synonym' | 'Near duplicate';
  terms: string[];
  detail: string;
  severity: Severity;
  action: string;
}

export function glossaryIssues(snapshot: GovernanceSnapshot): GlossaryIssue[] {
  const issues: GlossaryIssue[] = [];

  for (const term of snapshot.terms) {
    if (!term.ownerId) {
      issues.push({
        id: `owner-${term.id}`,
        kind: 'No owner',
        terms: [`${term.term} (${term.id})`],
        detail: 'Nobody is accountable for approving or changing this definition.',
        severity: 'High',
        action: 'Assign an owner from the domain and confirm the definition with them.',
      });
    }
    if (!term.definition || term.definition.length < 80) {
      issues.push({
        id: `def-${term.id}`,
        kind: 'Thin definition',
        terms: [`${term.term} (${term.id})`],
        detail: term.definition
          ? `Definition is only ${term.definition.length} characters — not enough to decide inclusion or exclusion.`
          : 'No definition at all.',
        severity: 'Medium',
        action: 'State the concept, its boundaries and one worked exclusion.',
      });
    }
    if (term.status === 'Proposed' && (daysSince(term.lastUpdated) ?? 999) > 60) {
      issues.push({
        id: `age-${term.id}`,
        kind: 'Proposed too long',
        terms: [`${term.term} (${term.id})`],
        detail: 'Proposed terms that sit unapproved become shadow definitions in reports.',
        severity: 'Medium',
        action: 'Approve, merge or retire it at the next governance forum.',
      });
    }
  }

  const synonymOwners = new Map<string, GlossaryTerm[]>();
  for (const term of snapshot.terms) {
    for (const synonym of term.synonyms) {
      const key = tokenize(synonym).join(' ');
      if (!key) continue;
      const list = synonymOwners.get(key) ?? [];
      list.push(term);
      synonymOwners.set(key, list);
    }
  }
  for (const [synonym, owners] of synonymOwners) {
    if (owners.length > 1) {
      issues.push({
        id: `syn-${synonym.replace(/\s+/g, '-')}`,
        kind: 'Shared synonym',
        terms: owners.map((t) => `${t.term} (${t.id})`),
        detail: `"${synonym}" points at more than one approved concept, so reports can disagree while using the same word.`,
        severity: 'High',
        action: 'Decide which term owns the synonym and add a disambiguation note to the other.',
      });
    }
  }

  for (let i = 0; i < snapshot.terms.length; i += 1) {
    for (let j = i + 1; j < snapshot.terms.length; j += 1) {
      const a = snapshot.terms[i];
      const b = snapshot.terms[j];
      const similarity = jaccard(termTokens(a), termTokens(b));
      if (similarity >= 0.5) {
        issues.push({
          id: `dup-${a.id}-${b.id}`,
          kind: 'Near duplicate',
          terms: [`${a.term} (${a.id})`, `${b.term} (${b.id})`],
          detail: `Term names and synonyms overlap by ${Math.round(similarity * 100)}%, which usually means one concept is defined twice.`,
          severity: 'Medium',
          action: 'Merge into one approved term, keeping the other as a synonym.',
        });
      }
    }
  }

  return issues.sort((a, b) => severityRankLocal(b.severity) - severityRankLocal(a.severity));
}
