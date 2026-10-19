/* =========================================================================
   CropSentinel AI — Weather provider layer

   Two providers behind one interface:

   • `simulated`  — the default. A deterministic scenario generator seeded from
                    the plot coordinates and the date, with a monsoon-aware
                    seasonal shape for Maharashtra. Fully offline and
                    reproducible: the same plot always yields the same series.
                    Every day it produces is tagged kind:'simulated'.

   • `open-meteo` — a genuine, free, key-less service (Open-Meteo). When it is
                    reachable the observed past days are tagged 'observed' and
                    the future days 'forecast'. If the request fails the
                    provider falls back to the simulated scenario and says so.

   The UI always distinguishes observed, forecast and simulated days.
   ========================================================================= */

import type { DailyWeather, WeatherSnapshot } from '../domain/types';

export type WeatherProviderId = 'simulated' | 'open-meteo';

export const WEATHER_PROVIDERS: { id: WeatherProviderId; labelKey: string; noteKey: string }[] = [
  { id: 'simulated', labelKey: 'settings.weatherSim', noteKey: 'risk.sourceSimulated' },
  { id: 'open-meteo', labelKey: 'settings.weatherLive', noteKey: 'risk.sourceObserved' },
];

const PAST_DAYS = 7;
const FORECAST_DAYS = 7;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d.getTime());
  c.setDate(c.getDate() + n);
  return c;
}

/**
 * Approximate seasonal shape for Maharashtra, used only by the simulated
 * provider. These are coarse climatological means, not measurements.
 */
function season(month: number, lat: number): { t: number; rh: number; rainP: number; rainMax: number } {
  const monsoon = [5, 6, 7, 8]; // Jun–Sep
  const postMonsoon = [9]; // Oct — humid but drying
  const winter = [10, 11, 0, 1]; // Nov–Feb
  const warmer = lat < 18 ? 1.6 : lat < 20 ? 0.6 : 0;
  if (monsoon.includes(month)) return { t: 28 + warmer, rh: 84, rainP: 0.62, rainMax: 46 };
  if (postMonsoon.includes(month)) return { t: 31 + warmer, rh: 68, rainP: 0.2, rainMax: 28 };
  if (winter.includes(month)) return { t: 27 + warmer, rh: 52, rainP: 0.05, rainMax: 8 };
  return { t: 36 + warmer, rh: 38, rainP: 0.04, rainMax: 6 }; // Mar–May
}

function simulatedSeries(lat: number, lng: number): DailyWeather[] {
  const today = new Date();
  const out: DailyWeather[] = [];
  const rnd = mulberry32(hash(`${lat.toFixed(3)}|${lng.toFixed(3)}`));
  for (let i = -PAST_DAYS; i <= FORECAST_DAYS; i++) {
    const d = addDays(today, i);
    const s = season(d.getMonth(), lat);
    const jitter = (rnd() - 0.5) * 4.2;
    const tMax = Math.round((s.t + jitter) * 10) / 10;
    const tMin = Math.round((s.t - 10 - jitter * 0.5) * 10) / 10;
    const rhMean = Math.round(Math.min(97, Math.max(28, s.rh + (rnd() - 0.5) * 16)));
    const rains = rnd() < s.rainP;
    const rainMm = rains ? Math.round(rnd() * s.rainMax * 10) / 10 : 0;
    out.push({
      date: iso(d),
      tMax,
      tMin,
      rhMean,
      rainMm,
      kind: 'simulated',
      source: 'Simulated scenario (offline generator)',
    });
  }
  return out;
}

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  relative_humidity_2m_mean?: number[];
  precipitation_sum: number[];
}

export async function fetchOpenMeteo(lat: number, lng: number): Promise<DailyWeather[]> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    '&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum' +
    `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS + 1}&timezone=Asia%2FKolkata`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const json = (await res.json()) as { daily?: OpenMeteoDaily };
    const daily = json.daily;
    if (!daily?.time?.length) throw new Error('Open-Meteo returned no daily data');
    const todayIso = iso(new Date());
    return daily.time.map((date, i) => ({
      date,
      tMax: daily.temperature_2m_max[i] ?? 0,
      tMin: daily.temperature_2m_min[i] ?? 0,
      rhMean: daily.relative_humidity_2m_mean?.[i] ?? 60,
      rainMm: daily.precipitation_sum[i] ?? 0,
      kind: (date <= todayIso ? 'observed' : 'forecast') as DailyWeather['kind'],
      source: date <= todayIso ? 'Open-Meteo (observed reanalysis)' : 'Open-Meteo (forecast)',
    }));
  } finally {
    clearTimeout(timer);
  }
}

export interface WeatherResult {
  snapshot: WeatherSnapshot;
  /** Set when a live provider was requested but the simulation was used instead. */
  fellBack: boolean;
  error?: string;
}

export async function getWeather(
  lat: number,
  lng: number,
  provider: WeatherProviderId,
): Promise<WeatherResult> {
  const fetchedAt = new Date().toISOString();

  if (provider === 'open-meteo') {
    try {
      const days = await fetchOpenMeteo(lat, lng);
      return {
        snapshot: {
          lat,
          lng,
          fetchedAt,
          providerId: 'open-meteo',
          providerLabel: 'Open-Meteo (free, no API key)',
          isSimulated: false,
          days,
        },
        fellBack: false,
      };
    } catch (e) {
      const days = simulatedSeries(lat, lng);
      return {
        snapshot: {
          lat,
          lng,
          fetchedAt,
          providerId: 'simulated',
          providerLabel: 'Simulated scenario (live provider unavailable)',
          isSimulated: true,
          days,
        },
        fellBack: true,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    snapshot: {
      lat,
      lng,
      fetchedAt,
      providerId: 'simulated',
      providerLabel: 'Simulated scenario (offline generator)',
      isSimulated: true,
      days: simulatedSeries(lat, lng),
    },
    fellBack: false,
  };
}

/** Convenience: synchronous simulated snapshot (used for seeding). */
export function simulatedSnapshot(lat: number, lng: number): WeatherSnapshot {
  return {
    lat,
    lng,
    fetchedAt: new Date().toISOString(),
    providerId: 'simulated',
    providerLabel: 'Simulated scenario (offline generator)',
    isSimulated: true,
    days: simulatedSeries(lat, lng),
  };
}

/** Summarise a window into the three values the risk engine consumes. */
export function summarise(days: DailyWeather[]): {
  rhMean: number;
  tMean: number;
  rainMm: number;
  kind: DailyWeather['kind'];
} | null {
  if (!days.length) return null;
  const rhMean = days.reduce((a, d) => a + d.rhMean, 0) / days.length;
  const tMean = days.reduce((a, d) => a + (d.tMax + d.tMin) / 2, 0) / days.length;
  const rainMm = days.reduce((a, d) => a + d.rainMm, 0);
  const kinds = new Set(days.map((d) => d.kind));
  const kind: DailyWeather['kind'] = kinds.size === 1 ? [...kinds][0] : days.some((d) => d.kind === 'observed') ? 'observed' : 'forecast';
  return { rhMean, tMean, rainMm, kind };
}
