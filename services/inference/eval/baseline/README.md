# Baseline evaluation artifacts (pre-exclusion)

Frozen copies of the evaluation artifacts as they existed at commit `9226aae`
("Fix misleading image quality messages"), generated on 2026-10-16 by
`services/inference/eval/evaluate.py` before the P0 evaluation-integrity changes.

| File | Why it is kept |
|---|---|
| `cotton_results.2026-10-16.pre-exclusion.json` | Cotton metrics before the two conflicting-label duplicates were excluded. Keeps the historical 210-image numbers. |
| `soybean_results.2026-10-16.pre-regeneration.json` | Soybean metrics before content hashes, split metadata and the full-head macro blocks were added. |
| `RESULTS.2026-10-16.pre-exclusion.md` | The human-readable report as shown at that commit. |

These files are byte-for-byte the checked-out working copies (LF stored, CRLF in
the checkout) and are not regenerated. The current artifacts live one directory
up: `cotton_results.json`, `soybean_results.json`, `cotton_manifest.json`,
`soybean_manifest.json`, `RESULTS.md`, plus `exclusions.json` and
`DUPLICATE_AUDIT.md`.

The regenerated cotton metrics differ from the baseline only because
`curl-virus/031.jpg` and `healthy-leaf/067.jpg` are excluded from metric
aggregation (see `exclusions.json`). Predictions and probabilities are identical
image for image; only the exclusion moved the aggregates.
