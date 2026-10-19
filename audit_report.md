# CropSentinel AI — Forensic Technical Audit Report

**Project:** CropSentinel AI (SIH 2026 prototype, Team Code Bites, PS 26131)
**Repository:** `C:\SIH PROJECT PROTOTYPE`
**Audit type:** Read-only forensic technical audit
**Audit date:** 2026-10-19
**Verification legend:** `Verified` = confirmed by file inspection or execution; `Reported` = claimed by project docs/model cards; `Inferred` = reasoned from code but not executed; `Missing` = absent; `Blocked` = could not verify in this environment.

---

## 001–040: Executive Summary

001 CropSentinel AI is a working full-stack prototype, not a mock: a React/TypeScript SPA, a Python
002 FastAPI inference service, and two genuine trained classifiers with their weights present on disk.
003 The audit verified the build, tests, model loading, and live inference on both crops.

004 **Verified at audit time:**
005 - `npm run typecheck` (`tsc --noEmit`) completes with no errors.
006 - `npm run test` passes **49 tests across 5 files** (exports, modelLabels, screening, i18n, store).
007 - `python -m pytest services/inference/tests -q` passes **46 tests**.
008 - Both models load with SHA-256 + label validation and return live predictions:
       Cotton DenseNet-121 → `bacterial blight` at raw softmax 0.8998, latency 96.5 ms.
       Soybean ConvNeXt-Small → `Frogeye Leaf Spot` at raw softmax 0.9332, latency 100.5 ms.
009 - Python 3.14.5, Node 24.16.0, torch 2.14.1+cpu, torchvision 0.29.1+cpu, timm 1.0.30.

010 **Headline findings:**
011 1. **Model quality is materially below the model cards.** Measured cotton macro-F1 is 53.4% and
       soybean macro-F1 is 54.6%, versus card claims of ~99% and ~88–92%. The repository itself
       documents this gap honestly in `services/inference/eval/RESULTS.md`.
012 2. **Scores are not calibrated.** The API correctly labels softmax output as `probability` with
       `calibrated: false`, but a UI reader can still over-interpret it as diagnostic confidence.
013 3. **A confirmed data bug:** `src/pages/FarmDetail.tsx` defaults new plots to `cropId: 'tomato'`
       (lines 27–28 and 52–53), a crop with no model and no domain support.
014 4. **Quality-check detail strings are misleading on passing checks** (`quality.py`), e.g. a sharp
       194.1 Laplacian is described as "below the 18 sharpness threshold". The pass/fail logic is
       correct; the human-readable audit text is wrong.
015 5. **No remote git state:** the repository has no commits and no configured remote, so the pasted
       `git push` sequence cannot succeed as written.
016 6. **Operational gaps for production:** no Dockerfile, no authentication, no rate limiting, no
       server-side persistence, and no structured logging.

017 **Overall verdict:** an honest, well-engineered prototype with unusually good scientific hygiene
018 (checksums, strict loading, abstention, explicit provenance, synthetic-data labelling). It is not
019 field-ready: the models are research-grade, the app is demo-grade in persistence and security, and
020 there is one confirmed crop-default bug and several misleading-text issues to fix.

021 **Top five recommended fixes (priority order):**
022 P1 — Remove the `tomato` default in `FarmDetail.tsx`; constrain crop selection to cotton/soybean.
023 P2 — Correct `quality.py` detail strings to describe the measured outcome conditionally.
024 P3 — Surface measured (not published) accuracy in the UI wherever model results are shown.
025 P4 — Add an ErrorBoundary and structured logging for both frontend and inference service.
026 P5 — Decide persistence/auth strategy before any multi-user or deployed use.

027 **Scope limits of this audit:** no pen-testing, no load testing, no retraining, no model
028 bias/fairness study, and no verification of the third-party training datasets' provenance.

---

## 041–070: Methodology and Evidence Standard

041 The audit proceeded in three passes:
042 1. **Inventory:** enumerate project-owned files while excluding `node_modules/`, `dist/`,
      `__pycache__/`, `.git/`, and large binary weights from content inspection.
043 2. **Static inspection:** read application, domain, library, backend, evaluation, and test files;
      trace the scan pipeline end to end; cross-check frontend class names against model metadata.
044 3. **Dynamic verification:** execute typecheck, unit tests, backend tests, and real inference.

045 Every assertion in this report carries one of the five verification labels. No metrics were
046 invented. Where a claim could not be executed (e.g. browser E2E, deployed CORS), it is labelled
047 `Inferred` or `Blocked`. Model-card numbers are labelled `Reported`, never `Verified`.

048 Tools used: `npm run typecheck`, `npm run test` (vitest 2.1.9), `python -m pytest`, and a direct
049 `InferenceEngine.predict()` invocation against `test_leaf.png` (512×512, 8,915 bytes).

050 **Evidence integrity note:** `test_leaf.png` is a generic test image of unknown real-world subject.
051 Its predictions (cotton: bacterial blight; soybean: Frogeye Leaf Spot) prove the plumbing works;
052 they do **not** validate diagnostic correctness. Correctness evidence comes from `eval/RESULTS.md`.

---

## 071–110: Repository Inventory and File Map

071 Project-owned source/config/test files number roughly 70 (excluding dependencies/artifacts).
072 `node_modules/`, `dist/`, logs, and generated caches are present but not part of the review.

073 **Frontend (React 18 + TypeScript + Vite):**
074 - `src/main.tsx`, `src/App.tsx` — React root, HashRouter, 16 routes inside `<AppShell />`.
075 - `src/pages/` — 15 pages: Dashboard, OfficerDashboard, Scanner, Traps, RiskForecast, HotspotMap,
      Advisories, Farms, FarmDetail, PlotDetail, Reports, ReportDetail, ExpertReview,
      FeedbackDataset, Settings.
076 - `src/components/` — reusable UI (ui.tsx, AppShell, ScanResultView, ModelInferencePanel,
      HotspotMap, charts, icons).
077 - `src/domain/` — `types.ts`, `modelLabels.ts`, `knowledge.ts`, `seed.ts`.
078 - `src/lib/` — `store.ts`, `inferenceClient.ts`, `modelScreening.ts`, `screening.ts`, `risk.ts`,
      `weather.ts`, `advisories.ts`, `exports.ts`, `geo.ts`, `format.ts`, `i18n.ts`,
      `sampleImages.ts`, `sampleCases.ts`, `selectors.ts`.
079 - `src/**/__tests__/` — exports, i18n, screening, store, modelLabels tests.

080 **Backend (FastAPI inference service):**
081 - `services/inference/cropsentinel_inference/`: `app.py`, `engine.py`, `preprocess.py`,
      `quality.py`, `registry.py`, `fetch_models.py`, `__init__.py`.
082 - `services/inference/eval/`: `evaluate.py`, `labels.json`, `RESULTS.md`,
      `cotton_results.json`, `soybean_results.json`.
083 - `services/inference/tests/`: `conftest.py`, `test_api.py`, `test_engine.py`,
      `test_preprocess_and_quality.py`.
084 - `services/inference/requirements.txt` — torch, torchvision, timm, safetensors, fastapi, uvicorn.

085 **Weights (present on disk, gitignored):**
086 - `services/inference/weights/cotton_densenet121/best_densenet.pth` (84,420,354 bytes).
087 - `services/inference/weights/soybean_convnext/model.safetensors` (98,952,428 bytes).
088 - Metadata: cotton `classes.json` (4 labels), soybean `config.json` (6 labels).

089 **Root configuration and assets:**
090 - `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`,
      `index.html`, `test_leaf.png`, `synthetic-cotton-disease.jpg`, `README.md`, `audit_report.md`.

091 `vite.config.ts` sets host `127.0.0.1`, port `5183`, `outDir: dist`, `sourcemap: false`.
092 **Important:** there is **no dev proxy**. The SPA calls the inference service directly at
093 `http://127.0.0.1:8000`, which works only because the backend CORS regex allows loopback origins.
094 This is verified in `vite.config.ts` and `app.py`; it is an `Inferred` browser behavior.

095 No Dockerfile, CI configuration, database migration, or deployment manifest was found (`Missing`).

---

## 111–160: Architecture and End-to-End Data Flow

111 The system is a two-process architecture:
112 `Browser SPA (Vite dev server :5183)` → `HTTP multipart/JSON` → `FastAPI :8000` → `torch/timm`.
113 All user data lives in browser `localStorage`; the backend is stateless apart from the model cache.

114 **Frontend bootstrap:** `src/main.tsx` mounts `<App/>`; `App.tsx` calls `bootstrap()` from the
115 Zustand store, which seeds a deterministic demonstration dataset (seed `20260213`) exactly once.
116 A loading screen is shown until seeded (App.tsx). `resetData()` re-seeds deterministically.

117 **Scan flow (verified by reading Scanner.tsx, screening.ts, modelScreening.ts):**
118 1. User selects farm, plot, crop, stage, and an image; crop selection is constrained to
       cotton/soybean by `hasImageModel()` / `MODEL_BACKED_CROPS` in `knowledge.ts`.
119 2. Upload uses `prepareUpload()` in `sampleImages.ts`: downsample to max edge 720 px, JPEG q≈0.72,
       `origin: 'uploaded'`. Synthetic gallery images carry `origin: 'synthetic-demo'`.
120 3. `runScreening()` in `screening.ts` always computes the rule-based assessment first, then
       attempts model inference, then merges the two.
121 4. `attemptModelInference()` calls `screenImage()` in `inferenceClient.ts`, which POSTs multipart
       `crop` + `image` to `/v1/screen` and validates the response shape in `looksLikeScreen()`.
122 5. `combineWithModel()` in `modelScreening.ts` applies conservative merge rules (see 141–150).
123 6. `addScan()` persists the scan into the Zustand/localStorage store; the UI renders
       `ScanResultView` and `ModelInferencePanel`.

124 **Backend flow (verified by reading app.py, engine.py, registry.py):**
125 `POST /v1/screen` → size check (8 MB) → `_screen()` → `spec_for_crop()` (400 if unsupported) →
126 `engine.load(spec)` (lazy, cached) → `engine.predict(spec, bytes)`:
127 decode → RGB → quality gates → preprocess → forward pass → softmax → top-k/margin → abstention.

128 **Model loading safety (verified):**
129 - Weight path and label file must exist, else `ModelUnavailable` → HTTP 503.
130 - SHA-256 is compared against the pinned value in `registry.py` unless explicitly skipped.
131 - Published labels are read and cross-checked; class-order drift → `ModelUnavailable`.
132 - Torch checkpoints load with `strict=True`; soybean uses `timm` + safetensors half precision.
133 - There is **no cross-crop fallback**: cotton and soybean each map to exactly one model.

134 **API surface (verified):**
135 - `GET /health` — liveness plus service/version info.
136 - `GET /v1/models` — model specs, provenance, thresholds, published metrics.
137 - `POST /v1/screen` — multipart `crop` + `image`.
138 - `POST /v1/screen/b64` — JSON base64 image variant.
139 - Error contract: 400 unsupported-crop, 413 too-large, 422 invalid-image, 503 model-unavailable,
       500 inference-failed.

140 **Merge rules (verified in `modelScreening.ts`):**
141 - Synthetic-demo images are never sent to the model.
142 - A model-only "healthy" result is never adopted; it must be corroborated.
143 - The model leads only when the rule engine named no condition.
144 - Model/rule disagreement yields `inconclusive` plus an expert referral.
145 - Abstained model output surfaces as "unable to determine", not as a diagnosis.
146 - Cross-crop class names are rejected by the class→condition mapping.

147 **Persistence:** Zustand `persist` (version 3) with a safeStorage wrapper; all state is browser-local.
148 Settings include language (Marathi default, English secondary), demo mode, weather provider,
149 model service URL, risk weights, and current user. No server database exists (`Missing`).

150 **Weather integration:** Open-Meteo (no key) when configured; otherwise deterministic simulated
151 weather. The UI labels the source, but "simulated" can still be misread as observed (`Inferred`).

152 **Geospatial:** HotspotMap uses a schematic Mercator graticule with district centroids, explicitly
153 labelled as not a survey boundary. No GIS shapefile or authoritative boundary data exists.

154 **Expert review and reports:** ExpertReview is a simulated workflow (pending/under-review/resolved).
155 Reports are client-side CSV exports and printable views; no server-side report service exists.

156 **Error handling:** `inferenceClient.ts` distinguishes timeout, unreachable, invalid-response, and
157 service-error. The frontend has no custom ErrorBoundary (`Missing`), so unexpected render errors
158 fall through to React's default behavior.

159 **Build/deploy:** frontend `npm run build` = `tsc --noEmit && vite build`; backend run via uvicorn.
160 Weights are fetched by `python services/inference/fetch_models.py` and are not committed to git.

---

## 161–220: Frontend Audit

161 **TypeScript safety:** `Verified` — typecheck passes. Domain types are explicit in
162 `src/domain/types.ts`; core modules avoid `any`. `ScanImage.origin` is a union that structurally
163 prevents synthetic images from being treated as field evidence.

164 **Routing:** HashRouter with routes `/`, `/officer`, `/scanner`, `/traps`, `/risk`, `/map`,
165 `/advisories`, `/farms`, `/farms/:farmId`, `/plots/:plotId`, `/reports`, `/report/:scanId`,
166 `/expert`, `/feedback`, `/settings`, and a `*` redirect. Route params are read via `useParams`.

167 **State:** a single Zustand store holds farms, plots, scans, traps, cases, follow-ups, feedback,
168 notifications, and settings. Pages use `useMemo` for derived rows. Re-renders are coarse
169 (store-wide subscription) but acceptable at demo data volume (`Inferred`).

170 **Dashboard:** metrics (farm/plot/scan counts, risk bands, pending reviews, healthy share, average
171 risk, trap alerts, inconclusive count) are computed by `selectors.ts` from live store state.
172 `Verified`: no hardcoded dashboard values; the demo dataset is the source, not inline literals.

173 **Charts/maps:** Recharts for health trend, risk donut, and condition bars. HotspotMap plots store
174 coordinates on a schematic projection. Charts read selectors, not embedded sample arrays.

175 **Forms/validation:** controlled components, no form library. Image type is checked with
176 `file.type.startsWith('image/')`; uploads are downscaled client-side. New-plot creation in
177 `FarmDetail.tsx` defaults to tomato — see Finding F-01.

178 **Localization:** `i18n.ts` provides English and Marathi dictionaries; Marathi is the default.
179 `makeT(lang)` is called per page; missing keys fall back. `Verified` by 8 passing i18n tests.

180 **Accessibility:** dropzone supports Enter/Space and drag events; modals use ARIA labels; images
181 carry alt text. Gaps: severity is colour-dependent, and busy/error state lacks ARIA live regions.

182 **Responsive layout:** grid/flex breakpoints via CSS; no dedicated mobile navigation audit was
183 performed (`Blocked` without a browser). No media-query inventory was completed.

184 **Loading/empty/error states:** Scanner disables analysis while busy and shows an error notice;
185 Dashboard/Reports/ExpertReview/PlotDetail render explicit empty states via `Empty`.

186 **Performance:** upload builds a full data URL in memory; the gallery renders all sample cards per
187 render; store updates re-render broadly. No profiling was run (`Blocked`).

188 **UI honesty:** synthetic images are visibly badged and the hotspot map states its schematic nature.
189 Residual risk: badges can be overlooked, and expert-review simulation is not prominent enough for a
190 first-time operator (`Inferred`).

191 **Demand claims vs. implementation:** there is no live expert network, no server-side account
192 system, and no real-time disease surveillance feed. These are demo simulations, not integrations.

---

## 221–280: Backend / API Audit

221 **Framework:** FastAPI with CORS restricted to loopback origins via regex. Engine is created once
222 at import and models are lazily loaded and cached per crop.
223 `Verified` by reading `app.py`, `engine.py`, and the 46 passing backend tests.

224 **Upload limit:** default 8 MB via `CROPSENTINEL_MAX_UPLOAD_BYTES`; oversized payloads → 413.
225 The frontend downsamples to ≤720 px, so normal requests are far below the limit.

226 **Preprocessing (`preprocess.py`, verified against model cards):**
227 - Cotton: `Resize(256)` → `CenterCrop(224)` → `ToTensor` → ImageNet normalize.
228 - Soybean: shorter-side resize to 224 → `CenterCrop(224)` → `ToTensor` → timm-resolved normalize.
229 Tests `test_cotton_pipeline_matches_the_model_card` and
230 `test_soybean_pipeline_matches_timm_resolved_transform` lock these pipelines.

231 **Quality gates (`quality.py`, verified):** minimum side 128 px, aspect ratio ≤4, mean luma
232 25–235, Laplacian variance ≥18, foliage fraction ≥0.20. Failures are non-fatal vs fatal and map
233 to reason codes (`image-too-small`, `image-blurry`, `image-no-foliage-detected`, etc.).

234 **Abstention:** cotton thresholds `min_confidence=0.60`, `min_margin=0.20`; soybean `0.45`/`0.15`.
235 Below-threshold or low-margin outputs abstain with reason codes instead of guessing.

236 **Calibration:** responses set `calibrated: false` and include an explanatory note. This is honest,
237 but the field is still named `probability`, which invites over-reading (`Inferred` UI risk).

238 **Label integrity:** cotton labels are reproduced verbatim, including the model's "fussarium wilt"
239 spelling; the app maps them explicitly rather than silently correcting them. Correct behaviour.

240 **Security posture (`Missing` unless noted):**
241 - No authentication or authorization on any endpoint.
242 - No rate limiting or request queue.
243 - CORS limited to loopback (good), but the service binds to 127.0.0.1 only (good for local demo).
244 - No upload content sniffing beyond Pillow decode; decompression-bomb limits are not explicit.
245 - No secrets in the repository were found; weights and metadata are public model artifacts.

246 **Logging/observability (`Missing`):** default uvicorn access logs only; no request IDs, no
247 structured events, no metrics, no health dependency checks beyond liveness.

248 **Resource behaviour:** model cache holds both models in memory after use (~183 MB weights plus
249 runtime overhead). Acceptable on a workstation; unsuitable for a small shared server (`Inferred`).

250 **API tests:** `test_api.py` covers endpoint contracts, crop rejection, oversize, invalid image,
251 and model-unavailable behavior. `test_engine.py` covers checksums, strict loading, abstention, and
252 label drift. `test_preprocess_and_quality.py` covers pipelines and gates. All 46 pass.

---

## 281–360: Machine-Learning Forensics

281 **Cotton model:** `FarmGuard/cotton-densenet121`, revision pinned, MIT licence.
282 Architecture: DenseNet-121 (torchvision), 4-class head:
283 `bacterial blight`, `curl virus`, `fussarium wilt`, `healthy`.
284 Weights: `best_densenet.pth`, 84,420,354 bytes, SHA-256 `dfb01012…071aa` (verified by load).
285 Reported by author: test accuracy 98.997%, macro-F1 99.091%, best-val accuracy 99.66%.
286 **Measured in-repo** (`eval/RESULTS.md`): macro-F1 53.4%, accuracy incl. abstentions 55.2%,
287 accuracy among answered 65.2%, coverage 84.8%, median latency 86.4 ms.
288 Per-class weakness: `curl virus` recall 10.0% (F1 18.2%); `fussarium wilt` had **0 support** in the
289 evaluation slice, so its performance is unmeasured.
290 Out-of-distribution probe: 27–47% abstention on herbicide damage, jassids, leaf redding, variegation.
291 Provenance caveat: the evaluation dataset's relationship to the training data is unknown.

292 **Soybean model:** `ixrbhii/soybean-disease-convnext`, revision pinned, CC-BY-4.0.
293 Architecture: ConvNeXt-Small (timm `convnext_small.fb_in22k_ft_in1k`), 6-class head:
294 Downy Mildew, Frogeye Leaf Spot, Healthy, Mosaic Virus, Rust, Septoria Brown Spot.
295 Weights: `model.safetensors`, 98,952,428 bytes, half precision, SHA-256 `41f79f76…a6f0f`.
296 Reported by author: 91.7% accuracy, 88.1% macro-F1 on 336 held-out photos.
297 **Measured in-repo:** macro-F1 54.6%, accuracy incl. abstentions 41.7%, accuracy among answered
298 54.0%, coverage 77.2%, median latency 124.5 ms.
299 Per-class weakness: Rust recall 16.7%, Healthy recall 35.0%; Downy Mildew, Mosaic Virus, and
300 Septoria Brown Spot had **0 support** in the evaluation slice.
301 Out-of-distribution probe: 21.7% abstention on bacterial blight, which the model cannot name.

302 **Why the card-vs-measured gap is plausible and expected:**
303 - Author evaluation often uses same-source splits; the repo's evaluation uses a separate public set.
304 - Soybean card itself warns held-out photos came from training datasets.
305 - Class imbalance and unnamed dataset provenance inflate optimistic numbers.
306 Therefore the repo's lower numbers are the trustworthy planning figures, not the card numbers.

307 **What is genuinely strong (verified):**
308 - SHA-256 pinning and strict loading prevent silent model swaps.
309 - Published label files are re-read and cross-checked at runtime.
310 - Explicit abstention with confidence and margin thresholds.
311 - No cross-crop fallback, avoiding confident nonsense labels.
312 - Honest `calibrated: false` disclosure and documented provenance/cautions.
313 - Reproducible evaluation harness that stops rather than guessing on undeclared data.

314 **What remains scientifically weak:**
315 - No temperature scaling/calibration, so thresholds are heuristic.
316 - Two classes (cotton fusarium, three soybean classes) are effectively unvalidated by the repo.
317 - No field-collected, geographically local (Maharashtra) evaluation set.
318 - No confusion-matrix-driven threshold tuning per class.
319 - No versioned dataset manifest tying each evaluation image to a hash.
320 - No monitoring for distribution shift or per-class drift once deployed.

321 **Reproducibility assessment:** the eval command is `python services/inference/eval/evaluate.py`;
322 datasets are downloaded on demand and are not redistributed. Results files (`*_results.json`,
323 `RESULTS.md`) are committed, so the reported numbers are traceable to a run timestamp/normalizer.

324 **Latency:** measured live at ~96.5 ms (cotton) and ~100.5 ms (soybean) on CPU for a 512² image,
325 consistent with the evaluation medians. Acceptable for interactive use (`Verified` on this machine).

---

## 361–410: Domain Logic, Persistence, Testing, and Security

361 **Agronomic domain:** `knowledge.ts` defines cotton/soybean crops, stages, conditions, symptom
362 options, and `MODEL_BACKED_CROPS`. `modelLabels.ts` maps each model class to an app condition and
363 stores measured performance sourced from evaluation outputs. Unmapped classes return null.

364 **Risk engine:** `risk.ts` computes a heuristic score from weather, crop stage, scan history,
365 traps, neighbourhood pressure, soil, and management factors, with configurable weights. It is a
366 transparent rule model, not an epidemiological model (`Verified` by inspection).

367 **Advisories:** `advisories.ts` generates multi-section IPM guidance tagged with verification
368 status. Advice is template-driven and should be reviewed by an agronomist before field use.

369 **Demo data:** `seed.ts` deterministically generates farms, plots, scans, traps, and cases from
370 seed `20260213`. All seeded records are flagged as samples. This makes demos reproducible.

371 **Sample cases:** `sampleCases.ts` defines four synthetic cases (cotton fusarium-labelled,
372 healthy cotton, soybean downy mildew, soybean rust). One case is internally inconsistent: the ID
373 and note describe pink bollworm (`sample-pink-bollworm-cotton`, bore hole/larva) while the
374 `declaration` is `cotton_fusarium_wilt`. This is a data-quality finding (F-04).

375 **Persistence:** browser `localStorage` only, via Zustand persist v3 with migration and quota-safe
376 storage. Clearing browser data resets to the deterministic demo dataset. No backup/export of full
377 state exists beyond CSV exports of tabular views (`Missing` for state portability).

378 **Frontend tests (Verified):** 49 tests pass — exports 6, modelLabels 9, screening 16, i18n 8,
379 store 10. They cover merge rules, class mapping, CSV export, localization, and store behavior.
380 They do **not** cover page rendering, routing, upload UI, or HTTP failure paths.

381 **Backend tests (Verified):** 46 pass — API contract, engine safety, preprocessing, and quality.
382 They do **not** cover concurrent requests, memory limits, or long-running stability.

383 **Test gaps:** no E2E/browser tests, no load tests, no fuzzing of image decoders, no accessibility
384 automation, no regression suite pinned to real field photos.

385 **Security review (static):**
386 - No authentication/authorization (`Missing`) — anyone on the host can call the service.
387 - No rate limiting / abuse controls (`Missing`).
388 - CORS is loopback-restricted (good). Service binds to loopback (good for demo).
389 - Client-side persistence means data is not encrypted at rest and is per-browser (`Inferred`).
390 - No obvious injection sinks: React escapes text; CSV export should guard formula injection
       (not verified in detail — `Blocked`).
391 - No secrets found. Model licences and attribution are documented.
392 - Upload handling relies on Pillow; decompression-bomb and polyglot-file defenses are not explicit.

393 **Privacy/compliance:** farmer names, villages, and coordinates exist in demo data. A real
394 deployment would require consent, data-minimization, retention, and access-control policies
395 (`Missing`). No privacy policy or terms were found.

---

## 411–450: Issue Register and Root-Cause Analysis

411 **F-01 (High) — Invalid default crop in FarmDetail.**
412 Location: `src/pages/FarmDetail.tsx:27–28` and `:52–53` (`crop: 'tomato'`, `cropId: 'tomato'`).
413 Impact: a new plot can be created for a crop with no model and no domain support; downstream
414 selection and screening can become inconsistent.
415 Root cause: stale default from an earlier broader-crop prototype; not updated when scope narrowed.
416 Fix: default to `cotton`/first supported crop and constrain the `<select>` to `MODEL_BACKED_CROPS`.

417 **F-02 (Medium) — Misleading quality-check detail strings.**
418 Location: `quality.py:158–161` (model-input-size), `:209–212` (focus), `:225–228` (foliage).
419 Impact: passing checks are described as failures ("below the 18 threshold", "only 100%"), which
420 undermines the auditability the service is designed to provide.
421 Root cause: unconditional f-strings instead of outcome-conditional messages.
422 Fix: branch the detail text on `ok` and report the comparison direction accurately.

423 **F-03 (Medium) — Published vs measured accuracy not surfaced together in the UI.**
424 Impact: operators may believe card-level 99%/88% figures while measured performance is ~53–55%.
425 Root cause: model metadata exposes both, but the primary result panel emphasises the prediction.
426 Fix: always render measured macro-F1/coverage beside the model result, with a short caveat.

427 **F-04 (Low) — Inconsistent synthetic sample case.**
428 Location: `src/lib/sampleCases.ts` (`sample-pink-bollworm-cotton`).
429 Impact: the declared condition is cotton fusarium wilt while the ID/note/symptoms describe pink
430 bollworm; this can confuse demo narratives and any future analytics.
431 Fix: split into a correct bollworm case or correct the declaration and note.

432 **F-05 (Medium) — No ErrorBoundary / global error UX.**
433 Impact: an unexpected render error yields a blank screen; only bootstrap errors are caught.
434 Fix: add a top-level ErrorBoundary with a Marathi/English fallback and a reset action.

435 **F-06 (Medium) — No authentication, rate limiting, or structured logging.**
436 Impact: the service is demo-safe on loopback but not deployment-safe.
437 Fix: add an auth layer or explicit "local-only" guard, request limits, and JSON logs with request IDs.

438 **F-07 (Low) — No dev proxy; direct cross-origin calls.**
439 Location: `vite.config.ts` (no `server.proxy`). Works only because backend CORS allows loopback.
440 Impact: fragile if the service URL/host changes or is deployed separately.
441 Fix: add a Vite proxy for development or document the CORS contract explicitly.

442 **F-08 (Low) — Coarse store subscriptions / no memoized sample gallery.**
443 Impact: unnecessary re-renders at scale; negligible at demo size.
444 Fix: selector-based subscriptions and `useMemo` for the sample gallery.

445 **F-09 (Info) — Uncalibrated probabilities labelled as probabilities.**
446 The API is transparent (`calibrated: false`), but naming and UI emphasis can still mislead.
447 Fix: label as "class score" in the UI and keep the calibration note adjacent to the value.

448 **F-10 (Info) — Evaluation coverage gaps.**
449 Cotton fusarium and three soybean classes have zero support in the repo's evaluation slice; their
450 reported performance is unmeasured. Fix: add a stratified evaluation set with per-class support.

---

## 451–500: Setup, Verification Matrix, Roadmap, and Deliverables

451 **Local setup (verified commands):**
452 1. `npm install` (dependencies already resolved in the lockfile).
453 2. `npm run dev` — Vite on `http://127.0.0.1:5183`.
454 3. `python services/inference/fetch_models.py` — only if weights are absent.
455 4. `npm run inference:serve` — FastAPI on `http://127.0.0.1:8000`.
456 5. `npm run typecheck`, `npm run test`, `npm run inference:test` — verification suites.
457 6. `npm run build` — production bundle in `dist/`.

458 **Verification matrix:**
459 | Area | Status | Evidence |
460 |---|---|---|
461 | TypeScript build | Verified | `tsc --noEmit` clean |
462 | Frontend unit tests | Verified | 49/49 pass (5 files) |
463 | Backend unit tests | Verified | 46/46 pass |
464 | Cotton weights + metadata | Verified | files present; SHA-256 load passed |
465 | Soybean weights + metadata | Verified | files present; SHA-256 load passed |
466 | Live cotton inference | Verified | bacterial blight 0.8998, 96.5 ms |
467 | Live soybean inference | Verified | Frogeye Leaf Spot 0.9332, 100.5 ms |
468 | Measured model metrics | Verified | `eval/RESULTS.md` |
469 | Browser E2E / accessibility | Blocked | no browser harness run |
470 | Deployment/CI/Docker | Missing | no artifacts found |
471 | Authentication/rate limits | Missing | no code found |
472 | Server-side persistence | Missing | browser-local only |
473 | Git remote/commits | Missing | no commits, no remote configured |

474 **10-stage improvement roadmap:**
475 1. Fix F-01 crop defaults and constrain crop selectors to supported crops.
476 2. Fix F-02 quality-detail text and add regression tests for each message branch.
477 3. Surface measured metrics and calibration caveats in every model-result view (F-03/F-09).
478 4. Correct the sample-case inconsistency and add a schema check for future cases (F-04).
479 5. Add a top-level ErrorBoundary and user-facing recovery (F-05).
480 6. Add structured logging, request IDs, and basic metrics to the inference service (F-06).
481 7. Introduce auth/local-only guard, rate limiting, and upload hardening (F-06/security).
482 8. Decide and implement persistence (server DB or explicit export/import) and backup.
483 9. Expand evaluation to stratified, locally collected Maharashtra field photos with per-class support.
484 10. Add E2E/accessibility/load tests and a CI pipeline with model-checksum verification.

485 **Deliverables available from this audit:**
486 D1 Repository/file inventory (071–110).
487 D2 Architecture and end-to-end request/response flow (111–160).
488 D3 Frontend audit with verified strengths and gaps (161–220).
489 D4 Backend/API contract and safety audit (221–280).
490 D5 Model forensics: provenance, measured vs reported metrics, failure modes (281–360).
491 D6 Domain/persistence/security review (361–410).
492 D7 Prioritized issue register with root causes (411–450).
493 D8 Setup instructions and verification matrix (451–473).
494 D9 Ten-stage improvement roadmap (474–484).
495 D10 This consolidated report (`audit_report.md`).

496 **Audit conclusion:** the prototype's engineering honesty is its strongest asset and its model
497 performance is its weakest. Fix the confirmed data bug and misleading text first, make measured
498 metrics impossible to miss, then invest in local field data and deployment hardening. No files were
499 modified during this audit other than writing this report; no models were retrained and no
500 dependencies were installed.

*End of report.*
