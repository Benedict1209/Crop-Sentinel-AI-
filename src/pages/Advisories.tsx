import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { buildAdvisory } from '../lib/advisories';
import { CONDITIONS, getCondition } from '../domain/knowledge';
import { Card, Empty, Field, Icon, Notice, SeverityBadge } from '../components/ui';
import { LANGS } from '../lib/i18n';
import { fmtDate } from '../lib/format';
import { resultLabelKey } from '../lib/screening';
import type { Lang } from '../domain/types';

export function Advisories() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const [params] = useSearchParams();

  const presetScan = state.scans.find((s) => s.id === params.get('scan'));
  const [conditionId, setConditionId] = useState(presetScan?.result.conditionId ?? 'cotton_fusarium_wilt');
  const [scanId, setScanId] = useState(presetScan?.id ?? '');
  const [advisoryLang, setAdvisoryLang] = useState<Lang>(state.settings.lang);

  const scan = state.scans.find((s) => s.id === scanId);
  const cond = getCondition(conditionId) ?? CONDITIONS[0];
  const at = useMemo(() => makeT(advisoryLang), [advisoryLang]);

  const advisory = useMemo(
    () =>
      buildAdvisory({
        conditionId: cond.id,
        category: cond.category,
        conditionLabel: at(cond.labelKey),
        lang: advisoryLang,
      }),
    [cond, advisoryLang, at],
  );

  const plot = scan ? state.plots.find((p) => p.id === scan.plotId) : undefined;
  const farm = plot ? state.farms.find((f) => f.id === plot.farmId) : undefined;

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('advisory.title')}</h1>
          <p className="sub">{t('advisory.sub')}</p>
        </div>
        <label className="row nowrap" style={{ gap: 6 }}>
          <Icon name="language" size={16} className="muted" />
          <select value={advisoryLang} onChange={(e) => setAdvisoryLang(e.target.value as Lang)} style={{ width: 'auto' }}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.native}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid c2 mb-14">
        <Card title={t('advisory.selectScan')} subtitle={t('reports.history')}>
          <div className="card-body">
            <Field label={t('reports.history')}>
              <select
                value={scanId}
                onChange={(e) => {
                  setScanId(e.target.value);
                  const s = state.scans.find((x) => x.id === e.target.value);
                  if (s) setConditionId(s.result.conditionId);
                }}
              >
                <option value="">{t('common.none')}</option>
                {state.scans.slice(0, 40).map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtDate(s.createdAt, state.settings.lang)} · {state.plots.find((p) => p.id === s.plotId)?.name} ·{' '}
                    {t(resultLabelKey(s.result))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('advisory.condition')} className="mt-10">
              <select value={conditionId} onChange={(e) => setConditionId(e.target.value)}>
                {CONDITIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </Field>
            {scan && (
              <div className="mt-10 row">
                <SeverityBadge severity={scan.result.severity} t={t} />
                <span className="badge outline">{t(`disposition.${scan.result.disposition}`)}</span>
              </div>
            )}
          </div>
        </Card>

        <Card title={t('common.details')} subtitle={scan ? `${plot?.name} · ${farm?.district}` : t('advisory.noCondition')}>
          <div className="card-body">
            <dl className="kv">
              <dt>{t('advisory.condition')}</dt>
              <dd>{at(cond.labelKey)}</dd>
              <dt>{t('common.crop')}</dt>
              <dd>{scan ? t(`crop.${scan.cropId}`) : '—'}</dd>
              <dt>{t('common.stage')}</dt>
              <dd>{scan ? t(`stage.${scan.stage}`) : '—'}</dd>
              <dt>{t('common.location')}</dt>
              <dd className="mono">{scan ? `${scan.lat}, ${scan.lng}` : '—'}</dd>
              <dt>{t('common.date')}</dt>
              <dd>{scan ? fmtDate(scan.createdAt, state.settings.lang) : '—'}</dd>
              <dt>{t('common.source')}</dt>
              <dd>
                {cond.favourable.label}
              </dd>
            </dl>
            <Notice kind="warn" icon="alert">
              {t('safety.expert')}
            </Notice>
          </div>
        </Card>
      </div>

      <div className="grid side">
        <Card title={at(cond.labelKey)} subtitle={`${t('advisory.title')} · ${at('advisory.verified')}`}>
          <div className="card-body">
            {advisory.sections.map((sec) => (
              <div
                key={sec.key}
                className={`advisory-section ${sec.key === 'chemical' ? 'chemical' : sec.key === 'referral' ? 'referral' : ''}`}
              >
                <h4>
                  {at(sec.titleKey)}
                  <span className={`badge ${sec.verification === 'needs-local-verification' ? 'medium' : 'outline'}`}>
                    {at(sec.verification === 'needs-local-verification' ? 'advisory.needsVerification' : 'advisory.verified')}
                  </span>
                </h4>
                {sec.body.split('\n\n').map((p, i) => (
                  <p key={i} className="small" style={{ margin: '6px 0 0' }}>
                    {p}
                  </p>
                ))}
                <div className="src">
                  {t('common.source')}: {at(sec.sourceKey)}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('advisory.safety')}>
            <div className="card-body">
              {advisory.safetyKeys.map((k, i) => (
                <div key={k} className={`notice ${i === 3 ? 'warn' : 'plain'}`} style={{ marginBottom: 8 }}>
                  <Icon name={i === 3 ? 'alert' : 'shield'} size={15} />
                  <div className="small">{at(k)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title={t('advisory.sources')}>
            <div className="card-body">
              <div className="small">
                <strong>{t('advisory.verified')}</strong>
                <p className="muted">
                  Sections marked as general IPM guidance are written from integrated pest and disease management
                  principles: sanitation, host resistance, cultural and mechanical control, biological control, and
                  responsible chemical use as a last resort.
                </p>
                <strong>{t('advisory.needsVerification')}</strong>
                <p className="muted">
                  Biological and chemical sections must be confirmed against your state package of practices, the
                  registered product label and your local Krishi Vigyan Kendra before any field use. No dose is
                  prescribed by this prototype.
                </p>
              </div>
            </div>
          </Card>

          <Notice kind="demo" icon="info">
            <strong>{t('brand.demoMode')}: </strong>
            {t('brand.demoNote')}
          </Notice>
        </div>
      </div>

      {!scan && <Empty text={t('advisory.noCondition')} />}
    </>
  );
}
