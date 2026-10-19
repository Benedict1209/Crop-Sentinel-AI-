import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { CROPS, SYMPTOMS, hasImageModel } from '../domain/knowledge';
import { MODEL_SUPPORTED_CROPS } from '../lib/modelScreening';
import { SAMPLE_CASES } from '../lib/sampleCases';
import { prepareUpload, syntheticImage } from '../lib/sampleImages';
import type { ScanImage, ScreeningResult } from '../domain/types';
import { Card, Empty, Field, Icon, Notice, SeverityBadge } from '../components/ui';
import { ScanResultView } from '../components/ScanResultView';
import { resultLabelKey, runScreening } from '../lib/screening';
import type { WeatherSummary } from '../lib/screening';
import { getWeather, summarise } from '../lib/weather';
import { conditionCategoryOf } from '../lib/screening';
import { daysAgo, fmtDateTime } from '../lib/format';
import type { CropStage } from '../domain/types';

export function Scanner() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const presetPlotId = params.get('plot') ?? '';
  const presetPlot = state.plots.find((p) => p.id === presetPlotId);

  const [farmId, setFarmId] = useState(presetPlot?.farmId ?? state.farms[0]?.id ?? '');
  const [plotId, setPlotId] = useState(presetPlot?.id ?? '');
  // Cotton is the default crop: the product is focused on cotton and soybean
  // for Maharashtra, and those are the two crops with a trained model.
  const [cropId, setCropId] = useState(presetPlot?.cropId ?? 'cotton');
  const [variety, setVariety] = useState(presetPlot?.variety ?? '');
  const [stage, setStage] = useState<CropStage | ''>(presetPlot?.stage ?? 'vegetative');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<ScanImage | null>(null);
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [resultState, setResultState] = useState<{ result: ScreeningResult; scanId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<{ summary: WeatherSummary | null; label: string; simulated: boolean; error?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const plotsOfFarm = state.plots.filter((p) => (farmId ? p.farmId === farmId : true));
  const plot = state.plots.find((p) => p.id === plotId);
  const farm = state.farms.find((f) => f.id === (plot?.farmId ?? farmId));

  /* ------------------------------------------------------- weather context */
  useEffect(() => {
    let alive = true;
    const lat = plot?.lat ?? farm?.lat;
    const lng = plot?.lng ?? farm?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    setWeather(null);
    getWeather(lat, lng, state.settings.weatherProvider).then((res) => {
      if (!alive) return;
      const sum = summarise(res.snapshot.days.slice(0, 6));
      setWeather({
        summary: sum ? { ...sum, label: res.snapshot.providerLabel } : null,
        label: res.snapshot.providerLabel,
        simulated: res.snapshot.isSimulated,
        error: res.error,
      });
    });
    return () => {
      alive = false;
    };
  }, [plot?.lat, plot?.lng, farm?.lat, farm?.lng, state.settings.weatherProvider]);

  /* ------------------------------------------------------- sample case load */
  function loadSample(id: string) {
    const sc = SAMPLE_CASES.find((s) => s.id === id);
    if (!sc) return;
    setActiveSample(id);
    setCropId(sc.cropId);
    setStage(sc.stage);
    setSymptoms(sc.symptoms);
    setNotes(sc.note);
    // Prefer a plot that already grows this crop so field context stays coherent.
    const matching = state.plots.find((p) => p.cropId === sc.cropId);
    if (matching) {
      setPlotId(matching.id);
      setFarmId(matching.farmId);
      setVariety(matching.variety);
    }
    setImage(syntheticImage(sc.kind, t('scanner.imageOrigin.synthetic')));
    setResultState(null);
    setMessage(null);
    setError(null);
  }

  function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Only image files (JPG, PNG, WebP, SVG) can be screened.');
      return;
    }
    setError(null);
    setActiveSample(null);
    prepareUpload(file)
      .then((img) => setImage(img))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not read that file.'));
  }

  async function analyze() {
    if (!image && symptoms.length === 0) {
      setError(t('scanner.needImageOrSymptom'));
      return;
    }
    setError(null);
    setBusy(true);
    setMessage(null);
    try {
      const plotHistory = (plot ? state.scans.filter((s) => s.plotId === plot.id) : []).slice(0, 5).map((s) => ({
        conditionId: s.result.conditionId,
        severity: s.result.severity,
        daysAgo: daysAgo(s.createdAt),
      }));
      const lastTrap = (plot ? state.traps.filter((x) => x.plotId === plot.id) : [])
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

      const sample = activeSample ? SAMPLE_CASES.find((s) => s.id === activeSample) : null;

      const result = await runScreening({
        image,
        cropId,
        cropLabel: t(`crop.${cropId}`),
        stage,
        symptoms,
        notes,
        modelServiceUrl: state.settings.modelServiceUrl,
        weather: weather?.summary ?? null,
        plotHistory,
        trapPressure: lastTrap
          ? { pest: lastTrap.pestCategory, count: lastTrap.count, threshold: 10, daysAgo: daysAgo(lastTrap.date) }
          : null,
        demoDeclaration: sample?.declaration || null,
      });

      const lat = plot?.lat ?? farm?.lat ?? 18.52;
      const lng = plot?.lng ?? farm?.lng ?? 73.86;
      const scanId = state.addScan({
        plotId: plot?.id ?? plotId,
        farmId: plot?.farmId ?? farmId,
        createdAt: new Date().toISOString(),
        crop: cropId,
        cropId,
        variety,
        stage: stage || 'vegetative',
        symptoms,
        notes,
        lat,
        lng,
        image,
        result,
        submittedBy: state.settings.currentUser.name,
      });
      setResultState({ result, scanId });
      setMessage(t('scanner.saved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Screening failed.');
    } finally {
      setBusy(false);
    }
  }

  function submitForReview() {
    if (!resultState) return;
    const result = resultState.result;
    const scan = state.scans.find((s) => s.id === resultState.scanId);
    const exists = state.cases.some((c) => c.scanId === resultState.scanId);
    if (exists) {
      navigate('/expert');
      return;
    }
    state.addCase({
      scanId: resultState.scanId,
      plotId: scan?.plotId ?? plotId,
      submittedBy: state.settings.currentUser.name,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      validation: 'not_yet',
      predictedConditionId: result.conditionId,
      confirmedConditionId: null,
      reviewerName: null,
      reviewerRole: null,
      reviewerNotes: '',
      management: '',
      followUpInstruction: '',
      resolvedAt: null,
      simulated: true,
    });
    state.pushNotification({
      kind: 'review',
      title: 'Expert review requested',
      body: `${plot?.name ?? 'Plot'} — ${t(resultLabelKey(result))} submitted for expert validation (simulated workflow).`,
      at: new Date().toISOString(),
      href: '/expert',
    });
    setMessage(t('expert.submitted'));
  }

  const imageSource = image
    ? image.origin === 'synthetic-demo'
      ? t('scanner.imageOrigin.synthetic')
      : t('scanner.imageOrigin.uploaded')
    : null;

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('scanner.title')}</h1>
          <p className="sub">{t('scanner.sub')}</p>
        </div>
        <button type="button" className="btn" onClick={() => { setResultState(null); setImage(null); setSymptoms([]); setNotes(''); setActiveSample(null); setMessage(null); }}>
          <Icon name="plus" size={14} /> {t('action.newScan')}
        </button>
      </div>

      <div className="grid side">
        <div className="col" style={{ gap: 14 }}>
          {/* ------------------------------------------------ 1. image */}
          <Card title={t('scanner.imageTitle')} subtitle={t('scanner.dropSub')}>
            <div className="card-body">
              {!image ? (
                <div
                  className={`dropzone ${dragOver ? 'over' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    onFiles(e.dataTransfer.files);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
                >
                  <Icon name="upload" size={24} className="muted" />
                  <div className="dz-title">{t('scanner.dropHere')}</div>
                  <div className="dz-sub">{t('scanner.dropSub')}</div>
                </div>
              ) : (
                <>
                  <div className="image-frame">
                    <img src={image.dataUrl} alt={image.name} />
                  </div>
                  <div className="row mt-10">
                    <span className={`badge ${image.origin === 'synthetic-demo' ? 'demo' : 'outline'}`}>
                      {imageSource}
                    </span>
                    <span className="small muted-2 truncate" style={{ maxWidth: 240 }}>
                      {image.name}
                      {image.width ? ` · ${image.width}×${image.height}` : ''}
                      {image.bytes ? ` · ${Math.round(image.bytes / 1024)} KB` : ''}
                    </span>
                    <div className="spacer" />
                    <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                      <Icon name="refresh" size={13} /> {t('action.replace')}
                    </button>
                    <button type="button" className="btn sm danger" onClick={() => setImage(null)}>
                      <Icon name="trash" size={13} /> {t('action.remove')}
                    </button>
                  </div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => onFiles(e.target.files)}
              />
              {!image && <div className="muted small mt-10">{t('scanner.noImage')}</div>}
            </div>
          </Card>

          {/* ---------------------------------------------- samples */}
          <Card title={t('scanner.sampleTitle')} subtitle={t('scanner.sampleNote')}>
            <div className="card-body">
              <div className="samples">
                {SAMPLE_CASES.map((sc) => {
                  const img = syntheticImage(sc.kind, sc.id);
                  const label = sc.declaration ? t(`cond.${sc.declaration}.short`) : '—';
                  const manifest = sc.manifest;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      className={`sample ${activeSample === sc.id ? 'active' : ''}`}
                      onClick={() => loadSample(sc.id)}
                      title={sc.note}
                    >
                      <img src={img.dataUrl} alt="" />
                      <span className="cap">
                        {t(`crop.${sc.cropId}`)}
                        <br />
                        <span className="muted-2">
                          {manifest.diseaseLabel}
                          {manifest.origin !== 'synthetic-demo' && <>
                            <br />
                            <span className="muted-3">{manifest.attribution}</span>
                          </>}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* ---------------------------------------------- 2. context */}
          <Card title={t('scanner.contextTitle')}>
            <div className="card-body">
              <div className="grid c2">
                <Field label={t('common.farm')}>
                  <select
                    value={farmId}
                    onChange={(e) => {
                      setFarmId(e.target.value);
                      const first = state.plots.find((p) => p.farmId === e.target.value);
                      setPlotId(first?.id ?? '');
                      if (first) {
                        setCropId(first.cropId);
                        setVariety(first.variety);
                        setStage(first.stage);
                      }
                    }}
                  >
                    {state.farms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} · {f.district}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('common.plot')}>
                  <select
                    value={plotId}
                    onChange={(e) => {
                      setPlotId(e.target.value);
                      const p = state.plots.find((x) => x.id === e.target.value);
                      if (p) {
                        setCropId(p.cropId);
                        setVariety(p.variety);
                        setStage(p.stage);
                      }
                    }}
                  >
                    <option value="">{t('risk.selectPlot')}</option>
                    {plotsOfFarm.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('common.crop')}>
                  <select
                    data-testid="crop-select"
                    value={cropId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setCropId(next);
                      // A scan record must never bind a plot to a scan of a
                      // different crop: if the selected plot grows another
                      // crop, clear the plot (and the stale stage it pulled
                      // in) rather than silently re-picking or mislabeling.
                      const selected = state.plots.find((x) => x.id === plotId);
                      if (selected && selected.cropId !== next) {
                        setPlotId('');
                        setStage('vegetative');
                      }
                    }}
                  >
                    {CROPS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t(c.labelKey)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`${t('common.variety')} (${t('common.optional')})`}>
                  <input value={variety} onChange={(e) => setVariety(e.target.value)} placeholder="e.g. Abhinav" />
                </Field>
                <Field label={t('common.stage')}>
                  <select value={stage} onChange={(e) => setStage(e.target.value as CropStage)}>
                    <option value="">{t('common.stageUnknown')}</option>
                    {(['nursery', 'vegetative', 'flowering', 'fruiting', 'maturity'] as CropStage[]).map((s) => (
                      <option key={s} value={s}>
                        {t(`stage.${s}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('common.location')} help={`${plot?.lat ?? farm?.lat ?? '—'}, ${plot?.lng ?? farm?.lng ?? '—'}`}>
                  <input
                    readOnly
                    value={plot ? `${plot.name} — ${farm?.village ?? ''}, ${farm?.district ?? ''}` : `${farm?.village ?? ''}, ${farm?.district ?? ''}`}
                  />
                </Field>
              </div>

              <div className="mt-10">
                {weather?.summary ? (
                  <Notice kind={weather.simulated ? 'warn' : 'info'} icon="cloud">
                    <strong>{t('risk.provider')}: </strong>
                    {weather.label} · {Math.round(weather.summary.rhMean)}% RH · {Math.round(weather.summary.tMean)}°C ·{' '}
                    {Math.round(weather.summary.rainMm)} mm
                    {weather.simulated ? ` — ${t('risk.sourceSimulated')}` : ` — ${t('risk.sourceObserved')}`}
                  </Notice>
                ) : (
                  <Notice kind="plain" icon="cloud">
                    {t('risk.weatherUnavailable')}
                  </Notice>
                )}
              </div>
            </div>
          </Card>

          {/* --------------------------------------------- 3. symptoms */}
          <Card title={t('scanner.symptomTitle')} subtitle={`${symptoms.length} ${t('common.total')}`}>
            <div className="card-body">
              <div className="grid c2" style={{ gap: 6 }}>
                {SYMPTOMS.map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      checked={symptoms.includes(s.id)}
                      onChange={(e) =>
                        setSymptoms((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))
                      }
                    />
                    <span>{t(s.labelKey)}</span>
                  </label>
                ))}
              </div>
              <Field label={`${t('common.notes')} (${t('common.optional')})`} className="mt-10">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </Field>
              <Notice kind={hasImageModel(cropId) ? 'info' : 'plain'} icon="cpu">
                {hasImageModel(cropId)
                  ? image
                    ? image.origin === 'synthetic-demo'
                      ? t('model.syntheticRefused')
                      : t('model.willRun', { model: MODEL_SUPPORTED_CROPS.join(' / ') })
                    : t('model.photoRequired')
                  : t('model.cropUnsupported')}
              </Notice>
              {error && (
                <Notice kind="danger" icon="alert">
                  {error}
                </Notice>
              )}
              <div className="row mt-10">
                <button type="button" className="btn leaf" disabled={busy} onClick={analyze}>
                  <Icon name="cpu" size={14} /> {busy ? '…' : t('action.analyze')}
                </button>
                <span className="muted small">{t('scanner.analyzeNote')}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------- result */}
        <div className="col" style={{ gap: 14 }}>
          {message && (
            <Notice kind="good" icon="checkCircle">
              {message}
            </Notice>
          )}
          <Card title={t('scanner.resultTitle')} subtitle={resultState ? t('scanner.engine') + ': ' + resultState.result.engineId : undefined}>
            <div className="card-body">
              {!resultState ? (
                <Empty text={t('common.noData')} />
              ) : (
                <>
                  <ScanResultView result={resultState.result} t={t} />
                  <div className="row mt-14">
                    <button type="button" className="btn primary" onClick={submitForReview}>
                      <Icon name="users" size={14} /> {t('action.reviewCase')}
                    </button>
                    <button type="button" className="btn" onClick={() => navigate(`/report/${resultState.scanId}`)}>
                      <Icon name="file" size={14} /> {t('reports.openReport')}
                    </button>
                    <button type="button" className="btn" onClick={() => navigate(`/advisories?scan=${resultState.scanId}`)}>
                      <Icon name="book" size={14} /> {t('action.openAdvisory')}
                    </button>
                  </div>
                  <div className="muted-2 small mt-10">
                    {t('common.source')}: {conditionCategoryOf(resultState.result.conditionId)} ·{' '}
                    {fmtDateTime(new Date().toISOString(), state.settings.lang)}
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card title={t('risk.current')} subtitle={plot?.name ?? t('common.notAvailable')}>
            <div className="card-body">
              {!plot ? (
                <Empty text={t('risk.selectPlot')} />
              ) : (
                <>
                  <div className="row mb-10">
                    <SeverityBadge severity={resultState?.result.severity ?? 'inconclusive'} t={t} />
                    <button type="button" className="btn sm" onClick={() => navigate(`/risk?plot=${plot.id}`)}>
                      <Icon name="trending" size={13} /> {t('action.assessRisk')}
                    </button>
                  </div>
                  <div className="small muted">
                    {t('traps.historyNote')} {state.scans.filter((s) => s.plotId === plot.id).length} ·{' '}
                    {state.traps.filter((x) => x.plotId === plot.id).length} {t('nav.traps')}
                  </div>
                  <button type="button" className="btn sm block mt-10" onClick={() => navigate(`/plots/${plot.id}`)}>
                    <Icon name="leaf" size={13} /> {t('action.openPlot')}
                  </button>
                </>
              )}
            </div>
          </Card>

          <Notice kind="demo" icon="info">
            <strong>{t('brand.demoMode')}: </strong>
            {t('scanner.sampleNote')}
          </Notice>
          <div className="muted-2 small">
            {t('scanner.noConfidence')}
          </div>
        </div>
      </div>
    </>
  );
}
