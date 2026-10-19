import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { assessPlotRisk, category } from '../lib/risk';
import { riskInputFor } from '../lib/selectors';
import { Card, Empty, Field, Icon, Notice, RiskBadge, Stat } from '../components/ui';
import { RiskFactorList } from '../components/RiskFactorList';
import { RiskTrendChart } from '../components/charts';
import { getWeather } from '../lib/weather';
import type { WeatherSnapshot } from '../domain/types';
import { fmtDate } from '../lib/format';
import { resultLabelKey } from '../lib/screening';

export function RiskForecast() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [plotId, setPlotId] = useState(params.get('plot') ?? state.plots[0]?.id ?? '');
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherNote, setWeatherNote] = useState<string | null>(null);

  const plot = state.plots.find((p) => p.id === plotId) ?? state.plots[0];

  useEffect(() => {
    if (!plot) return;
    let alive = true;
    getWeather(plot.lat, plot.lng, state.settings.weatherProvider).then((res) => {
      if (!alive) return;
      setWeather(res.snapshot);
      setWeatherNote(res.fellBack ? `${t('risk.weatherUnavailable')} (${res.error ?? ''})` : null);
    });
    return () => {
      alive = false;
    };
  }, [plot?.id, state.settings.weatherProvider, t]);

  const { assessment, trend } = useMemo(() => {
    if (!plot) return { assessment: null, trend: [] };
    const input = riskInputFor(state, plot);
    const withWeather = { ...input, weather };
    return assessPlotRisk(withWeather);
  }, [state, plot, weather]);

  if (!plot || !assessment) {
    return (
      <Card title={t('risk.title')}>
        <Empty text={t('common.noData')} />
      </Card>
    );
  }

  const farm = state.farms.find((f) => f.id === plot.farmId);
  const forecastDays = (weather?.days ?? []).filter((d) => d.kind !== 'observed').slice(0, 7);

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('risk.title')}</h1>
          <p className="sub">{t('risk.sub')}</p>
        </div>
        <button type="button" className="btn" onClick={() => navigate('/settings')}>
          <Icon name="sliders" size={14} /> {t('risk.weights')}
        </button>
      </div>

      <div className="card pad mb-14">
        <div className="row">
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('risk.selectPlot')}</span>
            <select value={plot.id} onChange={(e) => setPlotId(e.target.value)} style={{ width: 260 }}>
              {state.plots.map((p) => {
                const f = state.farms.find((x) => x.id === p.farmId);
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} — {f?.district}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="spacer" />
          <span className="badge info">
            <Icon name="cloud" size={12} /> {assessment.weatherSource}
          </span>
          <span className={`badge ${assessment.weatherKind === 'simulated' ? 'medium' : 'low'}`}>
            {assessment.weatherKind === 'simulated' ? t('risk.simulated') : t('risk.observed')}
          </span>
        </div>
      </div>

      {weatherNote && (
        <Notice kind="warn" icon="alert">
          {weatherNote}
        </Notice>
      )}

      <div className="grid c4 mb-14">
        <Stat label={t('risk.current')} value={t(`risk.${assessment.category}`)} variant={assessment.category === 'high' ? 'risk' : assessment.category === 'medium' ? 'warn' : undefined} hint={`${t('risk.score')}: ${assessment.score}`} />
        <Stat label={t('common.crop')} value={t(`crop.${plot.cropId}`)} hint={`${plot.variety || '—'} · ${t(`stage.${plot.stage}`)}`} />
        <Stat label={t('risk.monitoring')} value={`${assessment.monitoringIntervalDays} ${t('risk.days')}`} variant="info" />
        <Stat label={t('risk.missing')} value={assessment.missingInformation.length} hint={assessment.missingInformation.map((k) => t(k))[0] ?? '—'} />
      </div>

      <div className="grid side">
        <Card
          title={t('risk.trend')}
          subtitle={weather ? `${weather.providerLabel} · ${fmtDate(weather.fetchedAt, state.settings.lang)}` : t('common.notAvailable')}
        >
          <div className="card-body">
            {trend.length === 0 ? (
              <Empty text={t('common.noData')} />
            ) : (
              <>
                <RiskTrendChart data={trend} t={t} lang={state.settings.lang} />
                <div className="legend-inline mt-10">
                  <span>
                    <i className="dot info" /> {t('risk.forecast')}
                  </span>
                  <span>
                    <i className="dot low" /> {t('risk.observed')}
                  </span>
                  <span className="muted-2">{t('risk.engineNote')}</span>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card title={t('risk.factors')} subtitle={`${t('risk.score')}: ${assessment.score} · ${t(`risk.${assessment.category}`)}`}>
          <div className="card-body">
            <RiskFactorList assessment={assessment} t={t} />
          </div>
        </Card>
      </div>

      <div className="grid c2 mt-14">
        <Card title={`${t('risk.provider')} — ${t('risk.forecast')}`}>
          {forecastDays.length === 0 ? (
            <Empty text={t('common.noData')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('traps.temp')}</th>
                    <th>{t('traps.humidity')}</th>
                    <th>mm</th>
                    <th>{t('common.source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastDays.map((d) => (
                    <tr key={d.date}>
                      <td className="no-wrap">{fmtDate(d.date, state.settings.lang)}</td>
                      <td>
                        {d.tMin}–{d.tMax}
                      </td>
                      <td>{d.rhMean}%</td>
                      <td>{d.rainMm}</td>
                      <td className="small muted">{d.kind === 'forecast' ? t('risk.forecast') : t('risk.simulated')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('risk.weights')} subtitle={t('settings.weights')}>
          <div className="card-body">
            <div className="col" style={{ gap: 9 }}>
              {Object.entries(state.settings.riskWeights).map(([k, v]) => (
                <div key={k} className="row nowrap">
                  <span className="small" style={{ width: 140 }}>
                    {t(`factor.${k}`)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={v}
                    onChange={(e) => state.setWeights({ [k]: Number(e.target.value) } as never)}
                    style={{ flex: 1 }}
                  />
                  <span className="small muted-2 no-wrap" style={{ width: 26, textAlign: 'right' }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <Notice kind="plain" icon="info">
              {t('risk.engineNote')}
            </Notice>
          </div>
        </Card>
      </div>

      <div className="grid c2 mt-14">
        <Card title={t('scanner.contributing')} subtitle={t('advisory.monitoring')}>
          <div className="card-body">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {assessment.factors.map((f) => (
                <li key={f.id} className="small mb-6">
                  <strong>{f.labelKey ? t(f.labelKey) : f.label}</strong> — {t(f.detailKey, f.params)}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card title={t('farms.plotHistory')} subtitle={`${plot.name} · ${farm?.name}`}>
          <div className="card-body">
            <div className="timeline">
              {state.scans
                .filter((s) => s.plotId === plot.id)
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .slice(0, 6)
                .map((s) => (
                  <div key={s.id} className={`tl-item ${s.result.severity === 'high' || s.result.severity === 'severe' ? 'high' : s.result.severity === 'moderate' ? 'medium' : ''}`}>
                    <div className="tl-date">{fmtDate(s.createdAt, state.settings.lang)}</div>
                    <div className="tl-title">{t(resultLabelKey(s.result))}</div>
                    <div className="tl-body muted">{t(`severity.${s.result.severity}`)}</div>
                  </div>
                ))}
              {state.scans.filter((s) => s.plotId === plot.id).length === 0 && <Empty text={t('risk.noScan')} />}
            </div>
            <div className="mt-10">
              <Field label={t('common.riskLevel')}>
                <div className="row">
                  <RiskBadge level={category(assessment.score)} t={t} />
                  <span className="small muted">
                    {t('traps.historyNote')}
                  </span>
                </div>
              </Field>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
