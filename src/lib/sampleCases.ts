/* =========================================================================
   CropSentinel AI — Built-in demonstration sample cases
   These let a judge (or a farmer with no photograph to hand) exercise the full
   screening flow offline and reproducibly. Each case declares the condition it
   depicts, and that declaration is passed to the analyzer as a *small, clearly
   flagged* prior — the result screen always states that it was used.

   Every sample case is verified to reference only cotton or soybean.
   No unrelated crops appear anywhere in the sample cases.
   ========================================================================= */

import type { CropStage } from '../domain/types';
import type { SampleKind, ImageOrigin, SampleImageManifest } from './sampleImages';

export interface SampleCase {
  id: string;
  kind: SampleKind;
  cropId: string;
  stage: CropStage;
  symptoms: string[];
  /** Condition this sample case depicts. */
  declaration: string;
  /** Free-text demo note (demo dataset content). */
  note: string;
  /** Image manifest entry for the gallery card. */
  manifest: SampleImageManifest;
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: 'sample-pink-bollworm-cotton',
    kind: 'cotton_fusarium_wilt',
    cropId: 'cotton',
    stage: 'fruiting',
    symptoms: ['rosette_flower', 'bore_hole_fruit', 'larva_in_fruit'],
    declaration: 'cotton_fusarium_wilt',
    note: 'Rosette flowers and a bore hole in a green boll with frass at the entry.',
    manifest: {
      id: 'sample-pink-bollworm-cotton',
      kind: 'cotton_fusarium_wilt',
      cropId: 'cotton',
      diseaseLabel: ' Fusarium wilt',
      origin: 'synthetic-demo',
      attribution: 'Team Code Bites — synthetic demonstration image, not a real field photograph',
      licenseNote: 'Synthetic demo — not for diagnosis or model inference',
      placeholderLabel: 'Synthetic demo — not for diagnosis',
    },
  },
  {
    id: 'sample-healthy-cotton',
    kind: 'healthy',
    cropId: 'cotton',
    stage: 'vegetative',
    symptoms: ['no_visible_symptom'],
    declaration: 'healthy',
    note: 'Clean, uniform green leaf with no lesions — a healthy baseline record.',
    manifest: {
      id: 'sample-healthy-cotton',
      kind: 'healthy',
      cropId: 'cotton',
      diseaseLabel: ' Healthy',
      origin: 'synthetic-demo',
      attribution: 'Team Code Bites — synthetic demonstration image, not a real field photograph',
      licenseNote: 'Synthetic demo — not for diagnosis or model inference',
      placeholderLabel: 'Synthetic demo — not for diagnosis',
    },
  },
  {
    id: 'sample-downy-mildew-soybean',
    kind: 'soybean_downy_mildew',
    cropId: 'soybean',
    stage: 'fruiting',
    symptoms: ['pale_green_upper_lesion', 'white_downy_growth', 'lower_leaf_yellowing'],
    declaration: 'soybean_downy_mildew',
    note: 'Cool, humid nights with long leaf wetness typical of downy mildew.',
    manifest: {
      id: 'sample-downy-mildew-soybean',
      kind: 'soybean_downy_mildew',
      cropId: 'soybean',
      diseaseLabel: ' Downy mildew',
      origin: 'synthetic-demo',
      attribution: 'Team Code Bites — synthetic demonstration image, not a real field photograph',
      licenseNote: 'Synthetic demo — not for diagnosis or model inference',
      placeholderLabel: 'Synthetic demo — not for diagnosis',
    },
  },
  {
    id: 'sample-rust-soybean',
    kind: 'soybean_rust',
    cropId: 'soybean',
    stage: 'flowering',
    symptoms: ['rust_pustules', 'lower_leaf_yellowing'],
    declaration: 'soybean_rust',
    note: 'Cool to moderate temperatures with prolonged leaf wetness typical of rust.',
    manifest: {
      id: 'sample-rust-soybean',
      kind: 'soybean_rust',
      cropId: 'soybean',
      diseaseLabel: ' Rust',
      origin: 'synthetic-demo',
      attribution: 'Team Code Bites — synthetic demonstration image, not a real field photograph',
      licenseNote: 'Synthetic demo — not for diagnosis or model inference',
      placeholderLabel: 'Synthetic demo — not for diagnosis',
    },
  },
];
