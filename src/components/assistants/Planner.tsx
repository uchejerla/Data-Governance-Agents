import { useMemo, useState } from 'react';
import { snapshot } from '../../data/seed';
import { assignablePeople, clearDecision, useDecisions } from '../../lib/decisions';
import { buildPlan, type PlanItem } from '../../lib/planner';
import { formatDate } from '../../lib/util';
import type { DomainId } from '../../types';
import { DecisionChip, DecisionControls } from '../Decision';
import { PageHead, type View } from '../Shell';
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
  Stat,
} from '../ui';

const ASSISTANT_LABEL: Record<PlanItem['assistant'], string> = {
  catalog: 'Catalog Curation',
  quality: 'Quality Triage',
  access: 'Access Review',
  planner: 'Stewardship Plan',
};

const SOURCE_TONE: Record<PlanItem['source'], 'neutral' | 'high' | 'info' | 'accent' | 'medium'> = {
  Catalog: 'accent',
  Quality: 'high',
  Access: 'info',
  Glossary: 'medium',
  Attestation: 'neutral',
};

export function PlannerPage({
  domainId,
  onNavigate,
}: {
  domainId: DomainId;
  onNavigate: (view: View) => void;
}) {
  const [horizon, setHorizon] = useState(30);
  const [weeklyHours, setWeeklyHours] = useState(12);
  const { decisions, viewer } = useDecisions();

  const plan = useMemo(
    () => buildPlan(domainId, horizon, weeklyHours, snapshot, decisions),
    [domainId, horizon, weeklyHours, decisions],
  );
  const highImpact = plan.items.filter((item) => item.impact >= 80).length;
  const accepted = plan.items.filter((item) => item.decision === 'accepted').length;
  const overCapacity = plan.totalHours > plan.capacityHours;
  const people = assignablePeople(snapshot, domainId, true);

  const columns: { key: 'now' | 'next' | 'later'; title: string; hint: string; items: PlanItem[] }[] = [
    { key: 'now', title: 'Now', hint: 'due within 14 days', items: plan.now },
    { key: 'next', title: 'Next', hint: 'due within 45 days', items: plan.next },
    { key: 'later', title: 'Later', hint: 'inside the horizon', items: plan.later },
  ];

  return (
    <>
      <PageHead
        eyebrow="Agent assistant · Stewardship planning"
        title="Stewardship Plan"
        lede="Governance debt, sorted. The agent reads catalog gaps, failing rules, the access queue, glossary findings and attestations, then sequences the work against your real capacity."
        actions={<CopyButton text={plan.markdown} label="Copy plan" />}
      />

      <Card>
        <CardHead
          title="Planning horizon and capacity"
          sub="Change these and the plan rebalances immediately — no run button, because the backlog is derived from live findings."
        />
        <div className="card-body stack">
          <div className="row" style={{ gap: 20, alignItems: 'flex-end' }}>
            <Field label="Horizon">
              <div className="row" style={{ gap: 6 }}>
                {[30, 60, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`btn btn-sm${horizon === days ? ' btn-primary' : ''}`}
                    onClick={() => setHorizon(days)}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Steward hours per week" htmlFor="planner-hours" hint="Be honest — this is the constraint that makes the plan useful.">
              <input
                id="planner-hours"
                type="number"
                className="input"
                style={{ width: 110 }}
                min={2}
                max={40}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Math.max(2, Math.min(40, Number(e.target.value) || 2)))}
              />
            </Field>
            <div style={{ marginLeft: 'auto', minWidth: 220 }}>
              <div className="spread small">
                <span className="muted">Committed</span>
                <span className="mono">
                  {plan.totalHours}h / {plan.capacityHours}h
                </span>
              </div>
              <Meter
                value={Math.min(100, (plan.totalHours / Math.max(1, plan.capacityHours)) * 100)}
                tone={overCapacity ? 'critical' : 'low'}
              />
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {overCapacity
                  ? `${plan.totalHours - plan.capacityHours}h over capacity — delegate or defer the Later column.`
                  : `${plan.capacityHours - plan.totalHours}h of headroom for reactive work.`}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="section stack">
        <div className="grid grid-4" style={{ gap: 0, overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
          <Stat
            label="Open items"
            value={plan.items.length}
            note={`${plan.now.length} due in the next two weeks · ${accepted} accepted · ${plan.dismissed.length} dismissed`}
          />
          <Stat label="High impact" value={highImpact} tone={highImpact > 0 ? 'high' : 'neutral'} note="risk or certification impact ≥ 80" />
          <Stat label="Effort" value={`${plan.totalHours}h`} note={`against ${plan.capacityHours}h capacity`} />
          <Stat label="Capacity" value={overCapacity ? 'Over' : 'Inside'} tone={overCapacity ? 'critical' : 'accent'} note={overCapacity ? 'reduce scope or raise hours' : 'plan fits the horizon'} />
        </div>

        {overCapacity ? (
          <Callout tone="warn" title="This plan does not fit">
            You have {plan.totalHours} hours of work against {plan.capacityHours}. Cutting the Later
            column is the honest move — a plan that ignores capacity is a wish list.
          </Callout>
        ) : null}

        <div className="grid grid-3" style={{ alignItems: 'start' }}>
          {columns.map((column) => (
            <div className="plan-col" key={column.key}>
              <div className="plan-col-head">
                <span className="plan-col-title">{column.title}</span>
                <span className="tiny muted">{column.hint}</span>
                <span className="plan-col-meta">
                  {column.items.length} · {column.items.reduce((sum, i) => sum + i.hours, 0)}h
                </span>
              </div>
              {column.items.length === 0 ? (
                <Empty title="Nothing here">
                  {column.key === 'later' ? 'No work falls later in this horizon.' : 'Nothing due in this window.'}
                </Empty>
              ) : (
                column.items.map((item) => (
                  <article
                    className={`plan-item${item.decision === 'accepted' ? ' plan-item-accepted' : ''}`}
                    key={item.id}
                  >
                    <div className="spread" style={{ alignItems: 'flex-start', gap: 8 }}>
                      <span className="plan-item-title">{item.title}</span>
                      <span className="impact" title="Impact score (0–100)">{item.impact}</span>
                    </div>
                    <p className="plan-item-detail">{item.detail}</p>
                    <div className="plan-meta">
                      <Badge tone={SOURCE_TONE[item.source]}>{item.source}</Badge>
                      <span className="mono">{item.effort} · {item.hours}h</span>
                      <span>due {formatDate(item.dueOn)}</span>
                      <ClauseChip id={item.clauseId} />
                    </div>
                    <div className="spread">
                      <span className="tiny muted">{item.ownerName}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onNavigate(item.assistant)}
                      >
                        {ASSISTANT_LABEL[item.assistant]}
                        <Icon name="arrow" size={12} />
                      </button>
                    </div>
                    <DecisionControls reference={item.id} people={people} label="Decision" />
                  </article>
                ))
              )}
            </div>
          ))}
        </div>

        {plan.dismissed.length > 0 ? (
          <Card>
            <CardHead
              title="Dismissed from the plan"
              sub="Your dismissals are persisted and excluded from the plan, its hours and the exported Markdown. Restore one if circumstances change."
              aside={<Badge tone="neutral">{plan.dismissed.length}</Badge>}
            />
            <div className="list">
              {plan.dismissed.map((item) => (
                <div className="list-item decided decided-dismissed" key={item.id}>
                  <div className="list-title">
                    <Badge tone={SOURCE_TONE[item.source]}>{item.source}</Badge>
                    {item.title}
                    <DecisionChip decision={decisions[item.id]} />
                  </div>
                  <div className="list-detail">{item.detail}</div>
                  <div className="spread">
                    <span className="tiny muted">{item.ownerName} · {item.hours}h</span>
                    {viewer && decisions[item.id]?.byId === viewer.id ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => clearDecision(item.id)}
                      >
                        Restore
                      </button>
                    ) : (
                      <span className="tiny muted">Dismissed by {decisions[item.id]?.by ?? 'another steward'}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHead
            title="Plan as Markdown"
            sub="Paste into the stewardship review pack, a ticket or your weekly update."
            aside={<CopyButton text={plan.markdown} />}
          />
          <div className="card-body">
            <pre className="pre">{plan.markdown}</pre>
          </div>
          <div className="card-foot">{plan.summary}</div>
        </Card>
      </div>
    </>
  );
}
