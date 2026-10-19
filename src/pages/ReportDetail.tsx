import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Icon, Kv, Notice, SeverityBadge, StatusBadge } from '../components/ui';
import { ScanResultView } from '../components/ScanResultView';
import { buildAdvisory } from '../lib/advisories';
import { getCondition, getCrop } from '../domain/knowledge';
import { resultLabelKey } from '../lib/screening';
import { fmtDate, fmtDateTime } from '../lib/format';
import { printPage } from '../lib/exports';

export function ReportDetail() {
  const { scanId = '' } = useParams();
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();

  const scan = state.scans.find((s) => s.id === scanId);
  if (!scan) {
    return (
      <Card title={t('report.title')}>
        <Empty text={t('common.noData')} />
      </Card>
    );
  }

  const plot = state.plots.find((p) => p.id === scan.plotId);
  const farm = state.farms.find((f) => f.id === scan.farmId);
  const kase = state.cases.find((c) => c.scanId === scan.id);
  const followUps = state.followUps.filter((f) => f.scanId === scan.id);
  const cond = getCondition(scan.result.conditionId);

  const advisory = useMemo(
    () =>
      buildAdvisory({
        conditionId: scan.result.conditionId,
        category: scan.result.category,
        conditionLabel: t(resultLabelKey(scan.result)),
        lang: state.settings.lang,
      }),
    [scan, t, state.settings.lang],
  );

  return (
    <>
      <div className="page-head no-print">
        <div className="flex-1">
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="icon-btn sm" onClick={() => navigate('/reports')} aria-label={t('common.back')}>
              <Icon name="chevronLeft" size={15} />
            </button>
            <h1>{t('report.title')}</h1>
          </div>
          <p className="sub">
            {plot?.name} · {farm?.name} · {fmtDate(scan.createdAt, state.settings.lang)}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={printPage}>
            <Icon name="printer" size={14} /> {t('common.print')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(kase ? '/expert' : '/scanner')}
          >
            <Icon name="users" size={14} /> {kase ? t('expert.caseLink') : t('action.reviewCase')}
          </button>
        </div>
      </div>

      <Notice kind="plain" icon="printer" >
        {t('reports.printHint')}
      </Notice>

      <div className="card pad mt-14 mb-14">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="flex-1">
            <div className="row" style={{ gap: 8 }}>
              <Icon name="leaf" size={18} />
              <strong>{t('brand.name')}</strong>
              <span className="badge demo">{t('common.demoData')}</span>
            </div>
            <div className="muted small">{t('brand.tagline')}</div>
            <div className="muted-2 small">{t('brand.team')}</div>
          </div>
          <div className="right small muted">
            {t('report.printed', { date: fmtDateTime(new Date().toISOString(), state.settings.lang) })}
            <br />
            <span className="mono">{scan.id}</span>
          </div>
        </div>
      </div>

      <div className="grid side">
        <div className="col" style={{ gap: 14 }}>
          <Card title={t('report.assessment')} subtitle={t('report.engineNote', { engine: scan.result.engineId })}>
            <div className="card-body">
              <ScanResultView result={scan.result} t={t} />
            </div>
          </Card>

          <Card title={t('report.advisory')}>
            <div className="card-body">
              {advisory.sections.map((sec) => (
                <div key={sec.key} className={`advisory-section ${sec.key === 'chemical' ? 'chemical' : sec.key === 'referral' ? 'referral' : ''}`}>
                  <h4>{t(sec.titleKey)}</h4>
                  {sec.body.split('\n\n').map((p, i) => (
                    <p key={i} className="small" style={{ margin: '6px 0 0' }}>
                      {p}
                    </p>
                  ))}
                  <div className="src">
                    {t('common.source')}: {t(sec.sourceKey)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title={t('advisory.safety')}>
            <div className="card-body">
              {advisory.safetyKeys.map((k) => (
                <div key={k} className="notice plain" style={{ marginBottom: 8 }}>
                  <Icon name="shield" size={15} />
                  <div className="small">{t(k)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('report.context')}>
            <div className="card-body">
              {scan.image && (
                <div className="mb-10">
                  <div className="image-frame">
                    <img src={scan.image.dataUrl} alt={scan.image.name} />
                  </div>
                  <div className={`badge mt-6 ${scan.image.origin === 'synthetic-demo' ? 'demo' : 'outline'}`}>
                    {scan.image.origin === 'synthetic-demo' ? t('report.synthetic') : t('report.uploaded')}
                  </div>
                </div>
              )}
              <Kv
                items={[
                  { k: t('common.farm'), v: farm?.name ?? '—' },
                  { k: t('common.plot'), v: plot?.name ?? '—' },
                  { k: t('common.district'), v: `${farm?.district ?? '—'} · ${farm?.taluka ?? ''}` },
                  { k: t('common.crop'), v: `${t(getCrop(scan.cropId).labelKey)} (${scan.variety || '—'})` },
                  { k: t('common.stage'), v: t(`stage.${scan.stage}`) },
                  { k: t('common.location'), v: <span className="mono">{scan.lat}, {scan.lng}</span> },
                  { k: t('common.date'), v: fmtDateTime(scan.createdAt, state.settings.lang) },
                  { k: t('traps.observer'), v: scan.submittedBy },
                  { k: t('common.severity'), v: <SeverityBadge severity={scan.result.severity} t={t} /> },
                  { k: t('filter.condition'), v: t(resultLabelKey(scan.result)) },
                  {
                    k: t('common.confidence'),
                    // Always 'not available': neither integrated model is
                    // calibrated, so no calibrated confidence exists to report.
                    v: scan.result.confidence === null ? t('common.notAvailable') : `${Math.round(scan.result.confidence * 100)}%`,
                  },
                  { k: t('ds.label'), v: t(`ds.${scan.result.dispositionSource ?? 'rule-only'}`) },
                  {
                    k: t('model.outcome'),
                    v: scan.result.modelInference
                      ? t(`model.outcome.${scan.result.modelInference.outcome}`)
                      : t('model.outcome.not-attempted'),
                  },
                  { k: t('model.id'), v: scan.result.modelInference?.modelId ?? t('common.notAvailable') },
                  {
                    k: t('model.predicted'),
                    v: scan.result.modelInference?.predictedClassName
                      ? `${scan.result.modelInference.predictedClassName} (${t('model.classScore')} ${scan.result.modelInference.probability?.toFixed(3)})`
                      : t('common.notAvailable'),
                  },
                  { k: t('common.source'), v: cond?.favourable.label ?? '—' },
                ]}
              />
              {scan.symptoms.length > 0 && (
                <div className="mt-10">
                  <h4 className="mb-6">{t('common.symptoms')}</h4>
                  <div className="row" style={{ gap: 6 }}>
                    {scan.symptoms.map((s) => (
                      <span key={s} className="badge outline">
                        {t(`sym.${s}`)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {scan.notes && (
                <div className="mt-10">
                  <h4 className="mb-6">{t('common.notes')}</h4>
                  <p className="small muted">{scan.notes}</p>
                </div>
              )}
            </div>
          </Card>

          {kase && (
            <Card title={t('expert.caseLink')}>
              <div className="card-body">
                <div className="row mb-10">
                  <StatusBadge status={kase.status} t={t} />
                  <span className={`badge ${kase.validation === 'confirmed' ? 'low' : kase.validation === 'corrected' ? 'medium' : 'outline'}`}>
                    {t(`validation.${kase.validation}`)}
                  </span>
                </div>
                <Kv
                  items={[
                    { k: t('expert.predicted'), v: t(`cond.${kase.predictedConditionId}`) },
                    { k: t('expert.confirmed'), v: kase.confirmedConditionId ? t(`cond.${kase.confirmedConditionId}`) : t('validation.not_yet') },
                    { k: t('expert.reviewer'), v: kase.reviewerName ?? t('common.notAvailable') },
                  ]}
                />
                {kase.reviewerNotes && <p className="small mt-10">{kase.reviewerNotes}</p>}
                {kase.management && <p className="small muted">{kase.management}</p>}
                {kase.simulated && <span className="badge demo">{t('expert.simulated')}</span>}
              </div>
            </Card>
          )}

          <Card title={t('report.followUpLog')}>
            <div className="card-body">
              {followUps.length === 0 ? (
                <div className="muted small">{t('reports.noFollowUp')}</div>
              ) : (
                <div className="timeline">
                  {followUps.map((f) => (
                    <div key={f.id} className="tl-item info">
                      <div className="tl-date">{fmtDate(f.date, state.settings.lang)}</div>
                      <div className="tl-title">
                        <SeverityBadge severity={f.severity} t={t} />
                      </div>
                      <div className="tl-body">{f.observation}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card title={t('report.disclaimer')}>
            <div className="card-body">
              <p className="small muted">{t('report.disclaimer')}</p>
              <div className="row mt-14" style={{ gap: 24 }}>
                <div>
                  <div style={{ borderTop: '1px solid var(--border-strong)', width: 170, marginTop: 32 }} />
                  <div className="small muted-2">{t('report.signature')}</div>
                </div>
                <div>
                  <div style={{ borderTop: '1px solid var(--border-strong)', width: 170, marginTop: 32 }} />
                  <div className="small muted-2">{t('report.farmerSignature')}</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
