"""Shared fixtures for the inference-service tests.

Images are generated here rather than checked in: these tests exercise plumbing
(preprocessing, quality gates, class mapping, error handling), and a generated
image with known properties is a better fixture for that than a photograph whose
provenance nobody can reproduce.
"""

from __future__ import annotations

import io
import math
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from cropsentinel_inference import registry  # noqa: E402
from cropsentinel_inference.engine import InferenceEngine  # noqa: E402

WEIGHTS = SERVICE_DIR / "weights"


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def leaf_image(size: int = 512, spots: int = 45, blur: float = 0.0, luma: float = 1.0) -> bytes:
    """A green leaf-like image with hard-edged brown lesions.

    Deterministic, in focus and well exposed, so it passes every quality gate;
    the parameters let a test break exactly one property at a time.
    """
    image = Image.new("RGB", (size, size), (58, 122, 52))
    draw = ImageDraw.Draw(image)
    # Vein-like structure and lesions: hard edges give the Laplacian variance a
    # realistic value rather than a flat, blurry one.
    for i in range(1, 9):
        offset = int(size * i / 9)
        draw.line([(0, offset), (size, offset + int(size * 0.06))], fill=(96, 152, 74), width=3)
    for i in range(spots):
        cx = int(size * (0.08 + 0.84 * ((i * 37) % 100) / 100))
        cy = int(size * (0.08 + 0.84 * ((i * 53) % 100) / 100))
        r = 6 + (i % 5) * 3
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(74, 48, 28))
        draw.ellipse([cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3], fill=(128, 96, 56))
    if blur > 0:
        from PIL import ImageFilter

        image = image.filter(ImageFilter.GaussianBlur(blur))
    if luma != 1.0:
        image = Image.eval(image, lambda v: max(0, min(255, int(v * luma))))
    return _png(image)


@pytest.fixture(scope="session")
def valid_leaf() -> bytes:
    return leaf_image()


@pytest.fixture(scope="session")
def cotton_spec() -> registry.ModelSpec:
    return registry.COTTON


@pytest.fixture(scope="session")
def soybean_spec() -> registry.ModelSpec:
    return registry.SOYBEAN


@pytest.fixture(scope="session")
def engine() -> InferenceEngine:
    return InferenceEngine(WEIGHTS)


@pytest.fixture(scope="session")
def weights_available() -> bool:
    return all(
        (WEIGHTS / spec.weights_file).exists() and (WEIGHTS / spec.labels_file).exists()
        for spec in registry.SPECS
    )


requires_weights = pytest.mark.skipif(
    not all((WEIGHTS / s.weights_file).exists() for s in registry.SPECS),
    reason="model weights are not downloaded; run services/inference/fetch_models.py",
)


@pytest.fixture()
def client(monkeypatch):
    """A TestClient over the real app, with the real weights directory."""
    from fastapi.testclient import TestClient

    from cropsentinel_inference import app as app_module

    app_module.engine = InferenceEngine(WEIGHTS)
    return TestClient(app_module.app)


@pytest.fixture()
def client_without_weights(monkeypatch, tmp_path):
    """A TestClient whose models cannot load: an empty weights directory."""
    from fastapi.testclient import TestClient

    from cropsentinel_inference import app as app_module

    app_module.engine = InferenceEngine(tmp_path)
    return TestClient(app_module.app)
