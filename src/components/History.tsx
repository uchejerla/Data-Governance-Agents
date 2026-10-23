import { useCallback, useEffect, useMemo, useState } from 'react';
import { snapshot } from '../data/seed';
import {
  fetchAllDecisionHistory,
  fetchDecisionHistory,
  signInHref,
  useDecisions,
  type DecisionEvent,
} from '../lib/decisions';
import {
  eventLabel,
  formatEventTime,
  groupEvents,
  historyActors,
  historyCsvRows,
  recommendationIndex,
} from '../lib/history';
import { downloadTextFile, toCsv } from '../lib/csv';
import { plural } from '../lib/util';
import { DecisionStatusChip } from './Decision';
import { PageHead } from './Shell';
import { Badge, Callout, Card, CardHead, Empty, Field, Icon, Stat } from './ui';

type Phase = 'loading' | 'ready' | 'signed-out' | 'error';

interface Loaded {
  phase: Phase;
  events: DecisionEvent[];
  error?: string;
  at?: string;
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'accepted', label: 'Acceptances' },
  { value: 'dismissed', label: 'Dismissals' },
  { value: 'cleared', label: 'Withdrawals' },
];

// The audit trail behind the shared backlog. The backlog table holds only the
// current decision; this screen reads the append-only event log, so an item that
// was accepted, re-assigned and later withdrawn still shows every step and the
// steward behind it.
export function HistoryPage() {
  const { decisions } = useDecisions();
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading', events: [] });
  const [actorId, setActorId] = useState('all');
  const [action, setAction] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchDecisionHistory();
    if (result.ok) {
      setLoaded({ phase: 'ready', events: result.events, at: new Date().toISOString() });
      return;
    }
    if (result.status === 401) {
      setLoaded({ phase: 'signed-out', events: [] });
      return;
    }
    setLoaded({ phase: 'error', events: [], error: result.error });
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const index = useMemo(() => recommendationIndex(snapshot), []);
  const people = useMemo(() => new Map(snapshot.people.map((person) => [person.id, person])), []);
  const domains = useMemo(() => new Map(snapshot.domains.map((domain) => [domain.id, domain])), []);

  const actors = useMemo(() => historyActors(loaded.events), [loaded.events]);

  function matchesFilter(event: DecisionEvent): boolean {
    return (actorId === 'all' || event.actorId === actorId) && (action === 'all' || event.action === action);
  }

  const groups = useMemo(
    () => groupEvents(loaded.events.filter(matchesFilter), index),
    [loaded.events, index, actorId, action],
  );

  const filteredCount = groups.reduce((sum, group) => sum + group.events.length, 0);
  const filtering = actorId !== 'all' || action !== 'all';

  // The export covers the whole trail, not the page in view, but keeps the
  // filters: a review pack should not disagree with the trail it was built from.
  async function exportCsv() {
    setExporting(true);
    setExportNote(null);

    const result = await fetchAllDecisionHistory();
    if (!result.ok) {
      setExporting(false);
      if (result.status === 401) setLoaded({ phase: 'signed-out', events: [] });
      else setExportNote(result.error);
      return;
    }

    const rows = groupEvents(result.events.filter(matchesFilter), index);
    const csv = toCsv(historyCsvRows(rows, { people, domains }));
    const count = rows.reduce((sum, group) => sum + group.events.length, 0);
    downloadTextFile(
      `steward-decisions-${new Date().toISOString().slice(0, 10)}.csv`,
      `\uFEFF${csv}`,
    );
    setExporting(false);
    setExportNote(
      result.complete
        ? `Exported the full trail: ${plural(count, 'entry', 'entries')}.`
        : `Exported ${plural(count, 'entry', 'entries')}; the log is longer than one export can page through.`,
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Workspace · audit trail"
        title="Decision history"
        lede="Every accept, dismiss, assignment and withdrawal, with the steward who made it and when. The log is append-only: changing your mind adds to the record instead of erasing it."
        actions={
          <span className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={loaded.phase !== 'ready' || groups.length === 0 || exporting}
              title={
                groups.length === 0
                  ? 'Nothing to export yet'
                  : 'Download the whole trail as CSV, with the current filters applied'
              }
              onClick={() => void exportCsv()}
            >
              <Icon name="download" size={13} />
              {exporting ? 'Preparing…' : 'Export CSV'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              <Icon name="clock" size={13} />
              {loaded.at
                ? `Refresh · ${new Date(loaded.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                : 'Refresh'}
            </button>
          </span>
        }
      />

      {loaded.phase === 'signed-out' ? (
        <Card>
          <CardHead
            title="Sign in to read the audit trail"
            sub="This record names the stewards who made each decision, so it is only visible to signed-in members of the workspace."
          />
          <div className="card-body stack">
            <Callout tone="info" title="Read-only without a session">
              The assistants and the plan still work signed out, but decisions and their history are
              shared team records and need a session.
            </Callout>
            <div className="row">
              <a className="btn btn-primary" href={signInHref()}>
                Sign in with Freebuff
              </a>
            </div>
          </div>
        </Card>
      ) : loaded.phase === 'error' ? (
        <Card>
          <CardHead title="The audit trail is unavailable" sub={loaded.error} />
          <div className="card-body">
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div className="grid grid-3">
              <Stat
                label="Recorded changes"
                value={loaded.events.length}
                note={filtering ? `${filteredCount} after filters` : 'one row per change, never overwritten'}
              />
              <Stat
                label="Items touched"
                value={new Set(loaded.events.map((event) => event.key)).size}
                note="recommendations with at least one decision"
              />
              <Stat
                label="Stewards"
                value={actors.length}
                note={actors[0] ? `busiest: ${actors[0].name} (${actors[0].count})` : 'nobody has decided anything yet'}
              />
            </div>
          </Card>

          <Card>
            <CardHead
              title="Filter"
              sub="Narrow by who changed a decision and what they did."
              aside={<Badge tone={filtering ? 'accent' : 'neutral'}>{plural(filteredCount, 'entry', 'entries')}</Badge>}
            />
            <div className="card-body">
              <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
                <div style={{ minWidth: 220 }}>
                  <Field label="Steward" htmlFor="history-actor">
                    <select
                      id="history-actor"
                      className="select"
                      value={actorId}
                      onChange={(event) => setActorId(event.target.value)}
                    >
                      <option value="all">All stewards</option>
                      {actors.map((actor) => (
                        <option key={actor.id} value={actor.id}>
                          {actor.name} · {actor.count}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div style={{ minWidth: 170 }}>
                  <Field label="Activity" htmlFor="history-action">
                    <select
                      id="history-action"
                      className="select"
                      value={action}
                      onChange={(event) => setAction(event.target.value)}
                    >
                      {ACTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {filtering ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setActorId('all');
                      setAction('all');
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead
              title="The record"
              sub="Newest first, grouped by the recommendation the decision was about."
              aside={
                <Badge tone="neutral">
                  {plural(groups.length, 'item')}
                </Badge>
              }
            />
            {loaded.phase === 'loading' ? (
              <div className="card-body">
                <p className="tiny muted">Reading the audit trail…</p>
              </div>
            ) : groups.length === 0 ? (
              <div className="card-body">
                <Empty title={filtering ? 'Nothing matches those filters' : 'No decisions recorded yet'}>
                  {filtering
                    ? 'Widen the filter to see the rest of the trail.'
                    : 'Record a decision in any assistant and it appears here with your name on it.'}
                </Empty>
              </div>
            ) : (
              <div className="list">
                {groups.map((group) => {
                  const current = decisions[group.key];
                  const assignee = current?.assigneeId ? people.get(current.assigneeId) : undefined;
                  const domain = group.ref?.domainId ? domains.get(group.ref.domainId) : undefined;
                  return (
                    <div className="list-item history-item" key={group.key}>
                      <div className="history-head">
                        <div>
                          <div className="list-title">
                            {group.ref?.source ? (
                              <Badge tone={SOURCE_TONE[group.ref.source]}>{group.ref.source}</Badge>
                            ) : null}
                            <span>{group.ref?.title ?? group.key}</span>
                            {domain ? <span className="tiny muted">{domain.name}</span> : null}
                          </div>
                          <div className="list-detail">
                            {group.ref?.detail ?? 'This recommendation is not in the current snapshot.'}
                          </div>
                        </div>
                        <div className="history-current">
                          {current ? (
                            <DecisionStatusChip
                              status={current.status}
                              assigneeName={assignee?.name ?? current.assigneeId}
                              by={current.by}
                              at={current.at}
                            />
                          ) : (
                            <span className="history-withdrawn">No current decision</span>
                          )}
                        </div>
                      </div>

                      <ol className="history-timeline">
                        {group.events.map((event) => (
                          <li key={event.id} className={`history-event history-event-${event.action}`}>
                            <span className={`history-dot history-dot-${event.action}`} aria-hidden="true" />
                            <span className="history-verb">
                              {eventLabel(
                                event,
                                event.assigneeId
                                  ? (people.get(event.assigneeId)?.name ?? event.assigneeId)
                                  : undefined,
                              )}
                            </span>
                            <span className="history-actor">{event.actorName ?? 'Unknown steward'}</span>
                            <time className="history-time" dateTime={event.at}>
                              {formatEventTime(event.at)}
                            </time>
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="card-foot">
              {exportNote ? <div className="history-export-note">{exportNote}</div> : null}
              Showing the most recent {plural(loaded.events.length, 'change')}; export pages through
              the whole trail, with the current filters applied. Times are shown in your local
              timezone, while the log and the CSV record UTC.
            </div>
          </Card>
        </>
      )}
    </>
  );
}

const SOURCE_TONE: Record<string, 'neutral' | 'high' | 'info' | 'accent' | 'medium'> = {
  Catalog: 'accent',
  Quality: 'high',
  Access: 'info',
  Glossary: 'medium',
  Attestation: 'neutral',
};
