/* =========================================================================
   CropSentinel AI — Domain models
   Single source of truth for every module (screening, risk, traps, geo,
   advisories, expert validation, reporting). Dependency-free so the same
   shapes can be reused by a future FastAPI / PostgreSQL backend.
   ========================================================================= */

export type Lang = 'en' | 'mr';

export type CropStage = 'nursery' | 'vegetative' | 'flowering' | 'fruiting' | 'maturity';

export type RiskLevel = 'low' | 'medium' | 'high';

/** Severity of a screening outcome. `inconclusive` is a first-class result. */
export type Severity = 'healthy' | 'low' | 'moderate' | 'high' | 'severe' | 'inconclusive';

export type ConditionCategory = 'disease-fungal' | 'disease-bacterial' | 'disease-viral' | 'pest' | 'disorder' | 'healthy' | 'unknown';

export interface Farm {
  id: string;
  name: string;
  farmerName: string;
  contact: string;
  district: string;
  taluka: string;
  village: string;
  lat: number;
  lng: number;
  irrigation: 'rainfed' | 'canal' | 'well' | 'borewell' | 'drip';
  soilType: 'black-cotton' | 'red-lateritic' | 'alluvial' | 'sandy-loam' | 'clay-loam' | 'unknown';
  totalAreaHa: number;
  createdAt: string;
  notes?: string;
  /** Demonstration record flag — never presented as verified government data. */
  sample: boolean;
}

export interface Plot {
  id: string;
  farmId: string;
  name: string;
  areaHa: number;
  crop: string;
  cropId: string;
  variety: string;
  plantingDate: string;
  stage: CropStage;
  soilPh?: number;
  soilOrganicMatter?: number;
  drainage: 'good' | 'moderate' | 'poor' | 'unknown';
  lat: number;
  lng: number;
  notes?: string;
  sample: boolean;
}

/* ------------------------------------------------------------ Observations */

export interface SymptomOption {
  id: string;
  labelKey: string;
  /** Conditions this visual symptom is commonly associated with (rule knowledge base). */
  associatedConditions: string[];
}

export interface ScanImage {
  dataUrl: string;
  name: string;
  /** Where the image came from — field photo vs synthetic demo asset. */
  origin: 'uploaded' | 'synthetic-demo' | 'unavailable';
  width?: number;
  height?: number;
  bytes?: number;
}

export interface RiskFactorContribution {
  id: string;
  /** i18n key for the factor's subject (a condition name, a stage, …). */
  labelKey?: string;
  /** Literal label when the factor's subject is data rather than a key. */
  label?: string;
  direction: 'increase' | 'decrease';
  weight: number;
  /** Points contributed to the 0-100 score (signed). */
  points: number;
  detailKey: string;
  params?: Record<string, string | number>;
  source: 'weather' | 'crop' | 'soil' | 'history' | 'traps' | 'neighbourhood' | 'management';
}

export interface RiskAssessment {
  id: string;
  plotId: string;
  generatedAt: string;
  score: number;
  category: RiskLevel;
  factors: RiskFactorContribution[];
  missingInformation: string[];
  preventiveActions: string[];
  monitoringIntervalDays: number;
  /** Which engine produced this: heuristic rule engine, not a trained model. */
  engine: 'heuristic-rule-v1';
  weatherSource: string;
  weatherKind: 'observed' | 'forecast' | 'simulated';
}

/* ------------------------------------------------------- Image inference */

/**
 * How an image classification attempt ended.
 *
 * `ran` and `abstained` are the only outcomes backed by a genuine forward pass
 * of a trained model; everything else means no trained model produced this
 * scan, which the UI and every export state explicitly.
 */
export type ModelOutcome =
  | 'ran'
  | 'abstained'
  | 'unsupported-crop'
  | 'service-unavailable'
  | 'not-attempted'
  | 'error';

export interface ModelQualityCheck {
  name: string;
  ok: boolean;
  fatal: boolean;
  detail: string;
  measured?: string | number | null;
  threshold?: string | number | null;
  reasonCode?: string | null;
}

/** Structured, persisted record of what the image model did for one scan. */
export interface ModelInference {
  outcome: ModelOutcome;
  /** True only when a genuine trained model actually executed on this image. */
  isGenuineInference: boolean;
  cropId: string;
  modelId: string | null;
  modelRevision: string | null;
  architecture: string | null;
  license: string | null;
  licenseNote: string | null;
  sourceUrl: string | null;
  weightsSha256: string | null;
  /** Class order exactly as published; an index here is the model's index. */
  classNames: string[];
  /** Raw softmax outputs, index-aligned with `classNames`. */
  probabilities: number[];
  predictedClassName: string | null;
  /** The app's condition id for the predicted class, or null when unmapped. */
  predictedConditionId: string | null;
  /** Raw softmax score of the top class. NEVER a calibrated confidence. */
  probability: number | null;
  /** Permanently false: neither integrated model has been calibrated. */
  calibrated: false;
  runnerUpClassName: string | null;
  marginToRunnerUp: number | null;
  abstained: boolean;
  abstainReasons: string[];
  thresholds: { minConfidence: number; minMargin: number } | null;
  qualityPassed: boolean | null;
  qualityChecks: ModelQualityCheck[];
  preprocessing: string | null;
  latencyMs: number | null;
  requestId: string | null;
  /** Human-readable reason when the model did not run. */
  message: string | null;
}

/**
 * Which evidence the displayed disposition rests on. The scanner always keeps
 * the two evidence sources separable so a farmer is never shown a model claim
 * dressed up as agronomic reasoning, or the reverse.
 */
export type DispositionSource =
  | 'model+rule-agree'
  | 'model-only'
  | 'rule-only'
  | 'model-abstained'
  | 'model-rule-conflict'
  | 'no-model-for-crop';

export interface ScreeningResult {
  engineId: string;
  engineLabel: string;
  /**
   * true => no trained model produced this answer; the rule/knowledge-base
   * analyzer or an abstention did. Derived from `modelInference`, so it cannot
   * disagree with the model metadata stored beside it.
   */
  isDemonstration: boolean;
  conditionId: string;
  conditionLabelKey: string;
  category: ConditionCategory;
  healthy: boolean;
  /**
   * Calibrated confidence in the named condition, or null.
   *
   * This stays null even when a trained model runs, because neither integrated
   * model has been temperature-scaled or otherwise calibrated. The model's raw
   * softmax score is reported separately in `modelInference.probability` and is
   * labelled there as not calibrated.
   */
  confidence: number | null;
  /** What the image model did, with full provenance. null when no model ran. */
  modelInference: ModelInference | null;
  /** Which evidence the disposition above rests on. */
  dispositionSource: DispositionSource;
  /**
   * The rule/knowledge-base assessment, computed for every scan so the two
   * evidence sources can be compared (and so a model-led result still carries
   * the agronomic reasoning beside it rather than replacing it).
   */
  ruleAssessment: {
    conditionId: string;
    conditionLabelKey: string;
    disposition: ScreeningResult['disposition'];
    severity: Severity;
    isPest: boolean;
    evidenceStrength: number;
  } | null;
  /** Heuristic strength of the visible symptom evidence, 0-1. Always present. */
  evidenceStrength: number;
  disposition: 'healthy' | 'suspected-disease' | 'suspected-pest' | 'inconclusive';
  severity: Severity;
  /* All human-readable text is stored as i18n keys so the result renders in
     English or Marathi and survives a language switch. */
  evidence: { labelKey: string; detailKey: string; params?: Record<string, string | number> }[];
  contributingFactors: { key: string; params?: Record<string, string | number> }[];
  nextSteps: string[];
  monitoringKey: string;
  referralRequired: boolean;
  uncertaintyKey: string;
  /** Ranked alternatives from the knowledge base (transparent, not a softmax). */
  topMatches: { conditionId: string; labelKey: string; score: number }[];
  /** Engine-level documentation of exactly which logic executed (English). */
  methodology: string;
  /** Every weight used by the analyzer, surfaced for auditability. */
  weightsUsed: Record<string, number>;
}

export interface Scan {
  id: string;
  plotId: string;
  farmId: string;
  createdAt: string;
  crop: string;
  cropId: string;
  variety: string;
  stage: CropStage;
  symptoms: string[];
  notes: string;
  lat: number;
  lng: number;
  image: ScanImage | null;
  result: ScreeningResult;
  /** Operator who submitted the scan. */
  submittedBy: string;
  weatherSnapshot?: WeatherSnapshot;
}

/* ------------------------------------------------------------------ Weather */

export interface DailyWeather {
  date: string;
  tMax: number;
  tMin: number;
  rhMean: number;
  rainMm: number;
  /** Observed (past), forecast (future) or simulated (no provider configured). */
  kind: 'observed' | 'forecast' | 'simulated';
  source: string;
}

export interface WeatherSnapshot {
  lat: number;
  lng: number;
  fetchedAt: string;
  providerId: string;
  providerLabel: string;
  isSimulated: boolean;
  days: DailyWeather[];
}

/* ------------------------------------------------------- Pest trap / sensor */

export interface TrapObservation {
  id: string;
  plotId: string;
  date: string;
  trapType: string;
  pestCategory: string;
  count: number;
  cropStage: CropStage;
  tempC?: number;
  humidity?: number;
  notes: string;
  observer: string;
  /** Auto-derived flag: count crossed the illustrative demo threshold. */
  thresholdAlert: boolean;
  /** Optional computer-vision count, when a future model is wired in. */
  cvCount?: number | null;
}

/* -------------------------------------------------------- Expert validation */

export type CaseStatus = 'pending' | 'under_review' | 'resolved';
export type CaseValidation = 'not_yet' | 'confirmed' | 'corrected';

export interface ExpertCase {
  id: string;
  scanId: string;
  plotId: string;
  submittedBy: string;
  submittedAt: string;
  status: CaseStatus;
  validation: CaseValidation;
  /** What the screening engine originally said (immutable link for learning). */
  predictedConditionId: string;
  /** What the expert confirmed, when corrected. */
  confirmedConditionId: string | null;
  reviewerName: string | null;
  reviewerRole: string | null;
  reviewerNotes: string;
  management: string;
  followUpInstruction: string;
  resolvedAt: string | null;
  /** True when the workflow is demonstration only (no live expert service). */
  simulated: boolean;
}

/** Append-only training/evaluation row. Only expert-confirmed rows are usable. */
export interface FeedbackRecord {
  id: string;
  caseId: string;
  scanId: string;
  recordedAt: string;
  predictedConditionId: string;
  confirmedConditionId: string;
  agreement: 'agree' | 'disagree' | 'unresolved';
  imageOrigin: ScanImage['origin'] | 'none';
  cropId: string;
  stage: CropStage;
  validatedBy: string;
  /** Whether this row is eligible for future supervised retraining. */
  trainingEligible: boolean;
  note: string;
}

/* ------------------------------------------------------------- Follow-ups */

export interface FollowUp {
  id: string;
  /** Links back to the screening case so the monitoring cycle is visible. */
  caseId: string | null;
  scanId: string;
  plotId: string;
  date: string;
  observation: string;
  severity: Severity;
  /** Traps / field reads recorded during this visit. */
  trapCount?: number | null;
  statusChange: string;
  actionTaken: string;
  recordedBy: string;
}

/* ------------------------------------------------------------ Notifications */

export interface AppNotification {
  id: string;
  kind: 'alert' | 'followup' | 'review' | 'system';
  title: string;
  body: string;
  at: string;
  read: boolean;
  href?: string;
}

/* ------------------------------------------------------------ App settings */

export interface AppSettings {
  lang: Lang;
  demoMode: boolean;
  weatherProvider: 'simulated' | 'open-meteo';
  /** Base URL of the local inference service that executes the trained models. */
  modelServiceUrl: string;
  /** User-tunable weights for the transparent risk engine. */
  riskWeights: RiskWeights;
  currentUser: { name: string; role: string; initials: string };
}

export interface RiskWeights {
  weather: number;
  stage: number;
  history: number;
  traps: number;
  neighbourhood: number;
  soil: number;
  management: number;
}

/* ------------------------------------------------------------ Aggregate  */

export interface AppData {
  farms: Farm[];
  plots: Plot[];
  scans: Scan[];
  traps: TrapObservation[];
  cases: ExpertCase[];
  followUps: FollowUp[];
  feedback: FeedbackRecord[];
  notifications: AppNotification[];
  settings: AppSettings;
}

/** Everything the UI shows is derived; nothing is hard-coded per screen. */
export interface PlotContext {
  plot: Plot;
  farm: Farm;
  scans: Scan[];
  traps: TrapObservation[];
  cases: ExpertCase[];
  followUps: FollowUp[];
}
