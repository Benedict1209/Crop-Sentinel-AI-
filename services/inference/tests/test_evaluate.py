"""Evaluation-metric and reproducibility-contract tests.

These tests pin the additive metric contract: the legacy fields keep their
previous meaning, while the explicit ``macroOver*`` blocks and the per-class
false-positive counts make unmeasured classes visible instead of silently
dropping them.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

SERVICE_DIR = Path(__file__).resolve().parents[1]
EVAL_DIR = SERVICE_DIR / "eval"
sys.path.insert(0, str(SERVICE_DIR))
sys.path.insert(0, str(EVAL_DIR))

import audit_duplicates as audit  # noqa: E402
import evaluate  # noqa: E402
from cropsentinel_inference import registry  # noqa: E402


def row(truth, predicted, abstained=False):
    return {
        "directory": "d",
        "expectedLabel": truth,
        "expectedModelClass": truth,
        "predictedClass": predicted,
        "abstained": abstained,
        "probability": 0.5,
        "latencyMs": 1.0,
    }


def metrics_for(rows, classes):
    return evaluate.compute_metrics(rows, classes)


# --------------------------------------------------------------- metric contract


def test_legacy_macro_fields_still_average_measured_classes_only():
    report = metrics_for(
        [row("A", "A"), row("A", "B"), row("B", "B")],
        ["A", "B", "C"],
    )
    # A: support 2, tp1 fn1 -> P1.0 R0.5 F1 0.6667; B: support 1, tp1 fp1 ->
    # P0.5 R1.0 F1 0.6667; C unmeasured.
    assert report["macroOverMeasuredClasses"]["classCount"] == 2
    assert report["macroOverMeasuredClasses"]["macroF1"] == pytest.approx(0.6667)
    # Legacy keys must keep the same definition.
    assert report["macroF1"] == report["macroOverMeasuredClasses"]["macroF1"]
    assert report["macroPrecision"] == report["macroOverMeasuredClasses"]["macroPrecision"]
    assert report["macroRecall"] == report["macroOverMeasuredClasses"]["macroRecall"]


def test_absent_class_false_positives_are_counted_and_visible():
    report = metrics_for([row("A", "A"), row("A", "C")], ["A", "B", "C"])
    absent = report["perClass"]["C"]
    assert absent["support"] == 0
    assert absent["predicted"] == 1
    assert absent["fp"] == 1
    assert absent["recall"] is None
    assert absent["f1"] is None
    assert report["macroOverAllClasses"]["unmeasuredClasses"] == ["B", "C"]


def test_abstention_is_a_false_negative_and_an_accuracy_error():
    report = metrics_for([row("A", "A", abstained=True)], ["A", "B"])
    a = report["perClass"]["A"]
    assert a["support"] == 1
    assert a["abstained"] == 1
    assert a["tp"] == 0
    assert a["fn"] == 1
    assert report["coverage"] == 0.0
    assert report["accuracyIncludingAbstentionsAsErrors"] == 0.0
    assert report["selectiveAccuracyAmongAnswered"] is None


def test_zero_denominators_are_none_not_invented():
    report = metrics_for([row("A", "A")], ["A", "B"])
    b = report["perClass"]["B"]
    assert b["support"] == 0
    assert b["predicted"] == 0
    assert b["precision"] is None
    assert b["recall"] is None
    assert b["f1"] is None
    # Full-head treats the unmeasured class as zero rather than dropping it.
    assert report["macroOverAllClasses"]["unmeasuredClasses"] == ["B"]
    assert report["macroOverAllClasses"]["macroF1"] == pytest.approx(0.5)


def test_all_abstained_class_has_undefined_precision_but_zero_recall():
    report = metrics_for([row("A", "A", abstained=True), row("B", "B")], ["A", "B"])
    a = report["perClass"]["A"]
    assert a["precision"] is None
    assert a["f1"] is None
    assert a["recall"] == 0.0
    # Legacy F1 average excludes the undefined class; full-head scores it zero.
    assert report["macroOverMeasuredClasses"]["macroF1"] == 1.0
    assert report["macroOverAllClasses"]["macroF1"] == pytest.approx(0.5)


def test_full_head_metric_never_silently_drops_unmeasured_classes():
    report = metrics_for([row("A", "A")], ["A", "B", "C", "D"])
    assert report["macroOverMeasuredClasses"]["macroF1"] == 1.0
    assert report["macroOverAllClasses"]["macroF1"] == pytest.approx(0.25)
    assert report["macroOverAllClasses"]["classCount"] == 4
    assert report["macroOverAllClasses"]["unmeasuredScoredAs"] == 0.0


def test_confusion_matrix_keeps_an_explicit_abstain_column():
    report = metrics_for([row("A", "A"), row("A", "B"), row("A", "B", abstained=True)], ["A", "B"])
    assert report["confusionLabels"][-1] == evaluate.ABSTAIN
    assert report["confusionMatrix"]["A"][evaluate.ABSTAIN] == 1
    assert report["confusionMatrix"]["A"]["B"] == 1


def test_unsupported_probe_stays_out_of_precision_denominators():
    results = [row("A", "A")]
    results.append(
        {
            "directory": "unsupported",
            "expectedLabel": "OOD",
            "expectedModelClass": None,
            "predictedClass": "B",
            "abstained": False,
            "probability": 0.9,
            "latencyMs": 1.0,
        }
    )
    report = metrics_for(results, ["A", "B"])
    assert report["perClass"]["B"]["fp"] == 0
    assert report["unsupportedProbe"]["unsupported"]["images"] == 1


# --------------------------------------------------------------- manifest contract


def _manifest_fixture(tmp_path: Path):
    data_dir = tmp_path / "cotton"
    (data_dir / "bacterial-blight").mkdir(parents=True)
    image = data_dir / "bacterial-blight" / "000.jpg"
    image.write_bytes(b"not-a-real-jpeg-but-the-hash-is-what-matters")

    label_map = {
        "dataset": "Example dataset (config raw, split train)",
        "datasetUrl": "https://example.invalid/dataset",
        "license": "CC-BY-4.0",
        "labelSource": "ClassLabel metadata",
        "overlapWarning": "Training provenance is unpublished.",
        "split": "train",
        "heldOut": False,
        "splitNote": "Only split available; not held out.",
    }
    truth = registry.COTTON.classes[0]
    results = [
        {
            "file": str(image),
            "sha256": "a" * 64,
            "directory": "bacterial-blight",
            "expectedLabel": "Bacterial Blight",
            "expectedModelClass": truth,
            "predictedClass": truth,
            "abstained": False,
            "probability": 0.9,
            "latencyMs": 1.0,
        }
    ]
    metrics = evaluate.compute_metrics(results, list(registry.COTTON.classes))
    manifest = evaluate.build_manifest(
        "cotton", registry.COTTON, label_map, results, data_dir, "2026-10-19T00:00:00+00:00", metrics
    )
    return manifest


def test_manifest_records_provenance_without_image_bytes(tmp_path):
    manifest = _manifest_fixture(tmp_path)
    assert manifest["manifestVersion"] == 2
    assert manifest["evaluationScript"] == "services/inference/eval/evaluate.py"
    assert manifest["evaluationScriptVersion"] == evaluate.EVAL_SCRIPT_VERSION
    assert manifest["dataset"]["split"] == "train"
    assert manifest["dataset"]["heldOutFromSourceTrain"] is False
    assert manifest["model"]["checkpointSha256"] == registry.COTTON.weights_sha256
    assert manifest["model"]["revision"] == registry.COTTON.revision
    assert manifest["preprocessing"]["pipeline"] == registry.COTTON.preprocess
    assert manifest["thresholds"] == {
        "minConfidence": registry.COTTON.min_confidence,
        "minMargin": registry.COTTON.min_margin,
    }
    assert manifest["images"][0]["path"] == "bacterial-blight/000.jpg"
    assert manifest["images"][0]["sha256"] == "a" * 64
    assert "bytes" not in manifest["images"][0]
    assert manifest["counts"]["images"] == 1
    assert manifest["counts"]["scoredImages"] == 1
    assert manifest["counts"]["excludedFromMetrics"] == 0
    # The manifest must be JSON-serialisable and contain no raw payload.
    json.dumps(manifest)


# --------------------------------------------------------------- exclusion contract


def _row(relative, sha, truth="A", predicted="A"):
    return {
        "file": f"data/{relative}",
        "relativePath": relative,
        "sha256": sha,
        "directory": relative.split("/")[0],
        "expectedLabel": truth,
        "expectedModelClass": truth,
        "predictedClass": predicted,
        "abstained": False,
        "probability": 0.9,
        "latencyMs": 1.0,
    }


def test_apply_exclusions_marks_only_the_declared_row():
    results = [
        _row("curl-virus/031.jpg", "a" * 64),
        _row("healthy-leaf/000.jpg", "b" * 64),
    ]
    entries = {
        "curl-virus/031.jpg": {
            "path": "curl-virus/031.jpg",
            "sha256": "a" * 64,
            "reason": "exact duplicate with conflicting label",
        }
    }
    applied, unmatched = evaluate.apply_exclusions(results, entries)
    assert [e["path"] for e in applied] == ["curl-virus/031.jpg"]
    assert results[0]["excludedFromMetrics"] is True
    assert results[1]["excludedFromMetrics"] is False
    assert unmatched == []


def test_apply_exclusions_refuses_a_changed_file():
    results = [_row("curl-virus/031.jpg", "b" * 64)]
    entries = {
        "curl-virus/031.jpg": {
            "path": "curl-virus/031.jpg",
            "sha256": "a" * 64,
            "reason": "exact duplicate with conflicting label",
        }
    }
    with pytest.raises(SystemExit, match="refusing to exclude"):
        evaluate.apply_exclusions(results, entries)


def test_apply_exclusions_reports_declared_but_unmatched(tmp_path):
    entries = {
        "curl-virus/031.jpg": {
            "path": "curl-virus/031.jpg",
            "sha256": "a" * 64,
            "reason": "exact duplicate",
        }
    }
    applied, unmatched = evaluate.apply_exclusions([], entries)
    assert applied == []
    assert unmatched == ["curl-virus/031.jpg"]


def test_manifest_propagates_applied_exclusions(tmp_path):
    data_dir = tmp_path / "cotton"
    image = data_dir / "curl-virus" / "031.jpg"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"x")
    truth = registry.COTTON.classes[0]
    results = [
        {
            "file": str(image),
            "relativePath": "curl-virus/031.jpg",
            "sha256": "c" * 64,
            "directory": "curl-virus",
            "expectedLabel": "Curl Virus",
            "expectedModelClass": truth,
            "predictedClass": truth,
            "abstained": False,
            "probability": 0.9,
            "latencyMs": 1.0,
            "excludedFromMetrics": True,
            "exclusionReason": "exact duplicate with conflicting label",
        }
    ]
    metrics = evaluate.compute_metrics([], list(registry.COTTON.classes))
    exclusions = {
        "source": "services/inference/eval/exclusions.json",
        "version": 1,
        "note": "test",
        "applied": [
            {
                "path": "curl-virus/031.jpg",
                "sha256": "c" * 64,
                "reason": "exact duplicate with conflicting label",
            }
        ],
        "declaredButNotEvaluated": [],
        "evaluatedImages": 1,
        "scoredImages": 0,
        "excludedImages": 1,
    }
    manifest = evaluate.build_manifest(
        "cotton",
        registry.COTTON,
        {
            "dataset": "d",
            "datasetUrl": "u",
            "license": "l",
            "labelSource": "s",
            "overlapWarning": "w",
            "split": "train",
            "heldOut": False,
            "splitNote": "not held out",
        },
        results,
        data_dir,
        "2026-10-19T00:00:00+00:00",
        metrics,
        exclusions=exclusions,
    )
    assert manifest["counts"] == {
        "images": 1,
        "scoredImages": 0,
        "excludedFromMetrics": 1,
        "supportedImages": 0,
        "unsupportedImages": 0,
        "measuredClasses": 0,
        "unmeasuredClasses": list(registry.COTTON.classes),
    }
    assert manifest["images"][0]["excludedFromMetrics"] is True
    assert manifest["images"][0]["exclusionReason"] == "exact duplicate with conflicting label"
    assert manifest["exclusions"]["applied"][0]["path"] == "curl-virus/031.jpg"


def test_render_distinguishes_non_held_out_split_and_lists_exclusions():
    metrics = evaluate.compute_metrics([_row("a/0.jpg", "d" * 64)], ["A"])
    report = {
        "crop": "cotton",
        "modelId": "m",
        "revision": "r",
        "license": "l",
        "classes": ["A"],
        "abstention": {"minConfidence": 0.6, "minMargin": 0.2},
        "dataset": "d",
        "datasetUrl": "u",
        "datasetLicense": "l",
        "datasetSplit": "train",
        "datasetHeldOut": False,
        "datasetSplitNote": "only split available",
        "labelSource": "s",
        "overlapWarning": "w",
        "transport": "in-process",
        "generatedAt": "t",
        "excludedImages": 1,
        "exclusions": {
            "applied": [
                {"path": "a/1.jpg", "sha256": "e" * 64, "reason": "duplicate"},
            ]
        },
        "metrics": metrics,
    }
    markdown = evaluate.render_markdown(report)
    assert "NOT held out" in markdown
    assert "only split available" in markdown
    assert "`a/1.jpg` — duplicate" in markdown
    assert "Images scored: **1**" in markdown


# --------------------------------------------------------------- duplicate audit


def _png(color: tuple[int, int, int], size: int = 32) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_dhash_is_identical_for_identical_images():
    image = Image.open(io.BytesIO(_png((30, 120, 40))))
    assert audit.dhash(image) == audit.dhash(image.copy())


def test_exact_duplicates_and_label_conflicts_are_reported():
    records = [
        {"path": "a/1.png", "row": None, "directory": "a", "label": "Curl Virus",
         "modelClass": "curl virus", "sha256": "same", "dhash": "0" * 16, "inEvaluation": True},
        {"path": "b/1.png", "row": None, "directory": "b", "label": "Healthy Leaf",
         "modelClass": "healthy", "sha256": "same", "dhash": "0" * 16, "inEvaluation": True},
        {"path": "a/2.png", "row": None, "directory": "a", "label": "Curl Virus",
         "modelClass": "curl virus", "sha256": "other", "dhash": "f" * 16, "inEvaluation": True},
    ]
    report = audit.build_report(records, "directory", "d", 0, None)
    assert report["counts"]["exactDuplicateGroups"] == 1
    assert report["counts"]["conflictingLabelGroups"] == 1
    group = report["exactDuplicateGroups"][0]
    assert group["conflict"] is True
    assert group["labels"] == ["Curl Virus", "Healthy Leaf"]
    assert all(member["inEvaluation"] for member in group["members"])


def test_audit_reports_every_group_but_deletes_nothing(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "curl-virus").mkdir(parents=True)
    (data_dir / "healthy-leaf").mkdir(parents=True)
    payload = _png((40, 110, 50))
    (data_dir / "curl-virus" / "000.png").write_bytes(payload)
    (data_dir / "healthy-leaf" / "000.png").write_bytes(payload)

    labels = tmp_path / "labels.json"
    labels.write_text(
        json.dumps(
            {
                "cotton": {
                    "classes": {
                        "curl-virus": {"sourceClass": "Curl Virus", "modelClass": "curl virus"},
                        "healthy-leaf": {"sourceClass": "Healthy Leaf", "modelClass": "healthy"},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    before = sorted(p.name for p in data_dir.rglob("*.png"))
    records = audit.collect_tree(data_dir, labels, "cotton")
    report = audit.build_report(records, "directory", str(data_dir), 0, None)
    after = sorted(p.name for p in data_dir.rglob("*.png"))

    assert before == after
    assert report["counts"]["images"] == 2
    assert report["counts"]["exactDuplicateGroups"] == 1
    assert report["counts"]["conflictingLabelGroups"] == 1
