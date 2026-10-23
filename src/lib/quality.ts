import type {
  Asset,
  GovernanceSnapshot,
  Person,
  QualityRule,
  Severity,
} from '../types';
import { addBusinessDays, formatDate, isoDate, plural } from './util';

export interface AssessmentFactor {
  label: string;
  points: number;
  detail: string;
}

export interface ProbableCause {
  cause: string;
  confidence: 'High' | 'Medium' | 'Low';
  evidence: string;
  firstCheck: string;
}

export interface QualityTriage {
  rule: QualityRule;
  asset: Asset;
  owner?: Person;
  steward?: Person;
  engineer?: Person;
  severity: Severity;
  score: number;
  factors: AssessmentFactor[];
  slaDays: number;
  dueOn: string;
  demotionRisk: boolean;
  affectedConsumers: number;
  causes: ProbableCause[];
  diagnostics: string[];
  stakeholderUpdate: string;
  clauseId: string;
}

const DIMENSION_WEIGHT: Record<QualityRule['dimension'], number> = {
  Accuracy: 16,
  Completeness: 15,
  Timeliness: 14,
  Uniqueness: 12,
  Validity: 12,
  Consistency: 10,
};

export function severityFromScore(score: number): Severity {
  if (score >= 78) return 'Critical';
  if (score >= 58) return 'High';
  if (score >= 38) return 'Medium';
  return 'Low';
}

export function slaDaysFor(severity: Severity): number {
  switch (severity) {
    case 'Critical':
      return 1;
    case 'High':
      return 3;
    case 'Medium':
      return 10;
    default:
      return 65;
  }
}

function columnFromRule(rule: QualityRule, asset: Asset): string | undefined {
  const first = rule.expression.split(/[\s(]/)[0]?.toLowerCase();
  return asset.columns.find((c) => c.name.toLowerCase() === first)?.name;
}

function buildCauses(rule: QualityRule, asset: Asset, column?: string): ProbableCause[] {
  const causes: ProbableCause[] = [];
  const worsening = rule.trend === 'worsening';
  const columnMeta = asset.columns.find((c) => c.name === column);

  if (rule.dimension === 'Completeness') {
    causes.push({
      cause: 'Source field became optional at the point of capture',
      confidence: worsening ? 'High' : 'Medium',
      evidence: `${rule.observed} against a ${rule.threshold} threshold${column ? ` on ${column}` : ''}, ${
        worsening ? 'worsening' : 'flat'
      } across runs. Optional-at-capture gaps persist rather than spike.`,
      firstCheck: column
        ? `Compare null rate for ${column} in ${asset.physicalName} with the same field in ${asset.sourceSystem}.`
        : `Compare null rates at ingest with ${asset.sourceSystem}.`,
    });
    causes.push({
      cause: 'Upstream extract or join dropping rows before load',
      confidence: 'Medium',
      evidence: `${asset.refresh} refresh from ${asset.sourceSystem}. A change to the extract query or an inner join will silently lose records.`,
      firstCheck: 'Reconcile source row counts against loaded row counts for the last seven runs.',
    });
    causes.push({
      cause: 'Late-arriving records outside the measurement window',
      confidence: columnMeta?.nullable ? 'Medium' : 'Low',
      evidence: 'Partition boundaries can exclude records that land after the quality check runs.',
      firstCheck: 'Re-run the rule after the next partition lands and compare the failure count.',
    });
  }

  if (rule.dimension === 'Uniqueness') {
    causes.push({
      cause: 'Natural key changed upstream, causing duplicates on reload',
      confidence: worsening ? 'High' : 'Medium',
      evidence: `${rule.observed}. Key changes combined with an append load produce duplicates instead of updates.`,
      firstCheck: 'Group by the key with COUNT(*) > 1 and inspect whether the duplicate rows differ only by load timestamp.',
    });
    causes.push({
      cause: 'Deduplication step skipped after a backfill',
      confidence: 'Medium',
      evidence: 'Backfills often bypass the merge step that enforces uniqueness downstream.',
      firstCheck: 'Check whether a backfill ran in the last week and whether the merge job followed it.',
    });
  }

  if (rule.dimension === 'Validity') {
    causes.push({
      cause: 'Source code-set or format change not reflected in the rule',
      confidence: worsening ? 'Medium' : 'Low',
      evidence: `${rule.observed} failing against a fixed pattern. Validity breaks cluster when a source releases a new format.`,
      firstCheck: column
        ? `Profile distinct formats of ${column} and compare with the rule pattern.`
        : 'Profile distinct value formats and compare with the rule pattern.',
    });
    causes.push({
      cause: 'Transformation in the pipeline introducing malformed values',
      confidence: 'Medium',
      evidence: 'A cast, trim or concatenation change can break values that were previously valid.',
      firstCheck: 'Compare values before and after the transformation layer for the same partition.',
    });
  }

  if (rule.dimension === 'Timeliness') {
    causes.push({
      cause: 'Scheduler lag or missed upstream completion SLA',
      confidence: worsening ? 'High' : 'Medium',
      evidence: `${rule.observed} against "${rule.threshold}". Lag that grows run over run points at the scheduler, not the data.`,
      firstCheck: 'Compare scheduled start, upstream completion and actual finish times for the last five runs.',
    });
    causes.push({
      cause: 'Upstream volume growth lengthening the load window',
      confidence: 'Low',
      evidence: `Row count is ${asset.rowCount.toLocaleString('en-GB')} with a ${asset.refresh.toLowerCase()} refresh.`,
      firstCheck: 'Plot runtime against row volume for the last 30 runs.',
    });
  }

  if (rule.dimension === 'Accuracy' || rule.dimension === 'Consistency') {
    causes.push({
      cause: 'Reconciliation logic drift between source and reporting model',
      confidence: 'Medium',
      evidence: `${rule.observed} against "${rule.threshold}". Small persistent variances usually come from differing filters or timing.`,
      firstCheck: 'Rebuild the figure from the source and compare each filter and join to the reporting model.',
    });
    causes.push({
      cause: 'Late adjustments not captured in the reporting period',
      confidence: 'Low',
      evidence: 'Post-close adjustments land after the quality check and appear as variance.',
      firstCheck: 'Check for post-close journals and re-run the reconciliation after they post.',
    });
  }

  return causes.slice(0, 3);
}

function buildDiagnostics(rule: QualityRule, asset: Asset, column?: string): string[] {
  const base = [
    `Confirm the rule is measuring what it claims: ${rule.expression}`,
    `Compare the last five runs of ${rule.id} to see whether the break is a step change or a drift.`,
  ];
  const byDimension: Record<QualityRule['dimension'], string[]> = {
    Completeness: [
      column
        ? `Compare ${column} null rates at ingest, after transformation and in ${asset.physicalName}.`
        : 'Compare null rates at ingest, after transformation and in the published asset.',
      `Check ${asset.sourceSystem} release notes for fields made optional since the last green run.`,
      'Sample 20 failing rows and confirm whether the field is genuinely missing or mapped to a sentinel value.',
    ],
    Uniqueness: [
      'Group by the natural key with COUNT(*) > 1 and sample the duplicates.',
      'Check whether a backfill or re-load ran without the merge step.',
      'Confirm the key is not reused upstream after customer merges or policy renewals.',
    ],
    Validity: [
      column ? `Profile distinct formats and lengths of ${column}.` : 'Profile distinct value formats and lengths.',
      'Diff the transformation logic against the last successful version.',
      'Check whether the rule pattern still matches the contractual value format.',
    ],
    Timeliness: [
      'Pull scheduler history for the last 10 runs: scheduled, upstream complete, finished.',
      'Measure p95 completion time by partition and look for volume correlation.',
      'Confirm the freshness rule still measures the business expectation, not an outdated SLA.',
    ],
    Accuracy: [
      'Rebuild the reconciled figure directly from source and compare every filter.',
      'Check post-close adjustments and re-run after they post.',
      'Verify the reporting currency, rounding and FX date conventions match.',
    ],
    Consistency: [
      'Compare the same measure across both systems for the same period.',
      'Check that both sides use the same entity resolution and deduplication rules.',
    ],
  };
  return [...base, ...byDimension[rule.dimension], 'Record the root cause in the incident before closing it.'];
}

function impactSentence(rule: QualityRule, asset: Asset): string {
  const subject =
    rule.dimension === 'Completeness'
      ? 'Records with missing fields will drop out of segmentation and eligibility logic'
      : rule.dimension === 'Uniqueness'
        ? 'Duplicate rows will double-count customers in any untabulated report'
        : rule.dimension === 'Timeliness'
          ? 'Consumers will act on stale data until the feed catches up'
          : rule.dimension === 'Validity'
            ? 'Invalid values will flow into downstream models and regulated reporting'
            : 'Reported figures will differ from the ledger and invite challenge during audit';
  return `${subject}. ${plural(asset.downstreamCount, 'downstream asset')} read ${asset.name}.`;
}

export function triageRule(
  ruleId: string,
  snapshot: GovernanceSnapshot,
  stewardNote = '',
): QualityTriage {
  const rule = snapshot.rules.find((r) => r.id === ruleId) ?? snapshot.rules[0];
  const asset = snapshot.assets.find((a) => a.id === rule.assetId) ?? snapshot.assets[0];
  const owner = snapshot.people.find((p) => p.id === asset.ownerId);
  const steward = snapshot.people.find((p) => p.id === asset.stewardId);
  const engineer =
    snapshot.people.find((p) => p.role === 'Data Engineer' && p.domainId === 'platform') ??
    snapshot.people.find((p) => p.role === 'Data Engineer');

  const criticalityPoints =
    asset.criticality === 'Tier 1' ? 35 : asset.criticality === 'Tier 2' ? 22 : 10;
  const downstreamPoints =
    asset.downstreamCount >= 10 ? 20 : asset.downstreamCount >= 4 ? 13 : 6;
  const dimensionPoints = DIMENSION_WEIGHT[rule.dimension];
  const failureRatio = asset.rowCount > 0 ? rule.failedRows / asset.rowCount : 0;
  const magnitudePoints =
    rule.failedRows === 0
      ? 4
      : failureRatio >= 0.01
        ? 18
        : failureRatio >= 0.001
          ? 12
          : 6;
  const trendPoints = rule.trend === 'worsening' ? 12 : rule.trend === 'stable' ? 5 : 0;

  const factors: AssessmentFactor[] = [
    {
      label: 'Asset criticality',
      points: criticalityPoints,
      detail: `${asset.criticality} asset in the ${asset.domainId} domain.`,
    },
    {
      label: 'Downstream reach',
      points: downstreamPoints,
      detail: `${plural(asset.downstreamCount, 'consumer')} depend on ${asset.name}.`,
    },
    {
      label: `Dimension: ${rule.dimension}`,
      points: dimensionPoints,
      detail:
        rule.dimension === 'Accuracy'
          ? 'Accuracy failures propagate into reported numbers and are expensive to unwind.'
          : `${rule.dimension} failures change how rows are selected or interpreted downstream.`,
    },
    {
      label: 'Deviation size',
      points: magnitudePoints,
      detail:
        rule.failedRows > 0
          ? `${rule.failedRows.toLocaleString('en-GB')} failing rows (${(failureRatio * 100).toFixed(2)}% of the table).`
          : `Threshold breach without row-level failures: ${rule.observed}.`,
    },
    {
      label: 'Direction of travel',
      points: trendPoints,
      detail: `${rule.trend} across recent runs.`,
    },
  ];

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  let score = Math.min(100, raw);
  let severity = severityFromScore(score);

  // POL-QUAL-04 §3.2: a Tier 1 asset failure with customer or regulatory reach is never Low.
  if (asset.criticality === 'Tier 1' && asset.downstreamCount >= 4 && severityRank(severity) < 3) {
    severity = 'High';
    score = Math.max(score, 60);
  }
  if (rule.status === 'Warning' && severityRank(severity) > 3) {
    severity = 'High';
  }

  const slaDays = slaDaysFor(severity);
  const dueOn = isoDate(addBusinessDays(slaDays));
  const column = columnFromRule(rule, asset);
  const causes = buildCauses(rule, asset, column);
  const demotionRisk = asset.criticality === 'Tier 1' && rule.status === 'Failing';
  const diagnostics = buildDiagnostics(rule, asset, column);

  const nextUpdate = isoDate(addBusinessDays(Math.max(1, Math.min(2, slaDays))));
  const stakeholderUpdate = [
    `Subject: [${severity}] Data quality incident — ${asset.name} / ${rule.name}`,
    '',
    'What happened',
    `${rule.observed} against a threshold of "${rule.threshold}" on ${asset.name} (${asset.physicalName}). Detected on the ${formatDate(rule.lastRun)} run of rule ${rule.id}.`,
    '',
    'Who is affected',
    `${plural(asset.downstreamCount, 'downstream asset')} consume this data, including ${asset.criticality} reporting. ${demotionRisk ? 'Certification is at risk under POL-QUAL-04 §5.1 and consumers must be told if the asset is demoted to Endorsed.' : 'No certification change yet.'}`,
    '',
    'Impact',
    impactSentence(rule, asset),
    '',
    'What we are doing',
    `${steward?.name ?? '[steward]'} owns the incident with ${owner?.name ?? '[data owner]'} as accountable owner. ${engineer?.name ?? 'The platform team'} is testing probable causes now. Target remediation is ${formatDate(dueOn)} (${severity} SLA, ${slaDays === 1 ? '1 business day' : `${slaDays} business days`}).`,
    '',
    'Next update',
    `${formatDate(nextUpdate)}${stewardNote ? `\n\nAdditional context from the steward: ${stewardNote.trim()}` : ''}`,
  ].join('\n');

  return {
    rule,
    asset,
    owner,
    steward,
    engineer,
    severity,
    score,
    factors,
    slaDays,
    dueOn,
    demotionRisk,
    affectedConsumers: asset.downstreamCount,
    causes,
    diagnostics,
    stakeholderUpdate,
    clauseId: 'QLT-3.2',
  };
}

function severityRank(severity: Severity): number {
  return severity === 'Critical' ? 4 : severity === 'High' ? 3 : severity === 'Medium' ? 2 : 1;
}
