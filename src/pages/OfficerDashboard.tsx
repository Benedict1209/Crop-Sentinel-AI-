import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Icon, Notice, RiskBadge, SeverityBadge, Stat, StatusBadge, Tabs } from '../components/ui';
import { allRiskRows, caseViews, conditionDistribution } from '../lib/selectors';
import { buildHotspots } from '../lib/geo';
import { exportCsv, printPage, stamp } from '../lib/exports';
import { fmtDate } from '../lib/format';
import { ConditionBars } from '../components/charts';
import { resultLabelKey } from '../lib/screening';

export function OfficerDashboard() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [tab, setTab] = useState('emerging');

  const rows = useMemo(() => allRiskRows(state), [state]);
  const views = useMemo(() => caseViews(state), [state]);
  const unresolved = views.filter((v) => v.kase.status !== 'resolved');
  const overdue = views.filter((v) => v.overdue);

  const { summaries, markers } = useMemo(
    () =>
      buildHotspots({
        plots: state.plots,
        scans: state.scans,
        traps: state.traps,
        districtOf: (plotId) => {
          const plot = state.plots.find((p) => p.id === plotId);
          return state.farms.find((f) => f.id === plot?.farmId)?.district ?? '—';
        },
      }),
    [state.plots, state.scans, state.traps, state.farms],
  );

  const districtRows = useMemo(() => {
    const byDistrict = new Map<string, { district: string; plots: number; high: number; scans: number; cases: number }>();
    for (const r of rows) {
      const key = r.farm.district;
      const cur = byDistrict.get(key) ?? { district: key, plots: 0, high: 0, scans: 0, cases: 0 };
      cur.plots += 1;
      if (r.assessment.category === 'high') cur.high += 1;
      cur.scans += r.plot ? state.scans.filter((s) => s.plotId === r.plot.id).length : 0;
      cur.cases += state.cases.filter((c) => c.plotId === r.plot.id && c.status !== 'resolved').length;
      byDistrict.set(key, cur);
    }
    return [...byDistrict.values()].sort((a, b) => b.high - a.high);
  }, [rows, state.scans, state.cases]);

  const dist = useMemo(() => conditionDistribution(state), [state]);

  function exportSummary() {
    exportCsv(
      `cropsentinel-officer-summary-${stamp()}.csv`,
      ['district', 'plots', 'high_risk_plots', 'screenings', 'open_cases'],
      districtRows.map((d) => [d.district, d.plots, d.high, d.scans, d.cases]),
    );
  }

  const emerging = markers
    .filter((m) => m.risk !== 'low')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('officer.title')}</h1>
          <p className="sub">{t('officer.sub')}</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={exportSummary}>
            <Icon name="download" size={14} /> {t('common.export')}
          </button>
          <button type="button" className="btn" onClick={printPage}>
            <Icon name="printer" size={14} /> {t('common.print')}
          </button>
        </div>
      </div>

      <Notice kind="demo" icon="info">
        {t('map.notConfirmed')} {t('brand.demoNote')}
      </Notice>

      <div className="grid c5 mt-14 mb-14">
        <Stat label={t('dashboard.farms')} value={state.farms.length} hint={`${districtRows.length} ${t('common.district')}`} />
        <Stat label={t('dashboard.plots')} value={state.plots.length} />
        <Stat label={t('officer.unresolved')} value={unresolved.length} variant="warn" />
        <Stat label={t('officer.overdue')} value={overdue.length} variant="risk" />
        <Stat
          label={t('dashboard.hotspots')}
          value={summaries.filter((s) => s.risk === 'high').length}
          variant="risk"
          hint={summaries[0] ? `${summaries[0].district} (${summaries[0].score})` : '—'}
        />
      </div>

      <div className="grid side mb-14">
        <Card title={t('officer.casesByDistrict')} subtitle={t('officer.regionSummary')}>
          {districtRows.length === 0 ? (
            <Empty text={t('common.noData')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.district')}</th>
                    <th>{t('common.plot')}</th>
                    <th>{t('dashboard.highRisk')}</th>
                    <th>{t('dashboard.scans')}</th>
                    <th>{t('officer.unresolved')}</th>
                    <th>{t('map.riskSummary')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {districtRows.map((d) => {
                    const summary = summaries.find((s) => s.district === d.district);
                    return (
                      <tr key={d.district}>
                        <td>{d.district}</td>
                        <td>{d.plots}</td>
                        <td>{d.high}</td>
                        <td>{d.scans}</td>
                        <td>{d.cases}</td>
                        <td>{summary ? <RiskBadge level={summary.risk} t={t} /> : <span className="badge outline">—</span>}</td>
                        <td className="right">
                          <button type="button" className="btn sm" onClick={() => navigate('/map')}>
                            <Icon name="map" size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('dashboard.riskDistribution')} subtitle={t('officer.regionSummary')}>
          <div className="card-body">
            {dist.length === 0 ? (
              <Empty text={t('common.noData')} />
            ) : (
              <ConditionBars data={dist.slice(0, 7).map((d) => ({ label: t(d.labelKey), count: d.count, group: d.group }))} height={230} />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Tabs
            active={tab}
            onChange={setTab}
            items={[
              { id: 'emerging', label: t('officer.emerging'), count: emerging.length },
              { id: 'unresolved', label: t('officer.unresolved'), count: unresolved.length },
              { id: 'followup', label: t('officer.followUpStatus'), count: state.followUps.length },
            ]}
          />
        </div>
        <div className="card-body">
          {tab === 'emerging' && (
            <>
              {emerging.length === 0 ? (
                <Empty text={t('common.noData')} />
              ) : (
                <div className="grid c2">
                  {emerging.map((m) => {
                    const farm = state.farms.find((f) => f.id === state.plots.find((p) => p.id === m.plotId)?.farmId);
                    return (
                      <div key={m.plotId} className="card pad clickable" onClick={() => navigate('/map')}>
                        <div className="row">
                          <RiskBadge level={m.risk} t={t} />
                          <SeverityBadge severity={m.severity as never} t={t} />
                          <span className="muted-2 small">{fmtDate(m.date, state.settings.lang)}</span>
                          <div className="spacer" />
                          <span className="badge outline">{m.district}</span>
                        </div>
                        <h3 className="mt-6">
                          {m.plotName} · {t(`crop.${m.cropId}`)}
                        </h3>
                        <div className="muted small">
                          {farm?.name} · {farm?.village} · {t(m.conditionKey)}
                        </div>
                        <div className="small mt-6">
                          <Icon name="mapPin" size={13} className="muted" />{' '}
                          <span className="mono">
                            {m.lat}, {m.lng}
                          </span>{' '}
                          · {m.supportingReports} {t('map.reports')} · {m.trapAlerts} {t('nav.traps')}
                        </div>
                        <div className="small muted mt-6">{t(m.recommendedKey)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'unresolved' && (
            <>
              {unresolved.length === 0 ? (
                <Empty text={t('common.noData')} />
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('common.plot')}</th>
                        <th>{t('common.district')}</th>
                        <th>{t('expert.predicted')}</th>
                        <th>{t('common.severity')}</th>
                        <th>{t('common.status')}</th>
                        <th>{t('common.followUp')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {unresolved.map((v) => (
                        <tr key={v.kase.id} className="clickable" onClick={() => navigate('/expert')}>
                          <td className="no-wrap">{fmtDate(v.kase.submittedAt, state.settings.lang)}</td>
                          <td>{v.plot?.name ?? '—'}</td>
                          <td>{v.farm?.district ?? '—'}</td>
                          <td>{v.scan ? t(resultLabelKey(v.scan.result)) : '—'}</td>
                          <td>{v.scan ? <SeverityBadge severity={v.scan.result.severity} t={t} /> : '—'}</td>
                          <td>
                            <StatusBadge status={v.kase.status} t={t} />
                          </td>
                          <td>{v.overdue ? <span className="badge high">{t('reports.overdue')}</span> : <span className="badge outline">{v.followUps.length}</span>}</td>
                          <td className="right">
                            <Icon name="chevronRight" size={15} className="muted" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'followup' && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('common.plot')}</th>
                    <th>{t('reports.observation')}</th>
                    <th>{t('common.severity')}</th>
                    <th>{t('reports.linkedCase')}</th>
                    <th>{t('traps.observer')}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.followUps.map((f) => (
                    <tr key={f.id}>
                      <td className="no-wrap">{fmtDate(f.date, state.settings.lang)}</td>
                      <td>{state.plots.find((p) => p.id === f.plotId)?.name ?? '—'}</td>
                      <td className="truncate" style={{ maxWidth: 320 }}>
                        {f.observation}
                      </td>
                      <td>
                        <SeverityBadge severity={f.severity} t={t} />
                      </td>
                      <td>{f.caseId ? <span className="badge info">{t('common.yes')}</span> : <span className="badge outline">{t('common.no')}</span>}</td>
                      <td>{f.recordedBy}</td>
                    </tr>
                  ))}
                  {state.followUps.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <Empty text={t('reports.noFollowUp')} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="muted small mt-10">{t('reports.priorityNote')}</div>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
