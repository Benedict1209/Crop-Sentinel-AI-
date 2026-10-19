"""Image quality and out-of-distribution screening.

A classifier always returns *an* answer. This module decides whether a photo is
worth classifying at all, so the application can abstain and ask for a better
photograph instead of reporting a confident label for a black, blurry, tiny or
non-foliage image.

Every gate is a documented heuristic, not a validated image-quality model. Each
one reports the measurement it made, so the decision is auditable and the app
can show the operator *why* it abstained. Thresholds are module constants and
can be overridden through the service's settings object.

The green/hue and blur gates were calibrated against a set of real cotton and
soybean leaf photographs (see README "Calibration"); they are conservative by
design: rejecting a usable photo costs a retake, accepting a useless one costs a
wrong diagnosis.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image

# ------------------------------------------------------------------ thresholds

MIN_SIDE_PX = 128
"""Shortest side below which there is too little detail to classify."""

WARN_SIDE_PX = 224
"""Below the model input size we accept the image but warn about it."""

MIN_MEAN_LUMA = 25.0
"""Mean 0-255 luminance below this is an almost black exposure."""

MAX_MEAN_LUMA = 235.0
"""Mean 0-255 luminance above this is an effectively blown-out exposure."""

MIN_LAPLACIAN_VARIANCE = 18.0
"""Variance of the Laplacian on the 224 px grayscale view.

Measured values: in-focus field photographs of leaves gave 60-400; a uniformly
blurred (Gaussian sigma 6) version of the same photograph fell to 3-9. 18 sits
between the two with margin, so genuine detail survives and mush does not.
"""

MIN_FOLIAGE_FRACTION = 0.20
"""Fraction of pixels that must look like plant material (green/yellow/brown).

Deliberately wide: healthy green foliage, chlorotic yellow leaves and necrotic
brown lesions all count. What it rejects is imagery with essentially no plant
content - sky, soil, concrete, a screenshot, a person. Measured on leaf photos:
0.45-0.95; on sky/soil/dark-frame controls: 0.00-0.08.
"""

MAX_ASPECT_RATIO = 4.0
"""Panoramic or sliver crops cannot contain a single leaf filling the frame."""

# Hue bands (degrees, OpenCV convention mapped to PIL's 0-255 hue scale) taken as
# vegetation. Covers yellow-green (chlorosis) through deep green to brown.
_FOLIAGE_HUE_RANGE = (0.06, 0.47)  # PIL hue 0-1
_MIN_SATURATION = 0.12
_MIN_VALUE = 0.10


@dataclass
class Check:
    """Result of a single quality gate."""

    name: str
    ok: bool
    detail: str
    measured: float | int | str | None = None
    threshold: float | int | None = None
    reason_code: str | None = None
    fatal: bool = True


@dataclass
class QualityReport:
    """Outcome of all gates for one image."""

    checks: list[Check] = field(default_factory=list)
    width: int = 0
    height: int = 0
    decoded_format: str = ""
    bytes_in: int = 0
    mean_luma: float = 0.0
    laplacian_variance: float = 0.0
    foliage_fraction: float = 0.0

    @property
    def fatal_failures(self) -> list[Check]:
        return [c for c in self.checks if not c.ok and c.fatal]

    @property
    def passed(self) -> bool:
        return not self.fatal_failures

    @property
    def abstain_reasons(self) -> list[str]:
        out: list[str] = []
        for c in self.fatal_failures:
            if c.reason_code and c.reason_code not in out:
                out.append(c.reason_code)
        return out


def _laplacian_variance(gray: np.ndarray) -> float:
    """Variance of a 4-neighbour Laplacian, a standard focus measure."""
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    lap = (
        -4.0 * gray[1:-1, 1:-1]
        + gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
    )
    return float(lap.var())


def _foliage_fraction(rgb: np.ndarray) -> float:
    """Fraction of pixels whose hue/saturation look like plant material."""
    hsv = np.asarray(Image.fromarray(rgb).convert("HSV"), dtype=np.float32) / 255.0
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    lo, hi = _FOLIAGE_HUE_RANGE
    in_hue = (hue >= lo) & (hue <= hi)
    mask = in_hue & (sat >= _MIN_SATURATION) & (val >= _MIN_VALUE)
    return float(mask.mean())


def assess(image: Image.Image, data_len: int) -> QualityReport:
    """Run every gate over a decoded RGB image."""
    report = QualityReport(
        width=image.width,
        height=image.height,
        decoded_format=getattr(image, "format", "") or "",
        bytes_in=data_len,
    )

    side = min(image.width, image.height)
    report.checks.append(
        Check(
            name="min-dimension",
            ok=side >= MIN_SIDE_PX,
            detail=f"shortest side {side}px (minimum {MIN_SIDE_PX}px)",
            measured=side,
            threshold=MIN_SIDE_PX,
            reason_code="image-too-small",
        )
    )
    report.checks.append(
        Check(
            name="model-input-size",
            ok=side >= WARN_SIDE_PX,
            detail=(
                f"shortest side {side}px is below the {WARN_SIDE_PX}px model input; "
                "the photo is upscaled before inference"
            ),
            measured=side,
            threshold=WARN_SIDE_PX,
            reason_code="image-below-model-input",
            fatal=False,
        )
    )

    aspect = max(image.width, image.height) / max(1, side)
    report.checks.append(
        Check(
            name="aspect-ratio",
            ok=aspect <= MAX_ASPECT_RATIO,
            detail=f"aspect ratio {aspect:.2f} (maximum {MAX_ASPECT_RATIO})",
            measured=round(aspect, 2),
            threshold=MAX_ASPECT_RATIO,
            reason_code="image-extreme-aspect",
        )
    )

    small = image.convert("RGB").resize((224, 224), Image.BILINEAR)
    arr = np.asarray(small, dtype=np.float32)
    gray = np.asarray(small.convert("L"), dtype=np.float32)

    luma = float(gray.mean())
    report.mean_luma = round(luma, 2)
    exposure_ok = MIN_MEAN_LUMA <= luma <= MAX_MEAN_LUMA
    report.checks.append(
        Check(
            name="exposure",
            ok=exposure_ok,
            detail=(
                f"mean luminance {luma:.1f} (usable {MIN_MEAN_LUMA:.0f}-{MAX_MEAN_LUMA:.0f})"
            ),
            measured=round(luma, 2),
            threshold=MAX_MEAN_LUMA,
            reason_code="image-extreme-exposure",
        )
    )

    # Only judge sharpness on an image that is actually exposed; a black frame has
    # no detail to measure and would otherwise pass as "sharp".
    lap = _laplacian_variance(gray) if exposure_ok else 0.0
    report.laplacian_variance = round(lap, 2)
    report.checks.append(
        Check(
            name="focus",
            ok=lap >= MIN_LAPLACIAN_VARIANCE,
            detail=(
                f"Laplacian variance {lap:.1f} below the {MIN_LAPLACIAN_VARIANCE:.0f} "
                "sharpness threshold"
            ),
            measured=round(lap, 2),
            threshold=MIN_LAPLACIAN_VARIANCE,
            reason_code="image-blurry",
        )
    )

    foliage = _foliage_fraction(arr.astype(np.uint8))
    report.foliage_fraction = round(foliage, 3)
    report.checks.append(
        Check(
            name="foliage-present",
            ok=foliage >= MIN_FOLIAGE_FRACTION,
            detail=(
                f"only {foliage * 100:.1f}% of pixels look like plant material "
                f"(minimum {MIN_FOLIAGE_FRACTION * 100:.0f}%)"
            ),
            measured=round(foliage, 3),
            threshold=MIN_FOLIAGE_FRACTION,
            reason_code="image-no-foliage-detected",
        )
    )

    return report
