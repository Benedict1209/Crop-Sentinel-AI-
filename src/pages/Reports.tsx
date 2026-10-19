import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Field, Icon, Notice, SeverityBadge, Stat, StatusBadge } from '../components/ui';
import { caseViews } from '../lib/selectors';
import { fmtDate } from '../lib/format';
import { exportCsv, printPage, screeningCsvHeader, screeningCsvRows, stamp } from '../lib/exports';
import { CROPS } from '../domain/knowledge';
import { resultLabelKey } from '../lib/screening';
import type { Severity } from '../domain/types';

export function Reports() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [plotId, setPlotId] = useState('all');
  const [cropId, setCropId] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(() => {
    return state.scans
      .filter((s) => {
        if (plotId !== 'all' && s.plotId !== plotId) return false;
        if (cropId !== 'all' && s.cropId !== cropId) return false;
        if (severity !== 'all' && s.result.severity !== severity) return false;
        if (from && new Date(s.createdAt) < new Date(from)) return false;
        if (to && new Date(s.createdAt) > new Date(`${to}T23:59:59`)) return false;
        if (query.trim()) {
          const q = query.toLowerCase();
          const plot = state.plots.find((p) => p.id === s.plotId);
          const hay = `${plot?.name ?? ''} ${s.variety} ${s.notes} ${t(resultLabelKey(s.result))} ${s.submittedBy}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [state.scans, state.plots, plotId, cropId, severity, from, to, query, t]);

  const cases = useMemo(() => caseViews(state), [state]);
  const due = cases.filter((c) => c.overdue);

  function doExport() {
    exportCsv(
      `cropsentinel-screenings-${stamp()}.csv`,
      screeningCsvHeader(),
      screeningCsvRows(filtered, state.plots, state.farms),
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('reports.title')}</h1>
          <p className="sub">{t('reports.sub')}</p>
        </div>
        <div className="row no-print">
          <button type="button" className="btn" onClick={doExport}>
            <Icon name="download" size={14} /> {t('common.export')}
          </button>
          <button type="button" className="btn" onClick={printPage}>
            <Icon name="printer" size={14} /> {t('common.print')}
          </button>
        </div>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('dashboard.scans')} value={state.scans.length} />
        <Stat label={t('risk.high')} value={state.scans.filter((s) => s.result.severity === 'high' || s.result.severity === 'severe').length} variant="risk" />
        <Stat label={t('reports.overdue')} value={due.length} variant="warn" hint={t('reports.priorityNote').slice(0, 56) + '…'} />
        <Stat label={t('common.followUp')} value={state.followUps.length} />
      </div>

      <Card title={t('common.filter')} className="mb-14">
        <div className="card-body">
          <div className="grid c4">
            <Field label={t('common.search')}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
            </Field>
            <Field label={t('common.plot')}>
              <select value={plotId} onChange={(e) => setPlotId(e.target.value)}>
                <option value="all">{t('common.all')}</option>
                {state.plots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('filter.crop')}>
              <select value={cropId} onChange={(e) => setCropId(e.target.value)}>
                <option value="all">{t('common.all')}</option>
                {CROPS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('filter.severity')}>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="all">{t('common.all')}</option>
                {(['healthy', 'low', 'moderate', 'high', 'severe', 'inconclusive'] as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {t(`severity.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('common.from')}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('common.to')}>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <div className="field">
              <span>&nbsp;</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery('');
                  setPlotId('all');
                  setCropId('all');
                  setSeverity('all');
                  setFrom('');
                  setTo('');
                }}
              >
                <Icon name="refresh" size={13} /> {t('filter.clear')}
              </button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid side">
        <Card title={t('reports.history')} subtitle={`${filtered.length} / ${state.scans.length}`}>
          {filtered.length === 0 ? (
            <Empty text={t('common.noData')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('common.plot')}</th>
                    <th>{t('common.crop')}</th>
                    <th>{t('scanner.resultTitle')}</th>
                    <th>{t('common.severity')}</th>
                    <th>{t('common.riskLevel')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 60).map((s) => {
                    const plot = state.plots.find((p) => p.id === s.plotId);
                    return (
                      <tr key={s.id} className="clickable" onClick={() => navigate(`/report/${s.id}`)}>
                        <td className="no-wrap">{fmtDate(s.createdAt, state.settings.lang)}</td>
                        <td className="truncate" style={{ maxWidth: 170 }}>
                          {plot?.name ?? '—'}
                        </td>
                        <td>{t(`crop.${s.cropId}`)}</td>
                        <td>{t(resultLabelKey(s.result))}</td>
                        <td>
                          <SeverityBadge severity={s.result.severity} t={t} />
                        </td>
                        <td>
                          <span className="badge outline">{s.result.engineId}</span>
                        </td>
                        <td className="right">
                          <Icon name="chevronRight" size={15} className="muted" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('reports.overdue')} subtitle={t('reports.priorityNote')}>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {due.length === 0 && <Empty text={t('common.noData')} />}
              {due.slice(0, 6).map((c) => (
                <div key={c.kase.id} className="rank-row">
                  <span className="name truncate">{c.plot?.name ?? '—'}</span>
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, c.ageDays * 5)}%`, background: 'var(--high)' }} />
                  </div>
                  <StatusBadge status={c.kase.status} t={t} />
                  <span className="small muted-2 no-wrap">{c.ageDays}d</span>
                </div>
              ))}
              <button type="button" className="btn sm block mt-10" onClick={() => navigate('/expert')}>
                <Icon name="users" size={13} /> {t('expert.queue')}
              </button>
            </div>
          </Card>

          <Card title={t('common.followUp')}>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {state.followUps.length === 0 && <Empty text={t('reports.noFollowUp')} />}
              {state.followUps.slice(0, 6).map((f) => {
                const plot = state.plots.find((p) => p.id === f.plotId);
                return (
                  <div key={f.id} className="notif">
                    <SeverityBadge severity={f.severity} t={t} />
                    <div className="flex-1">
                      <div className="small strong">{plot?.name}</div>
                      <div className="muted small truncate">{f.observation}</div>
                      <div className="t">{fmtDate(f.date, state.settings.lang)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Notice kind="plain" icon="info">
            {t('reports.exportedBy')}
          </Notice>
        </div>
      </div>
    </>
  );
}
