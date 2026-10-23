import { useMemo, type ReactNode } from 'react';
import { snapshot } from '../data/seed';
import type { DomainId } from '../types';
import { signInHref, useDecisions } from '../lib/decisions';
import { isModuleLicensed, useLicence, type LicenceModule, type LicenceSummary } from '../lib/licence';
import { formatDate, plural } from '../lib/util';
import { Icon, type IconName } from './ui';

export type View =
  | 'overview'
  | 'history'
  | 'catalog'
  | 'quality'
  | 'policy'
  | 'access'
  | 'planner';

const VIEW_META: Record<View, { label: string; hint: string; icon: IconName }> = {
  overview: { label: 'Overview', hint: 'Workspace', icon: 'overview' },
  history: { label: 'Decision history', hint: 'Workspace', icon: 'clock' },
  catalog: { label: 'Catalog Curation', hint: 'Assistant', icon: 'catalog' },
  quality: { label: 'Quality Triage', hint: 'Assistant', icon: 'quality' },
  policy: { label: 'Policy & Control', hint: 'Assistant', icon: 'policy' },
  access: { label: 'Access Review', hint: 'Assistant', icon: 'access' },
  planner: { label: 'Stewardship Plan', hint: 'Assistant', icon: 'planner' },
};

const ASSISTANT_VIEWS: View[] = ['catalog', 'quality', 'policy', 'access', 'planner'];

// Which package module a screen belongs to. `null` means the screen is core and
// is never withdrawn. The server enforces the same mapping on the API.
const VIEW_MODULE: Record<View, LicenceModule | null> = {
  overview: null,
  history: 'audit-export',
  catalog: 'catalog-curation',
  quality: 'quality-triage',
  policy: 'policy-qa',
  access: 'access-review',
  planner: 'stewardship-planner',
};

export function isViewLicensed(view: View, licence: LicenceSummary | null): boolean {
  const module = VIEW_MODULE[view];
  return module === null || isModuleLicensed(licence, module);
}

export function Shell({
  view,
  onNavigate,
  domainId,
  onDomainChange,
  children,
}: {
  view: View;
  onNavigate: (view: View) => void;
  domainId: DomainId;
  onDomainChange: (domain: DomainId) => void;
  children: ReactNode;
}) {
  const { viewer, status, syncedAt, decisions } = useDecisions();
  const { licence } = useLicence();
  const assistants = ASSISTANT_VIEWS.filter((item) => isViewLicensed(item, licence));
  const initials = (viewer?.name ?? '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const syncLabel =
    status === 'ready'
      ? `Shared backlog${syncedAt ? ` · ${new Date(syncedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`
      : status === 'signed-out'
        ? 'Read-only'
        : status === 'error'
          ? 'Decisions offline'
          : 'Connecting';

  const counts = useMemo(() => {
    const assets = snapshot.assets.filter((a) => a.domainId === domainId);
    return {
      catalog: assets.filter(
        (a) => !a.ownerId || !a.classification || !a.description || a.glossaryTermIds.length === 0,
      ).length,
      quality: snapshot.rules.filter(
        (r) => r.status === 'Failing' && assets.some((a) => a.id === r.assetId),
      ).length,
      access: snapshot.pendingAccessRequests.filter((r) =>
        assets.some((a) => a.id === r.assetId),
      ).length,
      policy: snapshot.policies.length,
      planner: assets.length,
      history: Object.keys(decisions).length,
    } as Record<View, number>;
  }, [domainId, decisions]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SD</div>
          <div>
            <div className="brand-name">Steward Desk</div>
            <div className="brand-sub">Governance agents</div>
          </div>
        </div>

        <nav className="nav-group" aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          <button
            type="button"
            className={`nav-item${view === 'overview' ? ' active' : ''}`}
            onClick={() => onNavigate('overview')}
            aria-current={view === 'overview' ? 'page' : undefined}
          >
            <Icon name="overview" size={15} className="nav-icon" />
            Overview
          </button>
          {isViewLicensed('history', licence) ? (
            <button
              type="button"
              className={`nav-item${view === 'history' ? ' active' : ''}`}
              onClick={() => onNavigate('history')}
              aria-current={view === 'history' ? 'page' : undefined}
            >
              <Icon name="clock" size={15} className="nav-icon" />
              Decision history
              <span className="nav-hint">{counts.history}</span>
            </button>
          ) : null}
        </nav>

        <nav className="nav-group" aria-label="Agent assistants">
          <div className="nav-label">Agent assistants</div>
          {assistants.map((item) => (
            <button
              key={item}
              type="button"
              className={`nav-item${view === item ? ' active' : ''}`}
              onClick={() => onNavigate(item)}
              aria-current={view === item ? 'page' : undefined}
            >
              <Icon name={VIEW_META[item].icon} size={15} className="nav-icon" />
              {VIEW_META[item].label}
              <span className="nav-hint">{counts[item]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="steward-chip">
            <div className={`avatar${viewer ? '' : ' avatar-muted'}`}>{viewer ? initials || 'S' : '–'}</div>
            <div>
              <div className="steward-name">{viewer?.name ?? 'Not signed in'}</div>
              <div className="steward-role">
                {viewer ? 'Steward · shared backlog' : 'Decisions need sign-in'}
              </div>
            </div>
          </div>
          {status === 'signed-out' ? (
            <a className="btn btn-sm btn-primary auth-btn" href={signInHref()}>
              Sign in with Freebuff
            </a>
          ) : null}
          {status === 'ready' ? (
            <form method="post" action="/auth/freebuff/signout" className="auth-form">
              <button type="submit" className="btn btn-ghost btn-sm auth-btn">
                Sign out
              </button>
            </form>
          ) : null}
          {licence?.source === 'evaluation' ? (
            <p className="licence-foot">Evaluation mode · no licence configured</p>
          ) : null}
          <p className="snapshot-note">
            Seeded catalog snapshot · {formatDate(snapshot.asOf)}. Agents reason over policies v4.2 and
            the access standard v2.1.
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{VIEW_META[view].label}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`sync-pill sync-${status}`} title="Decisions are shared with every signed-in steward">
              {syncLabel}
            </span>
            <span className="asof">As of {formatDate(snapshot.asOf)}</span>
            <label className="label" htmlFor="domain-scope" style={{ marginBottom: 0 }}>
              Domain
            </label>
            <select
              id="domain-scope"
              className="domain-select"
              value={domainId}
              onChange={(e) => onDomainChange(e.target.value as DomainId)}
            >
              {snapshot.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        {licence?.readOnly ? (
          <div className="licence-banner licence-banner-blocked" role="status">
            <Icon name="alert" size={15} />
            <span>
              <strong>Read-only.</strong> {licence.reason}
            </span>
          </div>
        ) : licence?.status === 'active' &&
          licence.daysRemaining !== null &&
          licence.daysRemaining <= 30 ? (
          <div className="licence-banner licence-banner-warn" role="status">
            <Icon name="clock" size={15} />
            <span>
              Licence expires in {plural(licence.daysRemaining, 'day')}
              {licence.notAfter ? ` (${formatDate(licence.notAfter.slice(0, 10))})` : ''}. Renew
              before then to keep recording decisions.
            </span>
          </div>
        ) : null}

        <main className="page">{children}</main>
      </div>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-lede">{lede}</p>
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </div>
  );
}
