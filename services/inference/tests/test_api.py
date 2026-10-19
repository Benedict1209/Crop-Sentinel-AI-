"""HTTP contract tests for the inference service."""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from cropsentinel_inference import registry  # noqa: E402
from conftest import leaf_image, requires_weights  # noqa: E402


def _post_image(client, crop: str, data: bytes, name: str = "leaf.png"):
    return client.post("/v1/screen", data={"crop": crop}, files={"image": (name, data, "image/png")})


# --------------------------------------------------------------------- health


def test_health_reports_the_service_and_its_models(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["service"] == "cropsentinel-inference"
    assert body["apiVersion"]
    assert body["checksumVerification"] is True
    assert body["supportedCrops"] == ["cotton", "soybean"]
    assert {m["crop"] for m in body["models"]} == {"cotton", "soybean"}
    for model in body["models"]:
        assert model["classCount"] == len(model["classNames"])
        assert model["license"]
        assert model["revision"]
        assert model["weightsSha256"]
        assert "minConfidence" in model["abstention"]


def test_models_endpoint_explains_the_routing_rule(client):
    body = client.get("/v1/models").json()
    assert body["supportedCrops"] == ["cotton", "soybean"]
    assert "another crop's classifier" in body["note"]


# ------------------------------------------------------------ crop routing ---


def test_an_unsupported_crop_is_refused_not_substituted(client):
    response = _post_image(client, "tomato", leaf_image())
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error"] == "unsupported-crop"
    assert detail["supportedCrops"] == ["cotton", "soybean"]
    assert "will not run a different crop's model" in detail["detail"]


def test_every_registered_crop_is_served(client):
    for crop in registry.supported_crops():
        response = _post_image(client, crop, leaf_image())
        assert response.status_code in (200, 503), response.text
        if response.status_code == 200:
            assert response.json()["crop"] == crop


# ------------------------------------------------------------- bad payloads --


def test_a_non_image_payload_is_rejected(client):
    response = _post_image(client, "cotton", b"this is a text file")
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "invalid-image"


def test_an_empty_payload_is_rejected(client):
    response = _post_image(client, "cotton", b"")
    assert response.status_code == 422


def test_an_oversized_payload_is_rejected(client, monkeypatch):
    from cropsentinel_inference import app as app_module

    monkeypatch.setattr(app_module, "MAX_UPLOAD_BYTES", 128)
    response = _post_image(client, "cotton", leaf_image())
    assert response.status_code == 413
    assert response.json()["detail"]["error"] == "payload-too-large"


def test_a_corrupt_image_body_is_rejected(client):
    # A valid PNG header followed by garbage: decodable signature, broken data.
    truncated = leaf_image()[:80]
    response = _post_image(client, "cotton", truncated)
    assert response.status_code in (422, 500)
    if response.status_code == 422:
        assert response.json()["detail"]["error"] == "invalid-image"


# ------------------------------------------------------------ model state ----


def test_a_model_that_cannot_load_returns_503_and_says_why(client_without_weights):
    response = _post_image(client_without_weights, "cotton", leaf_image())
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["error"] == "model-unavailable"
    assert "fetch_models" in detail["detail"] or "missing" in detail["detail"]


def test_health_reflects_models_that_cannot_load(client_without_weights):
    body = client_without_weights.get("/health").json()
    assert body["anyModelAvailable"] is False
    for model in body["models"]:
        assert model["available"] is False
        assert model["loadError"]


# ---------------------------------------------------------------- responses --


@requires_weights
def test_a_successful_screen_carries_full_provenance(client):
    response = _post_image(client, "cotton", leaf_image())
    assert response.status_code == 200
    body = response.json()

    assert body["requestId"]
    assert body["serviceVersion"]
    assert body["crop"] == "cotton"

    model = body["model"]
    assert model["modelId"] == registry.COTTON.model_id
    assert model["revision"] == registry.COTTON.revision
    assert model["weightsSha256"] == registry.COTTON.weights_sha256
    assert model["classNames"] == list(registry.COTTON.classes)
    assert model["preprocessingDetail"]
    assert model["publishedMetrics"]

    prediction = body["prediction"]
    assert prediction["calibrated"] is False
    assert len(prediction["probabilities"]) == len(model["classNames"])
    assert prediction["className"] == model["classNames"][prediction["classIndex"]]

    assert isinstance(body["abstained"], bool)
    assert body["thresholds"]["minConfidence"] == registry.COTTON.min_confidence
    assert body["quality"]["checks"]
    assert body["latencyMs"] >= 0


@requires_weights
def test_the_base64_endpoint_accepts_a_plain_and_a_data_url(client):
    raw = leaf_image()
    for encoded in (base64.b64encode(raw).decode(), "data:image/png;base64," + base64.b64encode(raw).decode()):
        response = client.post("/v1/screen/b64", json={"crop": "soybean", "imageBase64": encoded})
        assert response.status_code == 200, response.text
        assert response.json()["crop"] == "soybean"


@requires_weights
def test_a_bad_quality_photo_abstains_over_http(client):
    dark = Image.new("RGB", (400, 400), (6, 6, 6))
    buffer = io.BytesIO()
    dark.save(buffer, format="PNG")
    response = _post_image(client, "cotton", buffer.getvalue())
    assert response.status_code == 200
    body = response.json()
    assert body["abstained"] is True
    assert body["quality"]["passed"] is False
    assert "image-extreme-exposure" in body["abstainReasons"]


@requires_weights
def test_an_unsupported_crop_never_returns_another_crops_class(client):
    """The refusal must not leak a class name from the cotton model."""
    response = _post_image(client, "tomato", leaf_image())
    assert response.status_code == 400
    for name in registry.COTTON.classes:
        assert name not in response.text
