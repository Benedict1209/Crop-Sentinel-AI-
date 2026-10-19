import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Field, Icon, Kv, Notice, RiskBadge, SeverityBadge, Stat, StatusBadge, Tabs } from '../components/ui';
import { RiskFactorList } from '../components/RiskFactorList';
import { allRiskRows, caseViews, plotRows } from '../lib/selectors';
import { fmtDate, toInputDate } from '../lib/format';
import { getCrop } from '../domain/knowledge';
import { resultLabelKey } from '../lib/screening';
import type { Severity } from '../domain/types';

export function PlotDetail() {
  const { plotId = '' } = useParams();
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [tab, setTab] = useState('history');

  const rows = useMemo(() => allRiskRows(state), [state]);
  const row = useMemo(() => plotRows(state, rows).find((p) => p.plot.id === plotId), [state, rows, plotId]);
  const cases = useMemo(() => caseViews(state).filter((c) => c.plot?.id === plotId), [state, plotId]);

  const [fuOpen, setFuOpen] = useState(false);
  const [fuCase, setFuCase] = useState('');
  const [fuDate, setFuDate] = useState(toInputDate(new Date().toISOString()));
  const [fuObs, setFuObs] = useState('');
  const [fuSev, setFuSev] = useState<Severity>('low');
  const [fuAction, setFuAction] = useState('');
  const [fuTrap, setFuTrap] = useState('');

  if (!row) {
    return (
      <Card title={t('farms.plotHistory')}>
        <Empty text={t('common.noData')} />
      </Card>
    );
  }

  const { plot, farm, scans, traps, followUps, risk } = row;
  const latestCase = cases[0];

  function saveFollowUp() {
    const scan = scans[0];
    if (!scan) return;
    state.addFollowUp({
      caseId: fuCase || null,
      scanId: scan.id,
      plotId: plot.id,
      date: new Date(`${fuDate}T10:00:00`).toISOString(),
      observation: fuObs,
      severity: fuSev,
      trapCount: fuTrap === '' ? null : Number(fuTrap),
      statusChange: fuCase ? 'Follow-up recorded against the linked case.' : '',
      actionTaken: fuAction,
      recordedBy: state.settings.currentUser.name,
    });
    if (fuCase) {
      const kase = state.cases.find((c) => c.id === fuCase);
      if (kase && kase.status !== 'resolved') {
        state.updateCase(kase.id, {
          reviewerNotes: `${kase.reviewerNotes}\n[Follow-up ${fuDate}] ${fuObs}`.trim(),
          followUpInstruction: kase.followUpInstruction || 'Follow-up recorded. Continue monitoring.',
        });
      }
    }
    setFuOpen(false);
    setFuObs('');
    setFuAction('');
    setFuTrap('');
  }

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="icon-btn sm" onClick={() => navigate(`/farms/${farm.id}`)} aria-label={t('common.back')}>
              <Icon name="chevronLeft" size={15} />
            </button>
            <h1>{plot.name}</h1>
            {plot.sample && <span className="badge demo">{t('common.demoData')}</span>}
          </div>
          <p className="sub">
            {farm.name} · {farm.village}, {farm.district} · {t(`crop.${plot.cropId}`)} ({plot.variety || '—'}) ·{' '}
            {t(`stage.${plot.stage}`)}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => navigate(`/scanner?plot=${plot.id}`)}>
            <Icon name="camera" size={14} /> {t('action.scan')}
          </button>
          <button type="button" className="btn primary" onClick={() => setFuOpen((v) => !v)}>
            <Icon name="clipboard" size={14} /> {t('action.recordFollowUp')}
          </button>
        </div>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('risk.current')} value={risk ? t(`risk.${risk.assessment.category}`) : '—'} variant={risk?.assessment.category === 'high' ? 'risk' : 'warn'} hint={risk ? `${t('risk.score')}: ${risk.assessment.score}` : ''} />
        <Stat label={t('dashboard.scans')} value={scans.length} hint={scans[0] ? fmtDate(scans[0].createdAt, state.settings.lang) : '—'} />
        <Stat label={t('nav.traps')} value={traps.length} hint={`${traps.filter((x) => x.thresholdAlert).length} ${t('traps.exceeded')}`} />
        <Stat label={t('common.followUp')} value={followUps.length} hint={cases.length ? `${cases.length} ${t('expert.queue')}` : '—'} />
      </div>

      {fuOpen && (
        <Card title={t('action.recordFollowUp')} className="mb-14">
          <div className="card-body">
            <div className="grid c3">
              <Field label={t('common.date')}>
                <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} />
              </Field>
              <Field label={t('reports.linkedCase')} help={t('reports.priorityNote')}>
                <select value={fuCase} onChange={(e) => setFuCase(e.target.value)}>
                  <option value="">{t('common.none')}</option>
                  {cases.map((c) => (
                    <option key={c.kase.id} value={c.kase.id}>
                      {fmtDate(c.kase.submittedAt, state.settings.lang)} · {t(`status.${c.kase.status}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('common.severity')}>
                <select value={fuSev} onChange={(e) => setFuSev(e.target.value as Severity)}>
                  {(['healthy', 'low', 'moderate', 'high', 'severe'] as Severity[]).map((s) => (
                    <option key={s} value={s}>
                      {t(`severity.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`${t('traps.count')} (${t('common.optional')})`}>
                <input type="number" value={fuTrap} onChange={(e) => setFuTrap(e.target.value)} />
              </Field>
            </div>
            <Field label={t('reports.observation')} className="mt-10">
              <textarea rows={2} value={fuObs} onChange={(e) => setFuObs(e.target.value)} />
            </Field>
            <Field label={t('reports.actionTaken')} className="mt-10">
              <textarea rows={2} value={fuAction} onChange={(e) => setFuAction(e.target.value)} />
            </Field>
            <div className="row mt-10">
              <button type="button" className="btn leaf" onClick={saveFollowUp} disabled={!fuObs.trim()}>
                <Icon name="check" size={14} /> {t('common.save')}
              </button>
              <button type="button" className="btn" onClick={() => setFuOpen(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid side">
        <div className="col" style={{ gap: 14 }}>
          <Card>
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <Tabs
                active={tab}
                onChange={setTab}
                items={[
                  { id: 'history', label: t('farms.plotHistory'), count: scans.length },
                  { id: 'traps', label: t('nav.traps'), count: traps.length },
                  { id: 'cases', label: t('expert.queue'), count: cases.length },
                  { id: 'followup', label: t('common.followUp'), count: followUps.length },
                ]}
              />
            </div>
            <div className="card-body">
              {tab === 'history' && (
                <>
                  {scans.length === 0 ? (
                    <Empty text={t('common.noData')} />
                  ) : (
                    <div className="timeline">
                      {scans.map((s) => (
                        <div
                          key={s.id}
                          className={`tl-item ${s.result.severity === 'high' || s.result.severity === 'severe' ? 'high' : s.result.severity === 'moderate' ? 'medium' : ''}`}
                        >
                          <div className="tl-date">{fmtDate(s.createdAt, state.settings.lang)}</div>
                          <div className="tl-title">{t(resultLabelKey(s.result))}</div>
                          <div className="tl-body">
                            <SeverityBadge severity={s.result.severity} t={t} />{' '}
                            <span className="badge outline">{t(`disposition.${s.result.disposition}`)}</span>{' '}
                            <a
                              href={`#/report/${s.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                navigate(`/report/${s.id}`);
                              }}
                            >
                              {t('reports.openReport')}
                            </a>
                          </div>
                          {s.notes && <div className="muted small mt-6">{s.notes}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {tab === 'traps' && (
                <>
                  {traps.length === 0 ? (
                    <Empty text={t('common.noData')} />
                  ) : (
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>{t('common.date')}</th>
                            <th>{t('traps.trapType')}</th>
                            <th>{t('traps.pestCategory')}</th>
                            <th>{t('traps.count')}</th>
                            <th>{t('traps.threshold')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {traps.map((x) => (
                            <tr key={x.id}>
                              <td className="no-wrap">{fmtDate(x.date, state.settings.lang)}</td>
                              <td>{x.trapType}</td>
                              <td>{x.pestCategory}</td>
                              <td>{x.count}</td>
                              <td>
                                {x.thresholdAlert ? (
                                  <span className="badge high">{t('traps.exceeded')}</span>
                                ) : (
                                  <span className="badge low">{t('severity.low')}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {tab === 'cases' && (
                <>
                  {cases.length === 0 ? (
                    <Empty text={t('common.noData')} />
                  ) : (
                    <div className="col" style={{ gap: 10 }}>
                      {cases.map((c) => (
                        <div key={c.kase.id} className="card pad">
                          <div className="row">
                            <StatusBadge status={c.kase.status} t={t} />
                            <span className={`badge ${c.kase.validation === 'confirmed' ? 'low' : c.kase.validation === 'corrected' ? 'medium' : 'outline'}`}>
                              {t(`validation.${c.kase.validation}`)}
                            </span>
                            <span className="muted-2 small">{fmtDate(c.kase.submittedAt, state.settings.lang)}</span>
                            <div className="spacer" />
                            {c.overdue && <span className="badge high">{t('reports.overdue')}</span>}
                          </div>
                          <div className="small mt-10">
                            <div>
                              <strong>{t('expert.predicted')}:</strong> {t(`cond.${c.kase.predictedConditionId}`)}
                            </div>
                            <div>
                              <strong>{t('expert.confirmed')}:</strong>{' '}
                              {c.kase.confirmedConditionId ? t(`cond.${c.kase.confirmedConditionId}`) : t('validation.not_yet')}
                            </div>
                            {c.kase.reviewerNotes && <div className="muted mt-6">{c.kase.reviewerNotes}</div>}
                          </div>
                          <button type="button" className="btn sm mt-10" onClick={() => navigate('/expert')}>
                            {t('expert.caseLink')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {tab === 'followup' && (
                <>
                  {followUps.length === 0 ? (
                    <Empty text={t('reports.noFollowUp')} />
                  ) : (
                    <div className="timeline">
                      {followUps.map((f) => (
                        <div key={f.id} className="tl-item info">
                          <div className="tl-date">{fmtDate(f.date, state.settings.lang)}</div>
                          <div className="tl-title">
                            <SeverityBadge severity={f.severity} t={t} /> {f.recordedBy}
                          </div>
                          <div className="tl-body">{f.observation}</div>
                          {f.actionTaken && <div className="muted small">{f.actionTaken}</div>}
                          {f.caseId && (
                            <div>
                              <span className="badge outline">{t('reports.linkedCase')}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('common.details')}>
            <div className="card-body">
              <Kv
                items={[
                  { k: t('common.crop'), v: t(getCrop(plot.cropId).labelKey) },
                  { k: t('common.variety'), v: plot.variety || '—' },
                  { k: t('common.stage'), v: t(`stage.${plot.stage}`) },
                  { k: t('common.plantingDate'), v: fmtDate(plot.plantingDate, state.settings.lang) },
                  { k: t('common.area'), v: `${plot.areaHa} ha` },
                  { k: t('common.location'), v: <span className="mono">{plot.lat}, {plot.lng}</span> },
                  { k: 'Drainage', v: plot.drainage },
                  { k: 'Soil pH', v: plot.soilPh ?? t('common.notAvailable') },
                ]}
              />
            </div>
          </Card>

          {risk && (
            <Card title={t('risk.current')} subtitle={risk.assessment.weatherSource}>
              <div className="card-body">
                <div className="row mb-10">
                  <RiskBadge level={risk.assessment.category} t={t} />
                  <span className="small muted">{risk.assessment.score}/100</span>
                </div>
                <RiskFactorList assessment={risk.assessment} t={t} />
                <button type="button" className="btn sm block mt-10" onClick={() => navigate(`/risk?plot=${plot.id}`)}>
                  <Icon name="trending" size={13} /> {t('nav.risk')}
                </button>
              </div>
            </Card>
          )}

          <Card title={t('advisory.title')}>
            <div className="card-body">
              <button
                type="button"
                className="btn block"
                onClick={() => navigate(`/advisories${scans[0] ? `?scan=${scans[0].id}` : ''}`)}
              >
                <Icon name="book" size={14} /> {t('action.openAdvisory')}
              </button>
              {latestCase && (
                <div className="muted small mt-10">
                  {t('expert.caseLink')}: {t(`status.${latestCase.kase.status}`)} ·{' '}
                  {t(`validation.${latestCase.kase.validation}`)}
                </div>
              )}
            </div>
          </Card>

          <Notice kind="demo" icon="info">
            {t('brand.demoNote')}
          </Notice>
        </div>
      </div>
    </>
  );
}
