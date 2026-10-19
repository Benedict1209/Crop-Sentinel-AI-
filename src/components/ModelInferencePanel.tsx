import type { ModelInference } from '../domain/types';
import type { T } from '../lib/i18n';
import { MEASURED_PERFORMANCE, MODEL_DISPLAY } from '../domain/modelLabels';
import { ABSTAIN_REASON_TEXT } from '../lib/inferenceClient';
import { Icon, Meter, Notice, Stat } from './ui';

const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;

function outcomeKey(outcome: ModelInference['outcome']): string {
  return `model.outcome.${outcome}`;
}

function outcomeTone(outcome: ModelInference['outcome']): 'good' | 'warn' | 'plain' {
  if (outcome === 'ran') return 'good';
  if (outcome === 'abstained') return 'warn';
  return 'plain';
}

/**
 * The measured-performance block. It is shown next to every model result on
 * purpose: the model cards advertise 99.0% and 91.7% test accuracy, while the
 * measurement in this repository gives macro-F1 53% and 55% on images the models
 * did not train on. A farmer is shown the second number.
 */
export function MeasuredPerformanceBlock({ cropId, t }: { cropId: string; t: T }) {
  const perf = MEASURED_PERFORMANCE[cropId];
  if (!perf) return null;
  const rows = Object.entries(perf.perClass).filter(([, m]) => m.support > 0);
  return (
    <div>
      <h4 className="mb-6">
        <Icon name="activity" size={13} /> {t('model.measuredTitle')}
      </h4>
      <div className="grid c3" style={{ gap: 8 }}>
        <Stat label="macro-F1" value={pct(perf.macroF1)} variant="warn" />
        <Stat label="accuracy" value={pct(perf.accuracyIncludingAbstentions)} hint={`n=${perf.supportedImages}`} />
        <Stat label="coverage" value={pct(perf.coverage)} hint={`selective ${pct(perf.selectiveAccuracyAmongAnswered)}`} />
      </div>
      <div className="table-wrap mt-10">
        <table className="data">
          <thead>
            <tr>
              <th>class</th>
              <th>n</th>
              <th>precision</th>
              <th>recall</th>
              <th>F1</th>
              <th>abstained</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, m]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{m.support}</td>
                <td>{pct(m.precision)}</td>
                <td>{pct(m.recall)}</td>
                <td>{pct(m.f1)}</td>
                <td>{m.abstained}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small muted mt-6">
        {t('model.measuredBody', {
          n: perf.supportedImages,
          f1: pct(perf.macroF1),
          acc: pct(perf.accuracyIncludingAbstentions),
          cov: pct(perf.coverage),
        })}
      </div>
      <div className="small muted mt-6">
        {t('model.publishedBody', {
          acc: pct(perf.publishedTestAccuracy),
          f1: pct(perf.publishedMacroF1),
        })}
      </div>
      <div className="small muted-2 mt-6">
        <strong>{t('model.dataset')}:</strong> {perf.dataset} · {t('model.license')}: {perf.datasetLicense}
      </div>
      <div className="small muted-2 mt-6">{perf.caveat}</div>
    </div>
  );
}

export function DispositionSourceBadge({ source, t }: { source: string; t: T }) {
  const tone: Record<string, string> = {
    'model+rule-agree': 'low',
    'model-only': 'medium',
    'rule-only': 'outline',
    'model-abstained': 'outline',
    'model-rule-conflict': 'medium',
    'no-model-for-crop': 'outline',
  };
  return (
    <span className={`badge ${tone[source] ?? 'outline'}`} title={t('ds.label')}>
      {t(`ds.${source}`)}
    </span>
  );
}

export function ModelInferencePanel({ model, t, cropId }: { model: ModelInference | null; t: T; cropId: string }) {
  const display = MODEL_DISPLAY[cropId];

  if (!model) {
    return (
      <Notice kind="plain" icon="info">
        {t('model.photoRequired')}
      </Notice>
    );
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`badge ${outcomeTone(model.outcome)}`}>{t(outcomeKey(model.outcome))}</span>
        {model.isGenuineInference && (
          <span className="badge demo">{t('model.title')}</span>
        )}
      </div>

      {!model.isGenuineInference && (
        <>
          {model.outcome === 'unsupported-crop' && (
            <Notice kind="plain" icon="leaf">
              {t('model.cropUnsupported')}
            </Notice>
          )}
          {model.outcome === 'service-unavailable' && (
            <Notice kind="warn" icon="alert">
              <div>{t('model.serviceDown')}</div>
              <div className="small mt-6 mono">python -m uvicorn cropsentinel_inference.app:app --host 127.0.0.1 --port 8000 --app-dir services/inference</div>
              <div className="small mt-6">{t('model.serviceOptional')}</div>
            </Notice>
          )}
          {model.outcome === 'not-attempted' && (
            <Notice kind="plain" icon="info">
              {model.cropId && MODEL_DISPLAY[model.cropId] ? t('model.syntheticRefused') : t('model.photoRequired')}
            </Notice>
          )}
          {model.outcome === 'error' && (
            <Notice kind="danger" icon="alert">
              {model.message ?? 'The inference service returned an error.'}
            </Notice>
          )}
          {model.message && model.outcome !== 'error' && <div className="small muted">{model.message}</div>}
        </>
      )}

      {model.isGenuineInference && (
        <>
          <div className="grid c2" style={{ gap: 10 }}>
            <Stat label={t('model.predicted')} value={model.predictedClassName ?? '—'} variant="info" />
            <Stat
              label={t('model.classScore')}
              value={model.probability === null ? '—' : model.probability.toFixed(3)}
              hint={model.abstained ? t('model.outcome.abstained') : t('ds.label')}
            />
            <Stat label={t('model.runnerUp')} value={model.runnerUpClassName ?? '—'} />
            <Stat label={t('model.margin')} value={model.marginToRunnerUp === null ? '—' : model.marginToRunnerUp.toFixed(3)} />
          </div>

          <Notice kind="warn" icon="alert">
            <strong>{t('model.classScore')}: </strong>
            {t('model.notCalibrated')}
          </Notice>

          {model.thresholds && (
            <div className="small muted">
              <strong>{t('model.thresholds')}: </strong>
              {t('model.thresholdsValue', {
                c: model.thresholds.minConfidence,
                m: model.thresholds.minMargin,
              })}
            </div>
          )}

          {model.abstained && model.abstainReasons.length > 0 && (
            <div>
              <h4 className="mb-6">{t('model.abstainReasons')}</h4>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {model.abstainReasons.map((r) => (
                  <li key={r} className="small">
                    {ABSTAIN_REASON_TEXT[r] ?? r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {model.probabilities.length > 0 && (
            <div>
              <h4 className="mb-6">{t('model.probabilities')}</h4>
              <div className="col" style={{ gap: 6 }}>
                {model.classNames.map((name, i) => (
                  <div key={name} className="row nowrap" style={{ gap: 10 }}>
                    <span className="small truncate" style={{ width: 190 }}>
                      {name}
                    </span>
                    <div className="flex-1">
                      <Meter value={(model.probabilities[i] ?? 0) * 100} color="#17543c" />
                    </div>
                    <span className="small muted-2 no-wrap" style={{ width: 52, textAlign: 'right' }}>
                      {((model.probabilities[i] ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="muted-2 small mt-6">{t('model.notCalibrated')}</div>
            </div>
          )}

          <div className="table-wrap">
            <table className="data">
              <tbody>
                <tr>
                  <th scope="row">{t('model.id')}</th>
                  <td className="mono">{model.modelId}</td>
                </tr>
                <tr>
                  <th scope="row">{t('model.revision')}</th>
                  <td className="mono small">{model.modelRevision}</td>
                </tr>
                <tr>
                  <th scope="row">{t('model.architecture')}</th>
                  <td className="small">{model.architecture}</td>
                </tr>
                <tr>
                  <th scope="row">{t('model.license')}</th>
                  <td className="small">
                    {model.license}
                    {model.licenseNote ? <div className="muted-2 small">{model.licenseNote}</div> : null}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('model.source')}</th>
                  <td className="small truncate">
                    <a href={model.sourceUrl ?? '#'} target="_blank" rel="noreferrer" className="mono">
                      {model.sourceUrl}
                    </a>
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('model.classOrder')}</th>
                  <td className="small">{model.classNames.join(' · ')}</td>
                </tr>
                <tr>
                  <th scope="row">{t('model.preprocessing')}</th>
                  <td className="small">{model.preprocessing}</td>
                </tr>
                <tr>
                  <th scope="row">{t('model.latency')}</th>
                  <td className="small">
                    {model.latencyMs === null ? '—' : `${Math.round(model.latencyMs)} ms`}
                    {model.requestId ? <span className="muted-2"> · {t('model.requestId')} {model.requestId}</span> : null}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {model.qualityChecks.length > 0 && (
            <div>
              <h4 className="mb-6">{t('model.quality')}</h4>
              <div className="small muted mb-6">
                {model.qualityPassed ? t('model.qualityPassed') : t('model.qualityFailed')}
              </div>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {model.qualityChecks.map((c) => (
                      <tr key={c.name}>
                        <th scope="row" style={{ width: 150 }}>
                          {c.name}
                        </th>
                        <td className="small">
                          <span className={`badge ${c.ok ? 'low' : c.fatal ? 'high' : 'outline'}`}>{c.ok ? 'ok' : c.fatal ? 'fail' : 'warn'}</span>{' '}
                          {c.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Notice kind="plain" icon="alert">
            {t('model.noPestClasses')}
          </Notice>

          {(display || MEASURED_PERFORMANCE[cropId]) && <MeasuredPerformanceBlock cropId={cropId} t={t} />}
        </>
      )}

      {!model.isGenuineInference && MEASURED_PERFORMANCE[cropId] && (
        <details>
          <summary className="small strong" style={{ cursor: 'pointer' }}>
            {t('model.measuredTitle')}
          </summary>
          <div className="mt-10">
            <MeasuredPerformanceBlock cropId={cropId} t={t} />
          </div>
        </details>
      )}
    </div>
  );
}
