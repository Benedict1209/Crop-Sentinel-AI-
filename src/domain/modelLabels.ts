/* =========================================================================
   CropSentinel AI — trained-model class mapping and measured performance

   Two things live here, both deliberately explicit rather than inferred:

   1. The class -> condition mapping. The service returns the class order
      published by the model repository; this file is the only place that turns
      those class names into this app's condition ids. A class with no mapping
      returns null, and the caller must then say "the model named a condition
      this app has no advisory for" instead of guessing.

   2. The MEASURED performance of each model, from
      `services/inference/eval/RESULTS.md` (regenerate with
      `python services/inference/eval/evaluate.py`). These are the numbers the
      UI shows a farmer, not the numbers the model card advertises: the two
      differ by a very large margin, and only the measured ones describe how the
      model behaves on images it did not train on.
      `src/lib/__tests__/modelLabels.test.ts` fails if this file drifts from the
      generated evaluation JSON.
   ========================================================================= */

import type { CropStage } from './types';

export interface MeasuredClassMetrics {
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  abstained: number;
}

export interface MeasuredPerformance {
  /** Dataset the measurement was taken on, named exactly. */
  dataset: string;
  datasetUrl: string;
  datasetLicense: string;
  /** Images carrying a class this model can name. */
  supportedImages: number;
  /** Abstentions are counted as errors, never dropped. */
  accuracyIncludingAbstentions: number;
  selectiveAccuracyAmongAnswered: number;
  coverage: number;
  macroF1: number;
  macroPrecision: number;
  macroRecall: number;
  perClass: Record<string, MeasuredClassMetrics>;
  /** Published by the model author; shown beside the measurement, labelled. */
  publishedTestAccuracy: number | null;
  publishedMacroF1: number | null;
  /** Why the measurement is a floor/ceiling indicator rather than field truth. */
  caveat: string;
}

/**
 * Exact class name (as published by the model) -> this app's condition id.
 * `null` means the model can emit a class this app has no condition for.
 */
export const MODEL_CLASS_TO_CONDITION: Record<string, Record<string, string | null>> = {
  cotton: {
    'bacterial blight': 'cotton_bacterial_blight',
    // The repository's own spelling: classes.json lists "fussarium wilt".
    'fussarium wilt': 'cotton_fusarium_wilt',
    'curl virus': 'cotton_leaf_curl_virus',
    healthy: 'healthy',
  },
  soybean: {
    'Downy Mildew': 'soybean_downy_mildew',
    'Frogeye Leaf Spot': 'soybean_frogeye_leaf_spot',
    Healthy: 'healthy',
    'Mosaic Virus': 'soybean_mosaic_virus',
    Rust: 'soybean_rust',
    'Septoria Brown Spot': 'soybean_septoria_brown_spot',
  },
};

export const MODEL_DISPLAY: Record<
  string,
  { modelId: string; revision: string; license: string; licenseNote: string; architecture: string; sourceUrl: string }
> = {
  cotton: {
    modelId: 'FarmGuard/cotton-densenet121',
    revision: '22f8684282bd81ae4d9803b43c71e6f09a7bb7fc',
    license: 'MIT',
    licenseNote: 'Declared "license: mit" in the model card metadata.',
    architecture: 'DenseNet-121 (torchvision), ImageNet-pretrained backbone, 4-class head',
    sourceUrl: 'https://huggingface.co/FarmGuard/cotton-densenet121',
  },
  soybean: {
    modelId: 'ixrbhii/soybean-disease-convnext',
    revision: 'dd564d089f8a95fa046a5a6fc4a39cb0f5bf0c26',
    license: 'CC-BY-4.0',
    licenseNote:
      'Attribution required: "Multi-crop disease models, IXR (agritechixr)" and LeafNet (CC-BY-4.0).',
    architecture: 'ConvNeXt-Small (timm), 6-class head',
    sourceUrl: 'https://huggingface.co/ixrbhii/soybean-disease-convnext',
  },
};

export const MEASURED_PERFORMANCE: Record<string, MeasuredPerformance> = {
  cotton: {
    dataset: 'Project-AgML/cotton_leaf_disease_classification_bangladesh_2 (raw split)',
    datasetUrl: 'https://huggingface.co/datasets/Project-AgML/cotton_leaf_disease_classification_bangladesh_2',
    datasetLicense: 'CC-BY-4.0',
    supportedImages: 208,
    accuracyIncludingAbstentions: 0.5529,
    selectiveAccuracyAmongAnswered: 0.6534,
    coverage: 0.8462,
    macroF1: 0.5344,
    macroPrecision: 0.789,
    macroRecall: 0.5522,
    perClass: {
      'bacterial blight': { support: 70, precision: 0.8305, recall: 0.7, f1: 0.7597, abstained: 10 },
      'curl virus': { support: 69, precision: 1.0, recall: 0.1014, f1: 0.1841, abstained: 18 },
      'fussarium wilt': { support: 0, precision: null, recall: null, f1: null, abstained: 0 },
      healthy: { support: 69, precision: 0.5364, recall: 0.8551, f1: 0.6593, abstained: 4 },
    },
    publishedTestAccuracy: 0.9899665551839465,
    publishedMacroF1: 0.9909135593510112,
    caveat:
      'Curl virus recall is 10%: the model labels most cotton leaf curl images as healthy. Its provenance relative to the model\'s unnamed training data is unknown, so this is a sanity check, not field performance.',
  },
  soybean: {
    dataset: 'anandvermagmailcom/soybean-leaf-diseases (test split)',
    datasetUrl: 'https://huggingface.co/datasets/anandvermagmailcom/soybean-leaf-diseases',
    datasetLicense: 'No licence declared on the dataset card; downloaded on demand and not redistributed.',
    supportedImages: 180,
    accuracyIncludingAbstentions: 0.417,
    selectiveAccuracyAmongAnswered: 0.54,
    coverage: 0.772,
    macroF1: 0.546,
    macroPrecision: 0.962,
    macroRecall: 0.417,
    perClass: {
      'Downy Mildew': { support: 0, precision: null, recall: null, f1: null, abstained: 0 },
      'Frogeye Leaf Spot': { support: 60, precision: 0.978, recall: 0.733, f1: 0.838, abstained: 12 },
      Healthy: { support: 60, precision: 1.0, recall: 0.35, f1: 0.518, abstained: 20 },
      'Mosaic Virus': { support: 0, precision: null, recall: null, f1: null, abstained: 0 },
      Rust: { support: 60, precision: 0.909, recall: 0.167, f1: 0.282, abstained: 9 },
      'Septoria Brown Spot': { support: 0, precision: null, recall: null, f1: null, abstained: 0 },
    },
    publishedTestAccuracy: 0.917,
    publishedMacroF1: 0.881,
    caveat:
      'Rust recall is 17% and healthy recall is 35% on this set. The model card itself warns that its own held-out photos came from its training datasets.',
  },
};

/** App condition id for a model class name, or null when unmapped. */
export function conditionForModelClass(cropId: string, className: string | null | undefined): string | null {
  if (!className) return null;
  const table = MODEL_CLASS_TO_CONDITION[cropId];
  if (!table) return null;
  const mapped = table[className];
  return mapped === undefined ? null : mapped;
}

export function isClassMapped(cropId: string, className: string): boolean {
  return conditionForModelClass(cropId, className) !== null;
}

/** Measured performance for a crop, or null when no model covers that crop. */
export function measuredPerformance(cropId: string): MeasuredPerformance | null {
  return MEASURED_PERFORMANCE[cropId] ?? null;
}

/** Plants the model has never been shown: it has no pest classes at all. */
export const MODEL_DETECTS_PESTS = false as const;

/** Neither model was calibrated, so no softmax score may be called confidence. */
export const MODELS_ARE_CALIBRATED = false as const;

export const STAGE_ORDER: CropStage[] = ['nursery', 'vegetative', 'flowering', 'fruiting', 'maturity'];
