import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { LANGS, makeT } from '../lib/i18n';
import { Card, Field, Icon, Notice, Stat } from '../components/ui';
import { RISK_WEIGHT_LABELS } from '../lib/risk';
import { adapterStatus, TRAINED_MODEL_PATH } from '../lib/screening';
import { MODEL_SUPPORTED_CROPS } from '../lib/modelScreening';
import { checkHealth, DEFAULT_SERVICE_URL, type ServiceHealth } from '../lib/inferenceClient';
import { MEASURED_PERFORMANCE, MODEL_DISPLAY } from '../domain/modelLabels';
import { CROPS } from '../domain/knowledge';
import { WEATHER_PROVIDERS } from '../lib/weather';
import type { Lang } from '../domain/types';
import type { WeatherProviderId } from '../lib/weather';

interface AdapterRow {
  id: string;
  label: string;
  kind: string;
  available: boolean;
  describes: string;
}

export function Settings() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const [adapters, setAdapters] = useState<AdapterRow[]>([]);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [serviceDraft, setServiceDraft] = useState(state.settings.modelServiceUrl);
  const [serviceProbe, setServiceProbe] = useState<
    { state: 'idle' } | { state: 'testing' } | { state: 'ok'; health: ServiceHealth } | { state: 'down'; error: string }
  >({ state: 'idle' });

  useEffect(() => {
    adapterStatus().then(setAdapters);
  }, [state.settings.modelServiceUrl]);

  /**
   * Probe an explicit URL rather than reading it back out of the store: the
   * store has not re-rendered yet on the click that saves the field, so reading
   * `state.settings` here would test the previous address and report the wrong
   * service as reachable.
   */
  async function probeService(url: string) {
    setServiceProbe({ state: 'testing' });
    const result = await checkHealth(url);
    setServiceProbe(result.ok ? { state: 'ok', health: result.data } : { state: 'down', error: result.error });
    adapterStatus().then(setAdapters);
  }

  const cropsWithoutModel = CROPS.map((c) => c.id).filter(
    (id) => !(MODEL_SUPPORTED_CROPS as readonly string[]).includes(id),
  );

  const totalWeight = Object.values(state.settings.riskWeights).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('settings.title')}</h1>
          <p className="sub">{t('settings.sub')}</p>
        </div>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('settings.totalRecords')} value={state.scans.length + state.traps.length + state.cases.length + state.followUps.length} hint={`${state.scans.length} scans · ${state.traps.length} traps · ${state.cases.length} cases`} />
        <Stat label={t('settings.activeEngine')} value={adapters.find((a) => a.available)?.id ?? '…'} variant="info" />
        <Stat label={t('risk.provider')} value={state.settings.weatherProvider === 'simulated' ? t('risk.simulated') : 'Open-Meteo'} />
        <Stat label={t('common.language')} value={LANGS.find((l) => l.id === state.settings.lang)?.native ?? '—'} />
      </div>

      <div className="grid c2 mb-14">
        <Card title={t('settings.lang')} subtitle={t('settings.changeHint')}>
          <div className="card-body">
            <div className="row">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`btn ${state.settings.lang === l.id ? 'primary' : ''}`}
                  onClick={() => state.setLang(l.id as Lang)}
                >
                  <Icon name="language" size={13} /> {l.native}
                </button>
              ))}
            </div>
            <div className="muted small mt-10">{t('settings.defaultLangNote')}</div>
            <div className="muted small mt-10">
              Core navigation, the scanner workflow, primary actions, severity labels, advisories, follow-up actions and
              safety messages are translated. A few engine diagnostic sentences remain in English by design and are
              marked as such.
            </div>
          </div>
        </Card>

        <Card title={t('settings.weather')} subtitle={t('risk.engineNote')}>
          <div className="card-body">
            {WEATHER_PROVIDERS.map((p) => (
              <label key={p.id} className="check mb-6">
                <input
                  type="radio"
                  checked={state.settings.weatherProvider === p.id}
                  onChange={() => state.setWeatherProvider(p.id as WeatherProviderId)}
                />
                <span>
                  <strong>{t(p.labelKey)}</strong>
                  <br />
                  <span className="muted small">{t(p.noteKey)}</span>
                </span>
              </label>
            ))}
            <Notice kind="plain" icon="cloud">
              {t('risk.sourceSimulated')} The engine always tags each day as observed, forecast or simulated, and never
              presents a simulated day as real weather.
            </Notice>
          </div>
        </Card>
      </div>

      <Card title={t('settings.inference')} subtitle={t('settings.inferenceSub')} className="mb-14">
        <div className="card-body">
          <div className="grid c2">
            <Field label={t('settings.serviceUrl')} help={`default ${DEFAULT_SERVICE_URL}`}>
              <div className="row nowrap" style={{ gap: 8 }}>
                <input
                  className="mono"
                  value={serviceDraft}
                  onChange={(e) => setServiceDraft(e.target.value)}
                  onBlur={() => state.setModelServiceUrl(serviceDraft)}
                  placeholder={DEFAULT_SERVICE_URL}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    state.setModelServiceUrl(serviceDraft);
                    probeService(serviceDraft);
                  }}
                >
                  <Icon name="activity" size={13} />{' '}
                  {serviceProbe.state === 'testing' ? t('settings.serviceTesting') : t('settings.serviceTest')}
                </button>
              </div>
            </Field>
            <Field label={t('settings.runCmd')}>
              <input
                readOnly
                className="mono small"
                value="python -m uvicorn cropsentinel_inference.app:app --host 127.0.0.1 --port 8000 --app-dir services/inference"
              />
            </Field>
          </div>

          {serviceProbe.state === 'ok' && (
            <Notice kind="good" icon="checkCircle">
              {t('settings.serviceOk', { n: serviceProbe.health.models.filter((m) => m.available).length })} ·{' '}
              {t('settings.serviceChecksums', { v: serviceProbe.health.checksumVerification ? 'yes' : 'no' })} ·{' '}
              <span className="mono">api {serviceProbe.health.apiVersion}</span>
            </Notice>
          )}
          {serviceProbe.state === 'down' && (
            <Notice kind="warn" icon="alert">
              {t('settings.serviceDownResult', { error: serviceProbe.error })}
            </Notice>
          )}

          <div className="grid c2 mt-10">
            {MODEL_SUPPORTED_CROPS.map((cropId) => {
              const perf = MEASURED_PERFORMANCE[cropId];
              const display = MODEL_DISPLAY[cropId];
              const live = serviceProbe.state === 'ok' ? serviceProbe.health.models.find((m) => m.crop === cropId) : null;
              return (
                <div key={cropId} className="notif">
                  <Icon name="cpu" size={16} className="muted" />
                  <div className="flex-1">
                    <div className="small strong">{display?.modelId}</div>
                    <div className="mono small muted-2">rev {display?.revision.slice(0, 12)} · {display?.license}</div>
                    <div className="small muted mt-6">{t('settings.measuredPerf')}: {t('model.measuredTitle')}</div>
                    <div className="row mt-6" style={{ gap: 8 }}>
                      <span className="badge outline">macro-F1 {perf ? (perf.macroF1 * 100).toFixed(1) : '—'}%</span>
                      <span className="badge outline">coverage {perf ? (perf.coverage * 100).toFixed(1) : '—'}%</span>
                      <span className="badge outline">card claims {perf?.publishedTestAccuracy ? `${(perf.publishedTestAccuracy * 100).toFixed(1)}%` : '—'}</span>
                      {live && <span className={`badge ${live.available ? 'low' : 'high'}`}>{live.available ? 'available' : 'unavailable'}</span>}
                    </div>
                    {live?.loadError && <div className="small muted-2 mt-6">{live.loadError}</div>}
                    <div className="small muted-2 mt-6">{perf?.dataset}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <Notice kind="plain" icon="leaf">
            <strong>{t('settings.notBacked')}: </strong>
            {cropsWithoutModel.map((id) => t(`crop.${id}`)).join(', ')} — {t('settings.notBackedNote')}
          </Notice>
        </div>
      </Card>

      <div className="grid side mb-14">
        <Card title={t('settings.weights')} subtitle={`${t('common.total')}: ${totalWeight}`}>
          <div className="card-body">
            <div className="col" style={{ gap: 12 }}>
              {RISK_WEIGHT_LABELS.map(({ key, labelKey }) => (
                <div key={key} className="row nowrap">
                  <span className="small" style={{ width: 150 }}>
                    {t(labelKey)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={state.settings.riskWeights[key]}
                    onChange={(e) => state.setWeights({ [key]: Number(e.target.value) } as never)}
                    style={{ flex: 1 }}
                  />
                  <span className="small muted-2 no-wrap" style={{ width: 28, textAlign: 'right' }}>
                    {state.settings.riskWeights[key]}
                  </span>
                </div>
              ))}
            </div>
            <div className="muted small mt-10">
              Weights are normalised over the factor groups that could actually be applied to a plot. Missing inputs are
              excluded from the normalisation and listed on the risk page rather than scored as zero.
            </div>
          </div>
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('settings.modelStatus')}>
            <div className="card-body">
              {adapters.map((a) => (
                <div key={a.id} className="notif">
                  <Icon name={a.kind === 'trained-model' ? 'cpu' : 'sliders'} size={16} className="muted" />
                  <div className="flex-1">
                    <div className="small strong">{a.label}</div>
                    <div className="mono small muted-2">{a.id}</div>
                    <div className="small muted mt-6">{a.describes}</div>
                    <div className="mt-6">
                      <span className={`badge ${a.available ? 'low' : 'outline'}`}>
                        {a.available ? t('settings.trainedAvailable') : t('settings.trainedUnavailable')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <Notice kind="warn" icon="alert">
                {t('settings.trainedHow')} <span className="mono">{TRAINED_MODEL_PATH}</span>
              </Notice>
            </div>
          </Card>

          <Card title={t('settings.integrations')}>
            <div className="card-body small">
              <ul className="muted" style={{ paddingLeft: 18, margin: 0 }}>
                <li>
                  <strong>ScreeningModelAdapter</strong> — three engines: the local inference service (trained
                  cotton and soybean classifiers, active when the service runs), a browser-export seam
                  (inactive), and the transparent rule analyzer (always available).
                </li>
                <li>
                  <strong>WeatherProvider</strong> — simulated + Open-Meteo (implemented, switchable).
                </li>
                <li>
                  <strong>FastAPI / PostgreSQL</strong> — the store actions are the boundary; swap the zustand
                  persistence middleware for HTTP calls.
                </li>
                <li>
                  <strong>GIS</strong> — <span className="mono">project()</span> is isolated, so a tile layer or a real
                  district boundary can replace the schematic base without touching markers.
                </li>
                <li>
                  <strong>Expert / laboratory systems</strong> — the case queue carries validated DTOs ready for an
                  authenticated KVK review service.
                </li>
              </ul>
              <Notice kind="plain" icon="lock">
                {t('settings.integrationNote')}
              </Notice>
            </div>
          </Card>
        </div>
      </div>

      <Card title={t('settings.about')}>
        <div className="card-body">
          <div className="grid c3">
            <Field label={t('brand.name')}>
              <input readOnly value={t('brand.tagline')} />
            </Field>
            <Field label="Team">
              <input readOnly value={t('brand.team')} />
            </Field>
            <Field label={t('brand.demoMode')}>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={state.settings.demoMode}
                    onChange={(e) => state.setDemoMode(e.target.checked)}
                  />
                  <span>{t('brand.demoMode')}</span>
                </label>
              </div>
            </Field>
          </div>
          <div className="grid c2 mt-14">
            <div>
              <Field label="Demo user">
                <input
                  value={state.settings.currentUser.name}
                  onChange={(e) => state.setUser({ name: e.target.value })}
                />
              </Field>
              <Field label="Role" className="mt-10">
                <input
                  value={state.settings.currentUser.role}
                  onChange={(e) => state.setUser({ role: e.target.value })}
                />
              </Field>
            </div>
            <div>
              <Field label={t('settings.resetData')} help={t('brand.demoNote')}>
                <button
                  type="button"
                  className="btn danger"
                  onClick={async () => {
                    if (window.confirm(t('demo.resetConfirm'))) {
                      await state.resetData();
                      setResetMsg(t('settings.resetDone'));
                    }
                  }}
                >
                  <Icon name="refresh" size={14} /> {t('common.reset')}
                </button>
              </Field>
              {resetMsg && (
                <Notice kind="good" icon="checkCircle">
                  {resetMsg}
                </Notice>
              )}
            </div>
          </div>
          <Notice kind="demo" icon="info">
            {t('brand.demoNote')}
          </Notice>
        </div>
      </Card>
    </>
  );
}
