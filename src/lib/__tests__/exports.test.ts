/* =========================================================================
   Export tests.

   The CSV is the artifact a reviewer reads without the UI, so the two ways it
   could mislead are locked down here: a trained model that did not run must not
   be reported as if it had, and no column named `confidence` may ever carry a
   number while the models are uncalibrated.
   ========================================================================= */

import { describe, expect, it } from 'vitest';

import { screeningCsvHeader, screeningCsvRows, toCsv } from '../exports';
import type { Farm, ModelInference, Plot, Scan, ScreeningResult } from '../../domain/types';

const farm = { id: 'farm-1', name: 'Vidarbha Cotton Estate', district: 'Yavatmal' } as Farm;
const plot = { id: 'plot-1', name: 'Cotton field 1' } as Plot;

function model(overrides: Partial<ModelInference> = {}): ModelInference {
  return {
    outcome: 'ran',
    isGenuineInference: true,
    cropId: 'cotton',
    modelId: 'FarmGuard/cotton-densenet121',
    modelRevision: '22f8684282bd81ae4d9803b43c71e6f09a7bb7fc',
    architecture: 'DenseNet-121',
    license: 'MIT',
    licenseNote: null,
    sourceUrl: null,
    weightsSha256: 'dfb01012',
    classNames: ['bacterial blight', 'curl virus', 'fussarium wilt', 'healthy'],
    probabilities: [0.9, 0.02, 0.02, 0.06],
    predictedClassName: 'bacterial blight',
    predictedConditionId: 'cotton_bacterial_blight',
    probability: 0.9,
    calibrated: false,
    runnerUpClassName: 'healthy',
    marginToRunnerUp: 0.84,
    abstained: false,
    abstainReasons: [],
    thresholds: { minConfidence: 0.6, minMargin: 0.2 },
    qualityPassed: true,
    qualityChecks: [],
    preprocessing: 'Resize(256) -> CenterCrop(224)',
    latencyMs: 88,
    requestId: 'req-1',
    message: null,
    ...overrides,
  };
}

function result(overrides: Partial<ScreeningResult> = {}): ScreeningResult {
  return {
    engineId: 'FarmGuard/cotton-densenet121@22f8684',
    engineLabel: 'Trained image classifier',
    isDemonstration: false,
    conditionId: 'cotton_bacterial_blight',
    conditionLabelKey: 'cond.cotton_bacterial_blight',
    category: 'disease-bacterial',
    healthy: false,
    confidence: null,
    modelInference: model(),
    dispositionSource: 'model+rule-agree',
    ruleAssessment: null,
    evidenceStrength: 0.86,
    disposition: 'suspected-disease',
    severity: 'low',
    evidence: [],
    contributingFactors: [],
    nextSteps: [],
    monitoringKey: 'mon.monitor5',
    referralRequired: false,
    uncertaintyKey: 'unc.modelAgrees',
    topMatches: [],
    methodology: '',
    weightsUsed: {},
    ...overrides,
  };
}

function scan(overrides: Partial<Scan> = {}): Scan {
  return {
    id: 'scan-1',
    plotId: 'plot-1',
    farmId: 'farm-1',
    createdAt: '2026-10-16T05:00:00.000Z',
    crop: 'cotton',
    cropId: 'cotton',
    variety: 'Abhinav',
    stage: 'vegetative',
    symptoms: ['angular_leaf_spot'],
    notes: '',
    lat: 20.39,
    lng: 78.13,
    image: null,
    result: result(),
    submittedBy: 'Demo Officer',
    ...overrides,
  };
}

describe('screening CSV', () => {
  it('carries no column named confidence that can hold a value', () => {
    const { rows } = { rows: screeningCsvRows([scan()], [plot], [farm]) };
    const index = screeningCsvHeader().indexOf('confidence');
    expect(index).toBeGreaterThan(-1);
    // confidence is always empty because no integrated model is calibrated
    expect(rows[0][index]).toBe('');
  });

  it('reports model provenance separately from the confidence column', () => {
    const rows = screeningCsvRows([scan()], [plot], [farm]);
    const header = screeningCsvHeader();
    const cell = (name: string) => rows[0][header.indexOf(name)];

    expect(cell('is_demonstration')).toBe('no');
    expect(cell('disposition_source')).toBe('model+rule-agree');
    expect(cell('image_model_outcome')).toBe('ran');
    expect(cell('image_model_id')).toBe('FarmGuard/cotton-densenet121');
    expect(cell('image_model_class')).toBe('bacterial blight');
    expect(cell('image_model_raw_score')).toBe(0.9);
    expect(cell('image_model_calibrated')).toBe('false');
    expect(cell('image_model_abstained')).toBe('no');
  });

  it('marks a scan with no model at all instead of claiming one ran', () => {
    const rows = screeningCsvRows(
      [scan({ result: result({ isDemonstration: true, modelInference: model({ outcome: 'unsupported-crop', isGenuineInference: false, modelId: null, predictedClassName: null, probability: null, abstained: false }) }) })],
      [plot],
      [farm],
    );
    const header = screeningCsvHeader();
    const cell = (name: string) => rows[0][header.indexOf(name)];

    expect(cell('is_demonstration')).toBe('yes');
    expect(cell('image_model_outcome')).toBe('unsupported-crop');
    expect(cell('image_model_id')).toBe('');
    expect(cell('image_model_class')).toBe('');
    expect(cell('image_model_raw_score')).toBe('');
  });

  it('records an abstention as an abstention, with no named class', () => {
    const rows = screeningCsvRows(
      [scan({ result: result({ disposition: 'inconclusive', referralRequired: true, modelInference: model({ abstained: true, abstainReasons: ['image-blurry'], outcome: 'abstained' }) }) })],
      [plot],
      [farm],
    );
    const header = screeningCsvHeader();
    const cell = (name: string) => rows[0][header.indexOf(name)];

    expect(cell('image_model_abstained')).toBe('yes');
    expect(cell('disposition_source')).toBe('model+rule-agree');
  });

  it('never exports a bare "healthy" for a result the engine could not name', () => {
    const rows = screeningCsvRows(
      [scan({ result: result({ disposition: 'inconclusive', conditionId: 'healthy' }) })],
      [plot],
      [farm],
    );
    const header = screeningCsvHeader();
    expect(rows[0][header.indexOf('condition')]).toBe('not-named (inconclusive)');
  });

  it('produces a parsable csv whose header length matches every row', () => {
    const scans = [scan(), scan({ id: 'scan-2' }), scan({ id: 'scan-3', result: result({ modelInference: null, isDemonstration: true }) })];
    const header = screeningCsvHeader();
    const rows = screeningCsvRows(scans, [plot], [farm]);
    const csv = toCsv(header, rows);

    expect(rows.every((r) => r.length === header.length)).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(scans.length + 1);
    expect(lines[0]).toContain('image_model_raw_score');
  });
});
