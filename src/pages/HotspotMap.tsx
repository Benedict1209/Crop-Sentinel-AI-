import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { buildHotspots } from '../lib/geo';
import { HotspotMap } from '../components/HotspotMap';
import { Card, Empty, Icon, Notice, RiskBadge, SeverityBadge } from '../components/ui';
import { fmtDate } from '../lib/format';
import { CROPS, getCrop } from '../domain/knowledge';
import { resultLabelKey } from '../lib/screening';

export function HotspotMapPage() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();

  const [cropId, setCropId] = useState('all');
  const [conditionId, setConditionId] = useState('all');
  const [range, setRange] = useState('30');
  const [riskFilter, setRiskFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');

  const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;

  const districtOf = useMemo(
    () => (plotId: string) => {
      const plot = state.plots.find((p) => p.id === plotId);
      return state.farms.find((f) => f.id === plot?.farmId)?.district ?? '—';
    },
    [state.plots, state.farms],
  );

  const scans = useMemo(
    () =>
      state.scans.filter((s) => {
        if (new Date(s.createdAt).getTime() < cutoff) return false;
        if (cropId !== 'all' && s.cropId !== cropId) return false;
        if (conditionId !== 'all' && s.result.conditionId !== conditionId) return false;
        return true;
      }),
    [state.scans, cutoff, cropId, conditionId],
  );

  const { markers, summaries } = useMemo(
    () => buildHotspots({ plots: state.plots, scans, traps: state.traps, districtOf }),
    [state.plots, scans, state.traps, districtOf],
  );

  const visibleMarkers = markers.filter((m) => riskFilter === 'all' || m.risk === riskFilter);
  const selected = markers.find((m) => m.plotId === selectedId) ?? null;
  const selectedPlot = state.plots.find((p) => p.id === selectedId);
  const selectedFarm = state.farms.find((f) => f.id === selectedPlot?.farmId);
  const selectedScan = state.scans.find((s) => s.id === selected?.scanId);
  const supporting = state.scans
    .filter((s) => s.plotId === selectedId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5);

  const conditions = useMemo(() => {
    const map = new Map<string, string>();
    state.scans.forEach((s) => map.set(s.result.conditionId, resultLabelKey(s.result)));
    return [...map.entries()];
  }, [state.scans]);

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('map.title')}</h1>
          <p className="sub">{t('map.sub')}</p>
        </div>
        <div className="row">
          <button type="button" className={`btn sm ${view === 'map' ? 'primary' : ''}`} onClick={() => setView('map')}>
            <Icon name="map" size={13} /> {t('map.mapView')}
          </button>
          <button type="button" className={`btn sm ${view === 'list' ? 'primary' : ''}`} onClick={() => setView('list')}>
            <Icon name="file" size={13} /> {t('map.listView')}
          </button>
        </div>
      </div>

      <Notice kind="demo" icon="info">
        <strong>{t('map.schematic')} </strong>
        {t('map.notConfirmed')}
      </Notice>

      <div className="card pad mt-14 mb-14">
        <div className="row">
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('filter.crop')}</span>
            <select value={cropId} onChange={(e) => setCropId(e.target.value)} style={{ width: 150 }}>
              <option value="all">{t('common.all')}</option>
              {CROPS.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('filter.condition')}</span>
            <select value={conditionId} onChange={(e) => setConditionId(e.target.value)} style={{ width: 200 }}>
              <option value="all">{t('common.all')}</option>
              {conditions.map(([id, key]) => (
                <option key={id} value={id}>
                  {t(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('filter.risk')}</span>
            <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} style={{ width: 140 }}>
              <option value="all">{t('common.all')}</option>
              <option value="high">{t('risk.high')}</option>
              <option value="medium">{t('risk.medium')}</option>
              <option value="low">{t('risk.low')}</option>
            </select>
          </label>
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('common.dateRange')}</span>
            <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 145 }}>
              <option value="30">{t('common.last30')}</option>
              <option value="90">{t('common.last90')}</option>
              <option value="all">{t('common.all')}</option>
            </select>
          </label>
          <div className="spacer" />
          <span className="badge outline">
            {visibleMarkers.length} {t('map.markers')}
          </span>
        </div>
      </div>

      <div className="grid side">
        <Card
          title={view === 'map' ? t('map.mapView') : t('map.listView')}
          subtitle={t('map.zoomHint')}
          actions={view === 'list' ? undefined : <span className="small muted">{t('map.selectMarker')}</span>}
        >
          {view === 'map' ? (
            <div className="card-body">
              <HotspotMap
                markers={visibleMarkers}
                selectedId={selectedId}
                onSelect={setSelectedId}
                legendLow={t('risk.low')}
                legendMedium={t('risk.medium')}
                legendHigh={t('risk.high')}
                ariaLabel={t('map.title')}
              />
            </div>
          ) : visibleMarkers.length === 0 ? (
            <Empty text={t('common.noData')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.plot')}</th>
                    <th>{t('common.farm')}</th>
                    <th>{t('common.district')}</th>
                    <th>{t('common.crop')}</th>
                    <th>{t('filter.condition')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('common.riskLevel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMarkers.map((m) => (
                    <tr key={m.plotId} className="clickable" onClick={() => setSelectedId(m.plotId)}>
                      <td>{m.plotName}</td>
                      <td>{state.farms.find((f) => f.id === state.plots.find((p) => p.id === m.plotId)?.farmId)?.name ?? '—'}</td>
                      <td>{m.district}</td>
                      <td>{t(getCrop(m.cropId).labelKey)}</td>
                      <td>{t(m.conditionKey)}</td>
                      <td className="no-wrap">{fmtDate(m.date, state.settings.lang)}</td>
                      <td>
                        <RiskBadge level={m.risk} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('common.details')}>
            <div className="card-body">
              {!selected ? (
                <Empty text={t('map.selectMarker')} />
              ) : (
                <div className="col" style={{ gap: 11 }}>
                  <div>
                    <h3>{selected.plotName}</h3>
                    <div className="muted small">
                      {selectedFarm?.name} · {selected.district} · {selectedFarm?.village}
                    </div>
                  </div>
                  <div className="row">
                    <RiskBadge level={selected.risk} t={t} />
                    <SeverityBadge severity={selected.severity as never} t={t} />
                    <span className="badge outline">{t(getCrop(selected.cropId).labelKey)}</span>
                  </div>
                  <dl className="kv">
                    <dt>{t('common.location')}</dt>
                    <dd className="mono">
                      {selected.lat}, {selected.lng}
                    </dd>
                    <dt>{t('filter.condition')}</dt>
                    <dd>{t(selected.conditionKey)}</dd>
                    <dt>{t('common.date')}</dt>
                    <dd>{fmtDate(selected.date, state.settings.lang)}</dd>
                    <dt>{t('map.reports')}</dt>
                    <dd>
                      {selected.supportingReports} · {selected.trapAlerts} {t('nav.traps')}
                    </dd>
                    <dt>{t('common.riskLevel')}</dt>
                    <dd>{t(`risk.${selected.risk}`)}</dd>
                  </dl>
                  <div>
                    <h4 className="mb-6">{t('map.recommended')}</h4>
                    <div className="small">{t(selected.recommendedKey)}</div>
                  </div>
                  {selectedScan && (
                    <div>
                      <h4 className="mb-6">{t('map.reports')}</h4>
                      <div className="timeline">
                        {supporting.map((s) => (
                          <div key={s.id} className="tl-item">
                            <div className="tl-date">{fmtDate(s.createdAt, state.settings.lang)}</div>
                            <div className="tl-title">{t(resultLabelKey(s.result))}</div>
                            <div className="tl-body">
                              <SeverityBadge severity={s.result.severity} t={t} />{' '}
                              <a href={`#/report/${s.id}`} onClick={(e) => { e.preventDefault(); navigate(`/report/${s.id}`); }}>
                                {t('reports.openReport')}
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button type="button" className="btn block" onClick={() => navigate(`/plots/${selected.plotId}`)}>
                    <Icon name="leaf" size={13} /> {t('action.openPlot')}
                  </button>
                </div>
              )}
            </div>
          </Card>

          <Card title={t('map.hotspotRanking')} subtitle={t('map.regionSummary')}>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {summaries.length === 0 && <Empty text={t('common.noData')} />}
              {summaries.slice(0, 8).map((d) => (
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
                  <span className="small muted-2 no-wrap">{d.markers}</span>
                  <RiskBadge level={d.risk} t={t} />
                </div>
              ))}
              {summaries[0]?.dominantConditionKey && (
                <div className="muted-2 small mt-10">
                  {t('map.regionSummary')}: {summaries[0].district} — {t(summaries[0].dominantConditionKey)}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
