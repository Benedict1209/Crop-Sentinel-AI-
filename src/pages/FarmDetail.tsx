import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Field, Icon, Kv, Modal, Notice, RiskBadge, Stat } from '../components/ui';
import { allRiskRows, plotRows } from '../lib/selectors';
import { fmtDate } from '../lib/format';
import { CROPS } from '../domain/knowledge';
import type { CropStage, Plot } from '../domain/types';

export function FarmDetail() {
  const { farmId = '' } = useParams();
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();

  const farm = state.farms.find((f) => f.id === farmId);
  const rows = useMemo(() => allRiskRows(state), [state]);
  const plots = useMemo(() => plotRows(state, rows).filter((p) => p.plot.farmId === farmId), [state, rows, farmId]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Plot | null>(null);
  const [draft, setDraft] = useState<Omit<Plot, 'id'>>({
    farmId,
    name: '',
    areaHa: 1,
    crop: 'tomato',
    cropId: 'tomato',
    variety: '',
    plantingDate: new Date().toISOString(),
    stage: 'vegetative',
    drainage: 'moderate',
    lat: farm?.lat ?? 18.52,
    lng: farm?.lng ?? 73.86,
    notes: '',
    sample: false,
  });

  if (!farm) {
    return (
      <Card title={t('farms.title')}>
        <Empty text={t('common.noData')} />
      </Card>
    );
  }

  function openCreate() {
    setDraft({
      farmId,
      name: '',
      areaHa: 1,
      crop: 'tomato',
      cropId: 'tomato',
      variety: '',
      plantingDate: new Date().toISOString(),
      stage: 'vegetative',
      drainage: 'moderate',
      lat: farm!.lat,
      lng: farm!.lng,
      notes: '',
      sample: false,
    });
    setCreating(true);
  }

  function save() {
    if (!draft.name.trim()) return;
    if (editing) state.updatePlot(editing.id, draft);
    else state.addPlot(draft);
    setCreating(false);
    setEditing(null);
  }

  const scans = state.scans.filter((s) => s.farmId === farmId);
  const traps = state.traps.filter((x) => plots.some((p) => p.plot.id === x.plotId));
  const high = plots.filter((p) => p.risk?.assessment.category === 'high').length;

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="icon-btn sm" onClick={() => navigate('/farms')} aria-label={t('common.back')}>
              <Icon name="chevronLeft" size={15} />
            </button>
            <h1>{farm.name}</h1>
            {farm.sample && <span className="badge demo">{t('common.demoData')}</span>}
          </div>
          <p className="sub">
            {farm.farmerName} · {farm.village}, {farm.taluka}, {farm.district} · {farm.contact}
          </p>
        </div>
        <button type="button" className="btn primary" onClick={openCreate}>
          <Icon name="plus" size={14} /> {t('action.addPlot')}
        </button>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('dashboard.plots')} value={plots.length} hint={`${farm.totalAreaHa} ha ${t('common.total')}`} />
        <Stat label={t('dashboard.scans')} value={scans.length} />
        <Stat label={t('dashboard.highRisk')} value={high} variant="risk" />
        <Stat label={t('nav.traps')} value={traps.length} variant="warn" />
      </div>

      <div className="grid side">
        <Card title={t('dashboard.plots')} subtitle={`${plots.length} ${t('farms.plotCount')}`}>
          {plots.length === 0 ? (
            <Empty text={t('farms.noPlots')} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.plot')}</th>
                    <th>{t('common.crop')}</th>
                    <th>{t('common.variety')}</th>
                    <th>{t('common.stage')}</th>
                    <th>{t('common.area')}</th>
                    <th>{t('common.riskLevel')}</th>
                    <th>{t('dashboard.scans')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plots.map((p) => (
                    <tr key={p.plot.id}>
                      <td>
                        <Link to={`/plots/${p.plot.id}`}>{p.plot.name}</Link>
                      </td>
                      <td>{t(`crop.${p.plot.cropId}`)}</td>
                      <td>{p.plot.variety || '—'}</td>
                      <td>{t(`stage.${p.plot.stage}`)}</td>
                      <td>{p.plot.areaHa} ha</td>
                      <td>{p.risk ? <RiskBadge level={p.risk.assessment.category} t={t} /> : '—'}</td>
                      <td>{p.scans.length}</td>
                      <td className="right no-wrap">
                        <button
                          type="button"
                          className="icon-btn sm"
                          onClick={() => {
                            setDraft({ ...p.plot });
                            setEditing(p.plot);
                          }}
                          aria-label={t('common.edit')}
                        >
                          <Icon name="edit" size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn sm"
                          onClick={() => {
                            if (window.confirm(`${t('common.delete')} ${p.plot.name}? ${t('farms.deleteWarning')}`)) state.deletePlot(p.plot.id);
                          }}
                          aria-label={t('common.delete')}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="col" style={{ gap: 14 }}>
          <Card title={t('common.details')}>
            <div className="card-body">
              <Kv
                items={[
                  { k: t('common.district'), v: farm.district },
                  { k: t('common.taluka'), v: farm.taluka },
                  { k: t('common.village'), v: farm.village },
                  { k: t('common.location'), v: <span className="mono">{farm.lat}, {farm.lng}</span> },
                  { k: 'Irrigation', v: farm.irrigation },
                  { k: 'Soil', v: farm.soilType },
                  { k: t('common.area'), v: `${farm.totalAreaHa} ha` },
                  { k: 'Created', v: fmtDate(farm.createdAt, state.settings.lang) },
                ]}
              />
              {farm.notes && <p className="muted small mt-10">{farm.notes}</p>}
            </div>
          </Card>
          <Notice kind="plain" icon="info">
            {t('farms.deleteWarning')}
          </Notice>
        </div>
      </div>

      {(creating || editing) && (
        <Modal
          title={editing ? t('farms.editPlot') : t('action.addPlot')}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button type="button" className="btn primary" onClick={save} disabled={!draft.name.trim()}>
                <Icon name="check" size={14} /> {t('common.save')}
              </button>
            </>
          }
        >
          <div className="grid c2">
            <Field label={t('common.plot')}>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t('common.area')}>
              <input type="number" step="0.1" value={draft.areaHa} onChange={(e) => setDraft({ ...draft, areaHa: Number(e.target.value) })} />
            </Field>
            <Field label={t('common.crop')}>
              <select
                value={draft.cropId}
                onChange={(e) => setDraft({ ...draft, cropId: e.target.value, crop: e.target.value })}
              >
                {CROPS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('common.variety')}>
              <input value={draft.variety} onChange={(e) => setDraft({ ...draft, variety: e.target.value })} />
            </Field>
            <Field label={t('common.plantingDate')}>
              <input
                type="date"
                value={draft.plantingDate.slice(0, 10)}
                onChange={(e) => setDraft({ ...draft, plantingDate: new Date(e.target.value).toISOString() })}
              />
            </Field>
            <Field label={t('common.stage')}>
              <select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value as CropStage })}>
                {(['nursery', 'vegetative', 'flowering', 'fruiting', 'maturity'] as CropStage[]).map((s) => (
                  <option key={s} value={s}>
                    {t(`stage.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Latitude">
              <input type="number" step="0.0001" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="0.0001" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })} />
            </Field>
            <Field label="Drainage" help={t('prev.drainage')}>
              <select value={draft.drainage} onChange={(e) => setDraft({ ...draft, drainage: e.target.value as Plot['drainage'] })}>
                {['good', 'moderate', 'poor', 'unknown'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Soil pH">
              <input
                type="number"
                step="0.1"
                value={draft.soilPh ?? ''}
                onChange={(e) => setDraft({ ...draft, soilPh: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label={t('common.notes')} className="mt-10">
            <textarea rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
        </Modal>
      )}
    </>
  );
}
