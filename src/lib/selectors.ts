/* =========================================================================
   CropSentinel AI — Derived data selectors
   Everything the dashboard, map and reports display is computed here from the
   single store, so no screen hard-codes statistics.
   ========================================================================= */

import type {
  ExpertCase,
  Farm,
  FollowUp,
  Plot,
  RiskAssessment,
  RiskLevel,
  Scan,
  TrapObservation,
} from '../domain/types';
import type { StoreState } from './store';
import { DEFAULT_WEIGHTS, assessPlotRisk, distanceKm } from './risk';
import type { RiskInput, RiskTrendPoint } from './risk';
import { conditionLabelKeyOf, resultLabelKey } from './screening';
import { summarise } from './weather';
import { conditionsForCrop } from '../domain/knowledge';

export interface RiskRow {
  plot: Plot;
  farm: Farm;
  assessment: RiskAssessment;
  trend: RiskTrendPoint[];
}

function farmOf(state: StoreState, farmId: string): Farm | undefined {
  return state.farms.find((f) => f.id === farmId);
}

export function neighbourhoodFor(state: StoreState, plot: Plot): RiskInput['neighbourhood'] {
  const out: RiskInput['neighbourhood'] = [];
  for (const other of state.plots) {
    if (other.id === plot.id) continue;
    const d = distanceKm(plot.lat, plot.lng, other.lat, other.lng);
    if (d > 20) continue;
    const scans = state.scans
      .filter((s) => s.plotId === other.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!scans.length) continue;
    const recent = scans[0];
    const ageDays = (Date.now() - new Date(recent.createdAt).getTime()) / 86400000;
    if (ageDays > 21) continue;
    out.push({ plot: other, scan: recent, distanceKm: d });
  }
  return out;
}

export function riskInputFor(state: StoreState, plot: Plot, now = new Date()): RiskInput {
  const farm = farmOf(state, plot.farmId);
  const scans = state.scans.filter((s) => s.plotId === plot.id);
  const traps = state.traps.filter((t) => t.plotId === plot.id);
  const managementActions = state.followUps.filter(
    (f) => f.plotId === plot.id && (now.getTime() - new Date(f.date).getTime()) / 86400000 <= 14,
  ).length;

  const fallbackWeather = scans.find((s) => s.weatherSnapshot)?.weatherSnapshot ?? null;

  return {
    plot,
    farm:
      farm ?? {
        id: 'unknown',
        name: 'Unassigned',
        farmerName: '—',
        contact: '—',
        district: '—',
        taluka: '—',
        village: '—',
        lat: plot.lat,
        lng: plot.lng,
        irrigation: 'rainfed',
        soilType: 'unknown',
        totalAreaHa: 0,
        createdAt: plot.plantingDate,
        sample: true,
      },
    scans,
    traps,
    neighbourhood: neighbourhoodFor(state, plot),
    weather: fallbackWeather,
    weights: state.settings.riskWeights ?? DEFAULT_WEIGHTS,
    managementActions,
    now,
  };
}

export function allRiskRows(state: StoreState, now = new Date()): RiskRow[] {
  return state.plots.map((plot) => {
    const input = riskInputFor(state, plot, now);
    const { assessment, trend } = assessPlotRisk(input, now);
    return {
      plot,
      farm: input.farm,
      assessment,
      trend,
    };
  });
}

export function riskMap(rows: RiskRow[]): Map<string, RiskRow> {
  return new Map(rows.map((r) => [r.plot.id, r]));
}

/* ------------------------------------------------------------- Dashboard */

export interface DashboardMetrics {
  farms: number;
  plots: number;
  scans: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  pendingReviews: number;
  underReview: number;
  resolvedCases: number;
  openFollowUps: number;
  healthyShare: number;
  avgRisk: number;
  trapAlerts: number;
  inconclusive: number;
}

export function dashboardMetrics(state: StoreState, rows: RiskRow[]): DashboardMetrics {
  const totalScans = state.scans.length;
  const clean = state.scans.filter((s) => s.result.disposition === 'healthy').length;
  const inconclusive = state.scans.filter((s) => s.result.disposition === 'inconclusive').length;
  const casesWithFollowUp = new Set(state.followUps.map((f) => f.caseId));
  const resolvedCases = state.cases.filter((c) => c.status === 'resolved');
  return {
    farms: state.farms.length,
    plots: state.plots.length,
    scans: totalScans,
    highRisk: rows.filter((r) => r.assessment.category === 'high').length,
    mediumRisk: rows.filter((r) => r.assessment.category === 'medium').length,
    lowRisk: rows.filter((r) => r.assessment.category === 'low').length,
    pendingReviews: state.cases.filter((c) => c.status === 'pending').length,
    underReview: state.cases.filter((c) => c.status === 'under_review').length,
    resolvedCases: resolvedCases.length,
    openFollowUps: state.cases.filter((c) => c.status !== 'resolved' && !casesWithFollowUp.has(c.id)).length,
    healthyShare: totalScans ? Math.round((clean / totalScans) * 100) : 0,
    avgRisk: rows.length ? Math.round(rows.reduce((a, r) => a + r.assessment.score, 0) / rows.length) : 0,
    trapAlerts: state.traps.filter((t) => t.thresholdAlert).length,
    inconclusive,
  };
}

/** Daily scan/severity trend for the last N days. */
export function healthTrend(state: StoreState, days = 30): { date: string; scans: number; high: number; moderate: number; healthy: number }[] {
  const out: { date: string; scans: number; high: number; moderate: number; healthy: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d.getTime() + 86400000);
    const same = state.scans.filter((s) => {
      const t = new Date(s.createdAt).getTime();
      return t >= d.getTime() && t < next.getTime();
    });
    out.push({
      date: d.toISOString().slice(0, 10),
      scans: same.length,
      high: same.filter((s) => s.result.severity === 'high' || s.result.severity === 'severe').length,
      moderate: same.filter((s) => s.result.severity === 'moderate').length,
      healthy: same.filter((s) => s.result.disposition === 'healthy').length,
    });
  }
  return out;
}

export function conditionDistribution(
  state: StoreState,
  scans?: Scan[],
): { conditionId: string; labelKey: string; count: number; group: string }[] {
  const src = scans ?? state.scans;
  const map = new Map<string, { count: number; labelKey: string; group: string }>();
  for (const s of src) {
    const key = `${s.result.conditionId}|${s.result.disposition}`;
    const prev = map.get(key);
    map.set(key, {
      count: (prev?.count ?? 0) + 1,
      // Labelled from a real result so an unnamed “inconclusive” bucket is
      // never charted as a named condition.
      labelKey: prev?.labelKey ?? resultLabelKey(s.result),
      group: prev?.group ?? s.result.category.split('-')[0],
    });
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      conditionId: key.split('|')[0],
      labelKey: v.labelKey,
      count: v.count,
      group: v.group,
    }))
    .sort((a, b) => b.count - a.count);
}

/* ---------------------------------------------------------------- Cases */

export interface CaseView {
  kase: ExpertCase;
  scan: Scan | undefined;
  plot: Plot | undefined;
  farm: Farm | undefined;
  followUps: FollowUp[];
  /** Days since submission — used to prioritise the extension backlog. */
  ageDays: number;
  overdue: boolean;
  priority: number;
}

export function caseViews(state: StoreState): CaseView[] {
  const now = Date.now();
  return state.cases
    .map((kase) => {
      const scan = state.scans.find((s) => s.id === kase.scanId);
      const plot = state.plots.find((p) => p.id === kase.plotId);
      const farm = plot ? farmOf(state, plot.farmId) : undefined;
      const fu = state.followUps.filter((f) => f.caseId === kase.id);
      const ageDays = Math.round((now - new Date(kase.submittedAt).getTime()) / 86400000);
      const interval = 5;
      const overdue = kase.status !== 'resolved' && ageDays > interval && fu.length === 0;
      const sevScore =
        scan?.result.severity === 'severe' || scan?.result.severity === 'high'
          ? 3
          : scan?.result.severity === 'moderate'
            ? 2
            : 1;
      const statusScore = kase.status === 'pending' ? 3 : kase.status === 'under_review' ? 2 : 1;
      return { kase, scan, plot, farm, followUps: fu, ageDays, overdue, priority: sevScore * 2 + statusScore + (overdue ? 3 : 0) };
    })
    .sort((a, b) => b.priority - a.priority || b.ageDays - a.ageDays);
}

/* ---------------------------------------------------------------- Plots */

export interface PlotRow {
  plot: Plot;
  farm: Farm;
  scans: Scan[];
  traps: TrapObservation[];
  cases: ExpertCase[];
  followUps: FollowUp[];
  risk: RiskRow | undefined;
  latestScan: Scan | undefined;
}

export function plotRows(state: StoreState, rows: RiskRow[]): PlotRow[] {
  const map = riskMap(rows);
  return state.plots.map((plot) => {
    const scans = state.scans
      .filter((s) => s.plotId === plot.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const farm = farmOf(state, plot.farmId);
    return {
      plot,
      farm:
        farm ?? {
          id: 'unknown', name: 'Unassigned', farmerName: '—', contact: '—', district: '—', taluka: '—', village: '—',
          lat: plot.lat, lng: plot.lng, irrigation: 'rainfed', soilType: 'unknown', totalAreaHa: 0,
          createdAt: plot.plantingDate, sample: true,
        },
      scans,
      traps: state.traps.filter((t) => t.plotId === plot.id).sort((a, b) => (a.date < b.date ? 1 : -1)),
      cases: state.cases.filter((c) => c.plotId === plot.id),
      followUps: state.followUps.filter((f) => f.plotId === plot.id).sort((a, b) => (a.date < b.date ? 1 : -1)),
      risk: map.get(plot.id),
      latestScan: scans[0],
    };
  });
}

/** Latest observation per plot, newest first — powers the map and officer view. */
export function latestObservations(state: StoreState): { scan: Scan; plot: Plot; farm: Farm | undefined }[] {
  return state.scans
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 60)
    .map((scan) => ({
      scan,
      plot: state.plots.find((p) => p.id === scan.plotId) as Plot,
      farm: state.farms.find((f) => f.id === scan.farmId),
    }))
    .filter((x) => Boolean(x.plot));
}

/* -------------------------------------------------- Trap / threshold view */

/** Illustrative demo threshold for a pest category label (documented as such). */
export function thresholdFor(cropId: string, pestCategory: string): { value: number | null; unit: string; conditionId: string | null } {
  const cands = conditionsForCrop(cropId).filter((c) => c.isPest);
  const lower = pestCategory.toLowerCase();
  const hit =
    cands.find((c) => lower.includes(c.id.split('_')[0])) ??
    (lower.includes('thrips') ? cands.find((c) => c.id.includes('thrips')) : undefined) ??
    (lower.includes('bollworm') ? cands.find((c) => c.id.includes('bollworm')) : undefined) ??
    (lower.includes('armyworm') ? cands.find((c) => c.id.includes('armyworm')) : undefined);
  if (!hit) return { value: null, unit: '', conditionId: null };
  return { value: hit.trapThreshold ?? null, unit: hit.trapUnit ?? '', conditionId: hit.id };
}

export function weatherSummaryOf(scan: Scan): ReturnType<typeof summarise> {
  return scan.weatherSnapshot ? summarise(scan.weatherSnapshot.days) : null;
}

export function riskLabelKey(level: RiskLevel): string {
  return `risk.${level}`;
}
