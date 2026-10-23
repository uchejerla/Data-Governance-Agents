import { useMemo } from 'react';
import { snapshot } from '../data/seed';
import { glossaryIssues, reviewCatalogAsset } from '../lib/catalog';
import { decisionCounts, refreshDecisions, signInHref, useDecisions } from '../lib/decisions';
import { buildPlan } from '../lib/planner';
import { triageRule } from '../lib/quality';
import { daysSince, formatDate, percent, plural } from '../lib/util';
import type { DomainId } from '../types';
import { DecisionStatusChip } from './Decision';
import { PageHead, type View } from './Shell';
import { Badge, Card, CardHead, ClauseChip, Empty, Icon, SeverityBadge, Stat, type IconName } from './ui';

const AGENTS: {
  view: View;
  icon: IconName;
  name: string;
  desc: string;
}[] = [
  {
    view: 'catalog',
    icon: 'catalog',
    name: 'Catalog Curation',
    desc: 'Score an asset, close the gaps that block certification, settle PII classification and stop duplicate terms.',
  },
  {
    view: 'quality',
    icon: 'quality',
    name: 'Quality Triage',
    desc: 'Score an incident, rank probable causes, agree the diagnostics and draft the stakeholder update.',
  },
  {
    view: 'policy',
    icon: 'policy',
    name: 'Policy & Control Q&A',
    desc: 'Answer handling questions with clause-level citations, or get an explicit escalation route when policy is silent.',
  },
  {
    view: 'access',
    icon: 'access',
    name: 'Access Review',
    desc: 'Turn a pending request into a defensible approve, conditional approval, escalation or denial.',
  },
  {
    view: 'planner',
    icon: 'planner',
    name: 'Stewardship Plan',
    desc: 'Sequence the domain backlog into Now, Next and Later against the hours you actually have.',
  },
];

export function OverviewPage({
  domainId,
  onNavigate,
}: {
  domainId: DomainId;
  onNavigate: (view: View) => void;
}) {
  const domain = snapshot.domains.find((d) => d.id === domainId) ?? snapshot.domains[0];
  const steward = snapshot.people.find((p) => p.role === 'Data Steward' && p.domainId === domainId);
  const { decisions, viewer, status, syncedAt, error } = useDecisions();
  const counts = decisionCounts(decisions);
  const decided = counts.accepted + counts.dismissed;

  const data = useMemo(() => {
    const assets = snapshot.assets.filter((a) => a.domainId === domainId);
    const assetIds = new Set(assets.map((a) => a.id));
    const reviews = assets.map((a) => reviewCatalogAsset(a.id, snapshot));
    const averageScore = Math.round(reviews.reduce((sum, r) => sum + r.score, 0) / Math.max(1, reviews.length));
    const needsCuration = reviews.filter((r) => r.gaps.length > 0).length;
    const failing = snapshot.rules.filter((r) => assetIds.has(r.assetId) && r.status === 'Failing');
    const access = snapshot.pendingAccessRequests.filter((r) => assetIds.has(r.assetId));
    const staleAccess = access.filter((r) => (daysSince(r.requestedOn) ?? 0) > 5);
    const domainTermIds = new Set(snapshot.terms.filter((t) => t.domainId === domainId).map((t) => t.id));
    const issues = glossaryIssues(snapshot).filter((issue) =>
      Array.from(issue.terms.join(' ').matchAll(/G-\d+/g)).some((m) => domainTermIds.has(m[0])),
    );
    const plan = buildPlan(domainId, 14, 12, snapshot, decisions);
    const failingTriage = failing
      .map((rule) => triageRule(rule.id, snapshot))
      .sort((a, b) => b.score - a.score);
    return { assets, reviews, averageScore, needsCuration, failing, access, staleAccess, issues, plan, failingTriage };
  }, [domainId, decisions]);

  const healthTone = data.averageScore >= 85 ? 'accent' : data.averageScore >= 65 ? 'high' : 'critical';

  return (
    <>
      <PageHead
        eyebrow={`Steward workspace · ${formatDate(snapshot.asOf)}`}
        title={`Good to see you, ${(viewer?.name ?? steward?.name ?? 'steward').split(' ')[0]}`}
        lede="Five assistants, one shared view of the estate. Pick the job in front of you; each agent works from the same catalog, policies and quality results."
        actions={<Badge tone="accent">{domain.name}</Badge>}
      />

      <Card>
        <div className="hero">
          <div className="hero-main">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Domain focus</div>
            <h2 className="hero-title">{domain.name}</h2>
            <p className="hero-text">
              {plural(data.assets.length, 'catalog asset')} sit in this domain, with{' '}
              {plural(data.failing.length, 'failing rule')} and {plural(data.access.length, 'access request')}{' '}
              waiting. {data.plan.now.length > 0
                ? `${data.plan.now.length} item${data.plan.now.length === 1 ? '' : 's'} need a steward in the next two weeks, starting with "${data.plan.now[0].title.toLowerCase()}".`
                : 'Nothing is burning this fortnight — a good week to work on curation quality.'}
            </p>
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => onNavigate('planner')}>
                <Icon name="planner" size={14} />
                Open the plan
              </button>
              <button type="button" className="btn" onClick={() => onNavigate('catalog')}>
                Review an asset
              </button>
            </div>
            <p className="tiny muted" style={{ marginTop: 14 }}>
              {domain.description} Executive sponsor: {domain.executive}.
            </p>
          </div>
          <div className="hero-stats">
            <Stat
              label="Catalog health"
              value={`${data.averageScore}`}
              tone={healthTone}
              note={`${data.needsCuration} of ${data.assets.length} entries have open gaps`}
            />
            <Stat
              label="Quality signals"
              value={data.failing.length}
              tone={data.failing.length > 0 ? 'critical' : 'neutral'}
              note={data.failingTriage[0] ? `worst: ${data.failingTriage[0].severity.toLowerCase()}` : 'all rules passing'}
            />
            <Stat
              label="Access queue"
              value={data.access.length}
              note={`${data.staleAccess.length} past the 5-day target`}
            />
            <Stat
              label="Glossary findings"
              value={data.issues.length}
              note={`${snapshot.terms.filter((t) => t.domainId === domainId && !t.ownerId).length} terms unowned`}
            />
          </div>
        </div>
      </Card>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Your assistants</h2>
          <span className="tiny muted">Each one produces a decision or an artefact, not a conversation.</span>
        </div>
        <div className="grid grid-3">
          {AGENTS.map((agent) => (
            <button
              type="button"
              className="agent-card"
              key={agent.view}
              onClick={() => onNavigate(agent.view)}
            >
              <div className="agent-card-head">
                <span className="agent-icon">
                  <Icon name={agent.icon} size={15} />
                </span>
                <span className="agent-name">{agent.name}</span>
              </div>
              <p className="agent-desc">{agent.desc}</p>
              <span className="agent-link">Open assistant →</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section grid grid-2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHead
            title="Needs you first"
            sub="Top of the 14-day plan, ranked by impact per hour."
            aside={<Badge tone="high">{data.plan.now.length} due</Badge>}
          />
          {data.plan.now.length === 0 ? (
            <div className="card-body">
              <Empty title="Nothing urgent">The next two weeks are clear in this domain.</Empty>
            </div>
          ) : (
            <div className="list">
              {data.plan.now.slice(0, 6).map((item) => (
                <div className="list-item" key={item.id}>
                  <div className="list-title">
                    <Badge tone={item.source === 'Quality' ? 'high' : item.source === 'Access' ? 'info' : 'accent'}>
                      {item.source}
                    </Badge>
                    {item.title}
                    {item.decision ? (
                      <DecisionStatusChip status={item.decision} assigneeName={item.assigneeName} />
                    ) : null}
                    <span className="impact" style={{ marginLeft: 'auto' }}>{item.impact}</span>
                  </div>
                  <div className="list-detail">{item.detail}</div>
                  <div className="spread">
                    <span className="tiny muted">
                      {item.ownerName} · {item.hours}h · due {formatDate(item.dueOn)}{' '}
                      <ClauseChip id={item.clauseId} />
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate(item.assistant)}>
                      Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="card-foot">
            Plan capacity: {data.plan.totalHours}h of {data.plan.capacityHours}h at 12h per week.
          </div>
        </Card>

        <div className="stack">
          <Card>
            <CardHead
              title="Quality signals"
              sub="Failing rules in this domain, worst first."
              aside={<Badge tone={data.failing.length > 0 ? 'critical' : 'accent'}>{data.failing.length}</Badge>}
            />
            {data.failing.length === 0 ? (
              <div className="card-body">
                <Empty title="All rules passing">No tier-one rule is currently in breach.</Empty>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Asset</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.failingTriage.map((triage) => (
                    <tr key={triage.rule.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{triage.rule.name}</div>
                        <div className="tiny muted">{triage.rule.observed}</div>
                      </td>
                      <td className="num">{triage.asset.name}</td>
                      <td>
                        <SeverityBadge severity={triage.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="card-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate('quality')}>
                Triage the worst one →
              </button>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Glossary hygiene"
              sub="Cross-domain findings that show up in this domain's terms."
              aside={<Badge tone="medium">{data.issues.length}</Badge>}
            />
            {data.issues.length === 0 ? (
              <div className="card-body">
                <Empty title="Glossary is clean in this domain" />
              </div>
            ) : (
              <div className="list">
                {data.issues.slice(0, 4).map((issue) => (
                  <div className="list-item" key={issue.id}>
                    <div className="list-title">
                      <SeverityBadge severity={issue.severity} />
                      {issue.kind}
                      <span className="tiny muted mono">{issue.terms[0]}</span>
                    </div>
                    <div className="list-detail">{issue.detail}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="card-foot">
              {percent(data.assets.filter((a) => a.glossaryTermIds.length > 0).length, data.assets.length)}% of
              assets link to at least one term.
            </div>
          </Card>

          <Card>
            <CardHead
              title="Recorded decisions"
              sub="Accept, dismiss and assign decisions are shared with every signed-in steward, with who decided and when on each one."
              aside={<Badge tone={decided > 0 ? 'accent' : 'neutral'}>{decided}</Badge>}
            />
            <div className="card-body">
              <div className="decision-tally">
                <div className="decision-tally-cell">
                  <span className="decision-tally-num">{counts.accepted}</span>
                  <span className="tiny muted">accepted</span>
                </div>
                <div className="decision-tally-cell">
                  <span className="decision-tally-num">{counts.dismissed}</span>
                  <span className="tiny muted">dismissed</span>
                </div>
                <div className="decision-tally-cell">
                  <span className="decision-tally-num">{counts.assigned}</span>
                  <span className="tiny muted">assigned on</span>
                </div>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Dismissed items drop out of the stewardship plan, its hours and its exported Markdown.
                Accepted items stay in the plan, marked with who owns them.
              </p>
            </div>
            <div className="card-foot spread">
              <span className="tiny muted">
                {status === 'ready'
                  ? `Shared with every signed-in steward${syncedAt ? ` · synced ${new Date(syncedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`
                  : status === 'signed-out'
                    ? 'Read-only until you sign in.'
                    : status === 'error'
                      ? (error ?? 'Decisions offline.')
                      : 'Connecting to the steward service…'}
              </span>
              {status === 'signed-out' ? (
                <a className="btn btn-sm" href={signInHref()}>
                  Sign in
                </a>
              ) : (
                <span className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void refreshDecisions()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onNavigate('history')}
                  >
                    History →
                  </button>
                </span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
