# CropSentinel AI — local image inference service

Runs the two **genuine trained classifiers** the prototype ships with, behind one
HTTP contract.

| Crop | Model | Architecture | Classes | Licence | Weights |
|---|---|---|---|---|---|
| cotton | [`FarmGuard/cotton-densenet121`](https://huggingface.co/FarmGuard/cotton-densenet121) | DenseNet-121 (torchvision) | 4 | MIT | `best_densenet.pth`, 84.4 MB |
| soybean | [`ixrbhii/soybean-disease-convnext`](https://huggingface.co/ixrbhii/soybean-disease-convnext) | ConvNeXt-Small (timm) | 6 | CC-BY-4.0 | `model.safetensors` (fp16), 99.0 MB |

Both are pinned to a repository commit and verified by SHA-256 before use.

---

## 1. Why a separate service, and not the browser

The published weights are PyTorch artifacts: a `.pth` state dict and an fp16
`.safetensors` file. A browser cannot execute either format. The alternatives
were:

* **Convert both to ONNX and run them in the browser** with `onnxruntime-web`.
  Rejected as the primary path: it needs a conversion step (so the artifact that
  runs is no longer the artifact that was published and checked), adds a
  multi-megabyte WASM runtime, and would ship ~130 MB of model to every client.
  It remains a legitimate future option and is noted in the main README.
* **Run the published checkpoint in-process** in a small local service. Chosen:
  it executes the exact published file, it can be verified by checksum, it keeps
  inference out of the UI bundle, and the scanner already hides model choice
  behind `ScreeningModelAdapter`.

**The service is optional.** Without it, the whole application still works and
screens from reported symptoms, and the UI says that is what happened.

## 2. Setup

Requires Python 3.10+ (verified on 3.14). Torch and torchvision are CPU wheels;
no GPU or CUDA is needed.

```bash
# 1. dependencies (about 2 GB of wheels: torch is the bulk of it)
python -m pip install -r services/inference/requirements.txt

# 2. pinned weights + their published label files (about 183 MB, checksums verified)
python services/inference/fetch_models.py
#    or: npm run inference:fetch        (one crop: --crop cotton)

# 3. serve
python -m uvicorn cropsentinel_inference.app:app --host 127.0.0.1 --port 8000 \
  --app-dir services/inference
#    or: npm run inference:serve
```

Then set the URL in the app: **Settings → Image inference service → Service URL**
(default `http://127.0.0.1:8000`) and press **Test connection**.

Verify:

```bash
curl -s http://127.0.0.1:8000/health
curl -s -F crop=cotton -F image=@leaf.jpg http://127.0.0.1:8000/v1/screen
```

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `CROPSENTINEL_WEIGHTS_DIR` | `services/inference/weights` | where the weights live |
| `CROPSENTINEL_MAX_UPLOAD_BYTES` | `8388608` (8 MB) | upload limit |
| `CROPSENTINEL_SKIP_CHECKSUM` | unset | set to `1` to skip SHA-256 verification (development only) |
| `CROPSENTINEL_ALLOWED_ORIGIN_REGEX` | any loopback origin | CORS allow-list |

The service binds to loopback and allows only loopback origins by default. Do not
expose it: it has no authentication and no rate limiting.

## 3. API contract

### `GET /health`

```json
{
  "status": "ok",
  "service": "cropsentinel-inference",
  "apiVersion": "1.0.0",
  "weightsDir": "...",
  "checksumVerification": true,
  "supportedCrops": ["cotton", "soybean"],
  "anyModelAvailable": true,
  "models": [ /* the objects described below */ ]
}
```

### `GET /v1/models`

The same model objects, with a note explaining the routing rule. Each model
object carries: `crop`, `modelId`, `sourceUrl`, `revision`, `license`,
`licenseNote`, `architecture`, `library`, `classNames`, `classCount`,
`classSource`, `inputSize`, `preprocessing`, `weightsSha256`, `weightsBytes`,
`abstention` (`minConfidence`, `minMargin`), `publishedMetrics`, `cautions`,
`available`, `loadError`.

### `POST /v1/screen`

`multipart/form-data`:

| field | value |
|---|---|
| `crop` | `cotton` or `soybean` |
| `image` | the image file |

`POST /v1/screen/b64` accepts `{"crop": "...", "imageBase64": "..."}` (a plain
base64 body or a `data:` URL) instead.

```bash
curl -s -F crop=cotton -F image=@leaf.jpg http://127.0.0.1:8000/v1/screen | jq
```

```json
{
  "requestId": "9f2c1a40b7e1",
  "serviceVersion": "1.0.0",
  "totalMs": 104.2,
  "crop": "cotton",
  "model": { "modelId": "FarmGuard/cotton-densenet121", "revision": "22f8684…",
             "weightsSha256": "dfb01012…", "classNames": ["bacterial blight", "curl virus", "fussarium wilt", "healthy"],
             "preprocessing": "resize-256-center-crop-224", "preprocessingDetail": "Resize(shorter side 256, bilinear) → CenterCrop(224) → ToTensor → Normalize(…)",
             "abstention": { "minConfidence": 0.6, "minMargin": 0.2 }, "available": true, "loadError": null },
  "image": { "width": 640, "height": 640, "meanLuma": 118.4, "laplacianVariance": 214.6, "foliageFraction": 0.83 },
  "quality": { "passed": true, "checks": [ { "name": "exposure", "ok": true, "fatal": true, "detail": "…" } ] },
  "prediction": {
    "classIndex": 0, "className": "bacterial blight",
    "probability": 0.91, "probabilities": [0.91, 0.02, 0.01, 0.06],
    "runnerUpClass": "healthy", "runnerUpProbability": 0.06, "marginToRunnerUp": 0.85,
    "calibrated": false,
    "calibrationNote": "This is not a calibrated probability. It is the raw softmax output…"
  },
  "abstained": false,
  "abstainReasons": [],
  "thresholds": { "minConfidence": 0.6, "minMargin": 0.2 },
  "latencyMs": 88.1
}
```

### Status codes

| code | `error` | when |
|---|---|---|
| 200 | — | a prediction record (which may carry `abstained: true`) |
| 400 | `unsupported-crop` | the crop has no registered model |
| 413 | `payload-too-large` | upload above `CROPSENTINEL_MAX_UPLOAD_BYTES` |
| 422 | `invalid-image` | the bytes are not a decodable image |
| 503 | `model-unavailable` | the model is registered but cannot be loaded |
| 500 | `inference-failed` | an unexpected inference error |

### What the contract deliberately does not do

* **It never substitutes another crop's model.** `crop=tomato` is a 400. A cotton
  model run on a soybean photo would produce a confident, meaningless label.
* **It never returns a calibrated confidence.** `calibrated` is always `false`
  and `probability` is documented as a raw softmax class score. Neither model has
  been temperature-scaled or otherwise calibrated.
* **It never decides for the caller.** It reports quality, thresholds and reasons;
  the application decides what to do with them.
* **It never claims pest detection.** Neither model has a pest class.

## 4. Preprocessing (exactly as each model requires)

Implemented in `cropsentinel_inference/preprocess.py` and asserted against the
models' own libraries in `tests/test_preprocess_and_quality.py`.

| Model | Pipeline | Source |
|---|---|---|
| cotton | shorter side → 256, centre-crop 224, ToTensor, ImageNet normalise | the model card's stated transform |
| soybean | shorter side → 224, centre-crop 224, ToTensor, ImageNet normalise | `timm.data.create_transform` resolved from the model's published `pretrained_cfg` |

Two trapdoors are pinned down by tests, because both silently change predictions:

1. **timm's default is not the model's config.** Building `convnext_small`
   locally resolves `crop_pct` 0.95 (resize to 235, then centre-crop). The
   published config says 1.0. The service validates the published config on load
   and refuses to use the model if it drifts.
2. **"resize to 224 without cropping" is only equivalent for square photos.** The
   model card says exactly that. On a 4:3 camera photograph, a squash resize and
   a shorter-side resize differ by up to 1.7 in normalised pixel value. The
   service uses the library's transform, and a test asserts the two differ
   off-square and agree on-square.

## 5. Quality gates and abstention

`cropsentinel_inference/quality.py`. A classifier always returns *an* answer;
these gates decide whether an answer is worth having.

| Gate | Threshold | Failure code |
|---|---|---|
| shortest side | ≥ 128 px (warns below 224 px) | `image-too-small` |
| aspect ratio | ≤ 4:1 | `image-extreme-aspect` |
| mean luminance | 25–235 (0–255) | `image-extreme-exposure` |
| Laplacian variance | ≥ 18 | `image-blurry` |
| plant-material pixels | ≥ 20% | `image-no-foliage-detected` |

Plus two model-level abstention rules, both configurable per model in
`registry.py`:

| Crop | `minConfidence` | `minMargin` | Why |
|---|---|---|---|
| cotton | 0.60 | 0.20 | the card publishes no threshold, so a conservative default is used |
| soybean | 0.45 | 0.15 | the card's own guidance: "below about 45 % confidence, ask for a better photo" |

Threshold calibration: on in-focus field photographs of leaves the Laplacian
variance measured 60–400, and fell to 3–9 on a Gaussian-blurred copy of the same
photograph (σ = 6); 18 sits between the two with margin. Foliage fraction
measured 0.45–0.95 on leaf photos and 0.00–0.08 on sky, soil, grey and dark
controls; the 0.20 floor rejects imagery with no plant content while accepting
healthy green, chlorotic yellow and necrotic brown foliage. These are heuristics;
rejecting a usable photo costs a retake, accepting a useless one costs a wrong
diagnosis.

When a gate or a threshold fails, the service sets `abstained: true` and lists
every reason. The application then returns **Inconclusive** and routes the case to
expert review.

## 6. Measured performance — and why the UI shows it

`eval/RESULTS.md` (regenerate with `npm run inference:eval` or
`python services/inference/eval/evaluate.py --crop cotton --data <dir>`).

| Crop | Published (model card) | Measured here | Coverage | Images |
|---|---|---|---|---|
| cotton | 98.99 % test accuracy, 99.09 % macro-F1 | **53.4 % macro-F1**, 55.2 % accuracy | 84.8 % | 210 |
| soybean | 91.7 % test accuracy, 88.1 % macro-F1 | **54.6 % macro-F1**, 41.7 % accuracy | 77.2 % | 180 |

Accuracy counts an abstention as an error; coverage is the share the model was
willing to answer. The two worst classes are the ones a farmer most needs:

* cotton **curl virus recall 10 %** — the model labels 41 of 70 cotton-leaf-curl
  images `healthy`;
* soybean **rust recall 17 %** and **healthy recall 35 %** — most rust images are
  answered "Septoria Brown Spot".

The out-of-distribution probe is equally important: on conditions the model
cannot name (herbicide damage, leaf-hopper damage, leaf redding, leaf
variegation) it abstained only 27–47 % of the time and answered with a **mean
probability of 0.72–0.82**. Thresholds and quality gates therefore *cannot* be
relied on to catch an out-of-distribution photograph; only the merge rules in the
application can.

These numbers are a sanity check on a specific public dataset, not field
performance — the cotton model's training data is not published, so overlap
cannot be excluded either way. That caveat travels with the numbers into the UI.

Because of this, the application treats the model as one piece of evidence and
never as an oracle; it accepts a model-only "healthy" under no circumstances. See
"Turning a model result into a screening result" in the main README.

## 7. Tests

```bash
python -m pytest services/inference/tests -q      # 46 tests
```

Covers: registry provenance, SHA-256 verification, class-order validation (a
reordered `classes.json` or `label_names` makes the model unavailable), a drifted
preprocessing config, output-shape validation, preprocessing equivalence with
torchvision and timm, every quality gate, configurable abstention, crop routing,
the whole HTTP error surface (400/413/422/503/500), and that an unsupported crop
never leaks another crop's class names.

Tests that need the weights are skipped with a clear reason if they are not
downloaded.

## 8. Evaluation harness

```bash
# a labelled tree of <class-slug>/<images>, where every directory must be
# declared in eval/labels.json -- the tool stops rather than guess a label
python services/inference/eval/evaluate.py --crop cotton --data /path/to/labelled \
  --json out.json --out eval/RESULTS.md
```

It reports per-class precision/recall/F1/support, macro-F1, accuracy (abstentions
as errors), selective accuracy, coverage, a latency summary, a confusion matrix
with an explicit ABSTAIN column, and — for directories whose class this model
cannot name — abstention rate and what the model said when it did answer.

`--via-http http://127.0.0.1:8000` evaluates the running service instead of
loading the weights in-process.

## 9. Limitations

* **The measured accuracy is roughly half of what the cards advertise.** Neither
  model is fit for unsupervised field use. Everything in the app is designed
  around that fact rather than in spite of it.
* **No calibration.** Both models are uncalibrated, so no calibrated confidence
  exists to report. Temperature scaling on a labelled set is the obvious next
  step; it would need a set the models did not train on.
* **No OOD detector.** The quality gates catch bad *photographs*, not unknown
  *diseases*. A confident answer on an unfamiliar condition is expected
  behaviour, which is why the app never lets the model answer alone.
* **The cotton model's training data is unpublished**, so my evaluation cannot
  prove there is no overlap with it.
* **Two crops only.** Cotton and soybean. A third crop needs its own validated
  model; the service will refuse rather than improvise.
* **Weights are 183 MB** and are fetched, not committed (`.gitignore`).
* **CPU inference**: ~90 ms per image for DenseNet-121 and ~125 ms for
  ConvNeXt-Small, plus ~1–3 s for the first request while the weights load.

## 10. Attribution

* Cotton model: **MIT**, `FarmGuard/cotton-densenet121`.
* Soybean model: **CC-BY-4.0**, credit **"Multi-crop disease models, IXR
  (agritechixr)"** and the training datasets it names — **LeafNet (CC-BY-4.0)**
  and the authors' own field photographs.
* Evaluation data: `Project-AgML/cotton_leaf_disease_classification_bangladesh_2`
  (CC-BY-4.0); `anandvermagmailcom/soybean-leaf-diseases` (no licence declared —
  downloaded on demand for local verification and **not redistributed** with this
  project).
