import { useState, type ReactNode } from 'react';
import type { Severity } from '../types';

export type IconName =
  | 'overview'
  | 'catalog'
  | 'quality'
  | 'policy'
  | 'access'
  | 'planner'
  | 'copy'
  | 'check'
  | 'alert'
  | 'arrow'
  | 'spark'
  | 'clock'
  | 'download';

const ICON_PATHS: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  catalog: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M8 7.5h8M8 11h5" />
    </>
  ),
  quality: <path d="M3 12h4l2.5-6 4 13L16 12h5" />,
  policy: (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z" />
      <path d="M9.3 12l1.9 1.9 3.6-3.9" />
    </>
  ),
  access: (
    <>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l9 9M17 17l2-2M14.5 14.5l2-2" />
    </>
  ),
  planner: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10.5h17M8 3v4M16 3v4M8 14.5h3M8 18h6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10M8 10.5l4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export type Tone = 'neutral' | 'accent' | 'critical' | 'high' | 'medium' | 'low' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function severityTone(severity: Severity): Tone {
  switch (severity) {
    case 'Critical':
      return 'critical';
    case 'High':
      return 'high';
    case 'Medium':
      return 'medium';
    default:
      return 'low';
  }
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={severityTone(severity)}>{severity}</Badge>;
}

export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  sub,
  aside,
}: {
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="card-head">
      <div>
        <h3 className="card-title">{title}</h3>
        {sub ? <div className="card-sub">{sub}</div> : null}
      </div>
      {aside ? <div className="card-aside">{aside}</div> : null}
    </header>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Meter({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="meter" role="img" aria-label={`${width} out of 100`}>
      <div
        className={`meter-fill${tone === 'accent' ? '' : ` tone-${tone}`}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: 'neutral' | 'accent' | 'critical' | 'high';
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

export function Callout({
  tone = 'accent',
  title,
  children,
}: {
  tone?: 'accent' | 'warn' | 'danger' | 'info';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`callout callout-${tone}`}>
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      window.setTimeout(() => setStatus('idle'), 1800);
    } catch {
      setStatus('failed');
      window.setTimeout(() => setStatus('idle'), 2400);
    }
  }

  return (
    <button type="button" className="btn btn-sm" onClick={copy} aria-live="polite">
      <Icon name="copy" size={13} />
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
    </button>
  );
}

export function ClauseChip({ id }: { id?: string }) {
  if (!id) return null;
  return <span className="clause-chip">{id}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div style={{ marginTop: 4 }}>{children}</div> : null}
    </div>
  );
}
