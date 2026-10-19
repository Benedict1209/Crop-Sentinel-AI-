"""Registry of the genuine trained classifiers this service can run.

Every entry records where the weights came from, the exact commit they were
pinned to, the checkpoint's SHA-256, the licence, the class order and the
preprocessing the model was trained with. Nothing is inferred from a model name:
each field was read from the published repository and is re-verified at load
time (a checksum mismatch makes the model unavailable rather than silently
loading different weights).

Only two crops have a validated model. Crops without one are reported as
unsupported -- the service never falls back to another crop's classifier, because
a cotton model run on a soybean photo produces a confident, meaningless label.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .preprocess import COTTON_PIPELINE, SOYBEAN_PIPELINE


@dataclass(frozen=True)
class PublishedMetric:
    """A metric the *model author* reported. Never measured by us in-repo."""

    name: str
    value: float | None
    unit: str
    source: str
    note: str = ""


@dataclass(frozen=True)
class ModelSpec:
    crop: str
    crop_label: str
    model_id: str
    source_url: str
    revision: str
    license: str
    license_note: str
    architecture: str
    library: str  # 'torchvision' | 'timm'
    weights_file: str
    weights_sha256: str
    weights_bytes: int
    checkpoint_kind: str  # how the file must be loaded
    labels_file: str
    labels_source: str
    classes: tuple[str, ...]
    input_size: int
    preprocess: str
    min_confidence: float
    min_margin: float
    published_metrics: tuple[PublishedMetric, ...] = field(default_factory=tuple)
    cautions: tuple[str, ...] = field(default_factory=tuple)


COTTON = ModelSpec(
    crop="cotton",
    crop_label="Cotton",
    model_id="FarmGuard/cotton-densenet121",
    source_url="https://huggingface.co/FarmGuard/cotton-densenet121",
    revision="22f8684282bd81ae4d9803b43c71e6f09a7bb7fc",
    license="MIT",
    license_note="Declared 'license: mit' in the model card metadata.",
    architecture="DenseNet-121 (torchvision), ImageNet-pretrained backbone, 4-class head",
    library="torchvision",
    weights_file="cotton_densenet121/best_densenet.pth",
    weights_sha256="dfb01012a64d9c9b3fd13b1b2483851de8ebd1b981329a19c244ed116a7071aa",
    weights_bytes=84420354,
    checkpoint_kind="torch-state-dict",
    labels_file="cotton_densenet121/classes.json",
    labels_source="classes.json (index order, as published)",
    # Reproduced verbatim from classes.json, including the published spelling
    # 'fussarium wilt'. We do not silently correct the label text: the class we
    # display must be the class the model was trained on.
    classes=("bacterial blight", "curl virus", "fussarium wilt", "healthy"),
    input_size=224,
    preprocess=COTTON_PIPELINE,
    min_confidence=0.60,
    min_margin=0.20,
    published_metrics=(
        PublishedMetric(
            name="test_accuracy",
            value=0.9899665551839465,
            unit="fraction",
            source="metadata.json in the model repository",
            note="Reported by the model author on their own held-out split.",
        ),
        PublishedMetric(
            name="test_macro_f1",
            value=0.9909135593510112,
            unit="fraction",
            source="metadata.json in the model repository",
            note="Reported by the model author.",
        ),
        PublishedMetric(
            name="best_validation_accuracy",
            value=0.9966,
            unit="fraction",
            source="metadata.json in the model repository",
            note="Model-selection metric, so optimistic by construction.",
        ),
    ),
    cautions=(
        "The card publishes no per-class precision/recall and no confusion matrix, and does not name its training or test dataset.",
        "The card states the model is for research and experimental use and is not a definitive agricultural diagnosis.",
        "The class order comes from classes.json, which lists 'fussarium wilt' (the card's published spelling).",
    ),
)

SOYBEAN = ModelSpec(
    crop="soybean",
    crop_label="Soybean",
    model_id="ixrbhii/soybean-disease-convnext",
    source_url="https://huggingface.co/ixrbhii/soybean-disease-convnext",
    revision="dd564d089f8a95fa046a5a6fc4a39cb0f5bf0c26",
    license="CC-BY-4.0",
    license_note=(
        "Released CC-BY-4.0. Required credit: \"Multi-crop disease models, IXR (agritechixr)\" "
        "and the training datasets (LeafNet, CC-BY-4.0, plus the authors' own field photos)."
    ),
    architecture="ConvNeXt-Small (timm convnext_small.fb_in22k_ft_in1k), 6-class head",
    library="timm",
    weights_file="soybean_convnext/model.safetensors",
    weights_sha256="41f79f767719150bfe8e4574fd4c299fdbcfaa7a924923cb630ad055a57a6f0f",
    weights_bytes=98952428,
    checkpoint_kind="safetensors-fp16",
    labels_file="soybean_convnext/config.json",
    labels_source="config.json -> label_names (index order, as published)",
    classes=(
        "Downy Mildew",
        "Frogeye Leaf Spot",
        "Healthy",
        "Mosaic Virus",
        "Rust",
        "Septoria Brown Spot",
    ),
    input_size=224,
    preprocess=SOYBEAN_PIPELINE,
    min_confidence=0.45,
    min_margin=0.15,
    published_metrics=(
        PublishedMetric(
            name="test_accuracy",
            value=0.917,
            unit="fraction",
            source="model card",
            note="336 held-out photos, as stated on the card.",
        ),
        PublishedMetric(
            name="test_macro_f1",
            value=0.881,
            unit="fraction",
            source="model card",
        ),
    ),
    cautions=(
        "The card states the held-out photos come from the same datasets the model learned from, so real field photos score lower.",
        "Per-class recall on the card ranges from 75.0% (Rust) to 99.3% (Healthy); Rust and Frogeye Leaf Spot are the weakest classes.",
        "The card's own guidance is to ask for a better photo below about 45% confidence, which is the abstention threshold used here.",
        "Weights are stored in half precision in the published file.",
    ),
)

SPECS: tuple[ModelSpec, ...] = (COTTON, SOYBEAN)


def spec_for_crop(crop: str) -> ModelSpec | None:
    key = (crop or "").strip().lower()
    for spec in SPECS:
        if spec.crop == key:
            return spec
    return None


def supported_crops() -> list[str]:
    return [s.crop for s in SPECS]


def weights_path(spec: ModelSpec, weights_dir: Path) -> Path:
    return weights_dir / spec.weights_file


def labels_path(spec: ModelSpec, weights_dir: Path) -> Path:
    return weights_dir / spec.labels_file
