"""Reproducible evaluation of the registered classifiers on a labelled image set.

The harness computes exactly what it can justify and nothing more:

* For directory names mapped to a model class, it reports per-class precision,
  recall, F1 and support, plus macro-F1, accuracy and coverage, and a confusion
  matrix that includes an explicit ABSTAIN column (an abstention is an error for
  accuracy and a lost sample for coverage -- it is never silently dropped).
* For directory names marked ``modelClass: null`` the model cannot name the
  condition, so those images are reported as an out-of-distribution probe:
  abstention rate and what the model said when it did answer, labelled
  "behaviour", never "accuracy".
* Declared exclusions (``eval/exclusions.json``) are evaluated and hashed like
  every other image, but are removed from the measured metrics only. They stay
  in the JSON report and manifest with their reason, so the exclusion is
  auditable and no image is deleted or altered.
* The dataset, its licence and the overlap caveat are printed with the results,
  because a metric without its provenance is not evidence.

Nothing here is a field-performance claim. Nothing is invented: if a directory is
not declared in eval/labels.json the run stops.

Usage:
    python services/inference/eval/evaluate.py --crop cotton  --data /path/to/labelled
    python services/inference/eval/evaluate.py --crop soybean --data /path/to/labelled \
        --via-http http://127.0.0.1:8000 --out services/inference/eval/RESULTS.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from cropsentinel_inference import registry  # noqa: E402
from cropsentinel_inference.engine import InferenceEngine  # noqa: E402
from cropsentinel_inference.preprocess import describe_pipeline  # noqa: E402

LABELS_FILE = Path(__file__).resolve().parent / "labels.json"
EXCLUSIONS_FILE = Path(__file__).resolve().parent / "exclusions.json"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ABSTAIN = "__abstain__"

EVAL_SCRIPT_VERSION = "1.2.0"
"""Bumped whenever this script's output shape or metric definitions change."""

EVAL_SCHEMA_VERSION = 3
"""Incremented for additive report fields. Existing fields keep their meaning."""


def load_exclusions(crop: str) -> tuple[dict[str, dict], dict]:
    """Return (entries keyed by data-dir-relative path, metadata block)."""
    if not EXCLUSIONS_FILE.exists():
        return {}, {"source": None, "version": None, "note": None}
    data = json.loads(EXCLUSIONS_FILE.read_text(encoding="utf-8"))
    by_path: dict[str, dict] = {}
    for entry in data.get("crops", {}).get(crop, []):
        relative = Path(entry["path"]).as_posix()
        if relative in by_path:
            raise SystemExit(
                f"duplicate exclusion entry for '{relative}' in {EXCLUSIONS_FILE.name}"
            )
        if not entry.get("sha256") or not entry.get("reason"):
            raise SystemExit(
                f"exclusion entry for '{relative}' must declare sha256 and reason"
            )
        by_path[relative] = {**entry, "path": relative}
    meta = {
        "source": "services/inference/eval/exclusions.json",
        "version": data.get("version"),
        "note": data.get("note"),
    }
    return by_path, meta


def apply_exclusions(
    results: list[dict], entries: dict[str, dict]
) -> tuple[list[dict], list[str]]:
    """Mark declared rows as excluded, refusing if a file's content has changed.

    The row is kept: its SHA-256, label and prediction remain in the report so the
    decision is auditable. Only metric aggregation skips it.
    """
    applied: list[dict] = []
    seen: set[str] = set()
    for row in results:
        relative = row.get("relativePath")
        if relative is None:
            relative = Path(row["file"]).name
        entry = entries.get(relative)
        if entry is None:
            row["excludedFromMetrics"] = False
            continue
        actual = row.get("sha256")
        if actual != entry["sha256"]:
            raise SystemExit(
                f"refusing to exclude '{relative}': expected sha256 "
                f"{entry['sha256']}, evaluated file has {actual}. The file changed; "
                "review the exclusion before proceeding."
            )
        row["excludedFromMetrics"] = True
        row["exclusionReason"] = entry["reason"]
        applied.append(
            {
                "path": relative,
                "sha256": entry["sha256"],
                "reason": entry["reason"],
                "approved": entry.get("approved"),
                "duplicateOf": entry.get("duplicateOf"),
                "sourceLabels": entry.get("sourceLabels"),
            }
        )
        seen.add(relative)
    unmatched = sorted(set(entries) - seen)
    return applied, unmatched


def load_label_map(crop: str) -> dict:
    data = json.loads(LABELS_FILE.read_text(encoding="utf-8"))
    if crop not in data:
        raise SystemExit(f"no label map for crop '{crop}' in {LABELS_FILE.name}")
    return data[crop]


def collect(data_dir: Path, label_map: dict) -> list[tuple[Path, dict]]:
    if not data_dir.is_dir():
        raise SystemExit(f"data directory not found: {data_dir}")
    declared = label_map["classes"]
    found = sorted(p for p in data_dir.iterdir() if p.is_dir())
    unknown = [p.name for p in found if p.name not in declared]
    if unknown:
        raise SystemExit(
            "these directories are not declared in labels.json, so their labels are "
            f"unknown and the run stops rather than guessing: {unknown}"
        )
    rows: list[tuple[Path, dict]] = []
    for directory in found:
        entry = declared[directory.name]
        images = sorted(
            p for p in directory.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES
        )
        for image in images:
            rows.append((image, entry))
    if not rows:
        raise SystemExit(f"no labelled images under {data_dir}")
    return rows


def predict_local(engine: InferenceEngine, spec: registry.ModelSpec, raw: bytes) -> dict:
    return engine.predict(spec, raw)


def predict_http(base_url: str, crop: str, path: Path) -> dict:
    import httpx

    with path.open("rb") as fh:
        response = httpx.post(
            f"{base_url.rstrip('/')}/v1/screen",
            data={"crop": crop},
            files={"image": (path.name, fh, "application/octet-stream")},
            timeout=120.0,
        )
    if response.status_code != 200:
        raise SystemExit(
            f"service returned HTTP {response.status_code} for {path.name}: {response.text[:400]}"
        )
    return response.json()


def run(
    crop: str,
    data_dir: Path,
    via_http: str | None,
    limit: int | None,
) -> dict:
    spec = registry.spec_for_crop(crop)
    if spec is None:
        raise SystemExit(f"no registered model for crop '{crop}'")
    label_map = load_label_map(crop)
    exclusion_entries, exclusion_meta = load_exclusions(crop)
    rows = collect(data_dir, label_map)
    if limit:
        rows = rows[:limit]

    engine = None if via_http else InferenceEngine(SERVICE_DIR / "weights")

    results = []
    for index, (path, entry) in enumerate(rows, start=1):
        raw = path.read_bytes()
        try:
            relative = path.relative_to(data_dir).as_posix()
        except ValueError:
            relative = path.name
        started = time.perf_counter()
        if via_http:
            payload = predict_http(via_http, crop, path)
        else:
            payload = predict_local(engine, spec, raw)
        elapsed = (time.perf_counter() - started) * 1000
        prediction = payload["prediction"]
        results.append(
            {
                "file": str(path),
                "relativePath": relative,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "directory": path.parent.name,
                "expectedLabel": entry["sourceClass"],
                "expectedModelClass": entry["modelClass"],
                "predictedClass": prediction["className"],
                "probability": prediction["probability"],
                "abstained": payload["abstained"],
                "abstainReasons": payload["abstainReasons"],
                "qualityPassed": payload["quality"]["passed"],
                "latencyMs": elapsed,
                "httpLatencyMs": payload.get("latencyMs"),
            }
        )
        if index % 25 == 0 or index == len(rows):
            print(f"  {index}/{len(rows)}", flush=True)

    applied, unmatched = apply_exclusions(results, exclusion_entries)
    scored = [row for row in results if not row["excludedFromMetrics"]]
    exclusions_block = {
        **exclusion_meta,
        "applied": applied,
        "declaredButNotEvaluated": unmatched,
        "evaluatedImages": len(results),
        "scoredImages": len(scored),
        "excludedImages": len(applied),
    }

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    metrics = compute_metrics(scored, list(spec.classes))
    report = {
        "crop": crop,
        "modelId": spec.model_id,
        "revision": spec.revision,
        "license": spec.license,
        "classes": list(spec.classes),
        "abstention": {"minConfidence": spec.min_confidence, "minMargin": spec.min_margin},
        "dataset": label_map["dataset"],
        "datasetUrl": label_map["datasetUrl"],
        "datasetLicense": label_map["license"],
        "datasetSplit": label_map.get("split"),
        "datasetHeldOut": label_map.get("heldOut"),
        "datasetSplitNote": label_map.get("splitNote"),
        "labelSource": label_map["labelSource"],
        "overlapWarning": label_map["overlapWarning"],
        "transport": via_http or "in-process",
        "generatedAt": generated_at,
        "images": results,
        "excludedImages": len(applied),
        "exclusions": exclusions_block,
        "metrics": metrics,
    }
    report["manifest"] = build_manifest(
        crop,
        spec,
        label_map,
        results,
        data_dir,
        generated_at,
        metrics,
        exclusions=exclusions_block,
    )
    return report


def build_manifest(
    crop: str,
    spec: registry.ModelSpec,
    label_map: dict,
    results: list[dict],
    data_dir: Path,
    generated_at: str,
    metrics: dict,
    exclusions: dict | None = None,
) -> dict:
    """Versioned record of exactly what was evaluated, without image bytes.

    The manifest names the source split and whether it is held out from that
    source's own training split. It does not claim the images are held out from
    the model's training data: for cotton that provenance is unpublished, and for
    soybean overlap is undocumented. That caveat travels in ``overlapWarning``.
    """
    images = []
    for row in results:
        relative = row.get("relativePath")
        if relative is None:
            path = Path(row["file"])
            try:
                relative = path.relative_to(data_dir).as_posix()
            except ValueError:
                relative = path.name
        images.append(
            {
                "path": relative,
                "sourceLabel": row["expectedLabel"],
                "expectedModelClass": row["expectedModelClass"],
                "sha256": row.get("sha256"),
                "abstained": row["abstained"],
                "predictedClass": row["predictedClass"],
                "excludedFromMetrics": row.get("excludedFromMetrics", False),
                "exclusionReason": row.get("exclusionReason"),
            }
        )
    excluded_count = sum(1 for row in results if row.get("excludedFromMetrics"))
    return {
        "manifestVersion": 2,
        "evaluationScript": "services/inference/eval/evaluate.py",
        "evaluationScriptVersion": EVAL_SCRIPT_VERSION,
        "evaluationSchemaVersion": EVAL_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "crop": crop,
        "dataset": {
            "name": label_map["dataset"],
            "url": label_map["datasetUrl"],
            "license": label_map["license"],
            "split": label_map.get("split"),
            "heldOutFromSourceTrain": label_map.get("heldOut"),
            "splitNote": label_map.get("splitNote"),
            "labelSource": label_map["labelSource"],
            "overlapWarning": label_map["overlapWarning"],
        },
        "model": {
            "modelId": spec.model_id,
            "revision": spec.revision,
            "weightsFile": spec.weights_file,
            "checkpointSha256": spec.weights_sha256,
            "architecture": spec.architecture,
            "library": spec.library,
        },
        "preprocessing": {
            "pipeline": spec.preprocess,
            "description": describe_pipeline(spec.preprocess),
            "inputSize": spec.input_size,
        },
        "thresholds": {
            "minConfidence": spec.min_confidence,
            "minMargin": spec.min_margin,
        },
        "counts": {
            "images": len(results),
            "scoredImages": metrics["supportedImages"] + metrics["unsupportedImages"],
            "excludedFromMetrics": excluded_count,
            "supportedImages": metrics["supportedImages"],
            "unsupportedImages": metrics["unsupportedImages"],
            "measuredClasses": metrics["macroOverMeasuredClasses"]["classCount"],
            "unmeasuredClasses": metrics["macroOverAllClasses"]["unmeasuredClasses"],
        },
        "exclusions": exclusions
        or {
            "source": None,
            "version": None,
            "note": None,
            "applied": [],
            "declaredButNotEvaluated": [],
            "evaluatedImages": len(results),
            "scoredImages": len(results) - excluded_count,
            "excludedImages": excluded_count,
        },
        "images": images,
    }


def compute_metrics(results: list[dict], model_classes: list[str]) -> dict:
    supported = [r for r in results if r["expectedModelClass"]]
    unsupported = [r for r in results if not r["expectedModelClass"]]

    per_class = {}
    for name in model_classes:
        per_class[name] = {"support": 0, "tp": 0, "fp": 0, "fn": 0, "abstained": 0}

    for row in supported:
        truth = row["expectedModelClass"]
        bucket = per_class.get(truth)
        if bucket is None:
            raise SystemExit(
                f"labels.json maps '{row['directory']}' to model class '{truth}', "
                "which the model does not emit"
            )
        bucket["support"] += 1
        if row["abstained"]:
            bucket["abstained"] += 1
            bucket["fn"] += 1
        elif row["predictedClass"] == truth:
            bucket["tp"] += 1
        else:
            bucket["fn"] += 1
            per_class.setdefault(row["predictedClass"], {}).setdefault("fp", 0)
            per_class[row["predictedClass"]]["fp"] += 1

    for name, b in per_class.items():
        b.setdefault("support", 0)
        b.setdefault("tp", 0)
        b.setdefault("fp", 0)
        b.setdefault("fn", 0)
        b.setdefault("abstained", 0)

    def safe_div(a: float, b: float) -> float | None:
        return round(a / b, 4) if b else None

    for name, b in per_class.items():
        b["precision"] = safe_div(b["tp"], b["tp"] + b["fp"])
        b["recall"] = safe_div(b["tp"], b["tp"] + b["fn"])
        if b["precision"] is not None and b["recall"] is not None and (b["precision"] + b["recall"]):
            b["f1"] = round(
                2 * b["precision"] * b["recall"] / (b["precision"] + b["recall"]), 4
            )
        else:
            b["f1"] = None

    for name, b in per_class.items():
        b["predicted"] = b["tp"] + b["fp"]

    measured_names = [n for n in model_classes if per_class[n]["support"] > 0]
    unmeasured_names = [n for n in model_classes if per_class[n]["support"] == 0]

    # Legacy fields: kept with exactly their previous meaning -- the average over
    # classes that have labelled examples in this evaluation set. New consumers
    # should prefer the explicitly named ``macroOverMeasuredClasses`` block below.
    # A measured class whose precision/F1 is undefined (for example: every sample
    # abstained, so there are no positive predictions) is excluded from the
    # legacy average. ``macroOverAllClasses`` scores it as zero instead.
    measured_f1s = [
        per_class[n]["f1"] for n in measured_names if per_class[n]["f1"] is not None
    ]
    measured_recalls = [
        per_class[n]["recall"] for n in measured_names if per_class[n]["recall"] is not None
    ]
    macro_f1 = round(statistics.fmean(measured_f1s), 4) if measured_f1s else None
    macro_recall = round(statistics.fmean(measured_recalls), 4) if measured_recalls else None
    measured_precisions = [
        per_class[n]["precision"] for n in measured_names if per_class[n]["precision"] is not None
    ]
    macro_precision = round(statistics.fmean(measured_precisions), 4) if measured_precisions else None

    # Full-head: every class the model can emit. A class with no labelled
    # examples is unmeasured and is scored as 0, so this figure is a floor rather
    # than an average that silently drops three of six soybean classes.
    def all_classes_mean(metric: str) -> float | None:
        if not model_classes:
            return None
        values = [
            per_class[name][metric] if per_class[name][metric] is not None else 0.0
            for name in model_classes
        ]
        return round(statistics.fmean(values), 4)

    correct = sum(1 for r in supported if not r["abstained"] and r["predictedClass"] == r["expectedModelClass"])
    answered = sum(1 for r in supported if not r["abstained"])

    # Confusion matrix with an explicit ABSTAIN column.
    labels = list(model_classes) + [ABSTAIN]
    matrix = {
        truth: {pred: 0 for pred in labels}
        for truth in measured_names
    }
    for row in supported:
        truth = row["expectedModelClass"]
        pred = ABSTAIN if row["abstained"] else row["predictedClass"]
        if truth in matrix and pred in matrix[truth]:
            matrix[truth][pred] += 1

    latencies = [r["latencyMs"] for r in results]
    unsupported_report = {}
    for directory in sorted({r["directory"] for r in unsupported}):
        group = [r for r in unsupported if r["directory"] == directory]
        answered_group = [r for r in group if not r["abstained"]]
        unsupported_report[directory] = {
            "sourceLabel": group[0]["expectedLabel"],
            "images": len(group),
            "abstained": sum(1 for r in group if r["abstained"]),
            "abstentionRate": safe_div(sum(1 for r in group if r["abstained"]), len(group)),
            "predictionHistogram": dict(Counter(r["predictedClass"] for r in answered_group)),
            "meanProbabilityWhenAnswered": (
                round(statistics.fmean(r["probability"] for r in answered_group), 4)
                if answered_group
                else None
            ),
        }

    return {
        "supportedImages": len(supported),
        "unsupportedImages": len(unsupported),
        "answeredWithoutAbstaining": answered,
        "coverage": safe_div(answered, len(supported)),
        "accuracyIncludingAbstentionsAsErrors": safe_div(correct, len(supported)),
        "selectiveAccuracyAmongAnswered": safe_div(correct, answered),
        # Legacy names, unchanged semantics (measured classes only).
        "macroF1": macro_f1,
        "macroPrecision": macro_precision,
        "macroRecall": macro_recall,
        "macroOverMeasuredClasses": {
            "classCount": len(measured_names),
            "classes": measured_names,
            "macroF1": macro_f1,
            "macroPrecision": macro_precision,
            "macroRecall": macro_recall,
            "note": (
                "Average over classes with labelled examples only. A measured class "
                "with an undefined precision/F1 (for example, every sample abstained) "
                "is excluded from the F1/precision averages; see perClass for details."
            ),
        },
        "macroOverAllClasses": {
            "classCount": len(model_classes),
            "measuredClasses": measured_names,
            "unmeasuredClasses": unmeasured_names,
            "unmeasuredScoredAs": 0.0,
            "macroF1": all_classes_mean("f1"),
            "macroPrecision": all_classes_mean("precision"),
            "macroRecall": all_classes_mean("recall"),
            "note": (
                "Average across every class the model can emit. A class with no "
                "labelled examples in this evaluation set is unmeasured and is scored "
                "as 0, so this figure is a floor, not a field estimate."
            ),
        },
        "perClass": per_class,
        "confusionMatrix": matrix,
        "confusionLabels": labels,
        "unsupportedProbe": unsupported_report,
        "latencyMs": {
            "mean": round(statistics.fmean(latencies), 1) if latencies else None,
            "median": round(statistics.median(latencies), 1) if latencies else None,
            "max": round(max(latencies), 1) if latencies else None,
        },
    }


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def render_markdown(report: dict) -> str:
    m = report["metrics"]
    lines: list[str] = []
    add = lines.append
    add(f"### {report['crop']} — {report['modelId']}")
    add("")
    add(f"- Model revision: `{report['revision']}`  ·  licence: {report['license']}")
    add(f"- Mapped classes: {', '.join(report['classes'])}")
    add(
        "- Abstention: raw softmax probability below "
        f"{report['abstention']['minConfidence']} or top-2 margin below "
        f"{report['abstention']['minMargin']}"
    )
    add(f"- Evaluation set: {report['dataset']}")
    split = report.get("datasetSplit")
    if split:
        if report.get("datasetHeldOut") is True:
            split_meaning = "held out from the source dataset's training split"
        elif report.get("datasetHeldOut") is False:
            split_meaning = (
                "NOT held out from the source dataset's training data; it is that "
                "dataset's training split"
            )
        else:
            split_meaning = "held-out status not declared"
        add(f"- Source split: `{split}` — {split_meaning}")
    if report.get("datasetSplitNote"):
        add(f"- Split note: {report['datasetSplitNote']}")
    add(f"- Source: {report['datasetUrl']}")
    add(f"- Licence: {report['datasetLicense']}")
    add(f"- Labels read from: {report['labelSource']}")
    add(f"- Transport: {report['transport']}  ·  run at {report['generatedAt']}")
    add(f"- **Caveat:** {report['overlapWarning']}")
    applied_exclusions = (report.get("exclusions") or {}).get("applied") or []
    if applied_exclusions:
        add("")
        add(
            f"**Excluded from measured metrics ({len(applied_exclusions)}):** evaluated and "
            "retained in the JSON report and manifest, but not scored. No image was "
            "deleted or altered."
        )
        for exclusion in applied_exclusions:
            add(f"- `{exclusion['path']}` — {exclusion['reason']}")
    add("")
    add("| Class | Support | Precision | Recall | F1 | Abstained | Predicted | False positives |")
    add("|---|---:|---:|---:|---:|---:|---:|---:|")
    for name in report["classes"]:
        b = m["perClass"][name]
        if b["support"] == 0:
            add(
                f"| {name} | 0 | n/a (unmeasured) | n/a | n/a | {b['abstained']} | "
                f"{b['predicted']} | {b['fp']} |"
            )
            continue
        add(
            f"| {name} | {b['support']} | {_pct(b['precision'])} | {_pct(b['recall'])} | "
            f"{_pct(b['f1'])} | {b['abstained']} | {b['predicted']} | {b['fp']} |"
        )
    add("")
    add(
        "`Predicted` counts every non-abstained emission of that class; `False positives` "
        "counts those whose labelled truth was a different class. A class with 0 support "
        "keeps its row (and its false positives) rather than being hidden behind `n/a`: "
        "every prediction of it is a false positive by definition."
    )
    add("")
    add(
        f"- Images scored: **{m['supportedImages'] + m['unsupportedImages']}**; "
        f"excluded from metrics: **{report.get('excludedImages', 0)}**"
    )
    add(
        f"- Images with a class this model can name: **{m['supportedImages']}**; "
        f"answered without abstaining: **{m['answeredWithoutAbstaining']}** "
        f"(coverage {_pct(m['coverage'])})"
    )
    add(
        f"- Accuracy counting abstentions as errors: **{_pct(m['accuracyIncludingAbstentionsAsErrors'])}**; "
        f"accuracy among answered images: **{_pct(m['selectiveAccuracyAmongAnswered'])}**"
    )
    measured_macro = m["macroOverMeasuredClasses"]
    full_macro = m["macroOverAllClasses"]
    add(
        f"- Macro over measured classes ({measured_macro['classCount']} of "
        f"{full_macro['classCount']}): F1 **{_pct(measured_macro['macroF1'])}** · "
        f"precision {_pct(measured_macro['macroPrecision'])} · "
        f"recall {_pct(measured_macro['macroRecall'])}"
    )
    add(
        f"- Macro over **all {full_macro['classCount']} model classes** (unmeasured scored 0): "
        f"F1 **{_pct(full_macro['macroF1'])}** · "
        f"precision {_pct(full_macro['macroPrecision'])} · "
        f"recall {_pct(full_macro['macroRecall'])}"
    )
    if full_macro["unmeasuredClasses"]:
        add(
            "- Unmeasured classes (no labelled examples in this set): "
            + ", ".join(full_macro["unmeasuredClasses"])
        )
    add(
        f"- Latency (end to end): median {m['latencyMs']['median']} ms, "
        f"mean {m['latencyMs']['mean']} ms, max {m['latencyMs']['max']} ms"
    )
    add("")
    add("Confusion matrix (rows = labelled truth, columns = what the service reported):")
    add("")
    labels = m["confusionLabels"]
    add("| truth \\ predicted | " + " | ".join(labels) + " |")
    add("|---|" + "---:|" * len(labels))
    for truth, row in m["confusionMatrix"].items():
        add(f"| {truth} | " + " | ".join(str(row[c]) for c in labels) + " |")
    add("")
    if m["unsupportedProbe"]:
        add("Conditions this model cannot name (out-of-distribution probe — behaviour, not accuracy):")
        add("")
        add("| Labelled condition | Images | Abstained | Abstention rate | Mean probability when it answered | What it answered |")
        add("|---|---:|---:|---:|---:|---|")
        for directory, info in m["unsupportedProbe"].items():
            hist = ", ".join(f"{k}×{v}" for k, v in sorted(info["predictionHistogram"].items()))
            add(
                f"| {info['sourceLabel']} | {info['images']} | {info['abstained']} | "
                f"{_pct(info['abstentionRate'])} | "
                f"{'n/a' if info['meanProbabilityWhenAnswered'] is None else info['meanProbabilityWhenAnswered']} | "
                f"{hist or '—'} |"
            )
        add("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crop", required=True, choices=registry.supported_crops())
    parser.add_argument("--data", required=True, type=Path, help="directory tree <class-slug>/*.jpg")
    parser.add_argument("--via-http", help="evaluate the running service instead of loading weights in-process")
    parser.add_argument("--limit", type=int, help="evaluate the first N images only")
    parser.add_argument("--out", type=Path, help="append a markdown section to this file")
    parser.add_argument("--json", type=Path, help="write the full report as JSON")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="write the versioned evaluation manifest (no image bytes) as JSON",
    )
    args = parser.parse_args()

    print(f"evaluating {args.crop} from {args.data} …")
    report = run(args.crop, args.data, args.via_http, args.limit)
    markdown = render_markdown(report)
    applied = report["exclusions"]["applied"]
    if applied:
        print(f"  excluded from metrics: {', '.join(e['path'] for e in applied)}")
    unmatched = report["exclusions"]["declaredButNotEvaluated"]
    if unmatched:
        print(
            "warning: declared exclusion entries were not evaluated in this run "
            f"(expected with --limit): {', '.join(unmatched)}",
            file=sys.stderr,
        )

    if args.manifest:
        args.manifest.write_text(
            json.dumps(report["manifest"], indent=2), encoding="utf-8"
        )
        print(f"wrote {args.manifest}")

    if args.json:
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {args.json}")
    if args.out:
        with args.out.open("a", encoding="utf-8") as fh:
            fh.write(markdown + "\n")
        print(f"appended to {args.out}")
    if not args.json and not args.out:
        print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
