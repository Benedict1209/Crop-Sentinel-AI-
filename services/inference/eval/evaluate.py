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

LABELS_FILE = Path(__file__).resolve().parent / "labels.json"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ABSTAIN = "__abstain__"


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
    rows = collect(data_dir, label_map)
    if limit:
        rows = rows[:limit]

    engine = None if via_http else InferenceEngine(SERVICE_DIR / "weights")

    results = []
    for index, (path, entry) in enumerate(rows, start=1):
        raw = path.read_bytes()
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

    return {
        "crop": crop,
        "modelId": spec.model_id,
        "revision": spec.revision,
        "license": spec.license,
        "classes": list(spec.classes),
        "abstention": {"minConfidence": spec.min_confidence, "minMargin": spec.min_margin},
        "dataset": label_map["dataset"],
        "datasetUrl": label_map["datasetUrl"],
        "datasetLicense": label_map["license"],
        "labelSource": label_map["labelSource"],
        "overlapWarning": label_map["overlapWarning"],
        "transport": via_http or "in-process",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "images": results,
        "metrics": compute_metrics(results, list(spec.classes)),
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

    present = [b for b in per_class.values() if b["support"] > 0]
    macro_f1 = (
        round(statistics.fmean(b["f1"] for b in present if b["f1"] is not None), 4)
        if present
        else None
    )
    macro_recall = (
        round(statistics.fmean(b["recall"] for b in present if b["recall"] is not None), 4)
        if present
        else None
    )
    precisions = [b["precision"] for b in present if b["precision"] is not None]
    macro_precision = round(statistics.fmean(precisions), 4) if precisions else None

    correct = sum(1 for r in supported if not r["abstained"] and r["predictedClass"] == r["expectedModelClass"])
    answered = sum(1 for r in supported if not r["abstained"])

    # Confusion matrix with an explicit ABSTAIN column.
    labels = list(model_classes) + [ABSTAIN]
    matrix = {
        truth: {pred: 0 for pred in labels}
        for truth in [n for n in model_classes if per_class[n]["support"] > 0]
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
        "macroF1": macro_f1,
        "macroPrecision": macro_precision,
        "macroRecall": macro_recall,
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
    add(f"- Source: {report['datasetUrl']}")
    add(f"- Licence: {report['datasetLicense']}")
    add(f"- Labels read from: {report['labelSource']}")
    add(f"- Transport: {report['transport']}  ·  run at {report['generatedAt']}")
    add(f"- **Caveat:** {report['overlapWarning']}")
    add("")
    add("| Class | Support | Precision | Recall | F1 | Abstained |")
    add("|---|---:|---:|---:|---:|---:|")
    for name in report["classes"]:
        b = m["perClass"][name]
        if b["support"] == 0:
            add(f"| {name} | 0 | n/a | n/a | n/a | 0 |")
            continue
        add(
            f"| {name} | {b['support']} | {_pct(b['precision'])} | {_pct(b['recall'])} | "
            f"{_pct(b['f1'])} | {b['abstained']} |"
        )
    add("")
    add(
        f"- Images with a class this model can name: **{m['supportedImages']}**; "
        f"answered without abstaining: **{m['answeredWithoutAbstaining']}** "
        f"(coverage {_pct(m['coverage'])})"
    )
    add(
        f"- Accuracy counting abstentions as errors: **{_pct(m['accuracyIncludingAbstentionsAsErrors'])}**; "
        f"accuracy among answered images: **{_pct(m['selectiveAccuracyAmongAnswered'])}**"
    )
    add(
        f"- Macro-F1 **{_pct(m['macroF1'])}** · macro-precision {_pct(m['macroPrecision'])} · "
        f"macro-recall {_pct(m['macroRecall'])}"
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
    args = parser.parse_args()

    print(f"evaluating {args.crop} from {args.data} …")
    report = run(args.crop, args.data, args.via_http, args.limit)
    markdown = render_markdown(report)

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
