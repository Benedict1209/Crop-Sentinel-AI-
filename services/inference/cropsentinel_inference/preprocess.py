"""Exact, documented image preprocessing for each registered model.

Why this module exists
----------------------
A classifier returns confident nonsense when the input is transformed
differently from training. Each model declares its pipeline by id in
``registry.ModelSpec.preprocess`` and this module implements that pipeline
verbatim. The test suite compares our implementation against the transform
resolved by the model's own library (torchvision / timm) on the same image, so
"exactly as required" is checked rather than asserted.

ImageNet normalisation is shared by both models because both were trained with
it (the cotton model card states mean/std explicitly; the soybean model's
``config.json`` carries the same pretrained_cfg).
"""

from __future__ import annotations

import io

from PIL import Image
from torchvision import transforms

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)

# Preprocessing pipeline ids (values of registry.ModelSpec.preprocess).
#: Cotton model card: Resize(256) -> CenterCrop(224) -> ToTensor -> Normalize.
COTTON_PIPELINE = "resize-256-center-crop-224"
#: Soybean: whatever `timm.data.create_transform` resolves from the model's own
#: published pretrained_cfg. Measured, not assumed -- it comes out as
#: Resize(224) on the SHORTER side plus CenterCrop(224), not a squash resize.
#: The two coincide for square photographs, which is what the model card means
#: by "gives the same result for square photos"; they diverge on a 4:3 camera
#: photo, so the pipeline must match timm rather than the prose.
SOYBEAN_PIPELINE = "resize-224-shorter-side-center-crop-224"


def decode_image(data: bytes) -> Image.Image:
    """Decode arbitrary image bytes to RGB, rejecting anything unreadable.

    Raises:
        ValueError: the bytes are not a decodable image.
    """
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.load()
    except Exception as exc:  # PIL raises a family of exceptions
        raise ValueError(f"not a decodable image: {exc}") from exc
    image = Image.open(io.BytesIO(data))
    image.load()
    return image.convert("RGB")


def _pipeline(pipe: str) -> transforms.Compose:
    if pipe == COTTON_PIPELINE:
        # torchvision.transforms.Resize(int) resizes the *shorter* side, which is
        # what the model card's Resize(256) means.
        return transforms.Compose(
            [
                transforms.Resize(256),
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
    if pipe == SOYBEAN_PIPELINE:
        # Resize(int) in torchvision resizes the *shorter* side and keeps the
        # aspect ratio, exactly like the transform timm resolves for this
        # checkpoint. Verified byte-for-byte against timm in
        # tests/test_preprocess_and_quality.py.
        return transforms.Compose(
            [
                transforms.Resize(224, antialias=True),
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
    raise ValueError(f"unknown preprocessing pipeline: {pipe!r}")


def preprocess(image: Image.Image, pipe: str):
    """Return a (1, 3, H, W) float32 tensor ready for the model."""
    return _pipeline(pipe)(image).unsqueeze(0)


def describe_pipeline(pipe: str) -> str:
    """Human-readable statement of the pipeline, surfaced in API responses."""
    if pipe == COTTON_PIPELINE:
        return (
            "Resize(shorter side 256, bilinear) -> CenterCrop(224) -> ToTensor -> "
            "Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225])"
        )
    if pipe == SOYBEAN_PIPELINE:
        return (
            "Resize(shorter side 224, bilinear) -> CenterCrop(224) -> ToTensor -> "
            "Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]) "
            "(identical to timm.data.create_transform resolved from this model's published "
            "pretrained_cfg: input_size 224, crop_pct 1.0, crop_mode centre)"
        )
    return f"unknown pipeline {pipe!r}"
