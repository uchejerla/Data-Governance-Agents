import { useState } from 'react';
import { snapshot } from '../../data/seed';
import { reviewAccessRequest, type AccessReview } from '../../lib/access';
import { assignablePeople, recKey } from '../../lib/decisions';
import { daysSince, formatDate, plural } from '../../lib/util';
import { DecisionControls } from '../Decision';
import { PageHead } from '../Shell';
import {
  Badge,
  Callout,
  Card,
  CardHead,
  ClauseChip,
  CopyButton,
  Field,
  Icon,
  Meter,
  Stat,
} from '../ui';

const DEFAULT_REQUEST = 'AR-2201';

export function AccessReviewPage() {
  const [requestId, setRequestId] = useState(DEFAULT_REQUEST);
  const [review, setReview] = useState<AccessReview>(() =>
    reviewAccessRequest(DEFAULT_REQUEST, snapshot),
  );

  function run(next = requestId) {
    setReview(reviewAccessRequest(next, snapshot));
  }

  const { request, requester, asset, owner, decision } = review;
  const tone =
    decision === 'Approve'
      ? 'low'
      : decision === 'Approve with conditions'
        ? 'medium'
        : decision === 'Escalate'
          ? 'info'
          : 'critical';
  const bannerClass =
    decision === 'Approve'
      ? 'approve'
      : decision === 'Approve with conditions'
        ? 'conditions'
        : decision === 'Escalate'
          ? 'escalate'
          : 'deny';
  const age = daysSince(request.requestedOn) ?? 0;
  const piiColumns = asset.columns.filter((c) => c.pii);

  return (
    <>
      <PageHead
        eyebrow="Agent assistant · Access review"
        title="Access Request Reviewer"
        lede="Prepare a decision the owner can sign without re-reading the standard: clearance and classification tested, conditions stated, approvals routed, expiry set."
        actions={<Badge tone="neutral">{snapshot.pendingAccessRequests.length} in the queue</Badge>}
      />

      <Card>
        <CardHead
          title="Request under review"
          sub="The agent checks the requester, the asset's classification and columns, training status, purpose and any access already held."
        />
        <div className="card-body stack">
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) auto', alignItems: 'end' }}>
            <Field label="Pending request" htmlFor="access-request">
              <select
                id="access-request"
                className="select"
                value={requestId}
                onChange={(e) => {
                  setRequestId(e.target.value);
                  run(e.target.value);
                }}
              >
                {snapshot.pendingAccessRequests.map((r) => {
                  const person = snapshot.people.find((p) => p.id === r.requesterId);
                  const target = snapshot.assets.find((a) => a.id === r.assetId);
                  return (
                    <option key={r.id} value={r.id}>
                      {r.id} · {person?.name} → {target?.name} · {r.requestedLevel}
                    </option>
                  );
                })}
              </select>
            </Field>
            <div className="small muted">
              Requested {formatDate(request.requestedOn)} ·{' '}
              <strong style={{ color: age > 5 ? 'var(--high)' : 'var(--ink-2)' }}>{age} days waiting</strong>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => run()}>
              <Icon name="spark" size={14} />
              Prepare decision
            </button>
          </div>
        </div>
      </Card>

      <div className="section stack fade-in">
        <div className={`result-banner banner-${bannerClass}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ marginBottom: 5 }}>
              <Badge tone={tone}>{decision}</Badge>
              <Badge tone="neutral">{request.id}</Badge>
              <span className="mono muted">
                {requester.name} → {asset.name}
              </span>
            </div>
            <div className="result-headline">{review.headline}</div>
            <div className="result-sub">
              {request.requestedLevel} requested · recommended {review.recommendedLevel} · expires{' '}
              {formatDate(review.expiresOn)} · {plural(review.conditions.length, 'condition')}
            </div>
          </div>
          <div style={{ width: 170 }}>
            <div className="spread">
              <span className="label" style={{ marginBottom: 0 }}>
                Residual risk
              </span>
              <span className="mono">{review.riskScore}/100</span>
            </div>
            <Meter value={review.riskScore} tone={review.riskScore >= 70 ? 'critical' : review.riskScore >= 50 ? 'high' : 'medium'} />
            <div className="tiny muted" style={{ marginTop: 5 }}>
              Based on classification, export scope, training and term.
            </div>
          </div>
        </div>

        <Card className="decision-card">
          <DecisionControls
            reference={recKey.accessRequest(request.id)}
            people={assignablePeople(snapshot, asset.domainId)}
            label={`Steward recommendation · ${request.id}`}
            hint="Records whether you agree with this recommendation. The data owner still makes the decision."
          />
        </Card>

        {review.blockers.length > 0 ? (
          <Callout tone="danger" title="Blocking issues">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {review.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        <div className="grid grid-3" style={{ gap: 0, overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
          <Stat label="Requester" value={requester.name.split(' ')[0]} note={`${requester.role} · clearance ${requester.clearance}`} />
          <Stat label="Asset" value={asset.name} note={`${asset.classification ?? 'Unclassified'} · ${asset.criticality}`} />
          <Stat
            label="Expiry to set"
            value={formatDate(review.expiresOn)}
            note={requester.role === 'Contractor' ? '90-day contractor cap' : '365-day employee cap'}
          />
        </div>

        <div className="split">
          <div className="stack">
            <Card>
              <CardHead
                title="Why this decision"
                sub="Each reason is tied to a clause the owner can check."
                aside={<Badge tone={tone}>{review.rationale.length} points</Badge>}
              />
              <div className="list">
                {review.rationale.map((item, index) => (
                  <div className="list-item" key={`${item.clauseId ?? 'reason'}-${index}`}>
                    <div className="list-title">
                      <span className={`dot ${item.severity === 'Low' ? 'dot-pass' : 'dot-fail'}`} />
                      <ClauseChip id={item.clauseId} />
                      <Badge tone={item.severity === 'Low' ? 'low' : item.severity === 'Medium' ? 'medium' : item.severity === 'High' ? 'high' : 'critical'}>
                        {item.severity}
                      </Badge>
                    </div>
                    <div className="list-detail">{item.text}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHead
                title="Conditions to attach"
                sub="Provisioning must carry these into the ticket, not just the review note."
                aside={<Badge tone={review.conditions.length > 0 ? 'medium' : 'accent'}>{review.conditions.length}</Badge>}
              />
              <div className="card-body stack" style={{ gap: 10 }}>
                {review.conditions.length === 0 ? (
                  <p className="small muted">No conditions. Standard expiry and recertification apply.</p>
                ) : (
                  review.conditions.map((condition, index) => (
                    <div className="row" key={condition} style={{ gap: 9, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      <span className="mono muted" style={{ width: 20, flex: 'none' }}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="small">{condition}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <CardHead title="Request context" sub="What the requester asked for, in their words." />
              <div className="card-body stack">
                <div className="kv">
                  <div className="kv-row">
                    <span className="kv-key">Purpose</span>
                    <span className="kv-val">{request.purpose}</span>
                  </div>
                  <div className="kv-row">
                    <span className="kv-key">Justification</span>
                    <span className="kv-val" style={{ maxWidth: '38ch' }}>{request.businessJustification}</span>
                  </div>
                  <div className="kv-row">
                    <span className="kv-key">Data owner</span>
                    <span className="kv-val">{owner?.name ?? 'Unassigned — escalate'}</span>
                  </div>
                  <div className="kv-row">
                    <span className="kv-key">Training current</span>
                    <span className="kv-val">{requester.trainingCurrent ? 'Yes' : 'No — blocks activation'}</span>
                  </div>
                  <div className="kv-row">
                    <span className="kv-key">Existing access</span>
                    <span className="kv-val">{review.duplicate ? 'Already held at this level' : 'None'}</span>
                  </div>
                </div>

                {piiColumns.length > 0 ? (
                  <>
                    <div className="divider" />
                    <div className="label" style={{ marginBottom: 0 }}>
                      Sensitive columns in scope
                    </div>
                    <div className="chip-row">
                      {piiColumns.map((column) => (
                        <span className="chip" key={column.name}>
                          <span className="mono">{column.name}</span>
                          <span className="muted">{column.pii}</span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <CardHead title="Reviewer note" sub="Paste into the access ticket or workflow comment." aside={<CopyButton text={review.reviewerNote} />} />
              <div className="card-body">
                <pre className="pre">{review.reviewerNote}</pre>
              </div>
            </Card>

            <Card>
              <CardHead title="Route and approvals" />
              <div className="card-body stack">
                {review.routeTo.map((route) => (
                  <div className="row" key={route} style={{ gap: 8 }}>
                    <Icon name="arrow" size={13} />
                    <span className="small">{route}</span>
                  </div>
                ))}
                <div className="divider" />
                <p className="tiny muted">
                  Steward target: respond within 2 business days of the request. Expiry is set at
                  provisioning; standing access without an expiry is not permitted (POL-ACC-05 §2.7).
                </p>
              </div>
            </Card>

            <Card>
              <CardHead title="What happens next" />
              <div className="card-body stack" style={{ gap: 8 }}>
                {decision === 'Deny' ? (
                  <>
                    <p className="small">1. Reply to {requester.name.split(' ')[0]} with the blocking reason and the path that would unblock it.</p>
                    <p className="small">2. Route the unblocking work — classification, clearance or a narrower request — to the owner.</p>
                    <p className="small">3. Leave the request open only if an unblock is genuinely in progress; otherwise close it.</p>
                  </>
                ) : decision === 'Escalate' ? (
                  <>
                    <p className="small">1. Send the note to the data owner and Privacy Office with the conditions attached.</p>
                    <p className="small">2. Ask for a decision in writing against {request.id}; do not provision before both approvals land.</p>
                    <p className="small">3. Record the approvals on the grant and set the expiry shown here.</p>
                  </>
                ) : (
                  <>
                    <p className="small">1. Send the recommendation to the data owner with the conditions attached.</p>
                    <p className="small">2. On approval, provision at {review.recommendedLevel} with the expiry shown.</p>
                    <p className="small">3. Add the grant to the quarterly recertification list.</p>
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
