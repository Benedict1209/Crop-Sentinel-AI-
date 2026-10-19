# Cotton evaluation: duplicate and label-conflict audit

Read-only audit. No image was deleted, relabelled, or rewritten, and the existing
`cotton_results.json` / `RESULTS.md` are unchanged. Produced by
`services/inference/eval/audit_duplicates.py` (v1.0.0) using exact SHA-256 and
dHash-8 perceptual hashes.

## Sources

| Source | Images | Role |
|---|---:|---|
| `.scratch/eval/cotton` | 490 | The actual evaluation tree consumed by `evaluate.py`. |
| `Project-AgML/cotton_leaf_disease_classification_bangladesh_2`, config `raw`, split `train` (1 shard, 2,137 rows) | 2,137 | The source dataset the evaluation tree was sampled from. |

The evaluation tree is **not** held out: the source dataset has no test or
validation split. It was sampled deterministically as the first 70 rows per class.

## Confirmed duplicate group in the evaluation sample

1 exact duplicate group (same bytes):

- `f4fc192312022687...` x2 - **CONFLICTING LABELS**
  - `curl-virus/031.jpg` - labelled Curl Virus
  - `healthy-leaf/067.jpg` - labelled Healthy Leaf
  - Both were answered `healthy` with probability 0.877.

This is the only duplicate in the 490-image evaluation tree. It double-counts one
photograph with two contradictory labels: one false negative for Curl Virus and one
true positive for Healthy.

## Confirmed duplicate groups in the source dataset

5 exact duplicate groups, all conflicting `Curl Virus` vs `Healthy Leaf`
(byte-identical content, different labels):

| SHA-256 prefix | Curl row (in eval) | Healthy row (in eval) |
|---|---|---|
| `2a312ead50a3392b...` | 253 (yes) | 747 (no) |
| `6cedf07176bf581e...` | 291 (yes) | 736 (no) |
| `98109d4553ac715f...` | 287 (yes) | 726 (no) |
| `99a0e299c11a6b12...` | 318 (no) | 824 (no) |
| `eac66528656fd8ef...` | 256 (yes) | 723 (yes) |

"in eval" means the row is within the first 70 rows of its label, which is the
sampler's rule. Only the last group contributes both of its members to the
evaluation sample.

## Near-duplicate flags (not confirmed label errors)

At dHash Hamming distance <= 6:

- Evaluation tree: 2 groups, both same-label (Healthy Leaf; Herbicide Growth
  Damage). No additional label conflicts.
- Source dataset: 33 groups, 8 of which span more than one label (28 cross-label
  pairs). A few are large cross-class clusters (for example, 11 images across Curl
  Virus, Healthy Leaf, Herbicide Growth Damage, Leaf Hopper Jassids and Leaf
  Redding). These are flags for visual review only: a dHash is sensitive to framing
  and background, and the clustering is transitive, so a near match is not proof of
  the same photograph. See `NEAR_DUPLICATE_REVIEW.md` for the cluster-by-cluster
  review.

At distance 0 (identical perceptual hash, different bytes) the source has no
additional groups beyond the 5 exact groups above.

## Approved exclusion (2026-10-19)

Exclude **both** members of the one conflicting group from the measured metrics,
because the correct label cannot be recovered without a human review:

- `.scratch/eval/cotton/curl-virus/031.jpg`
- `.scratch/eval/cotton/healthy-leaf/067.jpg`

The exclusion is declared in `services/inference/eval/exclusions.json` and
validated by content hash at evaluation time. Both images are still evaluated,
hashed, and listed in the JSON report and manifest - only the metric aggregation
skips them. Neither file was deleted, relabelled, or altered. The pre-exclusion
results are preserved under `services/inference/eval/baseline/`.

Measured effect of removing both (recomputed from the existing
`cotton_results.json`, no artifact changed):

| Metric | Current | Excluding both |
|---|---:|---:|
| Supported images | 210 | 208 |
| Coverage | 84.76% | 84.62% |
| Accuracy incl. abstentions | 55.24% | 55.29% |
| Selective accuracy | 65.17% | 65.34% |
| Macro-F1 | 53.36% | 53.44% |
| Curl virus support / recall / F1 | 70 / 10.00% / 18.18% | 69 / 10.14% / 18.41% |
| Healthy support / recall / F1 | 70 / 85.71% / 65.93% | 69 / 85.51% / 65.93% |

The change is negligible, but the evaluation is cleaner and one contradictory
label no longer inflates Healthy's true positives.

The four source-only groups are outside the 490-image sample and do not affect the
current numbers; they should be resolved before the source dataset is used to build
a new or larger evaluation set.

## Recommendation

1. Done: both conflicting files above are excluded from measured metrics only and
   retained on disk, in the report, and in the manifest.
2. Do not build any future split from this source without content-hash deduplication
   across train/validation/test and a human label check of the 8 near-duplicate
   cross-label clusters (see `NEAR_DUPLICATE_REVIEW.md`).
3. The two files stay on disk unchanged; the exclusion is keyed to their SHA-256,
   so any content change makes the evaluation stop instead of silently excluding a
   different image.

## Reproduction

```bash
python services/inference/eval/audit_duplicates.py \
  --data .scratch/eval/cotton --crop cotton --near-threshold 0

python services/inference/eval/audit_duplicates.py \
  --parquet .scratch/parquet/cotton_bangladesh2_raw_train.parquet \
  --per-class 70 --near-threshold 6
```
