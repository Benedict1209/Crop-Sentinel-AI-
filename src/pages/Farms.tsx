import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { Card, Empty, Field, Icon, Modal, Notice, RiskBadge, Stat } from '../components/ui';
import { allRiskRows, plotRows } from '../lib/selectors';
import { fmtDate } from '../lib/format';
import { SOIL_TYPES } from '../domain/knowledge';
import type { Farm } from '../domain/types';

const EMPTY_FARM: Omit<Farm, 'id'> = {
  name: '',
  farmerName: '',
  contact: '',
  district: 'Pune',
  taluka: '',
  village: '',
  lat: 18.5204,
  lng: 73.8567,
  irrigation: 'rainfed',
  soilType: 'black-cotton',
  totalAreaHa: 1,
  createdAt: new Date().toISOString(),
  notes: '',
  sample: false,
};

export function Farms() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('all');
  const [editing, setEditing] = useState<Farm | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Omit<Farm, 'id'>>(EMPTY_FARM);

  const rows = useMemo(() => allRiskRows(state), [state]);
  const plots = useMemo(() => plotRows(state, rows), [state, rows]);
  const districts = useMemo(() => [...new Set(state.farms.map((f) => f.district))].sort(), [state.farms]);

  const visible = state.farms.filter((f) => {
    if (district !== 'all' && f.district !== district) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      f.farmerName.toLowerCase().includes(q) ||
      f.village.toLowerCase().includes(q) ||
      f.district.toLowerCase().includes(q)
    );
  });

  function openCreate() {
    const first = state.farms[0];
    setDraft({ ...EMPTY_FARM, district: first?.district ?? 'Pune', taluka: first?.taluka ?? '' });
    setCreating(true);
  }

  function openEdit(f: Farm) {
    setDraft({ ...f });
    setEditing(f);
  }

  function save() {
    if (!draft.name.trim()) return;
    if (editing) state.updateFarm(editing.id, draft);
    else state.addFarm(draft);
    setEditing(null);
    setCreating(false);
  }

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('farms.title')}</h1>
          <p className="sub">{t('farms.sub')}</p>
        </div>
        <button type="button" className="btn primary" onClick={openCreate}>
          <Icon name="plus" size={14} /> {t('action.addFarm')}
        </button>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('dashboard.farms')} value={state.farms.length} />
        <Stat label={t('dashboard.plots')} value={state.plots.length} />
        <Stat
          label={t('farms.cropArea')}
          value={`${state.plots.reduce((a, p) => a + p.areaHa, 0).toFixed(1)} ha`}
          hint={`${state.farms.reduce((a, f) => a + f.totalAreaHa, 0).toFixed(1)} ha ${t('common.total')}`}
        />
        <Stat label={t('dashboard.highRisk')} value={rows.filter((r) => r.assessment.category === 'high').length} variant="risk" />
      </div>

      <div className="card pad mb-14">
        <div className="row">
          <label className="row nowrap" style={{ gap: 6 }}>
            <Icon name="search" size={15} className="muted" />
            <input
              placeholder={t('common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 240 }}
            />
          </label>
          <label className="row nowrap" style={{ gap: 6 }}>
            <span className="small muted">{t('filter.district')}</span>
            <select value={district} onChange={(e) => setDistrict(e.target.value)} style={{ width: 170 }}>
              <option value="all">{t('common.all')}</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <div className="spacer" />
          <span className="badge outline">
            {visible.length} / {state.farms.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <Empty text={t('common.noData')} />
        </Card>
      ) : (
        <div className="grid c2">
          {visible.map((f) => {
            const farmPlots = plots.filter((p) => p.plot.farmId === f.id);
            const high = farmPlots.filter((p) => p.risk?.assessment.category === 'high').length;
            const scans = state.scans.filter((s) => s.farmId === f.id).length;
            return (
              <Card
                key={f.id}
                title={
                  <span className="row nowrap" style={{ gap: 8 }}>
                    {f.name}
                    {f.sample && <span className="badge demo">{t('common.demoData')}</span>}
                  </span>
                }
                subtitle={`${f.farmerName} · ${f.village}, ${f.taluka}, ${f.district}`}
                actions={
                  <div className="row no-wrap">
                    <button type="button" className="icon-btn sm" onClick={() => openEdit(f)} aria-label={t('common.edit')}>
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm"
                      onClick={() => {
                        if (window.confirm(`${t('common.delete')} ${f.name}? ${t('farms.deleteWarning')}`)) state.deleteFarm(f.id);
                      }}
                      aria-label={t('common.delete')}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                }
              >
                <div className="card-body">
                  <div className="row mb-10">
                    <span className="badge outline">{f.totalAreaHa} ha</span>
                    <span className="badge outline">{f.irrigation}</span>
                    <span className="badge outline">{f.soilType}</span>
                    {high > 0 && <span className="badge high">{high} {t('risk.high')}</span>}
                    <span className="muted-2 small">{scans} {t('dashboard.scans')}</span>
                  </div>
                  <div className="col" style={{ gap: 6 }}>
                    {farmPlots.length === 0 && <div className="muted small">{t('farms.noPlots')}</div>}
                    {farmPlots.map((p) => (
                      <Link
                        key={p.plot.id}
                        to={`/plots/${p.plot.id}`}
                        className="row nowrap"
                        style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}
                      >
                        <Icon name="leaf" size={14} className="muted" />
                        <span className="small truncate flex-1">{p.plot.name}</span>
                        <span className="small muted-2 no-wrap">{t(`crop.${p.plot.cropId}`)}</span>
                        {p.risk && <RiskBadge level={p.risk.assessment.category} t={t} />}
                      </Link>
                    ))}
                  </div>
                  <div className="row mt-10">
                    <button type="button" className="btn sm" onClick={() => navigate(`/farms/${f.id}`)}>
                      <Icon name="arrowRight" size={13} /> {t('common.details')}
                    </button>
                    <span className="muted-2 small">{fmtDate(f.createdAt, state.settings.lang)}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <Modal
          title={editing ? t('farms.editFarm') : t('action.addFarm')}
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
            <Field label={t('common.farm')}>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Farmer">
              <input value={draft.farmerName} onChange={(e) => setDraft({ ...draft, farmerName: e.target.value })} />
            </Field>
            <Field label={t('common.district')}>
              <input value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} />
            </Field>
            <Field label={t('common.taluka')}>
              <input value={draft.taluka} onChange={(e) => setDraft({ ...draft, taluka: e.target.value })} />
            </Field>
            <Field label={t('common.village')}>
              <input value={draft.village} onChange={(e) => setDraft({ ...draft, village: e.target.value })} />
            </Field>
            <Field label={t('common.area')}>
              <input
                type="number"
                step="0.1"
                value={draft.totalAreaHa}
                onChange={(e) => setDraft({ ...draft, totalAreaHa: Number(e.target.value) })}
              />
            </Field>
            <Field label="Latitude">
              <input type="number" step="0.0001" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="0.0001" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })} />
            </Field>
            <Field label="Irrigation">
              <select value={draft.irrigation} onChange={(e) => setDraft({ ...draft, irrigation: e.target.value as Farm['irrigation'] })}>
                {['rainfed', 'canal', 'well', 'borewell', 'drip'].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Soil">
              <select value={draft.soilType} onChange={(e) => setDraft({ ...draft, soilType: e.target.value as Farm['soilType'] })}>
                {SOIL_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('common.notes')} className="mt-10">
            <textarea rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <Notice kind="plain" icon="info">
            {t('report.disclaimer')}
          </Notice>
        </Modal>
      )}
    </>
  );
}
