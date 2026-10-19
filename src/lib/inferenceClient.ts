/* =========================================================================
   CropSentinel AI — client for the local image-inference service

   Why a service and not the browser: both integrated models are published as
   PyTorch checkpoints (a 84 MB .pth and a 99 MB fp16 .safetensors). The browser
   cannot execute either format, so the genuine forward pass happens in the
   local Python service and this module is the only place the UI talks to it.

   Two rules are enforced here, because both are ways the app could lie:

   1. A response is validated structurally before it is trusted. A dev server's
      SPA fallback happily answers 200 with index.html for any unknown path, so
      "the request succeeded" is not evidence that a model ran.
   2. Nothing in this module ever produces a number that is not in the response.
      There is no default, no fallback probability and no guess: a missing model
      yields `service-unavailable`, not a made-up score.
   ========================================================================= */

import type { ScanImage } from '../domain/types';

export interface ServiceModelInfo {
  crop: string;
  cropLabel: string;
  modelId: string;
  sourceUrl: string;
  revision: string;
  license: string;
  licenseNote: string;
  architecture: string;
  library: string;
  classNames: string[];
  classCount: number;
  classSource: string;
  inputSize: number;
  preprocessing: string;
  preprocessingDetail?: string;
  weightsSha256: string;
  weightsBytes: number;
  abstention: { minConfidence: number; minMargin: number };
  publishedMetrics: { name: string; value: number | null; unit: string; source: string; note: string }[];
  cautions: string[];
  available: boolean;
  loadError: string | null;
}

export interface ServiceHealth {
  status: string;
  service: string;
  apiVersion: string;
  weightsDir: string;
  checksumVerification: boolean;
  supportedCrops: string[];
  anyModelAvailable: boolean;
  models: ServiceModelInfo[];
}

export interface ServiceQualityCheck {
  name: string;
  ok: boolean;
  fatal: boolean;
  detail: string;
  measured?: string | number | null;
  threshold?: string | number | null;
  reasonCode?: string | null;
}

export interface ScreenResponse {
  requestId: string;
  serviceVersion: string;
  totalMs: number;
  crop: string;
  model: ServiceModelInfo;
  image: {
    width: number;
    height: number;
    bytes: number;
    meanLuma: number;
    laplacianVariance: number;
    foliageFraction: number;
  };
  quality: { passed: boolean; checks: ServiceQualityCheck[] };
  prediction: {
    classIndex: number;
    className: string;
    probability: number;
    runnerUpClass: string | null;
    runnerUpProbability: number | null;
    marginToRunnerUp: number;
    probabilities: number[];
    calibrated: boolean;
    calibrationNote: string;
  };
  abstained: boolean;
  abstainReasons: string[];
  thresholds: { minConfidence: number; minMargin: number };
  latencyMs: number;
}

export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: 'unreachable' | 'timeout' | 'invalid-response' | 'service-error'; status?: number };

export type ClientErrorCode = Extract<ClientResult<never>, { ok: false }>['code'];

export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8000';
/** Generous: the first request also loads the weights into memory. */
export const HEALTH_TIMEOUT_MS = 4000;
export const SCREEN_TIMEOUT_MS = 60000;

export function normaliseServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

type TaggedError = Error & { code?: ClientErrorCode; status?: number };

function tag(error: Error, code: 'invalid-response' | 'service-error', status?: number): TaggedError {
  const tagged = error as TaggedError;
  tagged.code = code;
  if (status !== undefined) tagged.status = status;
  return tagged;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw tag(
      new Error(
        `response was not JSON (content-type ${response.headers.get('content-type') ?? 'unknown'}) — ` +
          'this is usually a dev-server fallback page, not the inference service',
      ),
      'invalid-response',
    );
  }
}

function looksLikeHealth(value: unknown): value is ServiceHealth {
  const v = value as Partial<ServiceHealth> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    v.service === 'cropsentinel-inference' &&
    Array.isArray(v.models) &&
    Array.isArray(v.supportedCrops)
  );
}

function looksLikeScreen(value: unknown): value is ScreenResponse {
  const v = value as Partial<ScreenResponse> | null;
  if (!v || typeof v !== 'object') return false;
  const p = v.prediction as Partial<ScreenResponse['prediction']> | undefined;
  const m = v.model as Partial<ServiceModelInfo> | undefined;
  return (
    !!p &&
    !!m &&
    typeof v.serviceVersion === 'string' &&
    typeof p.className === 'string' &&
    typeof p.probability === 'number' &&
    Array.isArray(p.probabilities) &&
    Array.isArray(m.classNames) &&
    p.probabilities.length === m.classNames.length &&
    Array.isArray(v.abstainReasons) &&
    typeof v.abstained === 'boolean'
  );
}

function errorMessageFrom(payload: unknown, fallback: string): string {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const d = detail as { error?: string; detail?: string };
    if (d.detail) return `${d.error ? `${d.error}: ` : ''}${d.detail}`;
  }
  return fallback;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  if (head.includes(';base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  label = 'the configured address',
): Promise<ClientResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { ok: true, data: await run(controller.signal) };    } catch (e) {
    const aborted = controller.signal.aborted;
    // Distinguish three different failures that all arrive here as exceptions:
    // the service never answered, it answered with an error status, or it
    // answered with something that is not our contract (e.g. a dev-server
    // fallback page). Collapsing them would make "the model Service is down"
    // indistinguishable from "the model refused", which the UI words very
    // differently.
    const raw = e instanceof Error ? e.message : 'network error';
    const tagged = e as TaggedError | null;
    const code: ClientErrorCode = aborted
      ? 'timeout'
      : tagged?.code === 'invalid-response' || tagged?.code === 'service-error'
        ? tagged.code
        : 'unreachable';
    const status = tagged?.status;
    return {
      ok: false,
      code,
      status,
      error: aborted
        ? `no response within ${Math.round(timeoutMs / 1000)}s`
        : code === 'unreachable' && /failed to fetch|networkerror|load failed/i.test(raw)
          ? // "Failed to fetch" is the browser's wording for a refused or blocked
            // connection; say what that means for an operator.
            `nothing is listening on ${label} (the browser reported "${raw}")`
          : raw,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(
  baseUrl: string,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<ClientResult<ServiceHealth>> {
  const url = normaliseServiceUrl(baseUrl);
  if (!url) return { ok: false, code: 'unreachable', error: 'no service URL configured' };
  return withTimeout(timeoutMs, async (signal) => {
    const response = await fetch(`${url}/health`, { signal });
    const payload = await readJson(response);
    if (!response.ok) {
      throw tag(new Error(errorMessageFrom(payload, `HTTP ${response.status}`)), 'service-error', response.status);
    }
    if (!looksLikeHealth(payload)) {
      throw new Error('unexpected /health payload — the service contract did not match');
    }
    return payload;
  }, url);
}

export async function screenImage(
  baseUrl: string,
  cropId: string,
  image: ScanImage,
  timeoutMs = SCREEN_TIMEOUT_MS,
): Promise<ClientResult<ScreenResponse>> {
  const url = normaliseServiceUrl(baseUrl);
  if (!url) return { ok: false, code: 'unreachable', error: 'no service URL configured' };

  const body = new FormData();
  body.append('crop', cropId);
  body.append('image', dataUrlToBlob(image.dataUrl), image.name || 'capture.jpg');

  return withTimeout(timeoutMs, async (signal) => {
    const response = await fetch(`${url}/v1/screen`, { method: 'POST', body, signal });
    const payload = await readJson(response);
    if (!response.ok) {
      throw tag(new Error(errorMessageFrom(payload, `HTTP ${response.status}`)), 'service-error', response.status);
    }
    if (!looksLikeScreen(payload)) {
      throw new Error('unexpected /v1/screen payload — the service contract did not match');
    }
    return payload;
  }, url);
}

/** Neutral wording for the abstention reason codes the service returns. */
export const ABSTAIN_REASON_TEXT: Record<string, string> = {
  'low-confidence': 'The model did not reach its confidence threshold.',
  'classes-indistinguishable': 'The top two classes were too close to separate.',
  'image-too-small': 'The photograph has too few pixels to classify.',
  'image-below-model-input': 'The photograph is smaller than the model input and was upscaled.',
  'image-extreme-aspect': 'The photograph is an extreme crop.',
  'image-extreme-exposure': 'The photograph is far too dark or too bright.',
  'image-blurry': 'The photograph is not in focus.',
  'image-no-foliage-detected': 'Almost no plant material was found in the photograph.',
};
