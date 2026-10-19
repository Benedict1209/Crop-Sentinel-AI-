import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { allRiskRows, caseViews, conditionDistribution, dashboardMetrics, healthTrend, plotRows } from '../lib/selectors';
import { buildHotspots } from '../lib/geo';
import { Card, Empty, Icon, Notice, RiskBadge, SeverityBadge, Stat, SeverityDot } from '../components/ui';
import { ConditionBars, HealthTrendChart, RiskDonut } from '../components/charts';
import { fmtDate, daysAgo } from '../lib/format';
import { resultLabelKey } from '../lib/screening';

export function Dashboard() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [farmId, setFarmId] = useState('all');
  const [district, setDistrict] = useState('all');
  const [range, setRange] = useState('30');

  const rows = useMemo(() => allRiskRows(state), [state]);
  const districts = useMemo(() => [...new Set(state.farms.map((f) => f.district))].sort(), [state.farms]);

  const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;

  const filteredPlots = useMemo(
    () =>
      state.plots.filter((p) => {
        const farm = state.farms.find((f) => f.id === p.farmId);
        if (farmId !== 'all' && p.farmId !== farmId) return false;
        if (district !== 'all' && farm?.district !== district) return false;
        return true;
      }),
    [state.plots, state.farms, farmId, district],
  );
  const plotIds = useMemo(() => new Set(filteredPlots.map((p) => p.id)), [filteredPlots]);
  const filteredScans = useMemo(
    () => state.scans.filter((s) => plotIds.has(s.plotId) && new Date(s.createdAt).getTime() >= cutoff),
    [state.scans, plotIds, cutoff],
  );
  const filteredRows = rows.filter((r) => plotIds.has(r.plot.id));
  const metrics = useMemo(() => dashboardMetrics(state, filteredRows), [state, filteredRows]);
  const trend = useMemo(() => healthTrend({ ...state, scans: filteredScans }, Number(range === 'all' ? 90 : range)), [state, filteredScans, range]);
  const dist = useMemo(() => conditionDistribution({ ...state, scans: filteredScans }), [state, filteredScans]);
  const hotspots = useMemo(
    () =>
      buildHotspots({
        plots: filteredPlots,
        scans: filteredScans,
        traps: state.traps,
        districtOf: (plotId) => {
          const plot = state.plots.find((p) => p.id === plotId);
          return state.farms.find((f) => f.id === plot?.farmId)?.district ?? '—';
        },
      }),
    [filteredPlots, filteredScans, state.traps, state.plots, state.farms],
  );
  const cases = useMemo(() => caseViews(state).filter((c) => plotIds.has(c.plot?.id ?? '' ) || c.plot === undefined), [state, plotIds]);
  const plots = useMemo(() => plotRows(state, rows).filter((p) => plotIds.has(p.plot.id)), [state, rows, plotIds]);

  const recent = filteredScans.slice(0, 8);
  const alerts = useMemo(() => {
    const out: { id: string; kind: 'trap' | 'review' | 'followup'; title: string; body: string; at: string; href: string }[] = [];
    state.traps
      .filter((x) => x.thresholdAlert && plotIds.has(x.plotId))
      .slice(0, 4)
      .forEach((x) => {
        const plot = state.plots.find((p) => p.id === x.plotId);
        out.push({
          id: `trap-${x.id}`,
          kind: 'trap',
          title: `${plot?.name ?? '—'} · ${x.count} caught`,
          body: `${x.pestCategory} — above the illustrative demo threshold.`,
          at: x.date,
          href: '/traps',
        });
      });
    cases
      .filter((c) => c.overdue || c.kase.status !== 'resolved')
      .slice(0, 4)
      .forEach((c) => {
        out.push({
          id: `case-${c.kase.id}`,
          kind: c.overdue ? 'followup' : 'review',
          title: `${c.plot?.name ?? '—'} · ${t(`status.${c.kase.status}`)}`,
          body: c.overdue ? t('reports.overdue') : t('expert.queue'),
          at: c.kase.submittedAt,
          href: '/expert',
        });
      });
    plots
      .filter((p) => p.risk?.assessment.category === 'high')
      .slice(0, 3)
      .forEach((p) => {
        out.push({
          id: `risk-${p.plot.id}`,
          kind: 'review',
          title: `${p.plot.name} · ${t('risk.high')}`,
          body: t('risk.title'),
          at: p.risk?.assessment.generatedAt ?? new Date().toISOString(),
          href: `/plots/${p.plot.id}`,
        });
      });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
  }, [state.traps, state.plots, cases, plots, plotIds, t]);

  const donut = [
    { level: 'high', count: filteredRows.filter((r) => r.assessment.category === 'high').length },
    { level: 'medium', count: filteredRows.filter((r) => r.assessment.category === 'medium').length },
    { level: 'low', count: filteredRows.filter((r) => r.assessment.category === 'low').length },
  ];

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('dashboard.title')}</h1>
          <p className="sub">{t('dashboard.sub')}</p>
        </div>
        <button type="button" className="btn primary" onClick={() => navigate('/scanner')}>
          <Icon name="camera" size={15} /> {t('action.scan')}
        </button>
      </div>

      <div className="card pad mb-14">
        <div className="row">
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('filter.farm')}</span>
            <select value={farmId} onChange={(e) => setFarmId(e.target.value)} style={{ width: 190 }}>
              <option value="all">{t('common.all')}</option>
              {state.farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('filter.district')}</span>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} style={{ width: 170 }}>
              <option value="all">{t('common.all')}</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('common.dateRange')}</span>
            <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 150 }}>
              <option value="30">{t('common.last30')}</option>
              <option value="90">{t('common.last90')}</option>
              <option value="all">{t('common.all')}</option>
            </select>
          </label>
          <div className="spacer" />
          <span className="badge outline">
            <Icon name="filter" size={12} /> {filteredPlots.length} / {state.plots.length} {t('common.plot')}
          </span>
        </div>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('dashboard.farms')} value={metrics.farms} hint={`${metrics.plots} ${t('farms.plotCount')}`} />
        <Stat label={t('dashboard.plots')} value={metrics.plots} hint={`${state.farms.length} ${t('common.farm')}`} />
        <Stat label={t('dashboard.scans')} value={metrics.scans} hint={`${t('dashboard.healthyShare')}: ${metrics.healthyShare}%`} />
        <Stat label={t('dashboard.highRisk')} value={metrics.highRisk} variant="risk" hint={`${t('dashboard.avgRisk')}: ${metrics.avgRisk}/100`} />
      </div>
      <div className="grid c4 mb-14">
        <Stat label={t('dashboard.pendingReview')} value={metrics.pendingReviews} variant="warn" hint={`${metrics.underReview} ${t('status.under_review')} · ${metrics.resolvedCases} ${t('status.resolved')}`} />
        <Stat label={t('dashboard.openFollowUps')} value={metrics.openFollowUps} variant="warn" />
        <Stat label={t('dashboard.trapAlerts')} value={metrics.trapAlerts} variant="risk" hint={t('traps.illustrativeNote').slice(0, 54) + '…'} />
        <Stat label={t('severity.inconclusive')} value={metrics.inconclusive} hint={t('unc.lowEvidence').slice(0, 60) + '…'} />
      </div>

      <div className="grid side mb-14">
        <Card title={t('dashboard.trend')} subtitle={t('common.demoData')}>
          <div className="card-body">
            <HealthTrendChart data={trend} t={t} lang={state.settings.lang} />
          </div>
        </Card>
        <Card title={t('dashboard.riskDistribution')}>
          <div className="card-body">
            <RiskDonut data={donut} t={t} />
            <div className="legend-inline mt-10">
              <span>
                <i className="dot high" /> {metrics.highRisk} {t('risk.high')}
              </span>
              <span>
                <i className="dot medium" /> {metrics.mediumRisk} {t('risk.medium')}
              </span>
              <span>
                <i className="dot low" /> {metrics.lowRisk} {t('risk.low')}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid side mb-14">
        <Card
          title={t('dashboard.recent')}
          subtitle={`${filteredScans.length} ${t('dashboard.scans')}`}
          actions={
            <Link className="btn sm" to="/reports">
              {t('common.viewAll')}
            </Link>
          }
        >
          {recent.length === 0 ? (
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s) => {
                    const plot = state.plots.find((p) => p.id === s.plotId);
                    return (
                      <tr key={s.id} className="clickable" onClick={() => navigate(`/report/${s.id}`)}>
                        <td className="no-wrap">{fmtDate(s.createdAt, state.settings.lang)}</td>
                        <td>{plot?.name ?? '—'}</td>
                        <td>{t(`crop.${s.cropId}`)}</td>
                        <td>{t(resultLabelKey(s.result))}</td>
                        <td>
                          <SeverityBadge severity={s.result.severity} t={t} />
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

        <Card title={t('dashboard.alerts')} subtitle={t('common.demoData')}>
          <div className="card-body" style={{ paddingTop: 6 }}>
            {alerts.length === 0 && <Empty text={t('common.noData')} />}
            {alerts.map((a) => (
              <div key={a.id} className="notif" style={{ cursor: 'pointer' }} onClick={() => navigate(a.href)}>
                <SeverityDot severity={a.kind === 'trap' ? 'high' : a.kind === 'followup' ? 'moderate' : 'low'} />
                <div className="flex-1">
                  <div style={{ fontWeight: 600, fontSize: 12.6 }}>{a.title}</div>
                  <div className="muted small">{a.body}</div>
                  <div className="t">{daysAgo(a.at)}d</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid side">
        <Card title="Disease & pest mix" subtitle={t('dashboard.riskDistribution')}>
          <div className="card-body">
            {dist.length === 0 ? (
              <Empty text={t('common.noData')} />
            ) : (
              <ConditionBars data={dist.slice(0, 8).map((d) => ({ label: t(d.labelKey), count: d.count, group: d.group }))} />
            )}
          </div>
        </Card>

        <Card
          title={t('dashboard.hotspots')}
          subtitle={t('map.notConfirmed')}
          actions={
            <Link className="btn sm" to="/map">
              <Icon name="map" size={13} /> {t('nav.map')}
            </Link>
          }
        >
          <div className="card-body">
            {hotspots.summaries.length === 0 && <Empty text={t('common.noData')} />}
            {hotspots.summaries.slice(0, 6).map((d) => (
              <div key={d.district} className="rank-row">
                <span className="name truncate">{d.district}</span>
                <div className="bar">
                  <i
                    style={{
                      width: `${d.score}%`,
                      background: d.risk === 'high' ? 'var(--high)' : d.risk === 'medium' ? 'var(--medium)' : 'var(--low)',
                    }}
                  />
                </div>
                <span className="small muted-2 no-wrap">{d.markers} obs</span>
                <RiskBadge level={d.risk} t={t} />
              </div>
            ))}
            {hotspots.summaries.length > 0 && (
              <Notice kind="demo" icon="info">
                {t('map.notConfirmed')}
              </Notice>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-14">
        <Notice kind="demo" icon="info">
          <strong>{t('brand.demoMode')}: </strong>
          {t('brand.demoNote')}
        </Notice>
      </div>

    </>
  );
}
