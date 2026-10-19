"""Preprocessing equivalence and quality-gate tests."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from cropsentinel_inference import preprocess as pp  # noqa: E402
from cropsentinel_inference import quality as q  # noqa: E402
from conftest import WEIGHTS, leaf_image  # noqa: E402

torch = pytest.importorskip("torch")

# A square photo and a deliberately non-square one, because the two pipelines
# differ in how they handle aspect ratio (Resize(256) keeps it; Resize((224,224))
# does not).
SQUARE = leaf_image(size=512)


def _wide_image() -> bytes:
    image = Image.open(io.BytesIO(leaf_image(size=512))).convert("RGB").resize((800, 400))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_decode_rejects_non_images():
    with pytest.raises(ValueError):
        pp.decode_image(b"this is not an image")


def test_decode_returns_rgb():
    image = pp.decode_image(SQUARE)
    assert image.mode == "RGB"
    assert image.size == (512, 512)


def test_cotton_pipeline_matches_the_model_card():
    """The card specifies Resize(256) -> CenterCrop(224) -> ToTensor -> Normalize."""
    from torchvision import transforms

    expected = transforms.Compose(
        [
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(pp.IMAGENET_MEAN, pp.IMAGENET_STD),
        ]
    )
    for raw in (SQUARE, _wide_image()):
        image = pp.decode_image(raw)
        ours = pp.preprocess(image, pp.COTTON_PIPELINE)
        theirs = expected(image).unsqueeze(0)
        assert ours.shape == (1, 3, 224, 224)
        assert torch.allclose(ours, theirs, atol=0)


def test_soybean_pipeline_matches_timm_resolved_transform():
    """The card says images were resized to 224x224 without cropping.

    Resolved from the model's *published* pretrained_cfg (input_size 224,
    crop_pct 1.0, crop_mode centre), timm produces Resize((224,224)) plus a no-op
    CenterCrop(224) -- which is what our manual pipeline must reproduce exactly.

    Note the trap this guards: building convnext_small locally without the
    published cfg resolves crop_pct 0.95 (resize 235 then centre-crop), which
    would change every prediction. `engine._validate_published_preprocessing`
    makes a drifted config fail the load instead.
    """
    timm = pytest.importorskip("timm")
    published = json.loads((WEIGHTS / "soybean_convnext/config.json").read_text(encoding="utf-8"))
    cfg = dict(published["pretrained_cfg"])
    cfg["input_size"] = tuple(cfg["input_size"])

    model = timm.create_model("convnext_small", pretrained=False, num_classes=6, pretrained_cfg=cfg)
    config = timm.data.resolve_data_config({}, model=model)
    assert config["input_size"] == (3, 224, 224)
    assert config["crop_pct"] == 1.0
    assert config["crop_mode"] == "center"
    theirs_transform = timm.data.create_transform(**config, is_training=False)

    for raw in (SQUARE, _wide_image()):
        image = pp.decode_image(raw)
        ours = pp.preprocess(image, pp.SOYBEAN_PIPELINE)
        theirs = theirs_transform(image).unsqueeze(0)
        assert ours.shape == (1, 3, 224, 224)
        assert torch.allclose(ours, theirs, atol=0), (
            "manual soybean preprocessing diverged from timm's resolved transform"
        )


def test_a_squash_resize_would_differ_and_is_therefore_not_used():
    """Documents why the soybean pipeline resizes the shorter side.

    The model card's prose says training resized images straight to 224x224, and
    that timm's transform "gives the same result for square photos". It does -
    but only for square photos. This test pins that down so nobody 'simplifies'
    the pipeline back to a squash resize, which would silently change every
    prediction on a normal 4:3 camera photograph.
    """
    from torchvision import transforms

    image = pp.decode_image(_wide_image())
    squash = transforms.Compose(
        [
            transforms.Resize((224, 224), antialias=True),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(pp.IMAGENET_MEAN, pp.IMAGENET_STD),
        ]
    )(image).unsqueeze(0)
    ours = pp.preprocess(image, pp.SOYBEAN_PIPELINE)
    assert not torch.allclose(ours, squash, atol=1e-3)
    # ...and on a square photo the two agree, which is what the card observed.
    square = pp.decode_image(SQUARE)
    squash_square = transforms.Compose(
        [
            transforms.Resize((224, 224), antialias=True),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(pp.IMAGENET_MEAN, pp.IMAGENET_STD),
        ]
    )(square).unsqueeze(0)
    assert torch.allclose(pp.preprocess(square, pp.SOYBEAN_PIPELINE), squash_square, atol=1e-5)


def test_unknown_pipeline_is_rejected():
    with pytest.raises(ValueError):
        pp.preprocess(pp.decode_image(SQUARE), "no-such-pipeline")


def test_describe_pipeline_is_honest():
    assert "Resize" in pp.describe_pipeline(pp.COTTON_PIPELINE)
    assert "shorter side 224" in pp.describe_pipeline(pp.SOYBEAN_PIPELINE)
    assert "timm" in pp.describe_pipeline(pp.SOYBEAN_PIPELINE)
    assert "unknown pipeline" in pp.describe_pipeline("nope")


# ----------------------------------------------------------------- quality ---


def test_a_good_leaf_photo_passes_every_gate():
    report = q.assess(pp.decode_image(leaf_image()), 1024)
    assert report.passed, [c.detail for c in report.fatal_failures]
    assert report.foliage_fraction >= q.MIN_FOLIAGE_FRACTION
    assert report.laplacian_variance >= q.MIN_LAPLACIAN_VARIANCE


def test_a_dark_frame_fails_exposure_focus_and_foliage():
    dark = Image.new("RGB", (400, 400), (10, 10, 10))
    buffer = io.BytesIO()
    dark.save(buffer, format="PNG")
    report = q.assess(pp.decode_image(buffer.getvalue()), 1024)
    assert not report.passed
    assert "image-extreme-exposure" in report.abstain_reasons
    assert "image-no-foliage-detected" in report.abstain_reasons


def test_a_blurred_photo_fails_the_focus_gate():
    report = q.assess(pp.decode_image(leaf_image(blur=8.0)), 1024)
    assert not report.passed
    assert "image-blurry" in report.abstain_reasons


def test_a_tiny_image_fails_the_dimension_gate():
    tiny = Image.open(io.BytesIO(leaf_image())).resize((64, 64))
    buffer = io.BytesIO()
    tiny.save(buffer, format="PNG")
    report = q.assess(pp.decode_image(buffer.getvalue()), 512)
    assert "image-too-small" in report.abstain_reasons


def test_an_extreme_crop_fails_the_aspect_gate():
    sliver = Image.open(io.BytesIO(leaf_image())).resize((1024, 128))
    buffer = io.BytesIO()
    sliver.save(buffer, format="PNG")
    report = q.assess(pp.decode_image(buffer.getvalue()), 2048)
    assert "image-extreme-aspect" in report.abstain_reasons


def test_a_small_but_usable_photo_warns_without_abstaining():
    small = Image.open(io.BytesIO(leaf_image())).resize((160, 160))
    buffer = io.BytesIO()
    small.save(buffer, format="PNG")
    report = q.assess(pp.decode_image(buffer.getvalue()), 512)
    warn = [c for c in report.checks if c.name == "model-input-size"]
    assert warn and warn[0].ok is False and warn[0].fatal is False
    assert "image-below-model-input" not in report.abstain_reasons


def test_a_greyscale_scene_does_not_look_like_foliage():
    grey = Image.new("RGB", (400, 400), (128, 128, 128))
    buffer = io.BytesIO()
    grey.save(buffer, format="PNG")
    report = q.assess(pp.decode_image(buffer.getvalue()), 1024)
    assert "image-no-foliage-detected" in report.abstain_reasons
