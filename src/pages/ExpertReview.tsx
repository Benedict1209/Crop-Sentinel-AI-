import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Field, Icon, Notice, SeverityBadge, Stat, StatusBadge, Tabs } from '../components/ui';
import { caseViews } from '../lib/selectors';
import { fmtDate } from '../lib/format';
import { CONDITIONS } from '../domain/knowledge';
import { resultLabelKey } from '../lib/screening';
import type { CaseValidation } from '../domain/types';

export function ExpertReview() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [tab, setTab] = useState('pending');
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  const views = useMemo(() => caseViews(state), [state]);
  const counts = {
    pending: views.filter((v) => v.kase.status === 'pending').length,
    under_review: views.filter((v) => v.kase.status === 'under_review').length,
    resolved: views.filter((v) => v.kase.status === 'resolved').length,
  };
  const list = views.filter((v) => v.kase.status === tab);
  const open = views.find((v) => v.kase.id === openCaseId) ?? null;

  const [notes, setNotes] = useState('');
  const [management, setManagement] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [confirmedId, setConfirmedId] = useState('');
  const [validation, setValidation] = useState<CaseValidation>('confirmed');

  function beginReview(caseId: string, predictedId: string) {
    setOpenCaseId(caseId);
    setConfirmedId(predictedId);
    setValidation('confirmed');
    setNotes('');
    setManagement('');
    setFollowUp('');
  }

  function moveToUnderReview() {
    if (!open) return;
    state.updateCase(open.kase.id, {
      status: 'under_review',
      reviewerName: state.settings.currentUser.name,
      reviewerRole: state.settings.currentUser.role,
    });
    setOpenCaseId(null);
  }

  function resolve() {
    if (!open) return;
    const kase = open.kase;
    const corrected = validation === 'corrected';
    state.updateCase(kase.id, {
      status: 'resolved',
      validation,
      confirmedConditionId: corrected ? confirmedId : kase.predictedConditionId,
      reviewerName: state.settings.currentUser.name,
      reviewerRole: state.settings.currentUser.role,
      reviewerNotes: notes,
      management,
      followUpInstruction: followUp,
      resolvedAt: new Date().toISOString(),
    });
    state.addFeedback({
      caseId: kase.id,
      scanId: kase.scanId,
      recordedAt: new Date().toISOString(),
      predictedConditionId: kase.predictedConditionId,
      confirmedConditionId: corrected ? confirmedId : kase.predictedConditionId,
      agreement: corrected ? 'disagree' : 'agree',
      imageOrigin: open.scan?.image?.origin ?? 'none',
      cropId: open.scan?.cropId ?? '',
      stage: open.scan?.stage ?? 'vegetative',
      validatedBy: state.settings.currentUser.name,
      trainingEligible: true,
      note: corrected
        ? 'Expert corrected the rule-engine outcome. High-value labelled pair for future evaluation.'
        : 'Expert confirmed the rule-engine outcome. Usable as a labelled evaluation pair.',
    });
    state.pushNotification({
      kind: 'review',
      title: 'Case resolved',
      body: `${open.plot?.name ?? 'Plot'} — ${corrected ? 'corrected' : 'confirmed'} as ${t(`cond.${corrected ? confirmedId : kase.predictedConditionId}`)}.`,
      at: new Date().toISOString(),
      href: '/feedback',
    });
    setOpenCaseId(null);
  }

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('expert.title')}</h1>
          <p className="sub">{t('expert.sub')}</p>
        </div>
        <button type="button" className="btn" onClick={() => navigate('/feedback')}>
          <Icon name="database" size={14} /> {t('nav.feedback')}
        </button>
      </div>

      <Notice kind="demo" icon="users">
        <strong>{t('expert.simulated')}: </strong>
        {t('expert.simulatedNote')}
      </Notice>

      <div className="grid c4 mt-14 mb-14">
        <Stat label={t('status.pending')} value={counts.pending} variant="warn" />
        <Stat label={t('status.under_review')} value={counts.under_review} variant="info" />
        <Stat label={t('status.resolved')} value={counts.resolved} />
        <Stat label={t('reports.overdue')} value={views.filter((v) => v.overdue).length} variant="risk" />
      </div>

      <Card>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Tabs
            active={tab}
            onChange={setTab}
            items={[
              { id: 'pending', label: t('status.pending'), count: counts.pending },
              { id: 'under_review', label: t('status.under_review'), count: counts.under_review },
              { id: 'resolved', label: t('status.resolved'), count: counts.resolved },
            ]}
          />
        </div>
        <div className="card-body">
          {list.length === 0 && <Empty text={t('common.noData')} />}
          <div className="grid c2">
            {list.map((v) => (
              <div key={v.kase.id} className="card pad">
                <div className="compare mb-10">
                  {v.scan?.image ? (
                    <div className="image-frame" style={{ maxHeight: 150 }}>
                      <img src={v.scan.image.dataUrl} alt="" style={{ maxHeight: 150 }} />
                    </div>
                  ) : (
                    <div className="image-frame muted small" style={{ padding: 18, textAlign: 'center' }}>
                      {t('scanner.noImage')}
                    </div>
                  )}
                  <div className="disposition-arrow">
                    <Icon name="arrowRight" size={20} className="muted" />
                  </div>
                  <div>
                    <div className="row" style={{ gap: 6 }}>
                      <StatusBadge status={v.kase.status} t={t} />
                      {v.overdue && <span className="badge high">{t('reports.overdue')}</span>}
                    </div>
                    <h3 className="mt-6">{v.scan ? t(resultLabelKey(v.scan.result)) : '—'}</h3>
                    <div className="muted small">
                      {v.plot?.name} · {v.farm?.district}
                    </div>
                    {v.scan && (
                      <div className="mt-6">
                        <SeverityBadge severity={v.scan.result.severity} t={t} />{' '}
                        <span className="badge outline">{v.scan.result.engineId}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="small muted">
                  {t('traps.observer')}: {v.kase.submittedBy} · {fmtDate(v.kase.submittedAt, state.settings.lang)} ·{' '}
                  {v.ageDays}d
                </div>
                {v.scan && v.scan.symptoms.length > 0 && (
                  <div className="row mt-6" style={{ gap: 5 }}>
                    {v.scan.symptoms.slice(0, 4).map((s) => (
                      <span key={s} className="badge outline">
                        {t(`sym.${s}`)}
                      </span>
                    ))}
                  </div>
                )}
                {v.kase.status === 'resolved' && (
                  <div className="small mt-10">
                    <div>
                      <strong>{t('expert.predicted')}:</strong> {t(`cond.${v.kase.predictedConditionId}`)}
                    </div>
                    <div>
                      <strong>{t('expert.confirmed')}:</strong>{' '}
                      {v.kase.confirmedConditionId ? t(`cond.${v.kase.confirmedConditionId}`) : '—'}{' '}
                      <span className={`badge ${v.kase.validation === 'confirmed' ? 'low' : 'medium'}`}>
                        {t(`validation.${v.kase.validation}`)}
                      </span>
                    </div>
                    {v.kase.reviewerNotes && <p className="muted mt-6">{v.kase.reviewerNotes}</p>}
                  </div>
                )}
                <div className="row mt-10">
                  {v.kase.status !== 'resolved' && (
                    <button type="button" className="btn sm primary" onClick={() => beginReview(v.kase.id, v.kase.predictedConditionId)}>
                      <Icon name="edit" size={13} /> {t('common.view')}
                    </button>
                  )}
                  <button type="button" className="btn sm" onClick={() => navigate(`/report/${v.kase.scanId}`)}>
                    <Icon name="file" size={13} /> {t('reports.openReport')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {open && (
        <div className="card pad mt-14">
          <div className="row mb-14">
            <h3 className="flex-1">
              {t('expert.queue')} · {open.plot?.name}
            </h3>
            <button type="button" className="icon-btn sm" onClick={() => setOpenCaseId(null)} aria-label={t('common.close')}>
              <Icon name="x" size={15} />
            </button>
          </div>

          <div className="grid c2">
            <div>
              <Field label={t('expert.reviewer')}>
                <input readOnly value={`${state.settings.currentUser.name} — ${state.settings.currentUser.role}`} />
              </Field>
              <Field label={t('expert.confirmedDiagnosis')} className="mt-10">
                <select value={confirmedId} onChange={(e) => setConfirmedId(e.target.value)}>
                  {CONDITIONS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(c.labelKey)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('expert.agreement')} className="mt-10">
                <div className="col" style={{ gap: 6 }}>
                  <label className="check">
                    <input type="radio" checked={validation === 'confirmed'} onChange={() => { setValidation('confirmed'); setConfirmedId(open.kase.predictedConditionId); }} />
                    <span>{t('expert.agree')}</span>
                  </label>
                  <label className="check">
                    <input type="radio" checked={validation === 'corrected'} onChange={() => setValidation('corrected')} />
                    <span>{t('expert.disagree')}</span>
                  </label>
                </div>
              </Field>
            </div>
            <div>
              <Field label={t('expert.reviewNotes')}>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Field label={t('expert.management')} className="mt-10">
                <textarea rows={2} value={management} onChange={(e) => setManagement(e.target.value)} />
              </Field>
              <Field label={t('expert.followUp')} className="mt-10">
                <textarea rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="row mt-14">
            {open.kase.status === 'pending' && (
              <button type="button" className="btn" onClick={moveToUnderReview}>
                <Icon name="eye" size={14} /> {t('expert.setUnderReview')}
              </button>
            )}
            <button type="button" className="btn leaf" onClick={resolve} disabled={!notes.trim()}>
              <Icon name="checkCircle" size={14} /> {t('expert.resolve')}
            </button>
            <button type="button" className="btn" onClick={() => navigate(`/advisories?scan=${open.kase.scanId}`)}>
              <Icon name="book" size={14} /> {t('action.openAdvisory')}
            </button>
          </div>

          <Notice kind="plain" icon="database">
            {t('expert.feedbackNote')} {t('expert.retrainNote')}
          </Notice>
        </div>
      )}
    </>
  );
}
