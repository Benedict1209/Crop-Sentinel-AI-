# Near-duplicate cross-label review: Cotton source train split

Read-only review of the Cotton source dataset
`Project-AgML/cotton_leaf_disease_classification_bangladesh_2` (config `raw`,
split `train`, 2,137 rows). **No image was excluded, relabelled, moved, or deleted.**
This report only flags clusters for human adjudication.

## Method

- Exact duplicates: SHA-256 over the stored bytes.
- Near-duplicates: dHash-8 (64-bit difference hash), Hamming distance <= 6,
  clustered transitively with union-find.
- "In eval" marks rows within the first 70 rows of each label, which is how the
  490-image evaluation tree in `.scratch/eval/cotton` was sampled.
- Contact sheets were generated from the parquet payloads at
  `.scratch/review_thr6/cluster_NN_sheet1.png` (one sheet per cluster, labelled
  with row numbers; `*` marks rows in the evaluation sample).

## Correction to the earlier count

At this threshold the audit finds **33 near-duplicate groups, of which 8 span more
than one label** (28 cross-label pairs). The earlier report of "13 cross-label
clusters" was incorrect; it did not match a re-run of the same tool. The table below
is the reproducible result.

## Cross-label clusters

| # | Size | Labels | Max dHash | In eval (row, label) | Preliminary visual review |
|---:|---:|---|---:|---|---|
| 1 | 11 | Curl Virus, Healthy Leaf, Herbicide Growth Damage, Leaf Hopper Jassids, Leaf Redding | 6 | 1 Leaf Hopper; 47 Leaf Hopper; 945 Herbicide Growth Damage | Distinct leaves; a transitive chain, not a set of copies. No convincing cross-label duplicate. Same-label pair 47/173 (Leaf Hopper) is only loosely similar. |
| 2 | 8 | Healthy Leaf, Leaf Hopper Jassids, Leaf Redding | 6 | 674 Healthy; 694 Healthy | Distinct leaves. Same-label close pairs exist (1648/1973 Leaf Redding, d=4; 674/694 Healthy, d=5); neither is a label conflict by itself. |
| 3 | 5 | Bacterial Blight, Leaf Hopper Jassids, Leaf Redding | 6 | 0 Leaf Hopper; 1335 Bacterial Blight | Distinct leaves. Same-label pair 0/159 (Leaf Hopper, d=3). The bacterial-blight row is not a visual match to the redding row. |
| 4 | 5 | Healthy Leaf, Leaf Redding | 6 | none | Four distinct Healthy leaves plus one redding leaf; chain artifact. No eval impact. |
| 5 | 4 | Curl Virus, Herbicide Growth Damage, Leaf Hopper Jassids, Leaf Redding | 6 | 41 Leaf Hopper | Four distinct leaves; chain artifact. |
| 6 | 2 | Bacterial Blight, Healthy Leaf | 6 | 683 Healthy | Different leaves and framing. The healthy row has spots; not a copy of the blight row. |
| 7 | 2 | Curl Virus, Leaf Redding | 5 | none | Clearly different images (single curled leaf vs. a red-spotted branch). |
| 8 | 2 | Leaf Redding, Leaf Variegation | 4 | 1201 Leaf Variegation (OOD probe) | **Strong candidate:** rows 1201 and 2127 share the same lesion pattern, leaf shape and framing; they appear to be the same photograph stored twice. Recommend human confirmation. |

Rows 1201/2127 in cluster 8 are `LV00116.jpg` and `LR00064.jpg`.

## Findings

- Only **cluster 8** survived visual scrutiny as a plausible cross-label duplicate.
  Its evaluation member is row 1201 (Leaf Variegation), an out-of-distribution probe
  class for the cotton model - not one of the measured classes - so it does not
  affect the reported model-class metrics.
- Clusters 1-7 look like distinct leaves linked by the transitive dHash rule. At
  Hamming <= 6, 64-bit dHash is a coarse screen (roughly 9% of bits), and a chain
  A-B-C does not imply A and C are similar. Treat these as low-priority flags.
- Same-label near pairs do exist (for example 1648/1973 Leaf Redding at d=4, 0/159
  Leaf Hopper at d=3, 674/694 Healthy at d=5). They do not create label conflicts,
  but a human should still confirm they are not duplicate photographs before any
  new split is built, because same-label duplicates inflate support and can leak
  across train/test.
- The only cross-label duplicate inside the measured evaluation classes remains the
  exact pair already handled by `exclusions.json`
  (`curl-virus/031.jpg` == `healthy-leaf/067.jpg`). No additional near-duplicate
  was excluded.

## Recommendation

1. Have a human confirm cluster 8 (rows 1201 and 2127) and decide whether to correct
   the source label or exclude either copy in a future dataset build. Nothing was
   changed here.
2. Before building any new split, deduplicate by content hash first, then review
   same-label near pairs, then run this cross-label audit again.
3. Keep the 33-group audit JSON if a more permissive or stricter threshold is needed;
   this report covers threshold 6 only.

## Reproduction

```bash
python services/inference/eval/audit_duplicates.py \
  --parquet .scratch/parquet/cotton_bangladesh2_raw_train.parquet \
  --per-class 70 --near-threshold 6 \
  --out .scratch/review_thr6/audit.json
```

Contact sheets: `.scratch/review_thr6/cluster_01_sheet1.png` through
`cluster_08_sheet1.png`. These are untracked review aids, not shipped artifacts.
