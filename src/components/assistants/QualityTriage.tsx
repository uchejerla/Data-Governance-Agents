import { useState } from 'react';
import { snapshot } from '../../data/seed';
import { assignablePeople, recKey } from '../../lib/decisions';
import { triageRule, type QualityTriage } from '../../lib/quality';
import { formatDate, plural } from '../../lib/util';
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
  SeverityBadge,
  Stat,
} from '../ui';

const DEFAULT_RULE = 'QR-01';
const CITED = ['QLT-3.2', 'QLT-4.1', 'QLT-5.1'];

export function QualityTriagePage() {
  const [ruleId, setRuleId] = useState(DEFAULT_RULE);
  const [note, setNote] = useState('');
  const [triage, setTriage] = useState<QualityTriage>(() => triageRule(DEFAULT_RULE, snapshot));

  function run(nextRule = ruleId, nextNote = note) {
    setTriage(triageRule(nextRule, snapshot, nextNote));
  }

  const { rule, asset, owner, steward, engineer, severity } = triage;
  const tone = severity === 'Critical' ? 'critical' : severity === 'High' ? 'high' : severity === 'Medium' ? 'medium' : 'low';

  return (
    <>
      <PageHead
        eyebrow="Agent assistant · Quality triage"
        title="Data Quality Triage"
        lede="Turn a failing rule into a decision: how bad it is under the quality standard, what most likely broke, who should act, and what to tell the people downstream."
        actions={<Badge tone="neutral">{snapshot.rules.filter((r) => r.status !== 'Passing').length} open signals</Badge>}
      />

      <Card>
        <CardHead
          title="Incident input"
          sub="Pick the rule that is breaching. The agent reads the asset's criticality, reach, trend and threshold gap."
        />
        <div className="card-body stack">
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', alignItems: 'start' }}>
            <Field label="Failing or warning rule" htmlFor="quality-rule">
              <select
                id="quality-rule"
                className="select"
                value={ruleId}
                onChange={(e) => {
                  setRuleId(e.target.value);
                  run(e.target.value, note);
                }}
              >
                {snapshot.assets
                  .filter((a) => snapshot.rules.some((r) => r.assetId === a.id && r.status !== 'Passing'))
                  .map((a) => (
                    <optgroup key={a.id} label={a.name}>
                      {snapshot.rules
                        .filter((r) => r.assetId === a.id && r.status !== 'Passing')
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id} · {r.name} · {r.status.toLowerCase()}
                          </option>
                        ))}
                    </optgroup>
                  ))}
              </select>
            </Field>
            <Field label="Steward context (optional)" hint="Appended to the stakeholder note, so leadership sees what you already know." htmlFor="quality-note">
              <textarea
                id="quality-note"
                className="textarea"
                style={{ minHeight: 62 }}
                placeholder="e.g. Raised with the CRM vendor; release 12.4 lands Thursday."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => run()}>
              <Icon name="spark" size={14} />
              Triage incident
            </button>
            <span className="hint">
              Rule expression: <span className="mono">{rule.expression}</span>
            </span>
          </div>
        </div>
      </Card>

      <div className="section stack fade-in">
        <div className={`result-banner banner-${severity === 'Critical' ? 'deny' : severity === 'High' ? 'conditions' : 'escalate'}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ marginBottom: 5 }}>
              <SeverityBadge severity={severity} />
              <span className="mono muted">
                {rule.id} · {rule.dimension} · {rule.trend}
              </span>
            </div>
            <div className="result-headline">
              {asset.name} is breaching "{rule.name.toLowerCase()}"
            </div>
            <div className="result-sub">
              {rule.observed} against {rule.threshold} · detected {formatDate(rule.lastRun)} ·{' '}
              {plural(triage.affectedConsumers, 'downstream consumer')}
            </div>
          </div>
          <div style={{ width: 190 }}>
            <div className="spread">
              <span className="label" style={{ marginBottom: 0 }}>
                Severity score
              </span>
              <span className="mono">{triage.score}/100</span>
            </div>
            <Meter value={triage.score} tone={tone} />
            <div className="tiny muted" style={{ marginTop: 5 }}>
              Remediate by <strong>{formatDate(triage.dueOn)}</strong> ({triage.slaDays === 65 ? 'next quarter' : `${triage.slaDays} business day${triage.slaDays === 1 ? '' : 's'}`})
            </div>
          </div>
        </div>

        <Card className="decision-card">
          <DecisionControls
            reference={recKey.rule(rule.id)}
            people={assignablePeople(snapshot, asset.domainId, true)}
            label={`Triage decision · ${rule.id}`}
            hint="Accepting records that this severity and remediation plan are agreed. The item then shows as taken on in the stewardship plan."
          />
        </Card>

        {triage.demotionRisk ? (
          <Callout tone="danger" title="Certification is at risk">
            {asset.name} is {asset.trustLevel} on a Tier 1 asset with a failing rule. Under POL-QUAL-04
            §5.1 it must be demoted to Endorsed within one business day and every consumer notified.
            Decide now whether to demote or to fix forward.
          </Callout>
        ) : null}

        <div className="grid grid-3" style={{ gap: 0, overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
          <Stat label="Severity" value={severity} tone={severity === 'Critical' ? 'critical' : severity === 'High' ? 'high' : 'neutral'} note={`${rule.dimension} · ${rule.trend}`} />
          <Stat label="Accountable owner" value={owner?.name ?? 'Unassigned'} note={`${steward?.name ?? 'No steward'} coordinating`} />
          <Stat label="Remediation deadline" value={formatDate(triage.dueOn)} note={`${triage.slaDays === 65 ? 'Low priority' : `${triage.slaDays} business-day SLA`} · POL-QUAL-04`} />
        </div>

        <div className="split">
          <div className="stack">
            <Card>
              <CardHead title="How the severity was scored" sub="Weights follow asset criticality, reach, dimension and direction of travel." aside={<Badge tone={tone}>{triage.score}/100</Badge>} />
              <div className="card-body breakdown">
                {triage.factors.map((factor) => (
                  <div className="breakdown-row" key={factor.label}>
                    <div className="breakdown-label">{factor.label}</div>
                    <div>
                      <Meter value={(factor.points / 35) * 100} tone={factor.points >= 18 ? 'high' : factor.points >= 10 ? 'medium' : 'low'} />
                      <div className="tiny muted" style={{ marginTop: 3 }}>{factor.detail}</div>
                    </div>
                    <div className="breakdown-points">+{factor.points}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHead title="Probable causes, ranked" sub="Hypotheses to test, not conclusions. Each has the first check that would confirm or kill it." />
              <div className="list">
                {triage.causes.map((cause) => (
                  <div className="list-item" key={cause.cause}>
                    <div className="list-title">
                      {cause.cause}
                      <Badge tone={cause.confidence === 'High' ? 'high' : cause.confidence === 'Medium' ? 'medium' : 'neutral'}>
                        {cause.confidence} confidence
                      </Badge>
                    </div>
                    <div className="list-detail">{cause.evidence}</div>
                    <div className="list-action">{cause.firstCheck}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHead title="Diagnostic checklist" sub="Run these before changing the rule — a rule that is wrong hides the real defect." />
              <div className="card-body stack" style={{ gap: 9 }}>
                {triage.diagnostics.map((step, index) => (
                  <div className="row" key={step} style={{ gap: 9, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                    <span className="mono muted" style={{ width: 20, flex: 'none' }}>{String(index + 1).padStart(2, '0')}</span>
                    <span className="small">{step}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <CardHead title="Stakeholder update" sub="Ready to send once the numbers are confirmed." aside={<CopyButton text={triage.stakeholderUpdate} />} />
              <div className="card-body">
                <pre className="pre">{triage.stakeholderUpdate}</pre>
              </div>
            </Card>

            <Card>
              <CardHead title="Who to engage" />
              <div className="card-body kv">
                <div className="kv-row">
                  <span className="kv-key">Accountable owner</span>
                  <span className="kv-val">{owner?.name ?? 'Unassigned'}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Steward</span>
                  <span className="kv-val">{steward?.name ?? 'Unassigned'}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Platform engineering</span>
                  <span className="kv-val">{engineer?.name ?? 'Platform team'}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Asset</span>
                  <span className="kv-val mono">{asset.physicalName}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Criticality</span>
                  <span className="kv-val">{asset.criticality} · {asset.classification ?? 'Unclassified'}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">Failed rows</span>
                  <span className="kv-val mono">{rule.failedRows.toLocaleString('en-GB')}</span>
                </div>
              </div>
            </Card>

            <Card>
              <CardHead title="Policy basis" sub="The clauses this triage applies." />
              <div className="list">
                {snapshot.policies
                  .filter((p) => CITED.includes(p.id))
                  .map((clause) => (
                    <div className="list-item" key={clause.id}>
                      <div className="list-title">
                        <ClauseChip id={clause.id} />
                        {clause.heading}
                      </div>
                      <div className="list-detail">{clause.shortAnswer}</div>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
