import { useMemo, useState } from 'react';
import { snapshot } from '../../data/seed';
import {
  glossaryIssues,
  reviewCatalogAsset,
  type CatalogReview,
} from '../../lib/catalog';
import { assignablePeople, recKey, useDecisions } from '../../lib/decisions';
import { formatDate, percent, relativeDays } from '../../lib/util';
import { DecisionControls } from '../Decision';
import { PageHead } from '../Shell';
import {
  Badge,
  Callout,
  Card,
  CardHead,
  ClauseChip,
  CopyButton,
  Empty,
  Field,
  Icon,
  Meter,
  SeverityBadge,
} from '../ui';

const DEFAULT_ASSET = 'AST-1041';

export function CatalogCurationPage() {
  const [assetId, setAssetId] = useState(DEFAULT_ASSET);
  const [proposedTerm, setProposedTerm] = useState('');
  const [review, setReview] = useState<CatalogReview>(() =>
    reviewCatalogAsset(DEFAULT_ASSET, snapshot),
  );

  const issues = useMemo(() => glossaryIssues(snapshot), []);
  const { decisions } = useDecisions();

  function runReview(nextAsset = assetId, term = proposedTerm) {
    setReview(reviewCatalogAsset(nextAsset, snapshot, term));
  }

  const { asset, owner, steward } = review;
  const gapPeople = assignablePeople(snapshot, asset.domainId);
  const glossaryPeople = assignablePeople(snapshot);
  const scoreTone =
    review.band === 'Healthy' ? 'accent' : review.band === 'Needs curation' ? 'medium' : 'critical';

  return (
    <>
      <PageHead
        eyebrow="Agent assistant · Catalog curation"
        title="Catalog Curation"
        lede="Audit an asset's catalog entry against the governance standard, find the gaps that block certification, settle classification and stop duplicate glossary terms before they spread."
        actions={<Badge tone="neutral">{snapshot.assets.length} assets indexed</Badge>}
      />

      <Card>
        <CardHead
          title="Choose the asset to curate"
          sub="The agent reads the catalog record, column profile and glossary links, then applies the classification and certification standards."
        />
        <div className="card-body stack">
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto', alignItems: 'end' }}>
            <Field label="Asset" htmlFor="catalog-asset">
              <select
                id="catalog-asset"
                className="select"
                value={assetId}
                onChange={(e) => {
                  setAssetId(e.target.value);
                  runReview(e.target.value, proposedTerm);
                }}
              >
                {snapshot.domains.map((domain) => (
                  <optgroup key={domain.id} label={domain.name}>
                    {snapshot.assets
                      .filter((a) => a.domainId === domain.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.id}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field
              label="New term you are about to add"
              hint="Optional. Used to check for duplicate or overlapping glossary terms."
              htmlFor="catalog-term"
            >
              <input
                id="catalog-term"
                className="input"
                placeholder="e.g. policyholder"
                value={proposedTerm}
                onChange={(e) => setProposedTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runReview();
                }}
              />
            </Field>
            <button type="button" className="btn btn-primary" onClick={() => runReview()}>
              <Icon name="spark" size={14} />
              Review asset
            </button>
          </div>
        </div>
      </Card>

      <div className="section stack fade-in">
        <Card>
          <div className="card-body">
            <div className="split" style={{ alignItems: 'start' }}>
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600 }}>
                    {asset.name}
                  </h2>
                  <Badge tone={asset.trustLevel === 'Certified' ? 'accent' : 'neutral'}>
                    {asset.trustLevel}
                  </Badge>
                  <Badge tone={asset.criticality === 'Tier 1' ? 'high' : 'neutral'}>
                    {asset.criticality}
                  </Badge>
                  <Badge tone={asset.classification ? 'info' : 'critical'}>
                    {asset.classification ?? 'Unclassified'}
                  </Badge>
                </div>
                <div className="mono muted" style={{ marginBottom: 10 }}>
                  {asset.physicalName} · {asset.type} · {owner?.name ?? 'No owner'} (owner) ·{' '}
                  {steward?.name ?? 'No steward'} (steward)
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-2)', maxWidth: '62ch' }}>
                  {asset.description ?? 'No business description recorded.'}
                </p>
                <div className="chip-row" style={{ marginTop: 12 }}>
                  <span className="chip">{asset.domainId} domain</span>
                  <span className="chip">{asset.refresh} refresh</span>
                  <span className="chip">{asset.rowCount.toLocaleString('en-GB')} rows</span>
                  <span className="chip">{asset.downstreamCount} downstream</span>
                  <span className="chip">
                    profiled {relativeDays(asset.lastProfiled)} · reviewed{' '}
                    {relativeDays(asset.lastReviewed)}
                  </span>
                </div>
              </div>

              <div className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                <div className="card-body">
                  <div className="score-panel">
                    <div>
                      <div className="score-num">
                        {review.score}
                        <span>/100</span>
                      </div>
                    </div>
                    <div className="score-meta">
                      <div className="row" style={{ gap: 6 }}>
                        <Badge tone={scoreTone}>{review.band}</Badge>
                      </div>
                      <Meter value={review.score} tone={scoreTone === 'accent' ? 'accent' : scoreTone} />
                      <div className="small muted">
                        {review.gaps.length === 0
                          ? 'Catalog entry meets the standard.'
                          : `${review.gaps.length} curation gap${review.gaps.length === 1 ? '' : 's'} to close`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="split">
          <div className="stack">
            <Card>
              <CardHead
                title="Curation gaps"
                sub="Ordered by the risk each gap creates for consumers, certification and audit."
                aside={<Badge tone={review.gaps.length > 0 ? 'high' : 'accent'}>{review.gaps.length} open</Badge>}
              />
              {review.gaps.length === 0 ? (
                <div className="card-body">
                  <Empty title="Nothing outstanding">
                    This entry is complete, classified and reviewed inside the standard windows.
                  </Empty>
                </div>
              ) : (
                <div className="list">
                  {review.gaps.map((gap) => {
                    const reference = recKey.catalogGap(asset.id, gap.id);
                    return (
                      <div
                        className={`list-item${decisions[reference] ? ` decided decided-${decisions[reference].status}` : ''}`}
                        key={gap.id}
                      >
                        <div className="list-title">
                          <SeverityBadge severity={gap.severity} />
                          {gap.label}
                          <ClauseChip id={gap.clauseId} />
                        </div>
                        <div className="list-detail">{gap.detail}</div>
                        <div className="list-action">{gap.action}</div>
                        <DecisionControls reference={reference} people={gapPeople} label="Gap decision" />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card>
              <CardHead
                title="Definition draft"
                sub="Built from the asset's grain, columns, source and consumers. Edit, then confirm with the owner."
                aside={<CopyButton text={review.definitionDraft} />}
              />
              <div className="card-body stack">
                <pre className="pre">{review.definitionDraft}</pre>
                <div className="hint">
                  Inferred grain: <strong>{review.grain}</strong>. The draft is a starting point — add
                  what the asset deliberately excludes before you publish it.
                </div>
              </div>
            </Card>

            <Card>
              <CardHead
                title="Classification recommendation"
                sub="Derived from column-level personal data, following POL-CLS-01 and POL-CLM-02."
                aside={
                  <Badge tone={review.classificationMismatch ? 'critical' : 'info'}>
                    Suggest {review.recommendedClassification}
                  </Badge>
                }
              />
              <div className="card-body stack">
                {review.classificationMismatch ? (
                  <Callout tone="danger" title="Recorded classification is lower than the standard allows">
                    The asset is labelled {asset.classification} but the columns indicate{' '}
                    {review.recommendedClassification}. Raise it with the owner before the next
                    access grant or certification.
                  </Callout>
                ) : null}
                {review.classificationRationale.map((reason) => (
                  <div className="list-detail" key={reason}>
                    · {reason}
                  </div>
                ))}

                <div className="divider" />

                <div className="spread">
                  <div className="label" style={{ marginBottom: 0 }}>
                    Column-level findings
                  </div>
                  <span className="tiny muted">{review.piiFindings.length} sensitive columns</span>
                </div>
                {review.piiFindings.length === 0 ? (
                  <p className="small muted">No personal, financial or health attributes detected.</p>
                ) : (
                  <table className="table" style={{ margin: '0 -16px', width: 'calc(100% + 32px)' }}>
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Kind</th>
                        <th>Handling</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.piiFindings.map((finding) => (
                        <tr key={finding.column}>
                          <td className="num">{finding.column}</td>
                          <td>
                            <Badge tone={finding.kind === 'Health' ? 'critical' : 'medium'}>
                              {finding.kind}
                            </Badge>
                          </td>
                          <td className="small">{finding.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <CardHead
                title="Term collisions"
                sub={`Checked against "${proposedTerm.trim() || asset.name.replace(/_/g, ' ')}"`}
                aside={<Badge tone={review.collisions.length > 0 ? 'high' : 'accent'}>{review.collisions.length}</Badge>}
              />
              {review.collisions.length === 0 ? (
                <div className="card-body">
                  <Empty title="No overlapping terms">This wording is distinct in the glossary.</Empty>
                </div>
              ) : (
                <div className="list">
                  {review.collisions.map((collision) => (
                    <div className="list-item" key={collision.termId}>
                      <div className="list-title">
                        {collision.term}
                        <span className="mono muted">{collision.termId}</span>
                        <Badge tone={collision.kind === 'Duplicate term' ? 'critical' : 'medium'}>
                          {collision.kind}
                        </Badge>
                        <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                          {Math.round(collision.similarity * 100)}% overlap
                        </span>
                      </div>
                      <div className="list-detail">{collision.recommendation}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHead title="Glossary links" sub="Terms already attached, plus ones this asset probably needs." />
              <div className="card-body stack">
                {review.linkedTerms.length === 0 ? (
                  <p className="small muted">No approved term is linked to this asset yet.</p>
                ) : (
                  <div className="chip-row">
                    {review.linkedTerms.map((term) => (
                      <span className="chip" key={term.id}>
                        {term.term}
                        <Badge tone={term.status === 'Approved' ? 'accent' : 'medium'}>{term.status}</Badge>
                      </span>
                    ))}
                  </div>
                )}
                {review.suggestedTerms.length > 0 ? (
                  <>
                    <div className="divider" />
                    <div className="label" style={{ marginBottom: 0 }}>
                      Suggested links
                    </div>
                    {review.suggestedTerms.map((term) => (
                      <div className="spread small" key={term.id}>
                        <span>{term.term}</span>
                        <span className="mono muted">{term.id}</span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHead title="Related assets" sub="Shared tags or columns — usually the same curation decisions apply." />
              <div className="card-body">
                {review.relatedAssets.length === 0 ? (
                  <p className="small muted">No related assets found.</p>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {review.relatedAssets.map((related) => (
                      <button
                        key={related.id}
                        type="button"
                        className="example-chip"
                        style={{ borderRadius: 8, textAlign: 'left', whiteSpace: 'normal' }}
                        onClick={() => {
                          setAssetId(related.id);
                          runReview(related.id, '');
                        }}
                      >
                        <span className="mono">{related.name}</span>
                        <span className="muted small"> · {related.trustLevel} · {related.classification ?? 'unclassified'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        <Card>
          <CardHead
            title="Score breakdown"
            sub="Weighted against the catalog completeness standard. Partial credit where the record is half there."
            aside={<Badge tone={scoreTone}>{review.score}/100</Badge>}
          />
          <div className="card-body breakdown">
            {review.checks.map((check) => (
              <div className="breakdown-row" key={check.label}>
                <div className="breakdown-label">
                  <span className={`dot ${check.passed ? 'dot-pass' : 'dot-fail'}`} />
                  {check.label}
                </div>
                <div title={check.detail}>
                  <Meter
                    value={percent(check.earned, check.weight)}
                    tone={check.passed ? 'low' : check.earned > 0 ? 'medium' : 'high'}
                  />
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    {check.detail}
                  </div>
                </div>
                <div className="breakdown-points">
                  {check.earned}/{check.weight}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Glossary hygiene"
            sub="Cross-term checks across the whole glossary — duplicates, shared synonyms and missing owners."
            aside={<Badge tone="neutral">{issues.length} findings</Badge>}
          />
          {issues.length === 0 ? (
            <div className="card-body">
              <Empty title="Glossary is clean" />
            </div>
          ) : (
            <div className="list">
              {issues.slice(0, 8).map((issue) => {
                const reference = recKey.glossaryIssue(issue.id);
                return (
                  <div
                    className={`list-item${decisions[reference] ? ` decided decided-${decisions[reference].status}` : ''}`}
                    key={issue.id}
                  >
                    <div className="list-title">
                      <SeverityBadge severity={issue.severity} />
                      {issue.kind}
                      <span className="mono muted">{issue.terms.join(' · ')}</span>
                    </div>
                    <div className="list-detail">{issue.detail}</div>
                    <div className="list-action">{issue.action}</div>
                    <DecisionControls reference={reference} people={glossaryPeople} label="Term decision" />
                  </div>
                );
              })}
            </div>
          )}
          <div className="card-foot">
            {formatDate(snapshot.asOf)} · {snapshot.terms.length} terms, {snapshot.terms.filter((t) => !t.ownerId).length} without an owner
          </div>
        </Card>
      </div>
    </>
  );
}
