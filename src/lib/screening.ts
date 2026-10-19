/* =========================================================================
   CropSentinel AI — Crop health screening engines

   ARCHITECTURE
   ------------
   `ScreeningModelAdapter` is the seam between the UI and whatever produces an
   assessment. Three adapters are registered:

   1. cropModelServiceAdapter — GENUINE TRAINED MODELS. Calls the local Python
                                inference service, which executes the published
                                cotton and soybean checkpoints. See
                                services/inference/README.md.
   2. trainedCnnAdapter       — PRESENT BUT NOT INSTALLED. The browser-export
                                alternative: a MobileNetV3/TFLite or ONNX export
                                dropped into /public/models with a registered
                                runtime. Unchanged, still inactive.
   3. demoRuleAdapter         — ALWAYS AVAILABLE. The transparent rule /
                                knowledge base analyzer that backs the symptom
                                workflow, the risk engine and the advisories.

   `runScreening()` computes the rule assessment for every scan and, when the
   crop has a validated model and the service answers, merges the genuine image
   inference with it. The merge rules (and why they are conservative) live in
   `lib/modelScreening.ts`.

   No engine in this file ever fabricates a confidence score, and no result
   claims a calibrated probability. Both integrated models are uncalibrated.
   ========================================================================= */

import type { ConditionDef } from '../domain/knowledge';
import { CONDITIONS, conditionsForCrop, getCondition, getCrop, getSymptom } from '../domain/knowledge';
import type { ConditionCategory, CropStage, ScanImage, ScreeningResult, Severity } from '../domain/types';
import { attemptModelInference, combineWithModel } from './modelScreening';
import { checkHealth, normaliseServiceUrl } from './inferenceClient';

export type { ConditionDef };

export interface WeatherSummary {
  rhMean: number;
  tMean: number;
  rainMm: number;
  kind: 'observed' | 'forecast' | 'simulated';
  label: string;
}

export interface ScreeningInput {
  image: ScanImage | null;
  cropId: string;
  cropLabel: string;
  stage: CropStage | '';
  symptoms: string[];
  notes?: string;
  weather?: WeatherSummary | null;
  /**
   * Base URL of the local inference service. When present and the crop has a
   * validated model, a genuine forward pass runs and is merged with the rule
   * assessment by `combineWithModel`.
   */
  modelServiceUrl?: string;
  /** Recent plot context, used as transparent supporting evidence. */
  plotHistory?: { conditionId: string; severity: Severity; daysAgo: number }[];
  trapPressure?: { pest: string; count: number; threshold: number; daysAgo: number } | null;
  /** Set only for built-in demonstration sample cases. */
  demoDeclaration?: string | null;
}

export interface ScreeningModelAdapter {
  id: string;
  label: string;
  kind: 'demonstration' | 'trained-model';
  /** Honest statement of what this adapter is. */
  describes: string;
  /** Whether this adapter can actually run right now. */
  isAvailable(): Promise<boolean>;
  analyze(input: ScreeningInput): Promise<ScreeningResult>;
}

/* ----------------------------------------------------------- Demo analyzer */

/** Symptoms that indicate damage has already gone beyond early stages. */
const SEVERE_DAMAGE_MARKERS = [
  'wilting', 'dead_heart', 'larva_in_fruit', 'bore_hole_fruit', 'frass_sawdust',
  'mosaic_mottle', 'white_downy_growth', 'yellow_halo',
];

export const DEMO_WEIGHTS = {
  symptom: 0.42,
  weather: 0.2,
  stage: 0.12,
  host: 0.14,
  context: 0.07,
  demoPrior: 0.05,
} as const;

function weatherFavour(cond: ConditionDef, w: WeatherSummary | null | undefined): number | null {
  if (!w) return null;
  if (cond.id === 'healthy' || cond.category === 'disorder') return 0.5;
  const f = cond.favourable;
  const tIn = w.tMean >= f.tMin && w.tMean <= f.tMax;
  const rhIn = w.rhMean >= f.rhMin;
  const rainIn = cond.isPest ? true : w.rainMm >= f.rainMmMin;
  if (cond.isPest) {
    // Pests generally build up in warmer, drier spells: reward a dry spell.
    const dry = w.rainMm < 12 ? 1 : 0.3;
    return Math.min(1, (tIn ? 0.45 : 0.12) + (rhIn ? 0.15 : 0.05) + dry * 0.4);
  }
  return Math.min(1, (tIn ? 0.45 : 0.05) + (rhIn ? 0.35 : 0.05) + (rainIn ? 0.2 : 0.05));
}

function symptomScore(cond: ConditionDef, selected: string[]): number {
  if (cond.id === 'healthy') {
    if (selected.length === 0) return 1;
    if (selected.length === 1 && selected[0] === 'no_visible_symptom') return 1;
    return 0;
  }
  if (selected.length === 0) return 0;
  const matched = selected.filter((s) => cond.symptoms.includes(s)).length;
  if (matched === 0) return 0;
  // Recall against the condition's own signature, tempered by precision
  // against what the operator reported.
  const recall = matched / cond.symptoms.length;
  const precision = matched / selected.length;
  return Math.min(1, 0.5 * recall + 0.5 * precision + (matched >= 2 ? 0.12 : 0));
}

function stageScore(cond: ConditionDef, cropId: string, stage: CropStage | ''): number | null {
  if (stage === '') return null;
  if (cond.id === 'healthy' || cond.category === 'disorder') return 0.5;
  return getCrop(cropId).stageSusceptibility[stage] ?? 0.6;
}

function hostScore(cond: ConditionDef, cropId: string): number {
  if (cond.hosts.length === 0) return 0.75; // crop-agnostic condition
  return cond.hosts.includes(cropId) ? 1 : 0.05;
}

function contextScore(cond: ConditionDef, input: ScreeningInput): number {
  let s = 0;
  const history = input.plotHistory ?? [];
  const related = history.filter((h) => h.conditionId === cond.id || sameGroup(h.conditionId, cond));
  if (related.length) s += Math.min(0.6, related.length * 0.25);
  if (input.trapPressure && cond.isPest && input.trapPressure.count >= input.trapPressure.threshold) s += 0.4;
  return Math.min(1, s);
}

function sameGroup(otherId: string, cond: ConditionDef): boolean {
  const other = getCondition(otherId);
  if (!other) return false;
  if (cond.isPest) return other.isPest;
  return other.category === cond.category;
}

async function analyzeWithRules(input: ScreeningInput): Promise<ScreeningResult> {
  const stage = input.stage;
  const candidates: ConditionDef[] = [...conditionsForCrop(input.cropId)];
  if (input.symptoms.some((s) => s === 'interveinal_chlorosis' || s === 'uniform_pale_leaf' || s === 'leaf_tip_dry')) {
    // nutrient_deficiency no longer supported; skip adding it
  }

  const w = input.weather ?? null;

  const scored = candidates.map((cond) => {
    const sym = symptomScore(cond, input.symptoms);
    const wf = weatherFavour(cond, w);
    const st = stageScore(cond, input.cropId, stage);
    const ho = input.cropId ? hostScore(cond, input.cropId) : 0.75;
    const cx = contextScore(cond, input);
    const prior = input.demoDeclaration === cond.id ? 1 : 0;

    const parts = {
      symptom: sym,
      weather: wf ?? 0.5,
      stage: st ?? 0.5,
      host: ho,
      context: cx,
      demoPrior: prior,
    };
    const raw =
      sym * DEMO_WEIGHTS.symptom +
      parts.weather * DEMO_WEIGHTS.weather +
      parts.stage * DEMO_WEIGHTS.stage +
      parts.host * DEMO_WEIGHTS.host +
      cx * DEMO_WEIGHTS.context +
      prior * DEMO_WEIGHTS.demoPrior;

    return { cond, raw, parts, sym, wf, st, ho, cx };
  });

  scored.sort((a, b) => b.raw - a.raw);
  const total = scored.reduce((acc, s) => acc + s.raw, 0) || 1;
  const top = scored[0];
  const second = scored[1];
  const share = (v: number) => Math.round((v / total) * 1000) / 10;

  /* ---- Evidence strength: an honest heuristic transparency metric, 0-1 ---- */
  const imageSignal = input.image ? (input.image.origin === 'synthetic-demo' ? 0.25 : 0.35) : 0;
  const noSymptomsReported = input.symptoms.length === 0;
  // An affirmative "I looked and saw nothing" is positive evidence; an empty
  // symptom list is an absence of evidence and must not be scored as if it were
  // evidence of health.
  const affirmativeHealthy = input.symptoms.includes('no_visible_symptom');
  const contextCompleteness =
    (stage ? 0.4 : 0) + (input.weather ? 0.2 : 0) + (input.symptoms.length >= 2 ? 0.4 : input.symptoms.length === 1 ? 0.2 : 0);
  let evidenceStrength = Math.round((top.sym * 0.5 + imageSignal + contextCompleteness * 0.3) * 100) / 100;
  if (noSymptomsReported) evidenceStrength = Math.min(evidenceStrength, 0.3);
  // A negative finding is weaker evidence than an observed lesion.
  if (top.cond.id === 'healthy') evidenceStrength = Math.min(evidenceStrength, 0.6);

  const gapPoints = share(top.raw) - share(second?.raw ?? 0);

  /* ------------------------------- Disposition --------------------------- */
  const healthyTop = top.cond.id === 'healthy';
  let disposition: ScreeningResult['disposition'];
  if (evidenceStrength < 0.42 || (!healthyTop && gapPoints < 6)) {
    disposition = 'inconclusive';
  } else if (healthyTop && !affirmativeHealthy) {
    // Nothing was found because nothing was reported — the correct answer here
    // is "I cannot tell", never a reassuring "healthy".
    disposition = 'inconclusive';
  } else if (healthyTop) {
    disposition = 'healthy';
  } else if (top.cond.isPest) {
    disposition = 'suspected-pest';
  } else {
    disposition = 'suspected-disease';
  }

  /* --------------------------------- Severity ---------------------------- */
  // Severity reflects the reported symptom burden (how many, and whether any of
  // them indicate advanced damage). It is NOT a measured damage extent, because
  // this prototype has no area/incidence measurement input.
  const severeMarkers = input.symptoms.filter((s) => SEVERE_DAMAGE_MARKERS.includes(s)).length;
  let severity: Severity;
  if (disposition === 'inconclusive') {
    severity = 'inconclusive';
  } else if (disposition === 'healthy') {
    severity = 'healthy';
  } else if (severeMarkers >= 2 || input.symptoms.includes('wilting') || input.symptoms.includes('dead_heart')) {
    severity = 'severe';
  } else if (severeMarkers >= 1 || input.symptoms.length >= 3) {
    severity = 'high';
  } else if (input.symptoms.length === 2) {
    severity = 'moderate';
  } else {
    severity = 'low';
  }

  /* ------------------------------ Evidence list -------------------------- */
  const matchedSymptoms = input.symptoms.filter((s) => top.cond.symptoms.includes(s));
  const evidence: ScreeningResult['evidence'] = [
    {
      labelKey: 'ev.symptoms',
      detailKey: matchedSymptoms.length ? 'scf.symptomMatch' : 'scf.noSymptomMatch',
      params: { n: matchedSymptoms.length, total: input.symptoms.length, condition: top.cond.labelKey },
    },
    {
      labelKey: 'ev.image',
      detailKey: input.image
        ? input.image.origin === 'synthetic-demo'
          ? 'scf.imageSynthetic'
          : 'scf.imagePresent'
        : 'scf.imageAbsent',
    },
    {
      labelKey: 'ev.weather',
      detailKey: w ? (top.wf && top.wf > 0.5 ? 'scf.weatherIn' : 'scf.weatherOut') : 'scf.weatherUnknown',
      params: w ? { rh: Math.round(w.rhMean), t: Math.round(w.tMean) } : undefined,
    },
    {
      labelKey: 'ev.crop',
      detailKey: top.ho > 0.5 ? 'scf.hostYes' : 'scf.hostNo',
      params: { crop: input.cropLabel },
    },
    {
      labelKey: 'ev.stage',
      detailKey: top.st ? 'scf.stageSus' : 'scf.stageMissing',
      params: { stage: stage ? `stage.${stage}` : '', sus: (top.st ?? 0).toFixed(2) },
    },
    {
      labelKey: 'ev.history',
      detailKey: (input.plotHistory?.length ?? 0) ? 'scf.historyCases' : 'scf.historyNone',
      params: { n: input.plotHistory?.length ?? 0 },
    },
    {
      labelKey: 'ev.margin',
      detailKey: gapPoints < 6 ? 'scf.marginLow' : 'scf.marginOk',
      params: { gap: gapPoints.toFixed(1) },
    },
  ];

  /* --------------------------- Contributing factors ---------------------- */
  const contributingFactors: ScreeningResult['contributingFactors'] = [];
  if (w) {
    if (w.rhMean >= 80 && !top.cond.isPest) contributingFactors.push({ key: 'scf.contribHumid', params: { rh: Math.round(w.rhMean) } });
    if (w.rainMm < 8 && top.cond.isPest) contributingFactors.push({ key: 'scf.contribDry', params: { mm: Math.round(w.rainMm) } });
    if (w.kind === 'simulated') contributingFactors.push({ key: 'scf.contribSimWeather' });
  } else {
    contributingFactors.push({ key: 'scf.contribSimWeather' });
  }
  if (top.cond.isPest) contributingFactors.push({ key: 'scf.contribTrapPressure' });
  if (top.st && top.st >= 0.85) contributingFactors.push({ key: 'scf.contribStageFav' });
  if (input.plotHistory?.length) contributingFactors.push({ key: 'scf.contribHistory', params: { n: input.plotHistory.length } });
  if (!input.image) contributingFactors.push({ key: 'scf.contribNoImage' });
  if (input.image?.origin === 'synthetic-demo') contributingFactors.push({ key: 'scf.contribSynthetic' });
  if (input.symptoms.length === 0) contributingFactors.push({ key: 'scf.contribNoSymptoms' });

  /* ------------------------------- Next steps ---------------------------- */
  const nextSteps: string[] = [];
  if (disposition === 'inconclusive') {
    nextSteps.push('step.secondImage', 'step.expert', 'step.noChemical');
  } else if (disposition === 'healthy') {
    nextSteps.push('step.routine', 'step.monitor7');
  } else {
    nextSteps.push('step.separate');
    if (top.cond.isPest) nextSteps.push('step.trapCheck', 'step.debris');
    else nextSteps.push('step.remove', 'step.sanitation');
    if (severity === 'high' || severity === 'severe' || top.cond.category === 'disease-bacterial' || top.cond.category === 'disease-viral') {
      nextSteps.push('step.expert');
    }
    nextSteps.push(severity === 'high' || severity === 'severe' ? 'step.monitor3' : 'step.monitor7');
    if (top.cond.category === 'disease-bacterial') nextSteps.push('step.waterManage');
  }

  const referralRequired =
    disposition === 'inconclusive' ||
    severity === 'high' ||
    severity === 'severe' ||
    top.cond.category === 'disease-bacterial' ||
    top.cond.category === 'disease-viral' ||
    (!healthyTop && gapPoints < 10);

  const monitoringKey =
    disposition === 'inconclusive' ? 'mon.monitor3' : disposition === 'healthy' ? 'mon.monitor14' : severity === 'low' || severity === 'moderate' ? 'mon.monitor5' : 'mon.monitor3';

  const uncertaintyKey =
    disposition === 'inconclusive'
      ? noSymptomsReported
        ? 'unc.noInput'
        : gapPoints < 6
          ? 'unc.close'
          : 'unc.lowEvidence'
      : disposition === 'healthy'
        ? 'unc.healthy'
        : referralRequired
          ? 'unc.referralSeverity'
          : 'unc.strong';

  const methodology =
    'Transparent rule/knowledge-base analyzer (engine: demo-rule-base-v1). ' +
    `Weighted score = symptom match ${DEMO_WEIGHTS.symptom} + weather-favourability ${DEMO_WEIGHTS.weather} + stage susceptibility ${DEMO_WEIGHTS.stage} + host match ${DEMO_WEIGHTS.host} + plot context ${DEMO_WEIGHTS.context}` +
    (input.demoDeclaration ? ` + demonstration-sample prior ${DEMO_WEIGHTS.demoPrior}` : '') +
    '. Candidate conditions are restricted to the selected crop plus crop-agnostic conditions. ' +
    'No trained neural network ran, no pixel-level inference was performed and no probability is reported. ' +
    'Weather-favourability windows are generic agronomic associations, not validated epidemiological coefficients. ' +
    'Severity is derived from the number and type of reported symptoms, not from measured crop damage extent, ' +
    'so treat it as a triage signal rather than a field-measured severity.';

  return {
    engineId: 'demo-rule-base-v1',
    engineLabel: 'Demonstration analyzer — rule & knowledge based (NOT a trained model)',
    isDemonstration: true,
    // Filled in by combineWithModel(): the rule engine on its own has no model
    // output to report, and it never claims one.
    modelInference: null,
    dispositionSource: 'rule-only',
    ruleAssessment: null,
    conditionId: top.cond.id,
    conditionLabelKey: top.cond.labelKey,
    category: top.cond.category,
    healthy: disposition === 'healthy',
    confidence: null,
    evidenceStrength,
    disposition,
    severity,
    evidence,
    contributingFactors,
    nextSteps,
    monitoringKey,
    referralRequired,
    uncertaintyKey,
    topMatches: scored.slice(0, 5).map((s) => ({
      conditionId: s.cond.id,
      labelKey: s.cond.labelKey,
      score: share(s.raw),
    })),
    methodology,
    weightsUsed: { ...DEMO_WEIGHTS },
  };
}

export const demoRuleAdapter: ScreeningModelAdapter = {
  id: 'demo-rule-base-v1',
  label: 'Demonstration analyzer (rule & knowledge base)',
  kind: 'demonstration',
  describes:
    'Reproducible weighted rule engine over the agronomic knowledge base. Reports no confidence score and states its limitations on every result.',
  async isAvailable() {
    return true;
  },
  analyze: analyzeWithRules,
};

/* ------------------------------------------- Local inference service adapter */

/**
 * Adapter for the local Python inference service that runs the published
 * checkpoints. `isAvailable()` answers "could this adapter serve any crop?" —
 * the per-crop decision is made in `modelScreening.attemptModelInference`, which
 * refuses a crop with no registered model rather than borrowing another one.
 */
export const cropModelServiceAdapter: ScreeningModelAdapter & { probeService: typeof checkHealth } = {
  id: 'crop-model-service-v1',
  label: 'Local inference service (trained cotton + soybean classifiers)',
  kind: 'trained-model',
  describes:
    'Executes the published FarmGuard cotton DenseNet-121 and ixrbhii soybean ConvNeXt-Small checkpoints in a local Python service, verified by SHA-256 and loaded with a strict class-count match. Available only while that service is running.',
  probeService: checkHealth,
  async isAvailable() {
    const url = currentServiceUrl();
    if (!url) return false;
    const health = await checkHealth(url);
    return health.ok && health.data.anyModelAvailable;
  },
  async analyze() {
    throw new Error(
      'The inference-service adapter is driven by runScreening() so that a genuine model result can be ' +
      'merged with the rule assessment; call runScreening() instead of this adapter directly.',
    );
  },
};

/**
 * The service URL is configuration, so it is read from the persisted settings
 * store. Imported lazily to keep this module free of a store cycle.
 */
function currentServiceUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return normaliseServiceUrl(getServiceUrlFromStore());
  } catch {
    return '';
  }
}

let serviceUrlResolver: (() => string) | null = null;

/** Registered once by the store module so availability checks can see settings. */
export function registerServiceUrlResolver(resolver: () => string): void {
  serviceUrlResolver = resolver;
}

function getServiceUrlFromStore(): string {
  return serviceUrlResolver ? serviceUrlResolver() : '';
}

/* -------------------------------------------------- Trained model adapter */

/**
 * Integration point for a genuine trained classifier.
 *
 * Expected drop-in: /public/models/crop_disease_mobilenetv3.tflite together
 * with @tensorflow/tfjs-tflite (or an ONNX Runtime Web export). Until a real,
 * validated model file is present AND tested, `isAvailable()` returns false and
 * the demonstration analyzer stays active — the UI never claims otherwise.
 */
export const TRAINED_MODEL_PATH = '/models/crop_disease_mobilenetv3.tflite';
export const TRAINED_MODEL_LABELS = '/models/labels.json';

export const trainedCnnAdapter: ScreeningModelAdapter = {
  id: 'trained-cnn-v1',
  label: 'Browser-export adapter (MobileNetV3 / TFLite or ONNX in /public/models)',
  kind: 'trained-model',
  describes:
    'Not installed, and not required: the cotton and soybean models run through the local inference service instead. This adapter remains the seam for a browser-loadable export — register an inference runtime on window.__cropSentinelModelLoader and deploy the model file plus its label map. Until both exist it reports itself unavailable.',
  async isAvailable() {
    if (typeof window === 'undefined') return false;

    // A model file alone is not enough — an inference runtime must also be
    // registered, otherwise there is nothing that can execute the model.
    const loader = (window as unknown as { __cropSentinelModelLoader?: unknown }).__cropSentinelModelLoader;
    if (!loader) return false;

    try {
      const [model, labels] = await Promise.all([
        fetch(TRAINED_MODEL_PATH, { method: 'HEAD' }),
        fetch(TRAINED_MODEL_LABELS, { method: 'HEAD' }),
      ]);
      if (!model.ok || !labels.ok) return false;
      // Guard against an SPA dev-server fallback answering 200 with index.html.
      const contentType = model.headers.get('content-type') ?? '';
      const length = Number(model.headers.get('content-length') ?? '0');
      if (contentType.includes('text/html') || contentType.includes('application/json')) return false;
      if (length > 0 && length < 4096) return false;
      return true;
    } catch {
      return false;
    }
  },
  async analyze() {
    throw new Error(
      'Trained CNN adapter is not installed. Deploy a validated model export to ' +
        TRAINED_MODEL_PATH +
        ' and register the runtime before calling this adapter.',
    );
  },
};

const ADAPTERS: ScreeningModelAdapter[] = [cropModelServiceAdapter, trainedCnnAdapter, demoRuleAdapter];

/**
 * One screening pass.
 *
 * Order matters: the rule assessment is always computed (it is the agronomic
 * reasoning, the advisory link and the risk input), and the genuine image model
 * is attempted afterwards. `combineWithModel` decides which one the displayed
 * disposition rests on and records that decision in `dispositionSource`.
 */
export async function runScreening(input: ScreeningInput): Promise<ScreeningResult> {
  const ruleResult = await analyzeWithRules(input);
  const model = await attemptModelInference(input);
  return combineWithModel(ruleResult, model, input.cropId);
}

export async function adapterStatus(): Promise<
  { id: string; label: string; kind: string; available: boolean; describes: string }[]
> {
  return Promise.all(
    ADAPTERS.map(async (a) => ({
      id: a.id,
      label: a.label,
      kind: a.kind,
      available: await a.isAvailable(),
      describes: a.describes,
    })),
  );
}

/**
 * Which engine produced a stored result, in one word, for tables and exports.
 * Derived from the stored model metadata so it cannot contradict it.
 */
export function engineKindOf(r: ScreeningResult): 'trained-model' | 'rule-based' {
  return r.modelInference?.isGenuineInference && !r.modelInference.abstained && !r.isDemonstration
    ? 'trained-model'
    : 'rule-based';
}

/* ---------------------------------------------------------------- Helpers */

export function conditionLabelKeyOf(id: string): string {
  return getCondition(id)?.labelKey ?? 'cond.healthy';
}

/**
 * What to show as the subject of a result. When the analyzer could not name a
 * condition, the top match is often the "healthy" pseudo-condition — showing
 * that as the answer would read as false reassurance, so the inconclusive
 * disposition is displayed instead.
 */
export function resultLabelKey(r: Pick<ScreeningResult, 'disposition' | 'conditionLabelKey'>): string {
  return r.disposition === 'inconclusive' && r.conditionLabelKey === 'cond.healthy'
    ? 'disposition.inconclusive'
    : r.conditionLabelKey;
}

export function conditionCategoryOf(id: string): ConditionCategory {
  return getCondition(id)?.category ?? 'unknown';
}

export function symptomLabelKey(id: string): string {
  return getSymptom(id)?.labelKey ?? id;
}

export const ALL_CONDITIONS = CONDITIONS;
