/* =========================================================================
   CropSentinel AI — genuine image-model screening

   This module is the only place a trained model's output becomes part of a
   screening result, and it is deliberately conservative.

   Why: the two integrated models were measured inside this repository
   (services/inference/eval/RESULTS.md) at macro-F1 0.53 (cotton) and 0.55
   (soybean) on labelled photographs they did not train on, against 0.99 and
   0.88 claimed on their model cards. The cotton model labels 41 of 70
   cotton-leaf-curl images "healthy". The model is therefore treated as one more
   piece of evidence, never as an oracle:

   * "healthy" is never adopted from the model alone. A false "healthy" is the
     dangerous error and the measurement shows it is common.
   * A model-named condition can lead only when the symptom assessment named no
     condition of its own; it is then marked model-only, is never described as
     calibrated, discloses its measured performance, and always refers to an
     expert.
   * Two conditions named by different sources produce an inconclusive result and
     an expert referral. Disagreement is never resolved in the model's favour.
   * An abstention (poor photo, low score, close classes) never becomes a disease
     conclusion.
   * A pest suspicion is never attributed to a model: neither model has a pest
     class, and both the UI and the exports say so.
   * Nothing is ever run across crops. A crop without a validated model gets
     `unsupported-crop` rather than the other crop's classifier.
   * A synthetic demonstration image is never passed to a real model at all.
   ========================================================================= */

import type { DispositionSource, ModelInference, ScreeningResult } from '../domain/types';

import { getCondition, hasImageModel } from '../domain/knowledge';
import { MODEL_DISPLAY, conditionForModelClass, measuredPerformance } from '../domain/modelLabels';
import type { ScreeningInput } from './screening';
import { screenImage, type ScreenResponse } from './inferenceClient';

export const MODEL_SUPPORTED_CROPS = ['cotton', 'soybean'] as const;

function base(cropId: string, outcome: ModelInference['outcome'], message: string): ModelInference {
  return {
    outcome,
    isGenuineInference: false,
    cropId,
    modelId: null,
    modelRevision: null,
    architecture: null,
    license: null,
    licenseNote: null,
    sourceUrl: null,
    weightsSha256: null,
    classNames: [],
    probabilities: [],
    predictedClassName: null,
    predictedConditionId: null,
    probability: null,
    calibrated: false,
    runnerUpClassName: null,
    marginToRunnerUp: null,
    abstained: false,
    abstainReasons: [],
    thresholds: null,
    qualityPassed: null,
    qualityChecks: [],
    preprocessing: null,
    latencyMs: null,
    requestId: null,
    message,
  };
}

function fromResponse(cropId: string, data: ScreenResponse): ModelInference {
  return {
    outcome: data.abstained ? 'abstained' : 'ran',
    isGenuineInference: true,
    cropId,
    modelId: data.model.modelId,
    modelRevision: data.model.revision,
    architecture: data.model.architecture,
    license: data.model.license,
    licenseNote: data.model.licenseNote,
    sourceUrl: data.model.sourceUrl,
    weightsSha256: data.model.weightsSha256,
    classNames: [...data.model.classNames],
    probabilities: [...data.prediction.probabilities],
    predictedClassName: data.prediction.className,
    predictedConditionId: conditionForModelClass(cropId, data.prediction.className),
    probability: data.prediction.probability,
    calibrated: false,
    runnerUpClassName: data.prediction.runnerUpClass,
    marginToRunnerUp: data.prediction.marginToRunnerUp,
    abstained: data.abstained,
    abstainReasons: [...data.abstainReasons],
    thresholds: { ...data.thresholds },
    qualityPassed: data.quality.passed,
    qualityChecks: data.quality.checks.map((c) => ({ ...c })),
    preprocessing: data.model.preprocessingDetail ?? data.model.preprocessing,
    latencyMs: data.latencyMs,
    requestId: data.requestId,
    message: data.abstained
      ? `The model ran but declined to conclude (${data.abstainReasons.join(', ') || 'no reason reported'}).`
      : null,
  };
}

/**
 * Attempt a genuine forward pass for this scan.
 *
 * Returns a fully populated `ModelInference` for every outcome, including those
 * where no model ran, so a stored scan can always answer "did a trained model
 * produce this?" without guessing.
 */
export async function attemptModelInference(input: ScreeningInput): Promise<ModelInference> {
  const cropId = input.cropId;

  if (!input.image) {
    return base(cropId, 'not-attempted', 'No photograph was supplied, so no image model was run.');
  }
  if (input.image.origin === 'synthetic-demo') {
    return base(
      cropId,
      'not-attempted',
      'This is a built-in synthetic demonstration image, not a photograph, so a trained model is not run on it.',
    );
  }
  if (!hasImageModel(cropId)) {
    return base(
      cropId,
      'unsupported-crop',
      `No validated model is registered for this crop, so screening uses the symptom knowledge base only. ` +
        `Models exist for: ${MODEL_SUPPORTED_CROPS.join(', ')}. Another crop's model is never substituted.`,
    );
  }

  const result = await screenImage(input.modelServiceUrl ?? '', cropId, input.image);
  if (result.ok) return fromResponse(cropId, result.data);

  if (result.code === 'unreachable' || result.code === 'timeout') {
    return base(
      cropId,
      'service-unavailable',
      `The local inference service did not answer (${result.error}), so screening used the symptom knowledge base only.`,
    );
  }
  return base(cropId, 'error', `The inference service returned an error: ${result.error}`);
}

function summarise(rule: ScreeningResult): NonNullable<ScreeningResult['ruleAssessment']> {
  return {
    conditionId: rule.conditionId,
    conditionLabelKey: rule.conditionLabelKey,
    disposition: rule.disposition,
    severity: rule.severity,
    isPest: getCondition(rule.conditionId)?.isPest ?? false,
    evidenceStrength: rule.evidenceStrength,
  };
}

const MODEL_ENGINE_LABEL =
  'Trained image classifier (named condition) with rule-based agronomic context';

const NO_CALIBRATION_NOTE =
  'The classifier is not calibrated, so its raw softmax score is reported as a class score and never as a ' +
  'confidence.';

/**
 * Merge the rule/knowledge-base assessment with the model's output.
 *
 * The rule assessment is always preserved in `ruleAssessment`, so the two
 * evidence sources stay separable in the UI, the report and the CSV export.
 */
export function combineWithModel(
  rule: ScreeningResult,
  model: ModelInference | null,
  cropId: string,
): ScreeningResult {
  const ruleAssessment = summarise(rule);
  const performance = measuredPerformance(cropId);
  const measuredSummary = performance
    ? `macro-F1 ${(performance.macroF1 * 100).toFixed(1)}%, accuracy ${(performance.accuracyIncludingAbstentions * 100).toFixed(1)}% counting abstentions as errors, coverage ${(performance.coverage * 100).toFixed(1)}%`
    : 'not measured in this repository';
  const publishedSummary = performance?.publishedTestAccuracy
    ? `${(performance.publishedTestAccuracy * 100).toFixed(1)}%`
    : 'unknown';

  /* ---------------- No genuine model ran: the rule result stands ---------- */
  if (!model || !model.isGenuineInference) {
    const source: DispositionSource =
      model?.outcome === 'unsupported-crop' ? 'no-model-for-crop' : 'rule-only';
    return {
      ...rule,
      modelInference: model,
      dispositionSource: source,
      ruleAssessment,
      isDemonstration: true,
    };
  }

  const modelRef = `${model.modelId}@${model.modelRevision?.slice(0, 7)}`;

  /* --------------------------- Model abstained ---------------------------- */
  if (model.abstained) {
    // The model's own verdict is Inconclusive by construction. An independent
    // symptom assessment that already named a condition is not thrown away, but
    // it is marked unconfirmed and always referred to an expert.
    const ruleNamedACondition =
      (rule.disposition === 'suspected-disease' || rule.disposition === 'suspected-pest') &&
      rule.evidenceStrength >= 0.42;

    return {
      ...rule,
      engineId: `${modelRef} + demo-rule-base-v1`,
      engineLabel: ruleNamedACondition
        ? 'Symptom assessment (rule based) — the trained image classifier abstained'
        : 'Trained image classifier abstained',
      isDemonstration: true,
      modelInference: model,
      dispositionSource: ruleNamedACondition ? 'rule-only' : 'model-abstained',
      ruleAssessment,
      confidence: null,
      disposition: ruleNamedACondition ? rule.disposition : 'inconclusive',
      healthy: false,
      severity: ruleNamedACondition ? rule.severity : 'inconclusive',
      referralRequired: true,
      uncertaintyKey: ruleNamedACondition ? 'unc.modelAbstainedRule' : 'unc.modelAbstained',
      contributingFactors: [
        ...rule.contributingFactors,
        { key: 'scf.contribModelAbstained' },
      ],
      nextSteps: ruleNamedACondition
        ? ['step.modelRetake', ...rule.nextSteps, 'step.expert']
        : ['step.modelRetake', 'step.expert', 'step.noChemical'],
      methodology:
        `${rule.methodology} [A trained image classifier (${modelRef}) also ran on the photograph and abstained: ` +
        `${model.abstainReasons.join(', ') || 'no reason reported'}. ` +
        `${ruleNamedACondition ? 'The symptom assessment therefore stands as an unconfirmed suspicion and the case is referred to an expert.' : 'No condition is named and the case is referred to an expert.'}]`,
    };
  }

  const modelCondition = model.predictedConditionId;
  const modelIsHealthy = modelCondition === 'healthy';
  const ruleNamesACondition =
    rule.disposition === 'suspected-disease' || rule.disposition === 'suspected-pest';
  const agree = !!modelCondition && modelCondition === rule.conditionId;

  const modelLed = (
    condition: string,
    disposition: ScreeningResult['disposition'],
    severity: ScreeningResult['severity'],
    uncertaintyKey: string,
    source: DispositionSource,
    extra: Partial<ScreeningResult> = {},
  ): ScreeningResult => {
    const def = getCondition(condition);
    return {
      ...rule,
      engineId: modelRef,
      engineLabel: MODEL_ENGINE_LABEL,
      isDemonstration: false,
      modelInference: model,
      dispositionSource: source,
      ruleAssessment,
      conditionId: condition,
      conditionLabelKey: def?.labelKey ?? rule.conditionLabelKey,
      category: def?.category ?? rule.category,
      healthy: disposition === 'healthy',
      confidence: null,
      disposition,
      severity,
      uncertaintyKey,
      referralRequired: extra.referralRequired ?? true,
      contributingFactors: [
        ...rule.contributingFactors,
        { key: 'scf.contribModelOnly' },
        { key: 'scf.contribModelPerformance', params: { f1: performance ? Math.round(performance.macroF1 * 100) : 0 } },
      ],
      nextSteps: extra.nextSteps ?? ['step.modelConfirm', 'step.expert', 'step.monitor3'],
      monitoringKey: extra.monitoringKey ?? rule.monitoringKey,
      methodology:
        `${rule.methodology} [THE NAMED CONDITION ABOVE COMES FROM A TRAINED IMAGE CLASSIFIER, not from the rule engine: ` +
        `${modelRef}, class "${model.predictedClassName}" at raw softmax ${(model.probability ?? 0).toFixed(3)}. ` +
        `${NO_CALIBRATION_NOTE} Its performance measured in this repository is ${measuredSummary}, against the model card's ` +
        `published test accuracy of ${publishedSummary}. The classifier has no pest classes and cannot detect pests. ` +
        'Confirm with a local expert before acting.]',
    };
  };

  /* ------- The classifier named a class this build does not map ---------- */
  if (!modelCondition) {
    return {
      ...rule,
      engineId: `${modelRef} + demo-rule-base-v1`,
      engineLabel: 'Inconclusive — the classifier named a class this build does not map',
      isDemonstration: true,
      modelInference: model,
      dispositionSource: 'model-rule-conflict',
      ruleAssessment,
      confidence: null,
      healthy: false,
      disposition: 'inconclusive',
      severity: 'inconclusive',
      referralRequired: true,
      uncertaintyKey: 'unc.modelUnmapped',
      contributingFactors: [
        ...rule.contributingFactors,
        { key: 'scf.contribModelUnmapped', params: { className: model.predictedClassName ?? '—' } },
      ],
      nextSteps: ['step.expert', 'step.noChemical'],
      methodology:
        `${rule.methodology} [The trained classifier (${modelRef}) answered "${model.predictedClassName}", which this build ` +
        'has no condition or advisory for, so no conclusion is drawn.]',
    };
  }

  /* --- A pest suspicion can only come from the symptom assessment -------- */
  if (ruleAssessment.isPest && rule.disposition === 'suspected-pest') {
    return {
      ...rule,
      engineId: `${modelRef} + demo-rule-base-v1`,
      engineLabel: 'Symptom assessment (rule based) — the classifier has no pest classes',
      isDemonstration: true,
      modelInference: model,
      dispositionSource: 'rule-only',
      ruleAssessment,
      confidence: null,
      referralRequired: true,
      uncertaintyKey: 'unc.modelNoPestClasses',
      contributingFactors: [...rule.contributingFactors, { key: 'scf.contribModelNoPest' }],
      methodology:
        `${rule.methodology} [A trained image classifier also ran (${modelRef}) and answered "${model.predictedClassName}". ` +
        'Neither integrated model has pest classes, so the pest suspicion above is symptom based and is NOT a model detection.]',
    };
  }

  /* --------- Agreement: both sources name the same condition ------------- */
  if (agree && !modelIsHealthy) {
    return modelLed(
      modelCondition,
      rule.disposition === 'healthy' ? 'suspected-disease' : rule.disposition,
      rule.severity === 'healthy' || rule.severity === 'inconclusive' ? 'low' : rule.severity,
      'unc.modelAgrees',
      'model+rule-agree',
      {
        referralRequired: rule.severity === 'high' || rule.severity === 'severe',
        nextSteps: ['step.modelConfirm', ...rule.nextSteps],
      },
    );
  }

  /* ------- The classifier says healthy: never adopt it on its own -------- */
  if (modelIsHealthy) {
    const ruleAffirmativelyHealthy = rule.conditionId === 'healthy';
    if (ruleAffirmativelyHealthy) {
      return modelLed('healthy', 'healthy', 'healthy', 'unc.modelHealthyConfirmed', 'model-only', {
        referralRequired: false,
        nextSteps: ['step.routine', 'step.monitor7', 'step.modelConfirm'],
        monitoringKey: 'mon.monitor14',
      });
    }
    return {
      ...rule,
      engineId: `${modelRef} + demo-rule-base-v1`,
      engineLabel: 'Inconclusive — the classifier and the reported symptoms disagree',
      isDemonstration: true,
      modelInference: model,
      dispositionSource: 'model-rule-conflict',
      ruleAssessment,
      confidence: null,
      healthy: false,
      disposition: 'inconclusive',
      severity: 'inconclusive',
      referralRequired: true,
      uncertaintyKey: 'unc.modelSaysHealthy',
      contributingFactors: [
        ...rule.contributingFactors,
        { key: 'scf.contribModelOnly' },
        { key: 'scf.contribModelPerformance', params: { f1: performance ? Math.round(performance.macroF1 * 100) : 0 } },
      ],
      nextSteps: ['step.modelRetake', 'step.expert', 'step.noChemical'],
      methodology:
        `${rule.methodology} [The trained classifier (${modelRef}) answered "healthy", but the operator reported symptoms ` +
        `and the rule engine named ${rule.conditionId}. A model-only "healthy" is not accepted: the measured false-negative ` +
        `rate is high (this model labelled most cotton leaf-curl images healthy). No reassurance is given from the image alone.]`,
    };
  }

  /* -------- The rule engine named nothing: the model is the only evidence - */
  if (!ruleNamesACondition) {
    return modelLed(modelCondition, 'suspected-disease', 'inconclusive', 'unc.modelOnly', 'model-only');
  }

  /* ------------- Both named a condition, and they disagree --------------- */
  return {
    ...rule,
    engineId: `${modelRef} + demo-rule-base-v1`,
    engineLabel: 'Inconclusive — the classifier and the symptom assessment disagree',
    isDemonstration: true,
    modelInference: model,
    dispositionSource: 'model-rule-conflict',
    ruleAssessment,
    confidence: null,
    healthy: false,
    disposition: 'inconclusive',
    severity: rule.severity === 'healthy' ? 'inconclusive' : rule.severity,
    referralRequired: true,
    uncertaintyKey: 'unc.modelDisagrees',
    contributingFactors: [
      ...rule.contributingFactors,
      { key: 'scf.contribModelOnly' },
      { key: 'scf.contribModelPerformance', params: { f1: performance ? Math.round(performance.macroF1 * 100) : 0 } },
    ],
    nextSteps: ['step.modelRetake', 'step.expert', 'step.noChemical'],
    methodology:
      `${rule.methodology} [The trained classifier (${modelRef}) answered "${model.predictedClassName}" while the symptom ` +
      `assessment named ${rule.conditionId}. The two disagree, neither is treated as authoritative, and the case is ` +
      `inconclusive and referred to an expert. The classifier was measured at ${measuredSummary}.`,
  };
}

/** Provenance block for the UI, or null when the crop has no model. */
export function modelDisplayFor(cropId: string) {
  return MODEL_DISPLAY[cropId] ?? null;
}
