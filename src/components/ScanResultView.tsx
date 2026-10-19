import type { ScreeningResult } from '../domain/types';
import type { T } from '../lib/i18n';
import { Icon, Meter, Notice, SeverityBadge } from './ui';
import { CONDITIONS } from '../domain/knowledge';
import { resultLabelKey } from '../lib/screening';
import { DispositionSourceBadge, ModelInferencePanel } from './ModelInferencePanel';

export function dispositionBadgeClass(d: ScreeningResult['disposition']): string {
  switch (d) {
    case 'healthy':
      return 'low';
    case 'suspected-disease':
      return 'high';
    case 'suspected-pest':
      return 'medium';
    default:
      return 'outline';
  }
}

export function ScanResultView({ result, t, compact }: { result: ScreeningResult; t: T; compact?: boolean }) {
  const condLabel = t(resultLabelKey(result));
  const unnamed = result.disposition === 'inconclusive' && result.conditionLabelKey === 'cond.healthy';
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`badge ${dispositionBadgeClass(result.disposition)}`}>{t(`disposition.${result.disposition}`)}</span>
        <SeverityBadge severity={result.severity} t={t} />
        <DispositionSourceBadge source={result.dispositionSource} t={t} />
        <span className="badge outline">
          <Icon name="cpu" size={12} /> {result.engineId}
        </span>
        <span className={`badge ${result.isDemonstration ? 'demo' : 'low'}`}>
          {result.isDemonstration ? t('scanner.ruleOnlyEngine') : t('scanner.trainedEngine')}
        </span>
      </div>

      <div>
        <h2 style={{ fontSize: 19 }}>{condLabel}</h2>
        {unnamed && (
          <div className="badge outline mt-6">{t('scanner.inconclusiveHelp').split('.')[0]}.</div>
        )}
        <div className="muted small mt-6">
          {t('scanner.engine')}: <span className="mono">{result.engineLabel}</span>
        </div>
      </div>

      {result.isDemonstration && (
        <Notice kind="warn" icon="alert">
          <strong>{t('scanner.engine')}: </strong>
          {t('scanner.noConfidence')}
        </Notice>
      )}

      <div>
        <h4 className="mb-6">{t('scanner.modelSection')}</h4>
        <div className="muted small mb-10">{t('scanner.modelSectionNote')}</div>
        <ModelInferencePanel model={result.modelInference} t={t} cropId={result.modelInference?.cropId ?? ''} />
      </div>

      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small strong">{t('scanner.evidenceStrength')}</span>
          <span className="small muted">{result.evidenceStrength.toFixed(2)}</span>
        </div>
        <Meter
          value={result.evidenceStrength * 100}
          color={result.evidenceStrength < 0.42 ? 'var(--medium)' : 'var(--leaf-500)'}
        />
      </div>

      <Notice kind={result.disposition === 'inconclusive' ? 'warn' : result.disposition === 'healthy' ? 'good' : 'info'}>
        {t(result.uncertaintyKey)}
      </Notice>

      {!compact && (
        <>
          <div>
            <h4 className="mb-6">{t('scanner.ruleSection')}</h4>
            <div className="muted small mb-10">{t('scanner.ruleSectionNote')}</div>
            {result.ruleAssessment && (
              <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                <span className="badge outline">
                  {t(`disposition.${result.ruleAssessment.disposition}`)} · {t(result.ruleAssessment.conditionLabelKey)}
                </span>
                <span className="badge outline small">
                  {t('scanner.evidenceStrength')} {result.ruleAssessment.evidenceStrength.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-6">{t('scanner.evidence')}</h4>
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {result.evidence.map((e, i) => (
                    <tr key={i}>
                      <th scope="row" style={{ width: 190, background: 'transparent', textTransform: 'none', letterSpacing: 0, fontSize: 12.4, color: 'var(--ink-2)' }}>
                        {t(e.labelKey)}
                      </th>
                      <td>{t(e.detailKey, e.params)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.contributingFactors.length > 0 && (
            <div>
              <h4 className="mb-6">{t('scanner.contributing')}</h4>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.contributingFactors.map((f, i) => (
                  <li key={i} className="small">
                    {t(f.key, f.params)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="mb-6">{t('scanner.nextSteps')}</h4>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {result.nextSteps.map((k, i) => (
                <li key={i} className="small">
                  {t(k)}
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h4 className="mb-6">{t('scanner.monitoring')}</h4>
            <div className="small">{t(result.monitoringKey)}</div>
          </div>

          <div>
            <h4 className="mb-6">{t('scanner.referral')}</h4>
            <div className="small">
              {result.referralRequired ? (
                <span className="badge info">
                  <Icon name="users" size={12} /> {t('scanner.referral')}
                </span>
              ) : (
                t('scanner.noReferral')
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-6">{t('scanner.topMatches')}</h4>
            <div className="col" style={{ gap: 7 }}>
              {result.topMatches.map((m) => (
                <div key={m.conditionId} className="row nowrap" style={{ gap: 10 }}>
                  <span className="small truncate" style={{ width: 220 }}>
                    {t(m.labelKey)}
                  </span>
                  <div className="flex-1">
                    <Meter value={m.score} max={100} color="#17543c" />
                  </div>
                  <span className="small muted-2 no-wrap" style={{ width: 46, textAlign: 'right' }}>
                    {m.score.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
            <div className="muted-2 small mt-6">
              These are relative knowledge-base match shares, not probabilities.
            </div>
          </div>

          <details>
            <summary className="small strong" style={{ cursor: 'pointer' }}>
              {t('scanner.methodology')}
            </summary>
            <p className="small muted mt-6">{result.methodology}</p>
            <div className="row" style={{ gap: 8 }}>
              {Object.entries(result.weightsUsed).map(([k, v]) => (
                <span key={k} className="badge outline small">
                  {k}: {v}
                </span>
              ))}
            </div>
          </details>
        </>
      )}

      {compact && (
        <div className="small muted">
          {CONDITIONS.some((c) => c.id === result.conditionId) ? t(result.topMatches[0]?.labelKey ?? result.conditionLabelKey) : result.conditionLabelKey}
        </div>
      )}
    </div>
  );
}
