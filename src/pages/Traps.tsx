import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { makeT } from '../lib/i18n';
import { PEST_CATEGORIES, TRAP_TYPES } from '../domain/knowledge';
import { Card, Empty, Field, Icon, Notice, SeverityBadge, Stat } from '../components/ui';
import { TrapTrendChart } from '../components/charts';
import { thresholdFor } from '../lib/selectors';
import { fmtDate, toInputDate } from '../lib/format';
import type { CropStage } from '../domain/types';

export function Traps() {
  const state = useStore();
  const t = useMemo(() => makeT(state.settings.lang), [state.settings.lang]);

  const [plotId, setPlotId] = useState(state.plots[0]?.id ?? '');
  const [showForm, setShowForm] = useState(false);
  const [trapType, setTrapType] = useState(TRAP_TYPES[0]);
  const [pestCategory, setPestCategory] = useState(PEST_CATEGORIES[0]);
  const [count, setCount] = useState(0);
  const [date, setDate] = useState(toInputDate(new Date().toISOString()));
  const [tempC, setTempC] = useState('');
  const [humidity, setHumidity] = useState('');
  const [notes, setNotes] = useState('');
  const [stage, setStage] = useState<CropStage | ''>('');
  const [filter, setFilter] = useState<'all' | 'alerts'>('all');

  const plot = state.plots.find((p) => p.id === plotId) ?? state.plots[0];
  const farm = state.farms.find((f) => f.id === plot?.farmId);

  const observations = useMemo(
    () =>
      state.traps
        .filter((x) => (plot ? x.plotId === plot.id : true))
        .filter((x) => (filter === 'all' ? true : x.thresholdAlert))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [state.traps, plot, filter],
  );

  const threshold = plot ? thresholdFor(plot.cropId, pestCategory) : { value: null, unit: '', conditionId: null };
  const plotThreshold = plot ? thresholdFor(plot.cropId, observations[0]?.pestCategory ?? '') : { value: null, unit: '', conditionId: null };

  const trend = observations
    .slice()
    .reverse()
    .slice(-14)
    .map((x) => ({ date: x.date, count: x.count }));

  function submit() {
    if (!plot) return;
    const thr = thresholdFor(plot.cropId, pestCategory);
    const alert = thr.value !== null ? count >= thr.value : count >= 25;
    state.addTrap({
      plotId: plot.id,
      date: new Date(`${date}T09:00:00`).toISOString(),
      trapType,
      pestCategory,
      count,
      cropStage: (stage || plot.stage) as CropStage,
      tempC: tempC === '' ? undefined : Number(tempC),
      humidity: humidity === '' ? undefined : Number(humidity),
      notes,
      observer: state.settings.currentUser.name,
      thresholdAlert: alert,
      cvCount: null,
    });
    if (alert) {
      state.pushNotification({
        kind: 'alert',
        title: 'Trap count above the illustrative demo threshold',
        body: `${plot.name}: ${count} caught (${pestCategory}). Review recommended.`,
        at: new Date().toISOString(),
        href: '/traps',
      });
    }
    setShowForm(false);
    setCount(0);
    setNotes('');
    setTempC('');
    setHumidity('');
  }

  const alertsTotal = state.traps.filter((x) => x.thresholdAlert).length;

  return (
    <>
      <div className="page-head">
        <div className="flex-1">
          <h1>{t('traps.title')}</h1>
          <p className="sub">{t('traps.sub')}</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowForm((v) => !v)}>
          <Icon name="plus" size={14} /> {t('traps.add')}
        </button>
      </div>

      <div className="grid c4 mb-14">
        <Stat label={t('nav.traps')} value={state.traps.length} hint={`${state.plots.length} ${t('common.plot')}`} />
        <Stat label={t('traps.threshold')} value={alertsTotal} variant="risk" hint={t('traps.exceeded')} />
        <Stat label={t('common.crop')} value={plot ? t(`crop.${plot.cropId}`) : '—'} hint={plot?.name} />
        <Stat
          label={t('traps.threshold')}
          value={plotThreshold.value ?? '—'}
          variant="warn"
          hint={plotThreshold.unit || t('traps.noThreshold')}
        />
      </div>

      <Notice kind="warn" icon="alert">
        <strong>{t('traps.threshold')}: </strong>
        {t('traps.illustrativeNote')}
      </Notice>

      {showForm && (
        <Card title={t('traps.add')} className="mt-14">
          <div className="card-body">
            <div className="grid c3">
              <Field label={t('common.plot')}>
                <select value={plotId} onChange={(e) => setPlotId(e.target.value)}>
                  {state.plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {state.farms.find((f) => f.id === p.farmId)?.district}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('traps.trapType')}>
                <select value={trapType} onChange={(e) => setTrapType(e.target.value)}>
                  {TRAP_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('traps.pestCategory')}>
                <select value={pestCategory} onChange={(e) => setPestCategory(e.target.value)}>
                  {PEST_CATEGORIES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('common.date')}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={t('traps.count')} help={threshold.value !== null ? `${t('traps.threshold')}: ${threshold.value} ${threshold.unit}` : t('traps.noThreshold')}>
                <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </Field>
              <Field label={t('common.stage')}>
                <select value={stage} onChange={(e) => setStage(e.target.value as CropStage)}>
                  <option value="">{t('common.stageUnknown')}</option>
                  {(['nursery', 'vegetative', 'flowering', 'fruiting', 'maturity'] as CropStage[]).map((s) => (
                    <option key={s} value={s}>
                      {t(`stage.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`${t('traps.temp')} (${t('common.optional')})`}>
                <input type="number" value={tempC} onChange={(e) => setTempC(e.target.value)} />
              </Field>
              <Field label={`${t('traps.humidity')} (${t('common.optional')})`}>
                <input type="number" value={humidity} onChange={(e) => setHumidity(e.target.value)} />
              </Field>
              <Field label={t('traps.observer')}>
                <input readOnly value={state.settings.currentUser.name} />
              </Field>
            </div>
            <Field label={`${t('common.notes')} (${t('common.optional')})`} className="mt-10">
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="row mt-10">
              <button type="button" className="btn leaf" onClick={submit}>
                <Icon name="check" size={14} /> {t('common.save')}
              </button>
              <button type="button" className="btn" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid side mt-14">
        <Card title={t('traps.trend')} subtitle={plot ? `${plot.name} · ${farm?.name}` : ''}>
          <div className="card-body">
            <label className="row nowrap mb-10" style={{ gap: 6 }}>
              <span className="small muted">{t('common.plot')}</span>
              <select value={plot?.id ?? ''} onChange={(e) => setPlotId(e.target.value)} style={{ width: 260 }}>
                {state.plots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {trend.length === 0 ? (
              <Empty text={t('common.noData')} />
            ) : (
              <TrapTrendChart data={trend} t={t} lang={state.settings.lang} threshold={plotThreshold.value} />
            )}
            <Notice kind="plain" icon="camera">
              {t('traps.cvNote')}
            </Notice>
          </div>
        </Card>

        <Card title={t('traps.entries')} subtitle={t('traps.historyNote')}>
          <div className="card-body" style={{ paddingTop: 8 }}>
            <div className="row mb-10">
              <button type="button" className={`btn sm ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>
                {t('common.all')}
              </button>
              <button type="button" className={`btn sm ${filter === 'alerts' ? 'primary' : ''}`} onClick={() => setFilter('alerts')}>
                <Icon name="alert" size={12} /> {t('traps.exceeded')}
              </button>
            </div>
            {observations.length === 0 ? (
              <Empty text={t('common.noData')} />
            ) : (
              <div className="col" style={{ gap: 9 }}>
                {observations.slice(0, 12).map((o) => (
                  <div key={o.id} className="row nowrap" style={{ gap: 9, alignItems: 'flex-start' }}>
                    <SeverityBadge severity={o.thresholdAlert ? 'high' : 'low'} t={t} />
                    <div className="flex-1">
                      <div className="small strong">
                        {o.count} · {o.pestCategory}
                      </div>
                      <div className="muted-2 small">
                        {fmtDate(o.date, state.settings.lang)} · {o.trapType}
                        {typeof o.tempC === 'number' ? ` · ${o.tempC}°C` : ''}
                        {typeof o.humidity === 'number' ? ` · ${o.humidity}%` : ''}
                      </div>
                      {o.notes && <div className="muted small">{o.notes}</div>}
                    </div>
                    <button
                      type="button"
                      className="icon-btn sm"
                      onClick={() => state.deleteTrap(o.id)}
                      aria-label={t('common.delete')}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
