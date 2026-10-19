/* =========================================================================
   CropSentinel AI — Demonstration seed dataset

   Everything in this file is DEMONSTRATION DATA. Farms, farmers, coordinates,
   dates and trap counts are synthetic but internally consistent, so the
   dashboard, map, risk engine and reports all demonstrate the real data model.

   It is generated deterministically (fixed PRNG seed) and every seeded scan is
   produced by running the ACTIVE screening adapter — the seeded results are
   therefore produced by exactly the same code path as a live scan.
   ========================================================================= */

import type {
  AppData,
  AppNotification,
  ConditionCategory,
  CropStage,
  DailyWeather,
  ExpertCase,
  Farm,
  FeedbackRecord,
  FollowUp,
  Plot,
  RiskWeights,
  Scan,
  TrapObservation,
} from './types';
import { conditionsForCrop, getCondition, PEST_CATEGORIES, TRAP_TYPES } from './knowledge';
import { demoRuleAdapter } from '../lib/screening';
import { combineWithModel } from '../lib/modelScreening';
import { DEFAULT_SERVICE_URL } from '../lib/inferenceClient';
import type { SampleKind } from '../lib/sampleImages';
import { syntheticImage } from '../lib/sampleImages';
import { simulatedSnapshot } from '../lib/weather';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed PRNG seed — the seed dataset is identical on every reset. */
const SEED = 20260213;

function condKind(conditionId: string): SampleKind {
  const allowed: SampleKind[] = [
    'cotton_fusarium_wilt',
    'soybean_downy_mildew',
    'soybean_rust',
    'healthy',
    'unclear',
  ];
  return (allowed.includes(conditionId as SampleKind) ? conditionId : 'unclear') as SampleKind;
}

interface FarmDef {
  name: string; farmer: string; district: string; taluka: string; village: string;
  lat: number; lng: number; irrigation: Farm['irrigation']; soil: Farm['soilType']; area: number;
}

const FARM_DEFS: FarmDef[] = [
  { name: 'Shivneri Farm', farmer: 'Ramesh Patil', district: 'Pune', taluka: 'Baramati', village: 'Malegaon', lat: 18.1502, lng: 74.5815, irrigation: 'drip', soil: 'black-cotton', area: 5.6 },
  { name: 'Vidarbha Cotton Estate', farmer: 'Ganesh Rathod', district: 'Yavatmal', taluka: 'Kalamb', village: 'Khadki', lat: 20.2902, lng: 78.2131, irrigation: 'rainfed', soil: 'black-cotton', area: 6.1 },
  { name: 'Marathwada Bhoomi', farmer: 'Kavita Jadhav', district: 'Latur', taluka: 'Ausa', village: 'Killari', lat: 18.2902, lng: 76.4012, irrigation: 'borewell', soil: 'black-cotton', area: 4.7 },
  { name: 'Bhima Basin Plot', farmer: 'Santosh More', district: 'Solapur', taluka: 'Malshiras', village: 'Akluj', lat: 17.8602, lng: 75.1231, irrigation: 'borewell', soil: 'black-cotton', area: 5.0 },
  // farmIdx 0-3 below must reference these entries by index.
  { name: 'Soybean Farm', farmer: 'Sunita Deshmukh', district: 'Nashik', taluka: 'Dindori', village: 'Janori', lat: 20.1902, lng: 73.8331, irrigation: 'drip', soil: 'sandy-loam', area: 3.6 },
  { name: 'Wainganga Soyabean Plot', farmer: 'Anil Meshram', district: 'Bhandara', taluka: 'Lakhandur', village: 'Chulod', lat: 21.0102, lng: 79.7126, irrigation: 'canal', soil: 'clay-loam', area: 5.4 },
];

interface PlotDef { farmIdx: number; name: string; cropId: string; variety: string; area: number; daysSincePlanting: number; stage: CropStage; drainage: Plot['drainage']; ph?: number }

const PLOT_DEFS: PlotDef[] = [
  { farmIdx: 0, name: 'Cotton field 1', cropId: 'cotton', variety: 'BG-II hybrid', area: 3.2, daysSincePlanting: 84, stage: 'fruiting', drainage: 'moderate', ph: 7.8 },
  { farmIdx: 0, name: 'Cotton field 2', cropId: 'cotton', variety: 'AKH-081', area: 2.4, daysSincePlanting: 56, stage: 'flowering', drainage: 'good', ph: 7.5 },
  { farmIdx: 1, name: 'Soybean field 1', cropId: 'soybean', variety: 'JS-9305', area: 1.6, daysSincePlanting: 120, stage: 'fruiting', drainage: 'good', ph: 7.9 },
  { farmIdx: 1, name: 'Soybean field 2', cropId: 'soybean', variety: 'Sonaka', area: 1.4, daysSincePlanting: 110, stage: 'fruiting', drainage: 'poor', ph: 8.1 },
  { farmIdx: 2, name: 'Cotton field 3', cropId: 'cotton', variety: 'BG-II hybrid', area: 2.8, daysSincePlanting: 68, stage: 'fruiting', drainage: 'moderate', ph: 7.6 },
  { farmIdx: 2, name: 'Soybean field 3', cropId: 'soybean', variety: 'JS-9305', area: 1.2, daysSincePlanting: 54, stage: 'flowering', drainage: 'good', ph: 7.4 },
  { farmIdx: 3, name: 'Cotton field 4', cropId: 'cotton', variety: 'AKH-081', area: 3.0, daysSincePlanting: 95, stage: 'vegetative', drainage: 'poor', ph: 8.0 },
  { farmIdx: 3, name: 'Soybean field 4', cropId: 'soybean', variety: 'MACS-1188', area: 2.0, daysSincePlanting: 72, stage: 'vegetative', drainage: 'moderate', ph: 7.5 },
  // Synthetic demonstration plots so every seeded farm owns at least one plot.
  { farmIdx: 4, name: 'Soybean field 5', cropId: 'soybean', variety: 'JS-335', area: 2.1, daysSincePlanting: 66, stage: 'flowering', drainage: 'moderate', ph: 7.6 },
  { farmIdx: 5, name: 'Soybean field 6', cropId: 'soybean', variety: 'JS-9305', area: 2.6, daysSincePlanting: 91, stage: 'fruiting', drainage: 'poor', ph: 7.7 },
];

export interface SeedOptions {
  weights?: RiskWeights;
  currentUser?: { name: string; role: string; initials: string };
}

export async function buildSeedData(opts: SeedOptions = {}): Promise<AppData> {
  // The generator lives inside the function so that every reset reproduces the
  // exact same demonstration dataset instead of continuing a module-level stream.
  const rnd = mulberry32(SEED);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const daysAgoIso = (days: number, hour = 9): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour, int(0, 55), 0, 0);
    return d.toISOString();
  };

  const farms: Farm[] = [];
  const plots: Plot[] = [];

  FARM_DEFS.forEach((f, i) => {
    farms.push({
      id: `farm-${i + 1}`,
      name: f.name,
      farmerName: f.farmer,
      contact: `+91 9${int(100000000, 899999999)}`,
      district: f.district,
      taluka: f.taluka,
      village: f.village,
      lat: Number(f.lat.toFixed(4)),
      lng: Number(f.lng.toFixed(4)),
      irrigation: f.irrigation,
      soilType: f.soil,
      totalAreaHa: f.area,
      createdAt: daysAgoIso(210),
      notes: 'Demonstration farm record created for the SIH prototype.',
      sample: true,
    });
  });

  PLOT_DEFS.forEach((p, i) => {
    const farm = farms[p.farmIdx];
    const planting = new Date();
    planting.setDate(planting.getDate() - p.daysSincePlanting);
    plots.push({
      id: `plot-${i + 1}`,
      farmId: farm.id,
      name: p.name,
      areaHa: p.area,
      crop: p.cropId,
      cropId: p.cropId,
      variety: p.variety,
      plantingDate: planting.toISOString(),
      stage: p.stage,
      soilPh: p.ph,
      soilOrganicMatter: Math.round((0.4 + rnd() * 0.9) * 100) / 100,
      drainage: p.drainage,
      lat: Number((farm.lat + (rnd() - 0.5) * 0.035).toFixed(4)),
      lng: Number((farm.lng + (rnd() - 0.5) * 0.035).toFixed(4)),
      notes: '',
      sample: true,
    });
  });

  /* --------------------------------------------------------------- Scans */
  const scans: Scan[] = [];
  let scanSeq = 0;

  for (let pi = 0; pi < plots.length; pi++) {
    const plot = plots[pi];
    const rounds = plot.stage === 'nursery' ? 1 : int(1, 3);
    const candidates = conditionsForCrop(plot.cropId).filter((c) => c.id !== 'healthy');
    // Two plots are deliberately kept clean, and roughly one observation in five
    // is a clean one, so the dashboard shows a realistic mix rather than an
    // all-alarm dataset.
    const alwaysHealthy = plot.id === 'plot-4' || plot.id === 'plot-8';

    for (let r = 0; r < rounds; r++) {
      const daysBack = int(1, 44);
      const clean = alwaysHealthy || rnd() < 0.2;
      // Conditions are cycled by plot and round rather than drawn uniformly, so
      // crops with few candidate conditions do not dominate the dashboard mix.
      const cond = clean
        ? getCondition('healthy')!
        : candidates[(pi + r) % Math.max(1, candidates.length)];
      // Vary how much was reported: a scout rarely lists every symptom.
      const symptomCount = clean ? 1 : rnd() < 0.3 ? 1 : int(2, Math.min(3, cond.symptoms.length));
      const symptoms = clean ? ['no_visible_symptom'] : cond.symptoms.slice(0, symptomCount);
      const weather = simulatedSnapshot(plot.lat, plot.lng);
      const window: DailyWeather[] = weather.days.slice(0, 6);
      const rhMean = window.reduce((a, d) => a + d.rhMean, 0) / window.length;
      const tMean = window.reduce((a, d) => a + (d.tMax + d.tMin) / 2, 0) / window.length;
      const rainMm = window.reduce((a, d) => a + d.rainMm, 0);
      const kind = cond.id;

      // Seeded scans are produced by the same rule engine as a live scan that had
      // no usable photograph: a synthetic image is deliberately never sent to a
      // real model (see modelScreening.attemptModelInference), so the seeded
      // record carries modelInference: null rather than a fabricated one.
      const result = combineWithModel(
        await demoRuleAdapter.analyze({
          image: syntheticImage(condKind(kind), `${plot.name} — synthetic demo image`),
          cropId: plot.cropId,
          cropLabel: plot.cropId,
          stage: plot.stage,
          symptoms,
          notes: `Seeded demonstration observation for ${plot.name}.`,
          weather: { rhMean, tMean, rainMm, kind: 'simulated', label: weather.providerLabel },
          plotHistory: [],
          trapPressure: null,
        }),
        null,
        plot.cropId,
      );

      scanSeq += 1;
      scans.push({
        id: `scan-${scanSeq}`,
        plotId: plot.id,
        farmId: plot.farmId,
        createdAt: daysAgoIso(daysBack, int(7, 17)),
        crop: plot.cropId,
        cropId: plot.cropId,
        variety: plot.variety,
        stage: plot.stage,
        symptoms,
        notes: `Seeded demonstration observation. Reported during a routine round of ${farms.find((f) => f.id === plot.farmId)?.name}.`,
        lat: plot.lat,
        lng: plot.lng,
        image: syntheticImage(condKind(kind), `${plot.name} — synthetic demo image`),
        result,
        submittedBy: farms.find((f) => f.id === plot.farmId)?.farmerName ?? 'Demo user',
        weatherSnapshot: weather,
      });
    }
  }

  scans.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  /* --------------------------------------------------------------- Traps */
  const traps: TrapObservation[] = [];
  let trapSeq = 0;
  for (const plot of plots) {
    const pestConds = conditionsForCrop(plot.cropId).filter((c) => c.isPest);
    if (!pestConds.length || rnd() < 0.35) continue;
    const cond = pick(pestConds);
    const trapType = cond.trapThreshold && cond.trapThreshold <= 12 ? TRAP_TYPES[0] : pick(TRAP_TYPES.slice(0, 4));
    const rounds = int(1, 3);
    for (let r = 0; r < rounds; r++) {
      trapSeq += 1;
      const thr = cond.trapThreshold ?? 25;
      const above = rnd() < 0.4;
      const count = above ? int(Math.ceil(thr * 1.05), Math.ceil(thr * 2.4)) : int(Math.max(1, Math.floor(thr * 0.15)), Math.max(2, Math.floor(thr * 0.9)));
      traps.push({
        id: `trap-${trapSeq}`,
        plotId: plot.id,
        date: daysAgoIso(int(1, 30), int(7, 11)),
        trapType,
        pestCategory: cond.isPest && cond.id === 'cotton_fusarium_wilt'
          ? PEST_CATEGORIES[1]
          : pick(PEST_CATEGORIES),
        count,
        cropStage: plot.stage,
        tempC: int(22, 36),
        humidity: int(38, 92),
        notes: 'Demonstration trap reading recorded by the field scout during the weekly round.',
        observer: farms.find((f) => f.id === plot.farmId)?.farmerName ?? 'Demo scout',
        thresholdAlert: above,
        cvCount: null,
      });
    }
  }
  traps.sort((a, b) => (a.date < b.date ? 1 : -1));

  /* --------------------------------------------------------------- Cases */
  const cases: ExpertCase[] = [];
  const followUps: FollowUp[] = [];
  const feedback: FeedbackRecord[] = [];
  let caseSeq = 0;

  const reviewable = scans.filter(
    (s) => s.result.referralRequired || s.result.severity === 'high' || s.result.severity === 'severe' || s.result.disposition === 'inconclusive',
  );
  const chosen = reviewable.slice(0, 9);

  for (const scan of chosen) {
    caseSeq += 1;
    const roll = rnd();
    const status: ExpertCase['status'] = roll < 0.34 ? 'pending' : roll < 0.6 ? 'under_review' : 'resolved';
    const validation: ExpertCase['validation'] =
      status !== 'resolved' ? 'not_yet' : rnd() < 0.62 ? 'confirmed' : 'corrected';
    const alternatives = conditionsForCrop(scan.cropId).filter((c) => c.id !== scan.result.conditionId && c.id !== 'healthy');
    const corrected = validation === 'corrected' ? pick(alternatives.length ? alternatives : conditionsForCrop(scan.cropId)) : null;
    const submittedDays = int(1, 40);
    const caseId = `case-${caseSeq}`;

    cases.push({
      id: caseId,
      scanId: scan.id,
      plotId: scan.plotId,
      submittedBy: scan.submittedBy,
      submittedAt: daysAgoIso(submittedDays, int(9, 15)),
      status,
      validation,
      predictedConditionId: scan.result.conditionId,
      confirmedConditionId: corrected ? corrected.id : validation === 'confirmed' ? scan.result.conditionId : null,
      reviewerName: status === 'pending' ? null : 'Dr. M. A. Kulkarni',
      reviewerRole: status === 'pending' ? null : 'KVK Plant Protection Specialist (simulated)',
      reviewerNotes:
        status === 'pending'
          ? ''
          : 'Reviewed the field image and the reported symptoms against the district package of practices. ' +
            (validation === 'corrected'
              ? 'The pattern is more consistent with the corrected diagnosis; please re-scout and re-photograph.'
              : 'Screening outcome matches the field pattern observed in this district.'),
      management:
        status === 'pending'
          ? ''
          : 'Follow the integrated advisory attached to this case; avoid any chemical application until the next scouting round confirms spread.',
      followUpInstruction:
        status === 'pending' ? '' : 'Record a follow-up observation within 5 days with a fresh photograph of the same plants.',
      resolvedAt: status === 'resolved' ? daysAgoIso(Math.max(0, submittedDays - 4), int(11, 17)) : null,
      simulated: true,
    });

    if (status === 'resolved') {
      const improved: SeverityAfter[] = ['low', 'moderate', 'healthy'];
      const sev = improved[int(0, 2)];
      followUps.push({
        id: `fu-${caseId}`,
        caseId,
        scanId: scan.id,
        plotId: scan.plotId,
        date: daysAgoIso(Math.max(1, submittedDays - 6), int(9, 16)),
        observation:
          'Re-visited the same rows. Affected plants marked earlier were removed; new lesions on the untreated rows look fewer than in the previous round.',
        severity: sev,
        trapCount: rnd() < 0.5 ? int(1, 14) : null,
        statusChange: 'Case moved to resolved after expert validation.',
        actionTaken: 'Removed and destroyed the worst affected leaves; opened the canopy; recorded fresh scouting counts.',
        recordedBy: farms.find((f) => f.id === scan.farmId)?.farmerName ?? 'Demo user',
      });

      feedback.push({
        id: `fb-${caseId}`,
        caseId,
        scanId: scan.id,
        recordedAt: daysAgoIso(Math.max(0, submittedDays - 4), int(12, 18)),
        predictedConditionId: scan.result.conditionId,
        confirmedConditionId: corrected ? corrected.id : scan.result.conditionId,
        agreement: validation === 'confirmed' ? 'agree' : 'disagree',
        imageOrigin: scan.image?.origin ?? 'none',
        cropId: scan.cropId,
        stage: scan.stage,
        validatedBy: 'Dr. M. A. Kulkarni',
        trainingEligible: validation === 'confirmed' || validation === 'corrected',
        note:
          validation === 'confirmed'
            ? 'Confirmed by an expert; usable as a labelled evaluation pair.'
            : 'Corrected by an expert; high-value labelled pair for future evaluation.',
      });
    }
  }

  /* ------------------------------------------------------- Notifications */
  const notifications: AppNotification[] = [];
  const trapAlerts = traps.filter((t) => t.thresholdAlert).slice(0, 3);
  trapAlerts.forEach((t, i) => {
    const plot = plots.find((p) => p.id === t.plotId);
    notifications.push({
      id: `ntf-trap-${i}`,
      kind: 'alert',
      title: 'Trap count above the demo threshold',
      body: `${plot?.name ?? 'Plot'}: ${t.count} caught (${t.pestCategory}). Demo threshold exceeded — review recommended.`,
      at: t.date,
      read: false,
      href: '/traps',
    });
  });
  const pendingCases = cases.filter((c) => c.status === 'pending').slice(0, 3);
  pendingCases.forEach((c, i) => {
    const plot = plots.find((p) => p.id === c.plotId);
    notifications.push({
      id: `ntf-case-${i}`,
      kind: 'review',
      title: 'Expert review pending',
      body: `${plot?.name ?? 'Plot'} case has been waiting for review since ${new Date(c.submittedAt).toDateString()}.`,
      at: c.submittedAt,
      read: false,
      href: '/expert',
    });
  });
  notifications.push({
    id: 'ntf-sys-1',
    kind: 'system',
    title: 'Demonstration dataset loaded',
    body: 'All records, coordinates, images and weather values in this workspace are clearly-labelled demonstration data.',
    at: daysAgoIso(0, 8),
    read: false,
    href: '/settings',
  });

  return {
    farms,
    plots,
    scans,
    traps,
    cases,
    followUps,
    feedback,
    notifications,
    settings: {
      // Marathi is the default farmer-facing language; English is the secondary
      // option. The store overrides this with any choice
      // the operator has already made.
      lang: 'mr',
      demoMode: true,
      weatherProvider: 'simulated',
      modelServiceUrl: DEFAULT_SERVICE_URL,
      riskWeights: opts.weights ?? { weather: 30, stage: 12, history: 20, traps: 14, neighbourhood: 10, soil: 6, management: 8 },
      currentUser: opts.currentUser ?? { name: 'Demo Officer', role: 'Agriculture Officer (demo)', initials: 'DO' },
    },
  };
}

type SeverityAfter = 'healthy' | 'low' | 'moderate';

export const SEED_CONDITION_CATEGORY = (id: string): ConditionCategory => getCondition(id)?.category ?? 'unknown';
