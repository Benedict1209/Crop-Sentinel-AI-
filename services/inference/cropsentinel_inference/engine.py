"""Model loading, validation and inference.

Design rules enforced here:

* Weights are re-verified by SHA-256 before use. A mismatch makes the model
  *unavailable* instead of quietly loading something else.
* The class list is re-read from the published labels file and must match the
  registry exactly, index for index. A label map that drifts is the most common
  way a classifier silently starts lying.
* The checkpoint is loaded with ``strict=True`` so the architecture, the head
  width and the class count must all agree. A 4-class checkpoint cannot be
  loaded into a 6-class model.
* The output tensor's shape is checked against the class list before an argmax
  is taken.
* Raw softmax output is reported as ``probability`` and is explicitly marked
  ``calibrated: false``. It is not a calibrated confidence score and nothing in
  this service calls it one.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import torch

from . import registry
from .preprocess import IMAGENET_MEAN, IMAGENET_STD, decode_image, preprocess
from .quality import QualityReport, assess

ABSTAIN_LOW_CONFIDENCE = "low-confidence"
ABSTAIN_INDISTINGUISHABLE = "classes-indistinguishable"


@dataclass
class LoadedModel:
    spec: registry.ModelSpec
    model: torch.nn.Module
    device: str
    sha256: str
    class_names: list[str]
    load_seconds: float


class ModelUnavailable(RuntimeError):
    """Raised when a crop's model cannot be loaded or failed validation."""

    def __init__(self, crop: str, detail: str):
        super().__init__(f"model for crop '{crop}' is unavailable: {detail}")
        self.crop = crop
        self.detail = detail


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_published_preprocessing(spec: registry.ModelSpec, raw: dict) -> None:
    """Check the model's own published preprocessing against what we apply.

    Only the soybean model publishes machine-readable preprocessing
    (``pretrained_cfg`` in config.json); the cotton card states it in prose, so
    there is nothing to cross-check there and the pipeline is pinned by id.

    This check exists because of a real trap: constructing a local
    ``convnext_small`` in timm resolves ``crop_pct`` 0.95 by default, which would
    resize to 235 px and centre-crop instead of the published 1.0 (a straight
    224 resize). That silently changes every prediction, so a drifted config
    makes the model unavailable rather than quietly mis-preprocessing.
    """
    if spec.library != "timm":
        return
    cfg = raw.get("pretrained_cfg") or {}
    problems: list[str] = []
    input_size = tuple(cfg.get("input_size") or ())
    if input_size and input_size != (3, spec.input_size, spec.input_size):
        problems.append(f"input_size {input_size} != (3, {spec.input_size}, {spec.input_size})")
    if "crop_pct" in cfg and float(cfg["crop_pct"]) != 1.0:
        problems.append(
            f"crop_pct {cfg['crop_pct']} != 1.0 (a lower value means resize-then-centre-crop, "
            "which this service would not be reproducing)"
        )
    if "crop_mode" in cfg and cfg["crop_mode"] != "center":
        problems.append(f"crop_mode {cfg['crop_mode']!r} != 'center'")
    for key, expected in (("mean", IMAGENET_MEAN), ("std", IMAGENET_STD)):
        actual = cfg.get(key)
        if actual and any(abs(float(a) - e) > 1e-6 for a, e in zip(actual, expected)):
            problems.append(f"{key} {actual} != {list(expected)}")
    if problems:
        raise ModelUnavailable(
            spec.crop,
            "the model's published preprocessing has drifted from the pipeline this service "
            "applies: " + "; ".join(problems),
        )


def read_published_labels(spec: registry.ModelSpec, weights_dir: Path) -> list[str]:
    """Read the class order from the published labels file and validate it.

    Never returns a class list we cannot stand behind: a missing file, a wrong
    shape or an order that differs from the registry all raise instead.
    """
    path = registry.labels_path(spec, weights_dir)
    if not path.exists():
        raise ModelUnavailable(spec.crop, f"labels file missing: {path.name}")
    raw = json.loads(path.read_text(encoding="utf-8"))
    if spec.library == "timm":
        names = raw.get("label_names")
        if names is None:
            raise ModelUnavailable(spec.crop, "config.json has no label_names array")
        _validate_published_preprocessing(spec, raw)
    else:
        names = raw
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise ModelUnavailable(spec.crop, "labels file is not a list of strings")
    if list(names) != list(spec.classes):
        raise ModelUnavailable(
            spec.crop,
            "published class list does not match the registry, so the class-index "
            f"mapping cannot be trusted: file={names!r} registry={list(spec.classes)!r}",
        )
    return list(names)


def _load_cotton(spec: registry.ModelSpec, path: Path, classes: list[str]) -> torch.nn.Module:
    from torchvision import models

    model = models.densenet121(weights=None)
    in_features = model.classifier.in_features
    model.classifier = torch.nn.Linear(in_features, len(classes))
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    state = checkpoint
    if isinstance(checkpoint, dict):
        state = (
            checkpoint.get("model_state_dict")
            or checkpoint.get("state_dict")
            or checkpoint
        )
    try:
        incompatible = model.load_state_dict(state, strict=True)
    except RuntimeError as exc:
        raise ModelUnavailable(
            spec.crop, f"checkpoint does not match a {len(classes)}-class densenet121: {exc}"
        ) from exc
    if incompatible.missing_keys or incompatible.unexpected_keys:
        raise ModelUnavailable(spec.crop, "checkpoint keys do not fully match the architecture")
    model.eval()
    return model


def _load_soybean(spec: registry.ModelSpec, path: Path, classes: list[str]) -> torch.nn.Module:
    try:
        import timm
        from safetensors.torch import load_file
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise ModelUnavailable(
            spec.crop, f"installing 'timm' and 'safetensors' is required ({exc})"
        ) from exc

    model = timm.create_model("convnext_small", pretrained=False, num_classes=len(classes))
    state = load_file(str(path))
    # The published file is half precision; load_state_dict casts into the fp32
    # parameters, which is the correct direction (up-cast, no precision invented).
    try:
        model.load_state_dict(state, strict=True)
    except RuntimeError as exc:
        raise ModelUnavailable(
            spec.crop, f"safetensors checkpoint does not match a convnext_small head of {len(classes)} classes: {exc}"
        ) from exc
    model.eval()
    return model


_LOADERS = {"torchvision": _load_cotton, "timm": _load_soybean}


class InferenceEngine:
    """Lazily loads, validates and caches one classifier per crop."""

    def __init__(self, weights_dir: Path, check_checksum: bool = True):
        self.weights_dir = Path(weights_dir)
        self.check_checksum = check_checksum
        self._lock = threading.Lock()
        self._cache: dict[str, LoadedModel | ModelUnavailable] = {}

    # ------------------------------------------------------------------ status

    def missing_files(self, spec: registry.ModelSpec) -> list[str]:
        missing = []
        for rel in (spec.weights_file, spec.labels_file):
            if not (self.weights_dir / rel).exists():
                missing.append(rel)
        return missing

    def model_info(self, spec: registry.ModelSpec) -> dict:
        """Describe a model without loading it (used by /health)."""
        missing = self.missing_files(spec)
        entry = {
            "crop": spec.crop,
            "cropLabel": spec.crop_label,
            "modelId": spec.model_id,
            "sourceUrl": spec.source_url,
            "revision": spec.revision,
            "license": spec.license,
            "licenseNote": spec.license_note,
            "architecture": spec.architecture,
            "library": spec.library,
            "classNames": list(spec.classes),
            "classCount": len(spec.classes),
            "classSource": spec.labels_source,
            "inputSize": spec.input_size,
            "preprocessing": spec.preprocess,
            "weightsSha256": spec.weights_sha256,
            "weightsBytes": spec.weights_bytes,
            "abstention": {
                "minConfidence": spec.min_confidence,
                "minMargin": spec.min_margin,
            },
            "publishedMetrics": [
                {
                    "name": m.name,
                    "value": m.value,
                    "unit": m.unit,
                    "source": m.source,
                    "note": m.note,
                }
                for m in spec.published_metrics
            ],
            "cautions": list(spec.cautions),
            "available": False,
            "loadError": None,
        }
        if missing:
            entry["loadError"] = "missing weight files: " + ", ".join(missing)
            return entry

        cached = self._cache.get(spec.crop)
        if isinstance(cached, ModelUnavailable):
            entry["loadError"] = cached.detail
            return entry
        if isinstance(cached, LoadedModel):
            entry["available"] = True
            return entry

        if self.check_checksum:
            actual = _sha256_file(registry.weights_path(spec, self.weights_dir))
            if actual != spec.weights_sha256:
                entry["loadError"] = (
                    "weight file checksum does not match the pinned revision "
                    f"(expected {spec.weights_sha256[:16]}…, found {actual[:16]}…)"
                )
                return entry
        entry["available"] = True
        return entry

    # ------------------------------------------------------------------- load

    def load(self, spec: registry.ModelSpec) -> LoadedModel:
        with self._lock:
            cached = self._cache.get(spec.crop)
            if isinstance(cached, LoadedModel):
                return cached
            if isinstance(cached, ModelUnavailable):
                raise cached
            started = time.perf_counter()
            try:
                loaded = self._load_locked(spec)
            except ModelUnavailable as exc:
                self._cache[spec.crop] = exc
                raise
            loaded.load_seconds = round(time.perf_counter() - started, 3)
            self._cache[spec.crop] = loaded
            return loaded

    def _load_locked(self, spec: registry.ModelSpec) -> LoadedModel:
        missing = self.missing_files(spec)
        if missing:
            raise ModelUnavailable(
                spec.crop,
                "weight files are not present (run services/inference/fetch_models.py): "
                + ", ".join(missing),
            )
        path = registry.weights_path(spec, self.weights_dir)
        actual = _sha256_file(path)
        if self.check_checksum and actual != spec.weights_sha256:
            raise ModelUnavailable(
                spec.crop,
                "SHA-256 of the weight file does not match the pinned revision "
                f"(expected {spec.weights_sha256}, found {actual})",
            )
        classes = read_published_labels(spec, self.weights_dir)
        model = _LOADERS[spec.library](spec, path, classes)
        return LoadedModel(
            spec=spec,
            model=model,
            device="cpu",
            sha256=actual,
            class_names=classes,
            load_seconds=0.0,
        )

    # ---------------------------------------------------------------- predict

    def predict(self, spec: registry.ModelSpec, image_bytes: bytes) -> dict:
        """Run the genuine model over one image and return a full record."""
        if not image_bytes:
            raise ValueError("empty image payload")
        decoded = decode_image(image_bytes)
        quality: QualityReport = assess(decoded, len(image_bytes))

        loaded = self.load(spec)
        tensor = preprocess(decoded, spec.preprocess)

        started = time.perf_counter()
        with torch.inference_mode():
            logits = loaded.model(tensor)
        latency_ms = round((time.perf_counter() - started) * 1000, 2)

        if logits.ndim != 2 or logits.shape[0] != 1:
            raise RuntimeError(f"unexpected model output shape {tuple(logits.shape)}")
        if logits.shape[1] != len(loaded.class_names):
            raise RuntimeError(
                "model output width "
                f"{logits.shape[1]} does not match {len(loaded.class_names)} class names"
            )
        probabilities = logits.softmax(dim=1)[0]
        probs = [float(p) for p in probabilities]
        order = sorted(range(len(probs)), key=lambda i: probs[i], reverse=True)
        top, runner = order[0], (order[1] if len(order) > 1 else None)
        margin = probs[top] - (probs[runner] if runner is not None else 0.0)

        reasons = list(quality.abstain_reasons)
        if probs[top] < spec.min_confidence:
            reasons.append(ABSTAIN_LOW_CONFIDENCE)
        if margin < spec.min_margin:
            reasons.append(ABSTAIN_INDISTINGUISHABLE)

        return {
            "crop": spec.crop,
            "model": self.model_info(spec),
            "image": {
                "width": quality.width,
                "height": quality.height,
                "bytes": quality.bytes_in,
                "meanLuma": quality.mean_luma,
                "laplacianVariance": quality.laplacian_variance,
                "foliageFraction": quality.foliage_fraction,
            },
            "quality": {
                "passed": quality.passed,
                "checks": [
                    {
                        "name": c.name,
                        "ok": c.ok,
                        "fatal": c.fatal,
                        "detail": c.detail,
                        "measured": c.measured,
                        "threshold": c.threshold,
                        "reasonCode": c.reason_code,
                    }
                    for c in quality.checks
                ],
            },
            "prediction": {
                "classIndex": top,
                "className": loaded.class_names[top],
                "probability": probs[top],
                "runnerUpClass": loaded.class_names[runner] if runner is not None else None,
                "runnerUpProbability": probs[runner] if runner is not None else None,
                "marginToRunnerUp": margin,
                "probabilities": probs,
                "calibrated": False,
                "calibrationNote": (
                    "This is not a calibrated probability. It is the raw softmax output of "
                    "the classifier, which has not been temperature-scaled or otherwise "
                    "calibrated, so it is a relative class score rather than a probability "
                    "that the diagnosis is correct."
                ),
            },
            "abstained": bool(reasons),
            "abstainReasons": reasons,
            "thresholds": {
                "minConfidence": spec.min_confidence,
                "minMargin": spec.min_margin,
            },
            "latencyMs": latency_ms,
        }
