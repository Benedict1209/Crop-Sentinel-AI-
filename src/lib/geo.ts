/* =========================================================================
   CropSentinel AI — Geospatial layer

   A deliberately dependency-free schematic map: real district-headquarter
   coordinates projected with Web-Mercator maths onto an SVG canvas, with a
   lat/long graticule as the base layer.

   HONESTY: the base is a graticule with district centroids, NOT a survey
   boundary. It is labelled as schematic in the UI. If a tile service or a
   full GIS stack is available later, `project()` stays the same and only the
   base layer changes — the marker/detail contract is unchanged.
   ========================================================================= */

import type { Plot, RiskLevel, Scan, TrapObservation } from '../domain/types';
import { distanceKm } from './risk';
import { resultLabelKey } from './screening';

export interface District {
  name: string;
  lat: number;
  lng: number;
}

/** District headquarters with their published approximate coordinates. */
export const DISTRICTS: District[] = [
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Nashik', lat: 19.9975, lng: 73.7898 },
  { name: 'Nagpur', lat: 21.1458, lng: 79.0882 },
  { name: 'Chhatrapati Sambhajinagar', lat: 19.8762, lng: 75.3433 },
  { name: 'Kolhapur', lat: 16.705, lng: 74.2433 },
  { name: 'Solapur', lat: 17.6599, lng: 75.9064 },
  { name: 'Amravati', lat: 20.9374, lng: 77.7796 },
  { name: 'Jalgaon', lat: 21.0077, lng: 75.5626 },
  { name: 'Satara', lat: 17.6805, lng: 74.0183 },
  { name: 'Ahilyanagar', lat: 19.0948, lng: 74.748 },
  { name: 'Latur', lat: 18.4088, lng: 76.5604 },
  { name: 'Yavatmal', lat: 20.3888, lng: 78.1204 },
  { name: 'Ratnagiri', lat: 16.9902, lng: 73.312 },
  { name: 'Nanded', lat: 19.1383, lng: 77.321 },
  { name: 'Bhandara', lat: 21.17, lng: 79.65 },
  { name: 'Sangli', lat: 16.8524, lng: 74.5815 },
  { name: 'Chandrapur', lat: 19.9615, lng: 79.2961 },
  { name: 'Buldhana', lat: 20.5292, lng: 76.1843 },
];

/** Canvas extents covering Maharashtra with a margin. */
export const MAP_BOUNDS = { minLat: 15.4, maxLat: 22.4, minLng: 72.3, maxLng: 81.0 };
export const MAP_W = 860;
export const MAP_H = 720;

function mercY(latDeg: number): number {
  const lat = (Math.max(-85, Math.min(85, latDeg)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

/** Project a lat/lng into SVG canvas coordinates. */
export function project(lat: number, lng: number): { x: number; y: number } {
  const yTop = mercY(MAP_BOUNDS.maxLat);
  const yBottom = mercY(MAP_BOUNDS.minLat);
  const x = ((lng - MAP_BOUNDS.minLng) / (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng)) * MAP_W;
  const y = ((yTop - mercY(lat)) / (yTop - yBottom)) * MAP_H;
  return { x, y };
}

/** Inverse projection, used to keep a clicked point inside the district model. */
export function unproject(x: number, y: number): { lat: number; lng: number } {
  const yTop = mercY(MAP_BOUNDS.maxLat);
  const yBottom = mercY(MAP_BOUNDS.minLat);
  const lng = MAP_BOUNDS.minLng + (x / MAP_W) * (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng);
  const m = yTop - (y / MAP_H) * (yTop - yBottom);
  const lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lng };
}

export function nearestDistrict(lat: number, lng: number): District {
  let best = DISTRICTS[0];
  let bestD = Infinity;
  for (const d of DISTRICTS) {
    const dist = distanceKm(lat, lng, d.lat, d.lng);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/* -------------------------------------------------------------- Hotspots  */

export interface HotspotMarker {
  plotId: string;
  plotName: string;
  farmName: string;
  district: string;
  crop: string;
  cropId: string;
  lat: number;
  lng: number;
  risk: RiskLevel;
  conditionId: string;
  conditionKey: string;
  date: string;
  severity: string;
  scanId: string;
  supportingReports: number;
  trapAlerts: number;
  recommendedKey: string;
}

export interface DistrictSummary {
  district: string;
  lat: number;
  lng: number;
  markers: number;
  high: number;
  medium: number;
  low: number;
  score: number;
  risk: RiskLevel;
  dominantConditionKey: string | null;
}

const SEVERITY_POINTS: Record<string, number> = {
  severe: 4,
  high: 3,
  moderate: 2,
  low: 1,
  healthy: 0,
  inconclusive: 1,
};

function riskFromScore(score: number): RiskLevel {
  return score < 30 ? 'low' : score < 60 ? 'medium' : 'high';
}

/**
 * Aggregate plot-level observations into district hotspots.
 * Only the *latest* observation per plot is used as the marker, while the
 * supporting-report count shows how much evidence sits behind it.
 */
export function buildHotspots(args: {
  plots: Plot[];
  scans: Scan[];
  traps: TrapObservation[];
  districtOf: (plotId: string) => string;
}): { markers: HotspotMarker[]; summaries: DistrictSummary[] } {
  const byPlot = new Map<string, Scan[]>();
  for (const s of args.scans) {
    const arr = byPlot.get(s.plotId) ?? [];
    arr.push(s);
    byPlot.set(s.plotId, arr);
  }

  const markers: HotspotMarker[] = [];
  for (const plot of args.plots) {
    const list = (byPlot.get(plot.id) ?? []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!list.length) continue;
    const latest = list[0];
    const sev = latest.result.severity;
    const base = SEVERITY_POINTS[sev] ?? 1;
    const supporting = list.filter((s) => SEVERITY_POINTS[s.result.severity] >= 2).length;
    const trapAlerts = args.traps.filter((t) => t.plotId === plot.id && t.thresholdAlert).length;
    const score = Math.min(100, base * 18 + supporting * 8 + trapAlerts * 6);
    const risk = riskFromScore(score);
    markers.push({
      plotId: plot.id,
      plotName: plot.name,
      farmName: '',
      district: args.districtOf(plot.id),
      crop: plot.cropId,
      cropId: plot.cropId,
      lat: plot.lat,
      lng: plot.lng,
      risk,
      conditionId: latest.result.conditionId,
      conditionKey: resultLabelKey(latest.result),
      date: latest.createdAt,
      severity: sev,
      scanId: latest.id,
      supportingReports: supporting,
      trapAlerts,
      recommendedKey: latest.result.referralRequired ? 'map.recReferral' : 'map.recMonitor',
    });
  }

  const byDistrict = new Map<string, HotspotMarker[]>();
  for (const m of markers) {
    const arr = byDistrict.get(m.district) ?? [];
    arr.push(m);
    byDistrict.set(m.district, arr);
  }

  const summaries: DistrictSummary[] = [];
  for (const d of DISTRICTS) {
    const list = byDistrict.get(d.name) ?? [];
    if (!list.length) continue;
    const high = list.filter((m) => m.risk === 'high').length;
    const medium = list.filter((m) => m.risk === 'medium').length;
    const low = list.filter((m) => m.risk === 'low').length;
    const total = list.length;
    const score = Math.round(((high * 3 + medium * 1.5 + low * 0.4) / (total * 3)) * 100);
    const counts = new Map<string, number>();
    for (const m of list) counts.set(m.conditionKey, (counts.get(m.conditionKey) ?? 0) + 1);
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    summaries.push({
      district: d.name,
      lat: d.lat,
      lng: d.lng,
      markers: total,
      high,
      medium,
      low,
      score,
      risk: riskFromScore(score),
      dominantConditionKey: dominant,
    });
  }
  summaries.sort((a, b) => b.score - a.score);
  return { markers, summaries };
}
