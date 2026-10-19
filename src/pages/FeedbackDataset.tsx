import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Icon, Notice, Stat } from '../components/ui';
import { exportCsv, stamp } from '../lib/exports';
import { fmtDate } from '../lib/format';

export function FeedbackDataset() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);

  const rows = useMemo(() => state.feedback.slice().sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)), [state.feedback]);
  const agree = rows.filter((r) => r.agreement === 'agree').length;
  const disagree = rows.filter((r) => r.agreement === 'disagree').length;
  const eligible = rows.filter((r) => r.trainingEligible).length;

  function doExport() {
    exportCsv(
      `cropsentinel-feedback-${stamp()}.csv`,
      [
        'record_id', 'case_id', 'scan_id', 'recorded_at', 'predicted_condition', 'confirmed_condition',
        'agreement', 'image_origin', 'crop', 'growth_stage', 'validated_by', 'training_eligible', 'note',
      ],
      rows.map((r) => [
        r.id, r.caseId, r.scanId, r.recordedAt, r.predictedConditionId, r.confirmedConditionId,
        r.agreement, r.imageOrigin, r.cropId, r.stage, r.validatedBy, r.trainingEligible ? 'yes' : 'no', r.note,
      ]),
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('nav.feedback')}</h1>
          <p className="sub">{t('expert.feedbackNote')}</p>
        </div>
        <button type="button" className="btn" onClick={doExport} disabled={rows.length === 0}>
          <Icon name="download" size={14} /> {t('common.export')}
        </button>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('common.total')} value={rows.length} />
        <Stat label={t('expert.agree')} value={agree} />
        <Stat label={t('expert.disagree')} value={disagree} variant="warn" />
        <Stat label={t('expert.trainingEligible')} value={eligible} variant="info" />
      </div>

      <Notice kind="warn" icon="alert">
        <strong>{t('expert.retrainNote')}</strong> {t('expert.feedbackNote')}
      </Notice>

      <div className="grid side mt-14">
        <Card title={t('nav.feedback')} subtitle={`${rows.length} ${t('common.total')}`}>
          {rows.length === 0 ? (
            <Empty text={t('common.noData')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('expert.predicted')}</th>
                    <th>{t('expert.confirmed')}</th>
                    <th>{t('expert.agreement')}</th>
                    <th>{t('common.crop')}</th>
                    <th>{t('common.source')}</th>
                    <th>{t('expert.trainingEligible')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="no-wrap">{fmtDate(r.recordedAt, state.settings.lang)}</td>
                      <td>{t(`cond.${r.predictedConditionId}`)}</td>
                      <td>{r.confirmedConditionId ? t(`cond.${r.confirmedConditionId}`) : '—'}</td>
                      <td>
                        <span className={`badge ${r.agreement === 'agree' ? 'low' : r.agreement === 'disagree' ? 'medium' : 'outline'}`}>
                          {r.agreement === 'agree' ? t('validation.confirmed') : r.agreement === 'disagree' ? t('validation.corrected') : t('expert.unresolved')}
                        </span>
                      </td>
                      <td>{r.cropId ? t(`crop.${r.cropId}`) : '—'}</td>
                      <td className="small muted">{r.imageOrigin}</td>
                      <td>
                        {r.trainingEligible ? (
                          <span className="badge low">
                            <Icon name="check" size={11} /> {t('common.yes')}
                          </span>
                        ) : (
                          <span className="badge outline">{t('common.no')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('settings.about')}>
            <div className="card-body small">
              <h4 className="mb-6">{t('expert.retrainNote')}</h4>
              <p className="muted">
                Each expert-confirmed record stores the screening engine output, the expert-confirmed label, the image
                origin, the crop and the growth stage. Together these form supervised training / evaluation pairs for a
                future image classifier, and a labelled benchmark for the rule engine itself.
              </p>
              <h4 className="mb-6 mt-14">What this prototype does NOT do</h4>
              <ul className="muted" style={{ paddingLeft: 18, margin: 0 }}>
                <li>It does not retrain any model automatically.</li>
                <li>It does not learn online from unverified farmer observations.</li>
                <li>It does not store a record as training-eligible unless an expert confirmed or corrected it.</li>
                <li>It does not mix synthetic demonstration images into a real training set without labelling them as such.</li>
              </ul>
              <h4 className="mb-6 mt-14">Integration path</h4>
              <p className="muted">
                Export this CSV, filter rows where <span className="mono">training_eligible = yes</span> and{' '}
                <span className="mono">image_origin = uploaded</span>, and use them as the validation set for a
                MobileNetV3 / TFLite model. The screening adapter interface
                (<span className="mono">ScreeningModelAdapter</span>) then swaps the demonstration analyzer for the
                trained model without any UI change.
              </p>
            </div>
          </Card>
          <Card title={t('expert.feedbackNote')}>
            <div className="card-body">
              {rows.slice(0, 5).map((r) => (
                <div key={r.id} className="notif">
                  <Icon name={r.agreement === 'agree' ? 'checkCircle' : 'edit'} size={15} className="muted" />
                  <div className="flex-1">
                    <div className="small strong">{r.validatedBy}</div>
                    <div className="muted small">{r.note}</div>
                  </div>
                </div>
              ))}
              {rows.length === 0 && <Empty text={t('common.noData')} />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
