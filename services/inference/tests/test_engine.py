"""Engine tests: weight verification, label-map validation and shape checks."""

from __future__ import annotations

import dataclasses
import json
import shutil
import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from cropsentinel_inference import registry  # noqa: E402
from cropsentinel_inference.engine import (  # noqa: E402
    InferenceEngine,
    ModelUnavailable,
    read_published_labels,
)
from conftest import WEIGHTS, leaf_image, requires_weights  # noqa: E402


def test_registry_declares_provenance_for_every_model():
    for spec in registry.SPECS:
        assert spec.model_id and spec.source_url.startswith("https://huggingface.co/")
        assert len(spec.revision) == 40, "the revision must be a pinned commit"
        assert len(spec.weights_sha256) == 64
        assert spec.license
        assert spec.classes
        assert 0 < spec.min_confidence < 1
        assert spec.cautions, "every model must carry its caveats"


def test_supported_crops_is_exactly_the_two_verified_crops():
    assert registry.supported_crops() == ["cotton", "soybean"]
    assert registry.spec_for_crop("tomato") is None
    assert registry.spec_for_crop("COTTON") is registry.COTTON


@requires_weights
def test_weights_match_the_pinned_checksum(engine):
    for spec in registry.SPECS:
        loaded = engine.load(spec)
        assert loaded.sha256 == spec.weights_sha256


@requires_weights
def test_class_names_come_from_the_published_labels_file(engine):
    """The class order must be the repository's, index for index."""
    for spec in registry.SPECS:
        loaded = engine.load(spec)
        assert loaded.class_names == list(spec.classes)
        published = json.loads(registry.labels_path(spec, WEIGHTS).read_text(encoding="utf-8"))
        names = published["label_names"] if spec.library == "timm" else published
        assert loaded.class_names == names


def test_a_reordered_label_map_is_rejected(tmp_path):
    """A drifted class order would silently relabel every prediction."""
    spec = registry.COTTON
    target = tmp_path / spec.labels_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(list(reversed(spec.classes))), encoding="utf-8")

    with pytest.raises(ModelUnavailable) as excinfo:
        read_published_labels(spec, tmp_path)
    assert "class-index" in excinfo.value.detail


def test_a_missing_labels_file_is_rejected(tmp_path):
    """Weights without their published label map must not load."""
    with pytest.raises(ModelUnavailable) as excinfo:
        read_published_labels(registry.COTTON, tmp_path)
    assert "labels file missing" in excinfo.value.detail


def test_a_labels_file_that_is_not_a_list_of_strings_is_rejected(tmp_path):
    spec = registry.COTTON
    target = tmp_path / spec.labels_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"nope": 1}), encoding="utf-8")
    with pytest.raises(ModelUnavailable):
        read_published_labels(spec, tmp_path)


def test_the_published_soybean_label_order_matches_the_registry():
    """The 6-class order published in config.json is what we map from."""
    assert read_published_labels(registry.SOYBEAN, WEIGHTS) == list(registry.SOYBEAN.classes)


def test_a_drifted_preprocessing_config_is_rejected(tmp_path):
    """timm's default crop_pct for convnext_small is 0.95, not the published 1.0.

    If the published config ever stopped saying 1.0, our straight 224 resize
    would no longer match the model's training transform, so the model must
    become unavailable rather than mis-preprocess every image.
    """
    spec = registry.SOYBEAN
    source = registry.labels_path(spec, WEIGHTS)
    if not source.exists():
        pytest.skip("soybean config.json not downloaded")
    config = json.loads(source.read_text(encoding="utf-8"))
    for drifted in (
        {**config, "pretrained_cfg": {**config["pretrained_cfg"], "crop_pct": 0.95}},
        {**config, "pretrained_cfg": {**config["pretrained_cfg"], "crop_mode": "squash"}},
        {**config, "pretrained_cfg": {**config["pretrained_cfg"], "input_size": [3, 288, 288]}},
        {**config, "pretrained_cfg": {**config["pretrained_cfg"], "mean": [0.5, 0.5, 0.5]}},
    ):
        target = tmp_path / spec.labels_file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(drifted), encoding="utf-8")
        with pytest.raises(ModelUnavailable) as excinfo:
            read_published_labels(spec, tmp_path)
        assert "preprocessing has drifted" in excinfo.value.detail


def test_missing_weights_are_reported_not_guessed(tmp_path):
    engine = InferenceEngine(tmp_path)
    for spec in registry.SPECS:
        info = engine.model_info(spec)
        assert info["available"] is False
        assert "missing weight files" in info["loadError"]


def test_a_checksum_mismatch_makes_the_model_unavailable(tmp_path):
    spec = registry.COTTON
    target = tmp_path / spec.weights_file
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"not the pinned checkpoint")
    shutil.copy(registry.labels_path(spec, WEIGHTS), tmp_path / spec.labels_file)

    bad = dataclasses.replace(spec, weights_sha256="0" * 64)
    engine = InferenceEngine(tmp_path)
    with pytest.raises(ModelUnavailable) as excinfo:
        engine.load(bad)
    assert "SHA-256" in excinfo.value.detail

    assert engine.model_info(bad)["available"] is False


@requires_weights
def test_predict_rejects_an_empty_payload(engine):
    with pytest.raises(ValueError):
        engine.predict(registry.COTTON, b"")


@requires_weights
def test_predict_rejects_an_undecodable_payload(engine):
    with pytest.raises(ValueError):
        engine.predict(registry.COTTON, b"definitely not an image")


@requires_weights
def test_prediction_shape_matches_the_class_list(engine):
    for spec in registry.SPECS:
        payload = engine.predict(spec, leaf_image())
        prediction = payload["prediction"]
        assert len(prediction["probabilities"]) == len(spec.classes)
        assert abs(sum(prediction["probabilities"]) - 1.0) < 1e-4
        assert 0 <= prediction["classIndex"] < len(spec.classes)
        assert prediction["className"] == spec.classes[prediction["classIndex"]]
        assert prediction["probability"] == max(prediction["probabilities"])
        # Index alignment: the argmax index must be the class we report.
        assert prediction["probabilities"][prediction["classIndex"]] == prediction["probability"]


@requires_weights
def test_prediction_never_claims_calibration(engine):
    payload = engine.predict(registry.COTTON, leaf_image())
    assert payload["prediction"]["calibrated"] is False
    assert "not a calibrated probability" in payload["prediction"]["calibrationNote"].lower()
    assert payload["model"]["publishedMetrics"], "published metrics must travel with the model"
    assert payload["model"]["license"] == registry.COTTON.license


@requires_weights
def test_the_two_models_are_never_confused(engine):
    """Each crop's prediction must come from that crop's class list."""
    cotton = engine.predict(registry.COTTON, leaf_image())
    soybean = engine.predict(registry.SOYBEAN, leaf_image())
    assert cotton["model"]["modelId"] == registry.COTTON.model_id
    assert soybean["model"]["modelId"] == registry.SOYBEAN.model_id
    assert cotton["prediction"]["className"] in registry.COTTON.classes
    assert soybean["prediction"]["className"] in registry.SOYBEAN.classes
    assert cotton["prediction"]["className"] not in registry.SOYBEAN.classes


@requires_weights
def test_a_configurable_threshold_drives_abstention(engine, monkeypatch):
    """Raising the threshold must turn a confident prediction into an abstention."""
    spec = dataclasses.replace(registry.COTTON, min_confidence=0.999999, min_margin=0.999999)
    monkeypatch.setattr(registry, "SPECS", (spec,))
    payload = engine.predict(spec, leaf_image())
    assert payload["abstained"] is True
    assert "low-confidence" in payload["abstainReasons"]
    assert "classes-indistinguishable" in payload["abstainReasons"]
    # The raw scores are still reported, but nothing was concluded from them.
    assert payload["prediction"]["probability"] is not None


@requires_weights
def test_quality_failure_produces_abstention_with_reasons(engine):
    from PIL import Image
    import io

    dark = Image.new("RGB", (400, 400), (8, 8, 8))
    buffer = io.BytesIO()
    dark.save(buffer, format="PNG")
    payload = engine.predict(registry.COTTON, buffer.getvalue())
    assert payload["abstained"] is True
    assert payload["quality"]["passed"] is False
    assert "image-extreme-exposure" in payload["abstainReasons"]
    assert payload["image"]["meanLuma"] < 25
