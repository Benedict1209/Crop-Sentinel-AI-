import type { ReactNode } from 'react';
import type { Lang, RiskLevel, Severity } from '../domain/types';
import { Icon } from './icons';
import { makeT } from '../lib/i18n';
import type { T } from '../lib/i18n';

export { Icon };

export function Card({
  title,
  subtitle,
  actions,
  children,
  pad = false,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div className="flex-1">
            {title && <h3>{title}</h3>}
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  variant,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  variant?: 'risk' | 'warn' | 'info';
}) {
  return (
    <div className={`stat ${variant ?? ''}`}>
      <span className="accent" />
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function RiskBadge({ level, t }: { level: RiskLevel; t: T }) {
  return (
    <span className={`badge ${level}`}>
      <i className={`dot ${level}`} />
      {t(`risk.${level}`)}
    </span>
  );
}

export function SeverityBadge({ severity, t }: { severity: Severity; t: T }) {
  const cls =
    severity === 'healthy' ? 'low' : severity === 'low' ? 'low' : severity === 'moderate' ? 'medium' : severity === 'high' || severity === 'severe' ? 'high' : 'outline';
  return <span className={`badge ${cls}`}>{t(`severity.${severity}`)}</span>;
}

export function StatusBadge({ status, t }: { status: string; t: T }) {
  const cls = status === 'resolved' ? 'low' : status === 'under_review' ? 'medium' : 'info';
  return <span className={`badge ${cls}`}>{t(`status.${status}`)}</span>;
}

export function DemoBadge({ label }: { label: string }) {
  return <span className="badge demo">{label}</span>;
}

export function Notice({
  kind = 'info',
  icon = 'info',
  children,
}: {
  kind?: 'info' | 'warn' | 'danger' | 'good' | 'demo' | 'plain';
  icon?: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice ${kind === 'plain' ? '' : kind}`}>
      {icon !== 'none' && <Icon name={icon} size={16} />}
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Field({
  label,
  help,
  children,
  className,
}: {
  label: string;
  help?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <header className="modal-head">
          <h3 className="flex-1">{title}</h3>
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={active === it.id}
          className={`tab ${active === it.id ? 'active' : ''}`}
          onClick={() => onChange(it.id)}
          type="button"
        >
          {it.label}
          {typeof it.count === 'number' && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Kv({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((it, i) => (
        <div key={i} className="row nowrap" style={{ display: 'contents' }}>
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RiskMeter({ score, level }: { score: number; level: RiskLevel }) {
  const color = level === 'high' ? 'var(--high)' : level === 'medium' ? 'var(--medium)' : 'var(--low)';
  return (
    <div>
      <div className="risk-scale">
        <i />
        <i />
        <i />
      </div>
      <div className="gauge-pin">
        <b style={{ left: `${Math.max(1, Math.min(99, score))}%`, background: color }} />
      </div>
    </div>
  );
}

export function Meter({ value, color = 'var(--leaf-500)', max = 100 }: { value: number; color?: string; max?: number }) {
  return (
    <div className="meter">
      <i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

/** Renders an engine-produced i18n key with its parameters. */
export function KeyText({ t, k, params }: { t: T; k: string; params?: Record<string, string | number> }) {
  return <>{t(k, params)}</>;
}

export function useT(lang: Lang): T {
  return makeT(lang);
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const cls = severity === 'moderate' ? 'medium' : severity === 'high' || severity === 'severe' ? 'high' : severity === 'healthy' || severity === 'low' ? 'low' : 'muted';
  return <i className={`dot ${cls}`} />;
}
