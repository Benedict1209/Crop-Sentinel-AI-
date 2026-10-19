"""HTTP interface for the CropSentinel inference service.

Contract (also documented in services/inference/README.md):

    GET  /health          -> service + per-crop model availability
    GET  /v1/models       -> full provenance for every registered model
    POST /v1/screen       -> multipart/form-data: crop=<id>, image=<file>
    POST /v1/screen/b64   -> application/json: {"crop": "...", "imageBase64": "..."}

Status codes
    200  a prediction record (which may carry ``abstained: true``)
    400  the crop has no registered model (``error: unsupported-crop``)
    413  the upload is larger than the configured limit
    422  the payload is not a decodable image (``error: invalid-image``)
    503  the crop's model is registered but cannot be loaded (``error: model-unavailable``)

The service always says which model answered, at which revision, with which
class order, and whether the number returned is a calibrated probability (it is
not). It never invents a confidence and never substitutes another crop's model.
"""

from __future__ import annotations

import base64
import binascii
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, registry
from .engine import InferenceEngine, ModelUnavailable
from .preprocess import describe_pipeline

SERVICE_DIR = Path(__file__).resolve().parents[1]
WEIGHTS_DIR = Path(os.environ.get("CROPSENTINEL_WEIGHTS_DIR", SERVICE_DIR / "weights"))
MAX_UPLOAD_BYTES = int(os.environ.get("CROPSENTINEL_MAX_UPLOAD_BYTES", 8 * 1024 * 1024))
CHECK_CHECKSUM = os.environ.get("CROPSENTINEL_SKIP_CHECKSUM", "") not in {"1", "true", "yes"}

# The service binds to loopback and is consumed by a local dev server whose port
# can vary, so any loopback origin is allowed. Non-loopback origins are not,
# because the weights and the endpoints are not designed to be exposed.
ALLOWED_ORIGIN_REGEX = os.environ.get(
    "CROPSENTINEL_ALLOWED_ORIGIN_REGEX", r"^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$"
)

engine = InferenceEngine(WEIGHTS_DIR, check_checksum=CHECK_CHECKSUM)

app = FastAPI(
    title="CropSentinel AI inference service",
    version=__version__,
    description=(
        "Runs the trained cotton and soybean leaf classifiers behind a single "
        "contract. Softmax output is returned as a class score and is explicitly "
        "not a calibrated confidence."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _models_payload() -> list[dict]:
    return [engine.model_info(spec) for spec in registry.SPECS]


@app.get("/health")
def health() -> dict:
    models = _models_payload()
    return {
        "status": "ok",
        "service": "cropsentinel-inference",
        "apiVersion": __version__,
        "weightsDir": str(WEIGHTS_DIR),
        "checksumVerification": CHECK_CHECKSUM,
        "supportedCrops": registry.supported_crops(),
        "anyModelAvailable": any(m["available"] for m in models),
        "models": models,
    }


@app.get("/v1/models")
def models() -> dict:
    return {
        "apiVersion": __version__,
        "supportedCrops": registry.supported_crops(),
        "models": _models_payload(),
        "note": (
            "supportedCrops lists every crop this service has a validated model for. "
            "A crop outside that list is reported as unsupported rather than being run "
            "through another crop's classifier."
        ),
    }


def _screen(crop: str, data: bytes, request_id: str) -> dict:
    spec = registry.spec_for_crop(crop)
    if spec is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unsupported-crop",
                "detail": (
                    f"No validated model is registered for crop '{crop}'. The service "
                    "will not run a different crop's model."
                ),
                "requestedCrop": crop,
                "supportedCrops": registry.supported_crops(),
            },
        )
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "error": "payload-too-large",
                "detail": f"image is {len(data)} bytes; the limit is {MAX_UPLOAD_BYTES} bytes",
            },
        )
    started = time.perf_counter()
    try:
        payload = engine.predict(spec, data)
    except ModelUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "model-unavailable", "detail": exc.detail, "crop": crop},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid-image", "detail": str(exc)},
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "inference-failed", "detail": str(exc)},
        ) from exc

    payload["requestId"] = request_id
    payload["serviceVersion"] = __version__
    payload["totalMs"] = round((time.perf_counter() - started) * 1000, 2)
    payload["model"]["preprocessingDetail"] = describe_pipeline(spec.preprocess)
    return payload


@app.post("/v1/screen")
async def screen(request: Request, crop: str = Form(...), image: UploadFile = File(...)) -> dict:
    data = await image.read()
    return _screen(crop, data, uuid.uuid4().hex[:12])


@app.post("/v1/screen/b64")
async def screen_base64(request: Request) -> dict:
    body = await request.json()
    crop = str(body.get("crop", ""))
    encoded = str(body.get("imageBase64", ""))
    if "," in encoded and encoded.strip().lower().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        data = base64.b64decode(encoded, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid-image", "detail": f"base64 decode failed: {exc}"},
        ) from exc
    return _screen(crop, data, uuid.uuid4().hex[:12])


@app.exception_handler(ModelUnavailable)
async def _model_unavailable(_request: Request, exc: ModelUnavailable) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"error": "model-unavailable", "detail": exc.detail, "crop": exc.crop},
    )
