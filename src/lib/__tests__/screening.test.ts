/* =========================================================================
   Screening behaviour tests.

   These lock down the conservative merge rules in lib/modelScreening.ts and the
   routing guarantees around them. Every case asserts something a farmer would be
   harmed by if it changed: a confidence that was never justified, a crop sent
   through another crop's model, false reassurance from a model-only "healthy",
   or a pest claim attributed to a classifier that has no pest classes.
   ========================================================================= */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runScreening, type ScreeningInput } from '../screening';
import type { ScanImage } from '../../domain/types';

const PHOTO: ScanImage = {
  dataUrl: 'data:image/jpeg;base64,AAAA',
  name: 'leaf.jpg',
  origin: 'uploaded',
  width: 640,
  height: 640,
};

const SYNTHETIC: ScanImage = {
  dataUrl: 'data:image/svg+xml;base64,AAAA',
  name: 'synthetic',
  origin: 'synthetic-demo',
};

function baseInput(patch: Partial<ScreeningInput> = {}): ScreeningInput {
  return {
    image: PHOTO,
    cropId: 'cotton',
    cropLabel: 'Cotton',
    stage: 'vegetative',
    symptoms: [],
    notes: '',
    weather: null,
    plotHistory: [],
    trapPressure: null,
    modelServiceUrl: 'http://127.0.0.1:8000',
    ...patch,
  };
}

const COTTON_CLASSES = ['bacterial blight', 'curl virus', 'fussarium wilt', 'healthy'];

function screenPayload(opts: {
  crop?: string;
  className: string;
  probability: number;
  probabilities?: number[];
  classes?: string[];
  abstained?: boolean;
  abstainReasons?: string[];
  qualityPassed?: boolean;
}) {
  const classes = opts.classes ?? COTTON_CLASSES;
  const index = classes.indexOf(opts.className);
  const probabilities =
    opts.probabilities ?? classes.map((_, i) => (i === index ? opts.probability : (1 - opts.probability) / (classes.length - 1)));
  return {
    requestId: 'req-test',
    serviceVersion: '1.0.0',
    totalMs: 42,
    crop: opts.crop ?? 'cotton',
    model: {
      crop: opts.crop ?? 'cotton',
      cropLabel: 'Cotton',
      modelId: 'FarmGuard/cotton-densenet121',
      sourceUrl: 'https://huggingface.co/FarmGuard/cotton-densenet121',
      revision: '22f8684282bd81ae4d9803b43c71e6f09a7bb7fc',
      license: 'MIT',
      licenseNote: 'MIT',
      architecture: 'DenseNet-121',
      library: 'torchvision',
      classNames: classes,
      classCount: classes.length,
      classSource: 'classes.json',
      inputSize: 224,
      preprocessing: 'resize-256-center-crop-224',
      preprocessingDetail: 'Resize(256) -> CenterCrop(224) -> ToTensor -> Normalize',
      weightsSha256: 'dfb01012',
      weightsBytes: 84420354,
      abstention: { minConfidence: 0.6, minMargin: 0.2 },
      publishedMetrics: [],
      cautions: [],
      available: true,
      loadError: null,
    },
    image: { width: 640, height: 640, bytes: 1234, meanLuma: 120, laplacianVariance: 90, foliageFraction: 0.8 },
    quality: { passed: opts.qualityPassed ?? true, checks: [] },
    prediction: {
      classIndex: index,
      className: opts.className,
      probability: opts.probability,
      runnerUpClass: classes[index === 0 ? 1 : 0],
      runnerUpProbability: 0.1,
      marginToRunnerUp: 0.5,
      probabilities,
      calibrated: false,
      calibrationNote: 'not calibrated',
    },
    abstained: opts.abstained ?? false,
    abstainReasons: opts.abstainReasons ?? [],
    thresholds: { minConfidence: 0.6, minMargin: 0.2 },
    latencyMs: 88,
  };
}

function stubFetchJson(payload: unknown, status = 200) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image model routing', () => {
  it('does not run a model when no photograph was supplied', async () => {
    const fetchSpy = stubFetchJson({});
    const result = await runScreening(baseInput({ image: null, symptoms: ['angular_leaf_spot'] }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.modelInference?.outcome).toBe('not-attempted');
    expect(result.dispositionSource).toBe('rule-only');
    expect(result.isDemonstration).toBe(true);
    expect(result.confidence).toBeNull();
  });

  it('never sends a synthetic demonstration image to a real model', async () => {
    const fetchSpy = stubFetchJson({});
    const result = await runScreening(baseInput({ image: SYNTHETIC, symptoms: ['angular_leaf_spot'] }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.modelInference?.outcome).toBe('not-attempted');
    expect(result.modelInference?.isGenuineInference).toBe(false);
  });

  it('refuses a crop with no registered model instead of using another crop model', async () => {
    const fetchSpy = stubFetchJson(screenPayload({ className: 'bacterial blight', probability: 0.9 }));
    const result = await runScreening(baseInput({ cropId: 'tomato', cropLabel: 'Tomato', symptoms: ['concentric_target_spot'] }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.modelInference?.outcome).toBe('unsupported-crop');
    expect(result.modelInference?.modelId).toBeNull();
    expect(result.dispositionSource).toBe('no-model-for-crop');
    expect(result.isDemonstration).toBe(true);
  });

  it('falls back to the symptom engine when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.modelInference?.outcome).toBe('service-unavailable');
    expect(result.dispositionSource).toBe('rule-only');
    expect(result.isDemonstration).toBe(true);
    expect(result.conditionId).toBe('cotton_bacterial_blight');
  });

  it('rejects a response that does not match the service contract', async () => {
    // A dev-server SPA fallback answers 200 with index.html for any unknown path.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.modelInference?.outcome).toBe('error');
    expect(result.isDemonstration).toBe(true);
  });
});

describe('merging a model result with the rule assessment', () => {
  it('marks agreement and lets the model lead, still with no confidence and no calibration claim', async () => {
    stubFetchJson(screenPayload({ className: 'bacterial blight', probability: 0.93 }));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.dispositionSource).toBe('model+rule-agree');
    expect(result.disposition).toBe('suspected-disease');
    expect(result.conditionId).toBe('cotton_bacterial_blight');
    expect(result.isDemonstration).toBe(false);
    expect(result.confidence).toBeNull();
    expect(result.modelInference?.calibrated).toBe(false);
    expect(result.ruleAssessment?.conditionId).toBe('cotton_bacterial_blight');
    expect(result.methodology).toMatch(/not calibrated|not a calibrated/i);
    expect(result.engineId).toContain('FarmGuard/cotton-densenet121');
  });

  it('never accepts a model-only "healthy" when symptoms were reported', async () => {
    stubFetchJson(screenPayload({ className: 'healthy', probability: 0.95 }));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.disposition).toBe('inconclusive');
    expect(result.dispositionSource).toBe('model-rule-conflict');
    expect(result.referralRequired).toBe(true);
    expect(result.healthy).toBe(false);
    expect(result.uncertaintyKey).toBe('unc.modelSaysHealthy');
  });

  it('accepts "healthy" only when the symptom report is also affirmatively healthy', async () => {
    stubFetchJson(screenPayload({ className: 'healthy', probability: 0.95 }));
    const result = await runScreening(baseInput({ symptoms: ['no_visible_symptom'] }));

    expect(result.disposition).toBe('healthy');
    expect(result.dispositionSource).toBe('model-only');
    expect(result.isDemonstration).toBe(false);
    expect(result.referralRequired).toBe(false);
  });

  it('routes an abstention to Inconclusive with expert review and names no condition', async () => {
    stubFetchJson(
      screenPayload({
        className: 'healthy',
        probability: 0.4,
        abstained: true,
        abstainReasons: ['low-confidence', 'image-blurry'],
        qualityPassed: false,
      }),
    );
    const result = await runScreening(baseInput());

    expect(result.disposition).toBe('inconclusive');
    expect(result.severity).toBe('inconclusive');
    expect(result.dispositionSource).toBe('model-abstained');
    expect(result.referralRequired).toBe(true);
    expect(result.uncertaintyKey).toBe('unc.modelAbstained');
    expect(result.conditionId).toBe('healthy');
    expect(result.nextSteps).toContain('step.expert');
  });

  it('keeps a symptom-based condition as an unconfirmed suspicion when the model abstains', async () => {
    stubFetchJson(
      screenPayload({
        className: 'curl virus',
        probability: 0.3,
        abstained: true,
        abstainReasons: ['image-blurry'],
        qualityPassed: false,
      }),
    );
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.disposition).toBe('suspected-disease');
    expect(result.dispositionSource).toBe('rule-only');
    expect(result.conditionId).toBe('cotton_bacterial_blight');
    expect(result.referralRequired).toBe(true);
    expect(result.uncertaintyKey).toBe('unc.modelAbstainedRule');
  });

  it('reports disagreement instead of resolving it in the model favour', async () => {
    stubFetchJson(screenPayload({ className: 'fussarium wilt', probability: 0.91 }));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.disposition).toBe('inconclusive');
    expect(result.dispositionSource).toBe('model-rule-conflict');
    expect(result.referralRequired).toBe(true);
    expect(result.uncertaintyKey).toBe('unc.modelDisagrees');
    // The rule engine's own named suspicion survives in the separate record.
    expect(result.ruleAssessment?.conditionId).toBe('cotton_bacterial_blight');
  });

  it('lets the model lead when the symptom report names nothing, and says so', async () => {
    stubFetchJson(screenPayload({ className: 'curl virus', probability: 0.88 }));
    const result = await runScreening(baseInput({ symptoms: [] }));

    expect(result.dispositionSource).toBe('model-only');
    expect(result.disposition).toBe('suspected-disease');
    expect(result.conditionId).toBe('cotton_leaf_curl_virus');
    expect(result.referralRequired).toBe(true);
    expect(result.uncertaintyKey).toBe('unc.modelOnly');
    expect(result.isDemonstration).toBe(false);
  });

  it('does not let the model name an unmapped class', async () => {
    stubFetchJson(screenPayload({ className: 'some new class', probability: 0.99, classes: [...COTTON_CLASSES, 'some new class'] }));
    const result = await runScreening(baseInput({ symptoms: [] }));

    expect(result.disposition).toBe('inconclusive');
    expect(result.dispositionSource).toBe('model-rule-conflict');
    expect(result.uncertaintyKey).toBe('unc.modelUnmapped');
    expect(result.referralRequired).toBe(true);
  });

  it('keeps a pest suspicion out of the model, because no model has pest classes', async () => {
    stubFetchJson(screenPayload({ className: 'healthy', probability: 0.8 }));
    const result = await runScreening(baseInput({ symptoms: ['rosette_flower', 'larva_in_fruit'] }));

    expect(result.disposition).toBe('suspected-pest');
    expect(result.dispositionSource).toBe('rule-only');
    expect(result.isDemonstration).toBe(true);
    expect(result.uncertaintyKey).toBe('unc.modelNoPestClasses');
    expect(result.modelInference?.isGenuineInference).toBe(true);
    expect(result.methodology).toMatch(/no pest classes|NOT a model detection/i);
  });

  it('stores model provenance on every result so it cannot be contradicted later', async () => {
    stubFetchJson(screenPayload({ className: 'bacterial blight', probability: 0.93 }));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));
    const m = result.modelInference!;

    expect(m.modelId).toBe('FarmGuard/cotton-densenet121');
    expect(m.modelRevision).toBe('22f8684282bd81ae4d9803b43c71e6f09a7bb7fc');
    expect(m.weightsSha256).toBe('dfb01012');
    expect(m.classNames).toEqual(COTTON_CLASSES);
    expect(m.probabilities).toHaveLength(COTTON_CLASSES.length);
    expect(m.license).toBe('MIT');
    expect(m.qualityPassed).toBe(true);
  });

  it('keeps a named condition out of a service error and falls back to symptoms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ detail: { error: 'model-unavailable', detail: 'weights missing' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ));
    const result = await runScreening(baseInput({ symptoms: ['angular_leaf_spot'] }));

    expect(result.modelInference?.outcome).toBe('error');
    expect(result.modelInference?.message).toContain('weights missing');
    expect(result.isDemonstration).toBe(true);
    expect(result.conditionId).toBe('cotton_bacterial_blight');
  });
});
