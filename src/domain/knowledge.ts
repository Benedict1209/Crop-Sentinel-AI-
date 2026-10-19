/* =========================================================================
   CropSentinel AI — Agronomic knowledge base
   Crops, visible-symptom vocabulary and condition definitions consumed by the
   screening analyzer, the risk engine and the advisory generator.

   IMPORTANT: this is a transparent rule/knowledge base written from general
   integrated pest & disease management (IPM) principles. It is NOT a trained
   classifier and it does NOT contain validated epidemiological coefficients.
   Weather windows are generic "conditions commonly associated with" ranges
   and every threshold here is labelled illustrative in the UI.
   ========================================================================= */

import type { ConditionCategory, CropStage } from './types';

export interface CropDef {
  id: string;
  labelKey: string;
  /** Growth stages, in agronomic order, for this crop. */
  stages: CropStage[];
  /** Relative susceptibility multiplier used by the risk engine (documented). */
  stageSusceptibility: Record<CropStage, number>;
  /** Varieties with documented tolerance used as a risk *reducer*. */
  tolerantVarieties: string[];
}

const STD_STAGES: CropStage[] = ['nursery', 'vegetative', 'flowering', 'fruiting', 'maturity'];

/*
 * The product is focused on cotton and soybean for Maharashtra, so those two
 * are the only supported crops. All workflows below have been narrowed to
 * these two; no other crop may be selected in the scanner, sample cases,
 * or model inference.
 */
export const PRIMARY_CROPS = ['cotton', 'soybean'] as const;

/** Crops with a genuine trained image model behind them. */
export const MODEL_BACKED_CROPS = ['cotton', 'soybean'] as const;

export function hasImageModel(cropId: string): boolean {
  return (MODEL_BACKED_CROPS as readonly string[]).includes(cropId);
}

export const CROPS: CropDef[] = [
  {
    id: 'cotton', labelKey: 'crop.cotton', stages: STD_STAGES,
    stageSusceptibility: { nursery: 0.4, vegetative: 0.75, flowering: 0.95, fruiting: 1, maturity: 0.55 },
    tolerantVarieties: ['BG-II (partial bollworm tolerance)'],
  },
  {
    id: 'soybean', labelKey: 'crop.soybean', stages: STD_STAGES,
    stageSusceptibility: { nursery: 0.4, vegetative: 0.8, flowering: 0.95, fruiting: 0.9, maturity: 0.4 },
    tolerantVarieties: [],
  },
];

export function getCrop(id: string): CropDef {
  return CROPS.find((c) => c.id === id) ?? CROPS[0];
}

/* ------------------------------------------------------ Symptom vocabulary */

export interface SymptomDef {
  id: string;
  labelKey: string;
  /** Conditions this visible sign is commonly associated with. */
  associatedConditions: string[];
}

export const SYMPTOMS: SymptomDef[] = [
  /* --- Symptoms of the cotton conditions the trained model can name --- */
  { id: 'angular_leaf_spot', labelKey: 'sym.angular_leaf_spot', associatedConditions: ['cotton_bacterial_blight'] },
  { id: 'vein_thickening', labelKey: 'sym.vein_thickening', associatedConditions: ['cotton_leaf_curl_virus'] },
  { id: 'one_sided_wilt', labelKey: 'sym.one_sided_wilt', associatedConditions: ['cotton_fusarium_wilt'] },
  { id: 'vascular_discolouration', labelKey: 'sym.vascular_discolouration', associatedConditions: ['cotton_fusarium_wilt'] },
  /* --- Symptoms of the soybean conditions the trained model can name --- */
  { id: 'pale_green_upper_lesion', labelKey: 'sym.pale_green_upper_lesion', associatedConditions: ['soybean_downy_mildew'] },
  { id: 'circular_grey_spot', labelKey: 'sym.circular_grey_spot', associatedConditions: ['soybean_frogeye_leaf_spot'] },
  { id: 'rust_pustules', labelKey: 'sym.rust_pustules', associatedConditions: ['soybean_rust'] },
  {
    id: 'irregular_brown_spot', labelKey: 'sym.irregular_brown_spot',
    associatedConditions: ['soybean_frogeye_leaf_spot', 'soybean_septoria_brown_spot'],
  },
  { id: 'rosette_flower', labelKey: 'sym.rosette_flower', associatedConditions: ['cotton_pink_bollworm'] },
  { id: 'bore_hole_fruit', labelKey: 'sym.bore_hole_fruit', associatedConditions: ['cotton_pink_bollworm'] },
  { id: 'larva_in_fruit', labelKey: 'sym.larva_in_fruit', associatedConditions: ['cotton_pink_bollworm'] },
  { id: 'frass_sawdust', labelKey: 'sym.frass_sawdust', associatedConditions: ['cotton_pink_bollworm'] },
  { id: 'no_visible_symptom', labelKey: 'sym.no_visible_symptom', associatedConditions: [] },
];

export function getSymptom(id: string): SymptomDef | undefined {
  return SYMPTOMS.find((s) => s.id === id);
}

/* ------------------------------------------------------ Condition catalogue */

export interface ConditionDef {
  id: string;
  labelKey: string;
  shortKey: string;
  category: ConditionCategory;
  /** Crop ids this condition is relevant for. */
  hosts: string[];
  /** Symptom ids that strongly indicate this condition. */
  symptoms: string[];
  /**
   * Generic "conditions commonly associated with" window. Used by the risk
   * engine as an illustrative multiplier, not as a validated model input.
   */
  favourable: { tMin: number; tMax: number; rhMin: number; rainMmMin: number; label: string };
  /** Pest conditions can carry an *illustrative* trap-alert count. */
  trapThreshold?: number;
  trapUnit?: string;
  isPest: boolean;
}

export const CONDITIONS: ConditionDef[] = [
  /* --- Cotton pest (symptom-based only; neither image model has pest classes) --- */
  {
    id: 'cotton_pink_bollworm', labelKey: 'cond.cotton_pink_bollworm', shortKey: 'cond.cotton_pink_bollworm.short',
    category: 'pest', hosts: ['cotton'],
    symptoms: ['rosette_flower', 'bore_hole_fruit', 'larva_in_fruit', 'frass_sawdust'],
    favourable: { tMin: 24, tMax: 35, rhMin: 45, rainMmMin: 0, label: 'Warm conditions with continuous flowering (generic bollworm-favourable window)' },
    trapThreshold: 8, trapUnit: 'moths/trap/week', isPest: true,
  },
  /* --- Cotton conditions named by the integrated trained models --- */
  {
    id: 'cotton_bacterial_blight', labelKey: 'cond.cotton_bacterial_blight', shortKey: 'cond.cotton_bacterial_blight.short',
    category: 'disease-bacterial', hosts: ['cotton'],
    symptoms: ['angular_leaf_spot', 'water_soaked_margin', 'leaf_tip_dry'],
    favourable: { tMin: 25, tMax: 35, rhMin: 80, rainMmMin: 2, label: 'Warm, wet and windy spells with splash dispersal (generic bacterial-blight-favourable window)' },
    isPest: false,
  },
  {
    id: 'cotton_leaf_curl_virus', labelKey: 'cond.cotton_leaf_curl_virus', shortKey: 'cond.cotton_leaf_curl_virus.short',
    category: 'disease-viral', hosts: ['cotton'],
    symptoms: ['upward_leaf_curl', 'vein_thickening', 'puckered_leaf', 'stunted_growth'],
    favourable: { tMin: 28, tMax: 40, rhMin: 40, rainMmMin: 0, label: 'Hot, dry spells that build up the whitefly vector (generic)' },
    isPest: false,
  },
  {
    id: 'cotton_fusarium_wilt', labelKey: 'cond.cotton_fusarium_wilt', shortKey: 'cond.cotton_fusarium_wilt.short',
    category: 'disease-fungal', hosts: ['cotton'],
    symptoms: ['wilting', 'one_sided_wilt', 'vascular_discolouration', 'lower_leaf_yellowing'],
    favourable: { tMin: 22, tMax: 32, rhMin: 55, rainMmMin: 0, label: 'Soil-borne; favoured by warm soil and moisture stress (generic)' },
    isPest: false,
  },
  /* --- Soybean conditions named by the integrated trained models --- */
  {
    id: 'soybean_downy_mildew', labelKey: 'cond.soybean_downy_mildew', shortKey: 'cond.soybean_downy_mildew.short',
    category: 'disease-fungal', hosts: ['soybean'],
    symptoms: ['pale_green_upper_lesion', 'white_downy_growth', 'lower_leaf_yellowing'],
    favourable: { tMin: 15, tMax: 25, rhMin: 85, rainMmMin: 1, label: 'Cool, humid nights with long leaf wetness (generic downy-mildew-favourable window)' },
    isPest: false,
  },
  {
    id: 'soybean_frogeye_leaf_spot', labelKey: 'cond.soybean_frogeye_leaf_spot', shortKey: 'cond.soybean_frogeye_leaf_spot.short',
    category: 'disease-fungal', hosts: ['soybean'],
    symptoms: ['circular_grey_spot', 'irregular_brown_spot'],
    favourable: { tMin: 20, tMax: 30, rhMin: 80, rainMmMin: 1, label: 'Warm and humid with frequent rain (generic frogeye-favourable window)' },
    isPest: false,
  },
  {
    id: 'soybean_mosaic_virus', labelKey: 'cond.soybean_mosaic_virus', shortKey: 'cond.soybean_mosaic_virus.short',
    category: 'disease-viral', hosts: ['soybean'],
    symptoms: ['mosaic_mottle', 'puckered_leaf', 'stunted_growth'],
    favourable: { tMin: 24, tMax: 34, rhMin: 45, rainMmMin: 0, label: 'Dry, warm spells that favour aphid and whitefly vectors (generic)' },
    isPest: false,
  },
  {
    id: 'soybean_rust', labelKey: 'cond.soybean_rust', shortKey: 'cond.soybean_rust.short',
    category: 'disease-fungal', hosts: ['soybean'],
    symptoms: ['rust_pustules', 'lower_leaf_yellowing'],
    favourable: { tMin: 15, tMax: 28, rhMin: 80, rainMmMin: 1, label: 'Cool to moderate temperatures with prolonged leaf wetness (generic rust-favourable window)' },
    isPest: false,
  },
  {
    id: 'soybean_septoria_brown_spot', labelKey: 'cond.soybean_septoria_brown_spot', shortKey: 'cond.soybean_septoria_brown_spot.short',
    category: 'disease-fungal', hosts: ['soybean'],
    symptoms: ['irregular_brown_spot', 'lower_leaf_yellowing'],
    favourable: { tMin: 20, tMax: 30, rhMin: 78, rainMmMin: 1, label: 'Warm, wet weather with humid canopy (generic septoria-favourable window)' },
    isPest: false,
  },
  {
    id: 'healthy', labelKey: 'cond.healthy', shortKey: 'cond.healthy.short',
    category: 'healthy', hosts: [],
    symptoms: ['no_visible_symptom'],
    favourable: { tMin: -99, tMax: 99, rhMin: 0, rainMmMin: 0, label: 'n/a' },
    isPest: false,
  },
];

export function getCondition(id: string): ConditionDef | undefined {
  return CONDITIONS.find((c) => c.id === id);
}

/** Conditions relevant to a crop (crop-agnostic conditions are always relevant). */
export function conditionsForCrop(cropId: string): ConditionDef[] {
  return CONDITIONS.filter((c) => c.hosts.length === 0 || c.hosts.includes(cropId));
}

export const SOIL_TYPES = ['black-cotton', 'red-lateritic', 'alluvial', 'sandy-loam', 'clay-loam', 'unknown'] as const;
export const TRAP_TYPES = [
  'Pheromone - species specific',
  'Light trap',
  'Blue sticky trap',
  'Yellow sticky trap',
  'Water pan trap',
  'Manual scout count (no trap)',
];
export const PEST_CATEGORIES = [
  'Fall armyworm / stem borer (lepidopteran larvae)',
  'Pink bollworm / fruit borer (lepidopteran)',
  'Thrips / mites (sucking pests)',
  'Aphid / whitefly / jassid (sucking pests)',
  'Mealybug',
  'Leaf folder / leaf roller',
  'Rodent',
  'Other / not identified',
];
