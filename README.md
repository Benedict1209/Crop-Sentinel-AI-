# CropSentinel AI

**Detect Early. Act Precisely. Protect Every Harvest.**

Smart India Hackathon 2026 prototype — Team **Code Bites** — Problem Statement **26131**
*Early Detection and Management of Crop Diseases and Pest Infestions* (Government of Maharashtra,
Maharashtra State Innovation Society; Software; Agriculture, FoodTech & Rural Development).

A runnable crop-health intelligence application for **cotton and soybean in Maharashtra**:
genuine image-based disease screening by trained classifiers, pest-trap and field observations, an
explainable weather-driven risk engine, geospatial hotspot mapping, multilingual integrated pest
management advisories (**Marathi by default**, English and Tamil selectable), an expert-validation
workflow and a follow-up monitoring cycle.

---

## 1. Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5183

python -m pip install -r services/inference/requirements.txt   # ~2 GB, torch is the bulk
python services/inference/fetch_models.py                      # ~183 MB, pinned + checksum-verified
python -m uvicorn cropsentinel_inference.app:app --host 127.0.0.1 --port 8000 --app-dir services/inference
```

No registration, no API key and no network access are required. The demonstration dataset is
generated locally on first run and persisted in the browser's `localStorage`
(key `cropsentinel-ai-v1`). **Demo mode → Reset demo data** regenerates the seed dataset at any
time (deterministic: the same dataset every reset).

### Optional: enable the trained image models

Everything below works without this. With a photograph of a cotton or soybean leaf, screening gets
**genuinely better evidence** when the inference service is running.

Then **Settings → Image inference service → Test connection**. Full detail, API contract and model
provenance: [services/inference/README.md](services/inference/README.md).

### All scripts

```bash
npm run typecheck            # tsc --noEmit
npm run build                # tsc --noEmit && vite build → dist/
npm run preview              # serve the production build
npm run test                 # 49 front-end tests (vitest)
npm run inference:serve      # start the model service
npm run inference:fetch      # download the pinned model weights
npm run inference:test       # 46 service tests (pytest)
npm run inference:eval       # measure the models on a labelled image set
```

### A note on stored data

The store schema is version **2**. A version-1 demonstration dataset is discarded and re-seeded
rather than migrated: a v1 scan has no image-model metadata, and rendering one with missing model
fields is exactly the kind of silent inconsistency this prototype must not have.

---

## 2. What is genuinely implemented

| Area | Status | Notes |
|---|---|---|
| Image-based disease screening | **Genuine trained models** for cotton and soybean | Runs the published checkpoints in a local service; see §3 |
| Model adapter seam (`ScreeningModelAdapter`) | **Implemented, three engines** | Inference service (active), browser export (inactive seam), rule analyzer (always available) |
| Multilingual UI | **Implemented — Marathi default** | Marathi, English, Tamil; navigation, scanner, severity, advisories, follow-up, safety, and the model report |
| Dashboard (farmer + officer) | **Implemented** | Every tile, filter, chart and table is computed from the store; nothing is hard-coded per screen |
| Image upload, preview, replace, remove | **Implemented** | Files are downscaled to 720 px JPEG before storage |
| Screening workflow end-to-end | **Implemented** | Crop, variety, stage, farm, plot, location, 35 symptoms, notes |
| Screening engine | **Hybrid** | Trained model output merged with the rule engine, kept separately visible; see §3 |
| Risk engine | **Implemented heuristic** | Documented, user-tunable weights; reproducible; missing inputs listed, not zero-scored |
| Pest-trap / field observations | **Implemented** | Manual entry, trend chart, thresholds, alerts, plot history |
| Weather | **Simulated by default**, live **Open-Meteo** optional | Free, key-less provider; observed / forecast / simulated days are labelled distinctly |
| Hotspot map | **Implemented** | Real Mercator projection of real district-headquarter coordinates onto a **schematic** graticule base — not a survey boundary |
| Expert validation workflow | **Implemented demo workflow** | Reviewer actions are performed by the demo user; no live KVK service is connected |
| Feedback / evaluation dataset | **Implemented** | Only expert-confirmed rows are training-eligible; CSV export |
| Farm & plot CRUD | **Implemented** | Create, read, update, delete with cascade to scans, traps, cases, follow-ups |
| Reports, CSV export, print layout | **Implemented** | CSV is generated locally; `@media print` stylesheet hides navigation |
| Persistence | **Implemented** | `localStorage` via zustand `persist` |
| Automated tests | **Implemented** | 49 front-end (vitest) + 46 service (pytest) |
| Image-based trap counting | **Not implemented** | Data model carries an optional `cvCount` field as the integration point |

## 3. The trained models, and how a prediction becomes a screening result

### Data flow

```
photograph ──► Scanner (browser)
                  │  crop, symptoms, stage, weather, plot history
                  ▼
        runScreening()  ──────────────────────────────┐
                  │                                  │
                  │ POST /v1/screen (multipart)      │ rule engine (always runs)
                  ▼                                  ▼
   local inference service                   demo-rule-base-v1
     • SHA-256 verify the weights              transparent weighted
     • validate published class order           knowledge base, no
     • validate published preprocessing         confidence claimed
     • quality gates → abstain?
     • forward pass → raw softmax
                  │                                  │
                  └──────────► combineWithModel() ◄──┘
                                    │
                     one ScreeningResult carrying BOTH:
                       modelInference  (provenance, scores, gates)
                       ruleAssessment  (the symptom assessment)
                       dispositionSource (which one the answer rests on)
```

### What the models are

| Crop | Model | Architecture | Classes | Licence | Weights | Revision |
|------|-------|--------------|---------|---------|---------|----------|
| cotton | `FarmGuard/cotton-densenet121` | DenseNet-121 (torchvision) | bacterial blight, curl virus, fussarium wilt, healthy | MIT | `best_densenet.pth` 84.4 MB | `22f86842…` |
| soybean | `ixrbhii/soybean-disease-convnext` | ConvNeXt-Small (timm) | downy mildew, frogeye leaf spot, healthy, mosaic virus, rust, septoria brown spot | CC-BY-4.0 | `model.safetensors` 99.0 MB | `dd564d08…` |

### Measured performance — and why the UI shows it

| Crop | Published (model card) | Measured here | Coverage | Images | Worst class |
|---|---|---|---|---|---|
| cotton | 98.99% test accuracy · 99.09% macro-F1 | **53.4% macro-F1**, 55.2% accuracy | 84.8% | 210 | curl virus recall **10%**: 41/70 curl images labelled `healthy` |
| soybean | 91.7% test accuracy · 88.1% macro-F1 | **54.6% macro-F1**, 41.7% accuracy | 77.2% | 180 | rust recall **17%**, healthy recall **35%** |

Source: `services/inference/eval/RESULTS.md`, produced by `eval/evaluate.py` on
`Project-AgML/cotton_leaf_disease_classification_bangladesh_2` (CC-BY-4.0) and
`anandvermagmailcom/soybean-leaf-diseases`. These are a sanity check on public research data, not
field performance — the cotton model's training data is unpublished, so overlap cannot be excluded.

The two worst classes are the ones a farmer most needs to catch: the cotton model calls
**41 of 70** cotton-leaf-curl images `healthy`, and the soybean model misses **83%** of rust images.
The models are not fit for unsupervised use, and the application is built around that rather than in
spite of it.

### The merge rules (conservative by construction)

1. A **model-only "healthy" is never accepted.** A false "healthy" is the dangerous error and the
   measurement shows it is a common one. If symptoms were reported and the classifier says healthy,
   the result is **Inconclusive** and goes to expert review.
2. **Disagreement is never resolved in the model's favour.** Two different named conditions produce
   Inconclusive plus an expert referral, with both names shown.
3. **Agreement is reported as agreement** and is stronger evidence than either source alone — but
   still uncalibrated, so it is confirmed with an extension officer before treatment.
4. The model can lead on its own only when the **symptom report named nothing**, and then the result
   is labelled *classifier only*, discloses the measured performance, and always refers to an expert.
5. **An abstention never becomes a disease conclusion**, and always triggers expert review.
6. **A pest suspicion is never attributed to a model.** Neither classifier has a pest class, so pest
   conclusions stay with the rule engine and the result says so.
7. **No cross-crop inference.** A crop without a validated model gets `unsupported-crop`; the other
   crop's model is never substituted.
8. **A synthetic demonstration image is never sent to a real model.**

### Truthfulness guarantees

* `confidence` is **always `null`**. Neither model is calibrated, so no calibrated confidence exists.
  The raw softmax value is reported separately, named a *class score*, and marked `calibrated: false`.
* `isDemonstration` is `true` whenever **no trained model produced the answer** (including an
  abstention), and is derived from the stored model metadata so it cannot contradict it.
* Every scan persists full model provenance: model id, pinned revision, weights SHA-256, licence,
  class order, all class scores, thresholds, image-quality measurements, and the request id.
* The CSV export carries `disposition_source`, `image_model_outcome`, `image_model_id`,
  `image_model_revision`, `image_model_class`, `image_model_raw_score`, `image_model_abstained` and
  `image_model_calibrated` — and an **empty** `confidence` column.

## 4. What is simulated — stated plainly

* **All records are demo data.** Farms, farmers, coordinates, dates, trap counts and notifications
  are synthetic. They are not verified government or field data.
* **Seeded screening results come from the rule engine, not from a model.** The built-in sample
  images are synthetic drawings, so no trained model is run on them; every seeded scan says so.
* **Sample images are synthetic.** They are SVG leaves rendered by the app and watermarked
  *"SYNTHETIC DEMO IMAGE — NOT A FIELD PHOTOGRAPH"*, with an `origin` field shown in the UI, the
  report and the CSV.
* **The rule/knowledge-base screening engine is not a trained model.** It reports `confidence: null`
  and performs no pixel inference. Its weather-favourability windows are generic agronomic
  associations, **not** validated epidemiological coefficients.
* **Pest thresholds are illustrative**, labelled as demo values.
* **Weather is simulated unless you switch to Open-Meteo**, and simulated days are tagged `simulated`.
* **The expert-review queue is a simulated workflow.** No live expert or laboratory service is
  connected. Nothing is retrained and nothing learns online.
* **The map base is schematic** — a lat/long graticule with district centroids, not a survey boundary.
* **Chemical guidance never includes doses.**

## 5. Architecture

```
src/
  domain/          types.ts         — single source of truth for every model
                   knowledge.ts     — crops, symptom vocabulary, condition catalogue
                   modelLabels.ts   — trained-model class → condition map + MEASURED performance
                   seed.ts          — deterministic demonstration dataset
  lib/             screening.ts     — the three adapters + runScreening(), the rule engine
                   modelScreening.ts— the model↔rule merge rules (the conservative core)
                   inferenceClient.ts— HTTP client, response validation, error typing
                   risk.ts, weather.ts, advisories.ts, geo.ts, store.ts,
                   selectors.ts, i18n.ts, exports.ts, format.ts,
                   sampleCases.ts, sampleImages.ts
  components/      AppShell, ui kit, charts, ModelInferencePanel,
                   ScanResultView, RiskFactorList, HotspotMap
  pages/           Dashboard, OfficerDashboard, Scanner, Traps, RiskForecast,
                   HotspotMap, Advisories, Farms, FarmDetail, PlotDetail,
                   Reports, ReportDetail, ExpertReview, FeedbackDataset, Settings

services/inference/                 — genuine model execution (see its README)
  cropsentinel_inference/  registry.py (pinned provenance), engine.py
                           (load/validate/predict), preprocess.py,
                           quality.py, app.py (FastAPI contract)
  eval/                    evaluate.py + labels.json + RESULTS.md
  tests/                   46 pytest tests
  fetch_models.py          pinned, checksum-verified weight download
```

**Integration points prepared (present but intentionally not enabled, because they cannot be tested
here):** the browser-model adapter (`window.__cropSentinelModelLoader`), PostgreSQL behind FastAPI,
GIS tile services, expert/laboratory systems. The store's actions are the persistence boundary —
swapping the zustand middleware for HTTP calls is the migration path, and `project()` in `geo.ts`
isolates map maths so a real boundary can replace the schematic base.

## 6. Verification performed

### Automated

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vite build` | **exit 0** (`dist/` 18.3 kB CSS + 971 kB JS) |
| `npm test` (vitest) | **49 passed** |
| `python -m pytest services/inference/tests` | **46 passed** |
| `python services/inference/eval/evaluate.py` | **produced `eval/RESULTS.md`** (210 cotton + 180 soybean measured) |

The front-end suite covers: every model↔rule merge path (agreement, conflict, model-only, both
abstention cases, unmapped class, pest), the no-photograph and synthetic-image refusals, cross-crop
refusal (asserting the service is **never called**), unreachable service, a non-JSON response (the
SPA-fallback guard), CSV column truthfulness, the Marathi default, every literal `t('…')` key across
all source files resolving in English with the model keys also translated into Marathi, and store
persistence/defaults.

The service suite covers: registry provenance, SHA-256 verification, class-order validation (a
reordered `classes.json` or `label_names` makes the model unavailable), a drifted preprocessing
config, output-shape validation, preprocessing equivalence with torchvision **and timm**, every
quality gate, configurable abstention, crop routing, the full HTTP error surface (400/413/422/503/500),
and that an unsupported crop never leaks another crop's class names.

### Behavioural (driving the running application)

Chromium against the Vite dev server, with the inference service running:

* Default language is **Marathi** on a fresh store; the sidebar, scanner, severity labels, charts,
  map and advisories render in Marathi; switching to English and Tamil works and persists.
* **Model ran and was overruled** — a cotton bacterial-blight photograph the classifier called
  `healthy` at 0.831 while the symptom assessment named cotton bacterial blight: result
  **Inconclusive**, `disposition_source = model-rule-conflict`, `uncertainty = unc.modelSaysHealthy`,
  expert referral required, `confidence: null`.
* **Model led** — a photograph with no symptoms reported: `disposition_source = model-only`,
  `isDemonstration = false`, referral required, measured performance shown with the caveat.
* **Abstention** — a dark frame produced `image-extreme-exposure`, `image-blurry`,
  `image-no-foliage-detected` and `low-confidence`; result Inconclusive, expert review, and the raw
  argmax was **not** used as the answer.
* **Cross-crop refusal** — a tomato photograph: `unsupported-crop`, no model called, no class named.
* **Synthetic refusal** — a built-in sample: `not-attempted`, no model called.
* **Service down** — with the URL pointed at a closed port: `service-unavailable` with a readable
  message, and the symptom workflow still produced a result.
* **Settings** reports the live service, 2 models ready, checksum verification on, and lists the
  crops without a model.
* No console errors from application code across the flows.

### Not verified, so not claimed

* The live **Open-Meteo** provider was not exercised against the real API in this environment.
* The browser **print dialog / PDF output** was not opened; only the `@media print` rules were
  confirmed.
* **No field validation.** The measured numbers come from public research datasets, not from
  Maharashtra fields; the cotton model's training data is unpublished, so overlap with it cannot be
  excluded either way.

## 7. Known limitations

* **Both models are far weaker than their cards claim** (§3). They are decision support that must be
  confirmed locally, and the UI says so on every result.
* **Neither model is calibrated**, so no probability of correctness is reported anywhere.
* **No out-of-distribution detector.** On conditions the models cannot name they still answered with
  a mean softmax of 0.72–0.82 and abstained only 27–47 % of the time. Only the merge rules catch
  that; thresholds and quality gates do not.
* **Two crops only.** Cotton and soybean have validated models. The other six crops keep the
  symptom-based workflow.
* Severity is derived from the number and type of reported symptoms, **not** measured damage extent.
* Risk weights and weather windows are heuristics, not calibrated epidemiology.
* The map base is schematic; hotspot scores are simple weighted counts over demonstration data.
* A few engine diagnostic sentences (risk-factor detail strings, the model merge `methodology` string,
  report boilerplate) remain in English even when the interface is Marathi or Tamil; this is visible and
  documented rather than silently mixed.
* `localStorage` limits total stored data; many uploaded photographs can reach the quota (the app keeps
  running and warns rather than losing the session).
* No authentication — this is the public demonstration mode.

## 8. Recommended next steps

1. **Calibrate** both classifiers (temperature scaling) on a labelled set they did not train on, and
   publish the calibration curve. Until then no confidence number can be shown.
2. **Add an out-of-distribution detector** — the measurement above is the argument for one, and the
   expert-review queue is already the place its outputs would go.
3. **Collect expert-labelled field images** through the existing review queue and fine-tune on
   Maharashtra cotton and soybean, then re-run `eval/evaluate.py` to see whether the measured
   macro-F1 moves. The harness already exists.
4. **Screen the quality gates against a larger corpus** — the current thresholds were calibrated on a
   handful of photographs and are documented as heuristics.
5. Replace the heuristic risk engine with a model calibrated on district-level disease incidence
   (KVK / state agriculture department data), keeping the factor list as interpretable features.
6. Migrate persistence to PostgreSQL behind a FastAPI service with authenticated role separation
   (farmer / extension worker / expert), keeping the store actions as the API contract.
7. Move to a real GIS stack behind the existing `project()` boundary, and aggregate only
   field-validated observations into public hotspot reporting.
8. If a zero-install deployment is ever needed, export both checkpoints to ONNX with INT8
   quantisation and add an `onnxruntime-web` adapter behind the same seam — verifying that the
   quantised model reproduces the measured numbers before trusting it.

---

Team Code Bites · SIH 2026 · Problem Statement 26131. Prototype only — not a substitute for
professional agricultural advice.
