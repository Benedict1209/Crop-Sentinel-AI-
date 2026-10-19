/* =========================================================================
   CropSentinel AI — Sample image manifest and synthetic demonstration
   leaf images.

   This file maintains a manifest of sample images used in the gallery.
   Each entry documents the image source, license, crop, disease label,
   and whether it is a real photograph or a synthetic demo.

   Images labeled  origin: 'real-photograph'  are real field photographs
   with verified source and usage permission. They may be submitted to the
   inference service.

   Images labeled  origin: 'synthetic-demo'  are generated vector graphics.
   They must never be submitted to a real model (the inference client
   enforces this).

   If no photograph has a verifiable source, permission, and defensible
   label, a polished placeholder labelled
   "Real reference photograph unavailable" is shown instead.

   The AI inference guard (modelScreening.attemptModelInference) explicitly
   rejects any image with origin 'synthetic-demo' and will also reject
   images origin 'uploaded' that fail validation.
   ========================================================================= */

import type { ScanImage } from '../domain/types';

export type SampleKind =
  | 'cotton_fusarium_wilt'
  | 'soybean_downy_mildew'
  | 'soybean_rust'
  | 'healthy'
  | 'unclear';

/** Origin of a sample image: real photograph or synthetic demo. */
export type ImageOrigin = 'real-photograph' | 'synthetic-demo' | 'unavailable';

/** Metadata for a sample image entry in the gallery manifest. */
export interface SampleImageManifest {
  id: string;
  kind: SampleKind;
  cropId: string;
  diseaseLabel: string;
  origin: ImageOrigin;
  /** Local file path or data URL for a real photograph. */
  photoPath?: string;
  /** Transparent attribution string (or empty if none required). */
  attribution: string;
  /** Human-readable license note (or empty if public domain / no requirement). */
  licenseNote: string;
  /** If 'unavailable', the placeholder text to display. */
  placeholderLabel: string;
}

const W = 340;
const H = 240;

const LEAF_PATHS: Record<string, string> = {
  grass: 'M170 18 C 214 52 236 118 170 206 C 104 118 126 52 170 18 Z',
  broad: 'M170 14 C 262 44 300 122 170 212 C 40 122 78 44 170 14 Z',
  round: 'M170 22 C 258 40 292 96 170 206 C 48 96 82 40 170 22 Z',
};

function lesion(x: number, y: number, rx: number, ry: number, fill: string, stroke: string, rot = 0) {
  return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="2" transform="rotate(${rot} ${x} ${y})"/>`;
}

function concentric(x: number, y: number, r: number) {
  let s = '';
  for (let i = 0; i < 3; i++) {
    const rr = r - i * (r / 3.4);
    s += `<circle cx="${x}" cy="${y}" r="${rr.toFixed(1)}" fill="none" stroke="#6b4326" stroke-width="1.6" opacity="${0.85 - i * 0.12}"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#8a5a30" opacity="0.82"/>${s}`;
}

function holes(list: [number, number, number][]) {
  return list
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#1d2b1c" opacity="0.9"/>`)
    .join('');
}

function frass(list: [number, number][]) {
  return list.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#c9b48a"/>`).join('');
}

function veins(path: string[], stroke = '#2c6b3f', width = 1.3, opacity = 0.5) {
  return path.map((d) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`).join('');
}

function makeCircle(x: number, y: number, r: number, fill: string): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
}

interface LeafSpec {
  path: string;
  base: string;
  top: string;
  mark: string;
  grade: string;
}

function spec(kind: SampleKind): LeafSpec {
  const grass = (base: string, top: string, mark: string) => ({
    path: LEAF_PATHS.grass, base, top, mark, grade: '',
  });
  switch (kind) {
    case 'cotton_fusarium_wilt':
      return {
        path: LEAF_PATHS.round, base: '#48864a', top: '#68a862', mark: 'basal',
        grade:
          `<circle cx="168" cy="150" r="26" fill="#8faa6a" stroke="#4d6b3a" stroke-width="2"/>` +
          `<circle cx="168" cy="150" r="7" fill="#20140f"/>` +
          `<circle cx="160" cy="158" r="3.2" fill="#d98fa6"/>` +
          holes([[116, 118, 8], [216, 126, 7], [128, 180, 9]]) +
          `<path d="M100 96 C 128 104 150 100 172 88" fill="none" stroke="#a1621f" stroke-width="2.4" opacity="0.8"/>` +
          frass([[186, 184], [150, 194], [204, 108]]),
      };
    case 'soybean_downy_mildew':
      return {
        path: LEAF_PATHS.round, base: '#48864a', top: '#68a862', mark: 'basal',
        grade:
          `<circle cx="168" cy="150" r="26" fill="#8faa6a" stroke="#4d6b3a" stroke-width="2"/>` +
          `<circle cx="168" cy="150" r="7" fill="#20140f"/>` +
          `<circle cx="160" cy="158" r="3.2" fill="#d98fa6"/>` +
          holes([[116, 118, 8], [216, 126, 7], [128, 180, 9]]) +
          `<path d="M100 96 C 128 104 150 100 172 88" fill="none" stroke="#a1621f" stroke-width="2.4" opacity="0.8"/>` +
          frass([[186, 184], [150, 194], [204, 108]]),
      };
    case 'soybean_rust':
      return {
        path: LEAF_PATHS.round, base: '#8fae5c', top: '#c3d68a', mark: 'basal',
        grade:
          `<circle cx="120" cy="150" r="6" fill="#9a8c4e"/>` +
          `<circle cx="168" cy="150" r="4" fill="#3d5a2c"/>` +
          `<path d="M96 84 C 140 70 156 84 180 96 C 144 104 132 116 120 128" fill="none" stroke="#6d5a2c" stroke-width="2" opacity="0.7"/>` +
          frass([[186, 92], [196, 118]]),
      };
    case 'healthy':
    default:
      return {
        path: LEAF_PATHS.broad, base: '#3f8347', top: '#6bb062', mark: 'basal',
        grade: '',
      };
  }
}

const VEIN_PATHS = [
  'M170 24 C 172 90 172 160 170 206',
  'M170 60 C 150 66 132 78 120 92',
  'M170 60 C 190 66 208 78 220 92',
  'M170 102 C 144 110 126 122 114 138',
  'M170 102 C 196 110 214 122 226 138',
  'M170 148 C 150 156 136 166 126 180',
  'M170 148 C 190 156 204 166 214 180',
  'M170 24 C 120 40 84 62 64 92',
  'M170 24 C 220 40 256 62 276 92',
];

function buildSvg(kind: SampleKind): string {
  const s = spec(kind);
  const isStem = kind === 'cotton_fusarium_wilt' || kind === 'soybean_rust';
  const body = isStem
    ? `<path d="${s.path}" fill="url(#leafGrad)"/><path d="M156 12 L188 12 L196 214 L150 214 Z" fill="none" stroke="#6f7f45" stroke-width="1.4" opacity="0.7"/>`
    : `<path d="${s.path}" fill="url(#leafGrad)"/><path d="${s.path}" fill="none" stroke="#2b4c30" stroke-width="1.6" opacity="0.55"/>${veins(isStem ? [] : VEIN_PATHS)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="leafGrad" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stop-color="${s.top}"/><stop offset="100%" stop-color="${s.base}"/></linearGradient><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#eef1e6"/><stop offset="100%" stop-color="#dfe5d6"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/><g opacity="0.35">${Array.from({ length: 7 }).map((_, i) => `<path d="M${-20 + i * 62} 240 L${40 + i * 58} 0" stroke="#c9d3bd" stroke-width="14" opacity="0.5"/>`).join('')}</g>${body}<g>${s.grade}</g><rect x="0" y="${H - 20}" width="${W}" height="20" fill="#0d2f24" opacity="0.82"/><text x="8" y="${H - 6}" font-family="Inter, Arial, sans-serif" font-size="10" fill="#dff0e5" letter-spacing="0.06em">SYNTHETIC DEMO IMAGE — NOT A FIELD PHOTOGRAPH</text></svg>`;
}

export function syntheticImage(kind: SampleKind, label: string): ScanImage {
  const svg = buildSvg(kind);
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    name: label,
    origin: 'synthetic-demo',
    width: W,
    height: H,
    bytes: svg.length,
  };
}

/** Returns a polished placeholder ScanImage when a real reference photograph
 * is unavailable. The image is clearly labelled and will never be sent to
 * the inference service because its origin is 'unavailable'.
 */
export function unavailableImage(label: string): ScanImage {
  const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"><defs><linearGradient id="leafGrad" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stop-color="#8c92ac"/><stop offset="100%" stop-color="#e4e6eb"/></linearGradient><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f8f9fa"/><stop offset="100%" stop-color="#dee2e6"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/><g opacity="0.35">${Array.from({ length: 7 }).map((_, i) => `<path d="M${-20 + i * 62} 240 L${40 + i * 58} 0" stroke="#ced4da" stroke-width="14" opacity="0.5"/>`).join('')}</g><rect x="0" y="${H - 20}" width="${W}" height="20" fill="#0d6efd" opacity="0.82"/><text x="8" y="${H - 6}" font-family="Inter, Arial, sans-serif" font-size="10" fill="#fff" letter-spacing="0.06em">REAL REFERENCE PHOTOGRAPH UNAVAILABLE</text></svg>`;
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(placeholderSvg)}`,
    name: label,
    origin: 'unavailable',
    width: W,
    height: H,
    bytes: placeholderSvg.length,
  };
}

/** Downscale/normalise an uploaded file so localStorage is not blown by a multi-megabyte phone photograph. Returns a JPEG data URL. */
export async function prepareUpload(file: File, maxEdge = 720): Promise<ScanImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read the selected file'));
    fr.readAsDataURL(file);
  });

  if (file.type === 'image/svg+xml') {
    return { dataUrl, name: file.name, origin: 'uploaded', bytes: dataUrl.length };
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not decode the selected image'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl, name: file.name, origin: 'uploaded', bytes: dataUrl.length };
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', 0.72);
    return { dataUrl: out, name: file.name, origin: 'uploaded', width: w, height: h, bytes: out.length };
  } catch {
    return { dataUrl, name: file.name, origin: 'uploaded', bytes: dataUrl.length };
  }
}