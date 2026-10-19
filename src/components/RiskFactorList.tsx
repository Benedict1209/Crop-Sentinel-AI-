import type { RiskAssessment } from '../domain/types';
import type { T } from '../lib/i18n';
import { Icon, RiskBadge, RiskMeter } from './ui';

export function RiskFactorList({ assessment, t }: { assessment: RiskAssessment; t: T }) {
  const increasing = assessment.factors.filter((f) => f.direction === 'increase');
  const decreasing = assessment.factors.filter((f) => f.direction === 'decrease');

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <RiskBadge level={assessment.category} t={t} />
        <span className="strong">{assessment.score}</span>
        <span className="muted small">/ 100</span>
      </div>
      <RiskMeter score={assessment.score} level={assessment.category} />

      <div className="notice plain small">
        <Icon name="info" size={15} />
        <div>
          {t('risk.engineNote')}{' '}
          <span className="mono">{assessment.engine}</span> · {t('risk.provider')}: {assessment.weatherSource}
          {assessment.weatherKind === 'simulated' ? ` · ${t('risk.simulated')}` : ''}
        </div>
      </div>

      {increasing.length > 0 && (
        <div>
          <h4 className="mb-6">{t('risk.increasing')}</h4>
          <div className="col" style={{ gap: 9 }}>
            {increasing.map((f) => (
              <div key={f.id}>
                <div className="row nowrap" style={{ gap: 8 }}>
                  <Icon name="alert" size={14} style={{ color: 'var(--high)' }} />
                  <span className="small strong truncate flex-1">{f.labelKey ? t(f.labelKey) : f.label}</span>
                  <span className="small muted-2 no-wrap">+{f.points}</span>
                </div>
                <div className="small muted" style={{ paddingLeft: 22 }}>
                  {t(f.detailKey, f.params)}
                  <span className="muted-2"> · weight {f.weight}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {decreasing.length > 0 && (
        <div>
          <h4 className="mb-6">{t('risk.decreasing')}</h4>
          <div className="col" style={{ gap: 9 }}>
            {decreasing.map((f) => (
              <div key={f.id}>
                <div className="row nowrap" style={{ gap: 8 }}>
                  <Icon name="check" size={14} style={{ color: 'var(--low)' }} />
                  <span className="small strong truncate flex-1">{f.labelKey ? t(f.labelKey) : f.label}</span>
                  <span className="small muted-2 no-wrap">{f.points}</span>
                </div>
                <div className="small muted" style={{ paddingLeft: 22 }}>
                  {t(f.detailKey, f.params)}
                  <span className="muted-2"> · weight {f.weight}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {assessment.missingInformation.length > 0 && (
        <div>
          <h4 className="mb-6">{t('risk.missing')}</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {assessment.missingInformation.map((k) => (
              <li key={k} className="small muted">
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-6">{t('risk.preventive')}</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {assessment.preventiveActions.map((k) => (
            <li key={k} className="small">
              {t(k)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="mb-6">{t('risk.monitoring')}</h4>
        <div className="small">
          <span className="badge info">
            <Icon name="calendar" size={12} /> {assessment.monitoringIntervalDays} {t('risk.days')}
          </span>
        </div>
      </div>
    </div>
  );
}
