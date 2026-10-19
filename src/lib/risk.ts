/* =========================================================================
   CropSentinel AI — Transparent crop-risk engine (heuristic-rule-v1)

   DESIGN RULES (all enforced in code, all stated in the UI):
   • It is a documented heuristic. It is NOT a validated predictive model and
     it does not forecast yield loss or guarantee an outbreak.
   • Every input group has an explicit, user-tunable weight.
   • Missing inputs are excluded from the normalisation and LISTED as missing,
     rather than silently scored as zero.
   • Weather-favourability windows come from the knowledge base and are
     described as generic agronomic associations.
   • The score is reproducible: same inputs → same score.
   ========================================================================= */

import { conditionsForCrop, getCrop, getCondition } from '../domain/knowledge';
import type {
  ConditionDef,
} from '../domain/knowledge';
import type {
  DailyWeather,
  Farm,
  Plot,
  RiskAssessment,
  RiskFactorContribution,
  RiskLevel,
  RiskWeights,
  Scan,
  TrapObservation,
  WeatherSnapshot,
} from '../domain/types';
import { summarise } from './weather';

export const DEFAULT_WEIGHTS: RiskWeights = {
  weather: 30,
  stage: 12,
  history: 20,
  traps: 14,
  neighbourhood: 10,
  soil: 6,
  management: 8,
};

export const RISK_WEIGHT_LABELS: { key: keyof RiskWeights; labelKey: string }[] = [
  { key: 'weather', labelKey: 'factor.weather' },
  { key: 'stage', labelKey: 'factor.stage' },
  { key: 'history', labelKey: 'factor.history' },
  { key: 'traps', labelKey: 'factor.traps' },
  { key: 'neighbourhood', labelKey: 'factor.neighbourhood' },
  { key: 'soil', labelKey: 'factor.soil' },
  { key: 'management', labelKey: 'factor.management' },
];

export function category(score: number): RiskLevel {
  return score < 35 ? 'low' : score < 65 ? 'medium' : 'high';
}

function daysBetween(a: string, b: string): number {
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  return Math.round((t2 - t1) / 86400000);
}

/** Highest weather-favourability condition for this crop, given a weather window. */
export function mostFavourableCondition(
  cropId: string,
  days: DailyWeather[],
): { cond: ConditionDef; favour: number } | null {
  const summary = summarise(days);
  if (!summary) return null;
  let best: { cond: ConditionDef; favour: number } | null = null;
  for (const cond of conditionsForCrop(cropId)) {
    if (cond.id === 'healthy') continue;
    const f = cond.favourable;
    let score: number;
    if (cond.category === 'disorder') {
      score = 0.35;
    } else if (cond.isPest) {
      const tIn = summary.tMean >= f.tMin && summary.tMean <= f.tMax;
      const dry = summary.rainMm < 12 ? 1 : 0.3;
      score = Math.min(1, (tIn ? 0.45 : 0.12) + dry * 0.4 + (summary.rhMean >= f.rhMin ? 0.15 : 0.05));
    } else {
      const tIn = summary.tMean >= f.tMin && summary.tMean <= f.tMax;
      const rhIn = summary.rhMean >= f.rhMin;
      const rainIn = summary.rainMm >= f.rainMmMin;
      score = Math.min(1, (tIn ? 0.45 : 0.05) + (rhIn ? 0.35 : 0.05) + (rainIn ? 0.2 : 0.05));
    }
    if (!best || score > best.favour) best = { cond, favour: score };
  }
  return best;
}

export interface RiskInput {
  plot: Plot;
  farm: Farm;
  scans: Scan[];
  traps: TrapObservation[];
  /** Other plots' recent observations, for neighbourhood pressure. */
  neighbourhood: { plot: Plot; scan: Scan; distanceKm: number }[];
  weather: WeatherSnapshot | null;
  weights: RiskWeights;
  /** Recent advisory acknowledgements / follow-ups on this plot. */
  managementActions: number;
  now?: Date;
}

export interface RiskBreakdown {
  factors: RiskFactorContribution[];
  signals: Record<string, number>;
  appliedWeights: Partial<Record<keyof RiskWeights, number>>;
  missing: string[];
  score: number;
  topCondition: ConditionDef | null;
}

function severityWeight(sev: string): number {
  switch (sev) {
    case 'severe': return 1;
    case 'high': return 0.8;
    case 'moderate': return 0.5;
    case 'low': return 0.25;
    default: return 0;
  }
}

/** Core scoring function — also reused by the trend projection. */
export function computeRisk(input: RiskInput, weatherDays: DailyWeather[], now: Date): RiskBreakdown {
  const { plot, farm, weights } = input;
  const crop = getCrop(plot.cropId);
  const factors: RiskFactorContribution[] = [];
  const signals: Record<string, number> = {};
  const appliedWeights: RiskBreakdown['appliedWeights'] = {};
  const missing: string[] = [];
  const DAY = 86400000;

  /* ---------------------------------------------------------- 1. Weather */
  const fav = mostFavourableCondition(plot.cropId, weatherDays);
  const summary = summarise(weatherDays);
  if (fav && summary) {
    signals.weather = fav.favour;
    appliedWeights.weather = weights.weather;
    const dryPest = fav.cond.isPest && summary.rainMm < 12;
    factors.push({
      id: 'weather',
      labelKey: fav.cond.labelKey,
      direction: fav.favour >= 0.5 ? 'increase' : 'decrease',
      weight: weights.weather,
      points: Math.round(fav.favour * weights.weather * 10) / 10,
      detailKey: dryPest ? 'riskf.drySpell' : fav.favour >= 0.5 ? 'riskf.weatherFav' : 'riskf.weatherUnfav',
      params: {
        rh: Math.round(summary.rhMean),
        t: Math.round(summary.tMean),
        mm: Math.round(summary.rainMm),
        lo: fav.cond.favourable.tMin,
        hi: fav.cond.favourable.tMax,
        window: fav.cond.favourable.label,
      },
      source: 'weather',
    });
  } else {
    missing.push('miss.weather');
  }

  /* ------------------------------------------------- 2. Crop growth stage */
  const stageSus = crop.stageSusceptibility[plot.stage];
  if (typeof stageSus === 'number') {
    signals.stage = stageSus;
    appliedWeights.stage = weights.stage;
    factors.push({
      id: 'stage',
      labelKey: `stage.${plot.stage}`,
      direction: stageSus >= 0.6 ? 'increase' : 'decrease',
      weight: weights.stage,
      points: Math.round(stageSus * weights.stage * 10) / 10,
      detailKey: 'riskf.stage',
      params: { sus: stageSus.toFixed(2) },
      source: 'crop',
    });
  } else {
    missing.push('miss.stage');
  }

  /* ---------------------------------------------------- 3. Plot history */
  const recent = input.scans.filter((s) => {
    const d = daysBetween(s.createdAt, now.toISOString());
    return d >= 0 && d <= 21;
  });
  if (recent.length) {
    const worst = Math.max(...recent.map((s) => severityWeight(s.result.severity)));
    const freq = Math.min(1, recent.length / 3);
    const value = Math.min(1, 0.65 * worst + 0.35 * freq);
    signals.history = value;
    appliedWeights.history = weights.history;
    factors.push({
      id: 'history',
      labelKey: 'factor.history',
      direction: value >= 0.45 ? 'increase' : 'decrease',
      weight: weights.history,
      points: Math.round(value * weights.history * 10) / 10,
      detailKey: value >= 0.45 ? 'riskf.historyHigh' : 'riskf.historyMod',
      params: { n: recent.length, days: 21 },
      source: 'history',
    });
  } else {
    missing.push('miss.noScan');
  }

  /* ------------------------------------------------- 4. Traps & scouting */
  const recentTraps = input.traps.filter((t) => {
    const d = daysBetween(t.date, now.toISOString());
    return d >= 0 && d <= 14;
  });
  if (recentTraps.length) {
    let pressure = 0;
    let worstPest = '';
    let count = 0;
    let threshold = 0;
    let unit = '';
    for (const t of recentTraps) {
      const pestDef = conditionsForCrop(plot.cropId).find((c) => c.isPest && t.pestCategory.toLowerCase().includes(c.id.split('_')[0]));
      const thr = pestDef?.trapThreshold ?? 25;
      const ratio = t.count / thr;
      if (ratio > pressure) {
        pressure = Math.min(1, ratio);
        worstPest = t.pestCategory;
        count = t.count;
        threshold = thr;
        unit = pestDef?.trapUnit ?? 'count/week';
      }
    }
    signals.traps = pressure;
    appliedWeights.traps = weights.traps;
    factors.push({
      id: 'traps',
      label: worstPest || 'Pest-trap observation',
      direction: pressure >= 0.5 ? 'increase' : 'decrease',
      weight: weights.traps,
      points: Math.round(pressure * weights.traps * 10) / 10,
      detailKey: 'riskf.trap',
      params: { count, threshold, unit, pest: worstPest },
      source: 'traps',
    });
  } else {
    missing.push('miss.noTraps');
  }

  /* ------------------------------------------------ 5. Neighbouring fields */
  const near = input.neighbourhood.filter((n) => n.distanceKm <= 15 && severityWeight(n.scan.result.severity) >= 0.5);
  if (near.length || input.neighbourhood.length) {
    const value = Math.min(1, near.length / 5);
    signals.neighbourhood = value;
    appliedWeights.neighbourhood = weights.neighbourhood;
    factors.push({
      id: 'neighbourhood',
      labelKey: 'factor.neighbourhood',
      direction: value >= 0.3 ? 'increase' : 'decrease',
      weight: weights.neighbourhood,
      points: Math.round(value * weights.neighbourhood * 10) / 10,
      detailKey: 'riskf.neighbour',
      params: { n: near.length, km: 15, days: 14 },
      source: 'neighbourhood',
    });
  }

  /* --------------------------------------------------------------- 6. Soil */
  if (plot.drainage !== 'unknown') {
    const drainageSignal = plot.drainage === 'poor' ? 1 : plot.drainage === 'moderate' ? 0.55 : 0.2;
    signals.soil = drainageSignal;
    appliedWeights.soil = weights.soil;
    factors.push({
      id: 'soil',
      label: `${farm.soilType} · ${plot.drainage}`,
      direction: drainageSignal >= 0.5 ? 'increase' : 'decrease',
      weight: weights.soil,
      points: Math.round(drainageSignal * weights.soil * 10) / 10,
      detailKey: 'riskf.drainage',
      params: { drainage: plot.drainage },
      source: 'soil',
    });
  } else {
    missing.push('miss.soil');
  }

  /* -------------------------------------------------- 7. Management actions */
  if (input.managementActions > 0) {
    const relief = Math.min(1, input.managementActions / 2);
    signals.management = -relief; // reduces risk
    appliedWeights.management = weights.management;
    factors.push({
      id: 'management',
      labelKey: 'factor.management',
      direction: 'decrease',
      weight: weights.management,
      points: Math.round(-relief * weights.management * 10) / 10,
      detailKey: 'riskf.management',
      params: { n: input.managementActions },
      source: 'management',
    });
  }

  /* ------------------------------------------------------------ Normalise */
  const applied = (Object.keys(appliedWeights) as (keyof RiskWeights)[]).reduce(
    (acc, k) => acc + (appliedWeights[k] ?? 0),
    0,
  );
  const rawPositive = (Object.keys(appliedWeights) as (keyof RiskWeights)[]).reduce(
    (acc, k) => acc + (signals[k] ?? 0) * (appliedWeights[k] ?? 0),
    0,
  );
  const score = applied > 0 ? Math.max(0, Math.min(100, Math.round((rawPositive / applied) * 100))) : 0;

  const topCondition = fav?.cond ?? null;

  void DAY;
  return { factors, signals, appliedWeights, missing, score, topCondition };
}

export function preventiveActions(input: RiskInput, breakdown: RiskBreakdown): string[] {
  const out: string[] = [];
  const cond = breakdown.topCondition;
  if (cond) {
    if (cond.isPest) out.push('prev.trapMonitor', 'prev.borderCrop', 'prev.canopy');
    else out.push('prev.canopy', 'prev.avoidEveningIrrigation');
    if (cond.category === 'disease-bacterial') out.push('prev.implements');
  }
  if (cond?.category === 'disease-fungal') out.push('prev.airflow');
  if (input.plot.drainage === 'poor' || input.plot.drainage === 'moderate') out.push('prev.drainage');
  out.push('prev.scout', 'prev.records');
  if (breakdown.signals.soil === undefined) out.push('prev.soilTest');
  return out;
}

export function monitoringInterval(breakdown: RiskBreakdown): number {
  const cat = category(breakdown.score);
  if (cat === 'high') return 3;
  if (cat === 'medium') return 5;
  return 7;
}

export interface RiskTrendPoint {
  date: string;
  score: number;
  category: RiskLevel;
  kind: DailyWeather['kind'];
  label: string;
}

export function riskTrend(input: RiskInput, now = new Date()): RiskTrendPoint[] {
  const snapshot = input.weather;
  if (!snapshot) return [];
  const days = snapshot.days;
  const points: RiskTrendPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    const windowDays = days.slice(Math.max(0, i - 3), i + 1);
    const b = computeRisk(input, windowDays, now);
    points.push({
      date: days[i].date,
      score: b.score,
      category: category(b.score),
      kind: days[i].kind,
      label: days[i].source,
    });
  }
  return points;
}

export function assessPlotRisk(input: RiskInput, now = new Date()): {
  assessment: RiskAssessment;
  trend: RiskTrendPoint[];
} {
  const breakdown = computeRisk(input, input.weather?.days ?? [], now);
  const cat = category(breakdown.score);
  const assessment: RiskAssessment = {
    id: `risk-${input.plot.id}-${now.getTime()}`,
    plotId: input.plot.id,
    generatedAt: now.toISOString(),
    score: breakdown.score,
    category: cat,
    factors: breakdown.factors,
    missingInformation: breakdown.missing,
    preventiveActions: preventiveActions(input, breakdown),
    monitoringIntervalDays: monitoringInterval(breakdown),
    engine: 'heuristic-rule-v1',
    weatherSource: input.weather?.providerLabel ?? 'No weather input',
    weatherKind: input.weather?.isSimulated ? 'simulated' : 'observed',
  };
  return { assessment, trend: riskTrend(input, now) };
}

/** Distance in km between two coordinates (haversine). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export const conditionDefById = getCondition;
