import { snapshot } from '../data/seed';
import {
  acceptDecision,
  assignDecision,
  clearDecision,
  dismissDecision,
  refreshDecisions,
  signInHref,
  useDecisions,
} from '../lib/decisions';
import type { Decision, DecisionStatus, Person } from '../types';
import { Icon } from './ui';

export function DecisionStatusChip({
  status,
  assigneeName,
  by,
  at,
}: {
  status?: DecisionStatus;
  assigneeName?: string;
  by?: string;
  at?: string;
}) {
  if (!status) return null;
  const attribution = assigneeName ?? by;
  const title = [by ? `Recorded by ${by}` : null, at ? new Date(at).toLocaleString('en-GB') : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className={`decision-chip decision-chip-${status}`}
      title={title || undefined}
    >
      {status === 'accepted' ? <Icon name="check" size={12} /> : null}
      {status === 'accepted' ? 'Accepted' : 'Dismissed'}
      {attribution ? ` · ${attribution}` : ''}
    </span>
  );
}

export function DecisionChip({
  decision,
  assigneeName,
}: {
  decision?: Decision;
  assigneeName?: string;
}) {
  return (
    <DecisionStatusChip
      status={decision?.status}
      assigneeName={assigneeName}
      by={decision?.by}
      at={decision?.at}
    />
  );
}

// One control surface for every recommendation. Reads and writes the shared
// backlog through the API, so a decision made here is visible to the rest of the
// team (and in the plan and overview) after the next refresh.
export function DecisionControls({
  reference,
  people,
  label = 'Your decision',
  hint,
}: {
  reference: string;
  people: Person[];
  label?: string;
  hint?: string;
}) {
  const { decisions, status, pending, error, viewer } = useDecisions();
  const decision = decisions[reference];
  const busy = pending.includes(reference);
  const canDecide = status === 'ready';
  // Only the steward who recorded a decision may withdraw it; the server enforces
  // the same rule, so the control reflects it rather than failing after the click.
  const canWithdraw = Boolean(decision) && (!decision?.byId || decision.byId === viewer?.id);

  // The assignee may have been picked in another screen with a wider shortlist,
  // so resolve names against the full directory before falling back to the id.
  const assigneeName = decision?.assigneeId
    ? (people.find((person) => person.id === decision.assigneeId)?.name ??
      snapshot.people.find((person) => person.id === decision.assigneeId)?.name ??
      decision.assigneeId)
    : undefined;

  return (
    <div className={`decision-bar${decision ? ` decision-${decision.status}` : ''}`}>
      <div className="decision-state">
        <span className="decision-label">{label}</span>
        <span aria-live="polite">
          {decision ? (
            <DecisionStatusChip
              status={decision.status}
              assigneeName={assigneeName}
              by={decision.by}
              at={decision.at}
            />
          ) : (
            <span className="tiny muted">
              {status === 'signed-out' ? 'Sign in to record a decision' : 'Not reviewed'}
            </span>
          )}
        </span>
        {hint ? <span className="decision-hint">{hint}</span> : null}
        {error && !busy ? <span className="decision-error">{error}</span> : null}
      </div>

      <div className="decision-actions">
        {status === 'loading' ? <span className="tiny muted">Connecting…</span> : null}
        {status === 'error' ? (
          <button type="button" className="btn btn-sm" onClick={() => void refreshDecisions()}>
            Retry
          </button>
        ) : null}
        {status === 'signed-out' ? (
          <a className="btn btn-sm btn-primary" href={signInHref()}>
            Sign in with Freebuff
          </a>
        ) : null}
        {canDecide ? (
          <>
            <button
              type="button"
              className={`btn btn-sm${decision?.status === 'accepted' ? ' btn-primary' : ''}`}
              aria-pressed={decision?.status === 'accepted'}
              disabled={busy}
              onClick={() => acceptDecision(reference)}
            >
              Accept
            </button>
            <button
              type="button"
              className={`btn btn-sm${decision?.status === 'dismissed' ? ' btn-primary' : ''}`}
              aria-pressed={decision?.status === 'dismissed'}
              disabled={busy}
              onClick={() => dismissDecision(reference)}
            >
              Dismiss
            </button>
            <select
              className="decision-assign"
              aria-label={`Assign to${viewer ? ` (as ${viewer.name})` : ''}`}
              value={decision?.assigneeId ?? ''}
              disabled={busy}
              onChange={(event) => assignDecision(reference, event.target.value)}
            >
              <option value="">Assign to…</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.role}
                </option>
              ))}
            </select>
            {decision ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || !canWithdraw}
                title={
                  canWithdraw
                    ? 'Withdraw this decision'
                    : `Recorded by ${decision.by ?? 'another steward'}; only they can withdraw it`
                }
                onClick={() => clearDecision(reference)}
              >
                Undo
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
