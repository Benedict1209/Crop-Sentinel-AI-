import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { LANGS, makeT } from '../lib/i18n';
import { Icon } from './icons';
import { fmtDateTime, initials } from '../lib/format';
import type { Lang } from '../domain/types';

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  end?: boolean;
  badge?: 'pendingCases';
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    labelKey: 'group.monitor',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: 'grid', end: true },
      { to: '/officer', labelKey: 'nav.officer', icon: 'shield' },
    ],
  },
  {
    labelKey: 'group.intel',
    items: [
      { to: '/risk', labelKey: 'nav.risk', icon: 'trending' },
      { to: '/map', labelKey: 'nav.map', icon: 'map' },
      { to: '/advisories', labelKey: 'nav.advisories', icon: 'book' },
    ],
  },
  {
    labelKey: 'group.field',
    items: [
      { to: '/scanner', labelKey: 'nav.scanner', icon: 'camera' },
      { to: '/traps', labelKey: 'nav.traps', icon: 'bug' },
    ],
  },
  {
    labelKey: 'group.records',
    items: [
      { to: '/farms', labelKey: 'nav.farms', icon: 'leaf' },
      { to: '/reports', labelKey: 'nav.reports', icon: 'file' },
      { to: '/expert', labelKey: 'nav.expert', icon: 'checkCircle', badge: 'pendingCases' },
      { to: '/feedback', labelKey: 'nav.feedback', icon: 'database' },
    ],
  },
  {
    labelKey: 'group.admin',
    items: [{ to: '/settings', labelKey: 'nav.settings', icon: 'sliders' }],
  },
];

const TITLES: [string, string][] = [
  ['/officer', 'nav.officer'],
  ['/scanner', 'nav.scanner'],
  ['/traps', 'nav.traps'],
  ['/risk', 'nav.risk'],
  ['/map', 'nav.map'],
  ['/advisories', 'nav.advisories'],
  ['/farms', 'nav.farms'],
  ['/plots', 'nav.farms'],
  ['/reports', 'nav.reports'],
  ['/report', 'reports.report'],
  ['/expert', 'nav.expert'],
  ['/feedback', 'nav.feedback'],
  ['/settings', 'nav.settings'],
  ['/', 'nav.dashboard'],
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const cases = useStore((s) => s.cases);
  const notifications = useStore((s) => s.notifications);
  const markAllRead = useStore((s) => s.markAllRead);
  const resetData = useStore((s) => s.resetData);
  const setLang = useStore((s) => s.setLang);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const t = useMemo(() => makeT(settings.lang), [settings.lang]);
  const pendingCases = cases.filter((c) => c.status === 'pending').length;
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    setMobileOpen(false);
    setNotifOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const titleKey = TITLES.find(([p]) => (p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)))?.[1] ?? 'nav.dashboard';

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="leaf" size={19} />
          </span>
          <div className="brand-text">
            <strong>{t('brand.name')}</strong>
            <span>{t('brand.short')}</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((group) => (
            <div key={group.labelKey}>
              <div className="nav-group-label">{t(group.labelKey)}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  title={t(item.labelKey)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{t(item.labelKey)}</span>
                  {item.badge === 'pendingCases' && pendingCases > 0 && <em className="count">{pendingCases}</em>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="nav-foot-note">
          {t('brand.team')}
          <br />
          {t('brand.tagline')}
        </div>
      </aside>

      <div className="main">
        {settings.demoMode && (
          <div className="demo-bar">
            <b>{t('brand.demoMode')}</b>
            <span className="flex-1">{t('brand.demoNote')}</span>
            <button
              type="button"
              className="btn no-print"
              onClick={async () => {
                if (window.confirm(t('demo.resetConfirm'))) await resetData();
              }}
            >
              <Icon name="refresh" size={13} /> {t('brand.reset')}
            </button>
          </div>
        )}

        <header className="topbar">
          <button type="button" className="icon-btn mobile-only" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
            <Icon name="menu" size={17} />
          </button>
          <button
            type="button"
            className="icon-btn desktop-only"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Toggle sidebar"
            title="Collapse sidebar"
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
          </button>
          <div className="page-crumb">
            <strong>{t(titleKey)}</strong>
          </div>
          <div className="spacer" />

          <button
            type="button"
            className="btn sm leaf no-print"
            onClick={() => navigate('/scanner')}
            aria-label={t('action.scan')}
            title={t('action.scan')}
          >
            <Icon name="camera" size={14} /> <span className="cta-text">{t('action.scan')}</span>
          </button>

          <label className="row nowrap" style={{ gap: 6 }}>
            <Icon name="language" size={16} className="muted" />
            <select
              aria-label={t('common.language')}
              value={settings.lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              style={{ width: 'auto' }}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.native}
                </option>
              ))}
            </select>
          </label>

          <div style={{ position: 'relative' }} ref={notifRef}>
            <button
              type="button"
              className={`icon-btn ${notifOpen ? 'active' : ''}`}
              onClick={() => {
                setNotifOpen((v) => !v);
                if (!notifOpen && unread) markAllRead();
              }}
              aria-label="Notifications"
            >
              <Icon name="bell" size={16} />
              {unread > 0 && (
                <span
                  style={{
                    position: 'absolute', top: -3, right: -3, background: 'var(--high)', color: '#fff',
                    borderRadius: 9, fontSize: 9.5, fontWeight: 700, padding: '1px 5px',
                  }}
                >
                  {unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="popover">
                <div className="card-head" style={{ padding: '9px 12px' }}>
                  <h3 style={{ fontSize: 13 }}>{t('dashboard.alerts')}</h3>
                </div>
                <div style={{ maxHeight: 330, overflow: 'auto' }}>
                  {notifications.length === 0 && <div className="empty">{t('common.noData')}</div>}
                  {notifications.slice(0, 12).map((n) => (
                    <div
                      key={n.id}
                      className="notif"
                      onClick={() => n.href && navigate(n.href)}
                      style={{ cursor: n.href ? 'pointer' : 'default' }}
                    >
                      <Icon
                        name={n.kind === 'alert' ? 'alert' : n.kind === 'review' ? 'clipboard' : 'info'}
                        size={15}
                        className="muted"
                      />
                      <div className="flex-1">
                        <div style={{ fontWeight: 600 }}>{n.title}</div>
                        <div className="muted small">{n.body}</div>
                        <div className="t">{fmtDateTime(n.at, settings.lang)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button type="button" className="user-chip" onClick={() => setUserOpen((v) => !v)} aria-label="User">
            <span className="avatar">{settings.currentUser.initials || initials(settings.currentUser.name)}</span>
            <span className="desktop-only">
              <span className="nm">{settings.currentUser.name}</span>
              <br />
              <span className="rl">{settings.currentUser.role}</span>
            </span>
            <Icon name="chevronDown" size={14} className="muted" />
          </button>
          {userOpen && (
            <div className="popover" style={{ top: 52, width: 250 }}>
              <div style={{ padding: '12px 13px' }}>
                <div className="strong">{settings.currentUser.name}</div>
                <div className="muted small">{settings.currentUser.role}</div>
                <div className="notice demo mt-10" style={{ fontSize: 11.5 }}>
                  <Icon name="info" size={14} />
                  <span>{t('brand.team')}</span>
                </div>
                <button type="button" className="btn sm block mt-10" onClick={() => navigate('/settings')}>
                  <Icon name="sliders" size={13} /> {t('nav.settings')}
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
