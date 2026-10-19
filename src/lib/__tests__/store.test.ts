// @vitest-environment jsdom
/* =========================================================================
   Store tests: language default, the inference-service setting and persistence.
   ========================================================================= */

import { beforeEach, describe, expect, it } from 'vitest';

import { bootstrap, useStore } from '../store';
import { DEFAULT_SERVICE_URL } from '../inferenceClient';

const STORAGE_KEY = 'cropsentinel-ai-v1';

describe('store defaults', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to Marathi, demo mode and the local inference service', () => {
    const s = useStore.getState().settings;
    expect(s.lang).toBe('mr');
    expect(s.demoMode).toBe(true);
    expect(s.modelServiceUrl).toBe(DEFAULT_SERVICE_URL);
  });

  it('keeps English and Marathi selectable and records the choice', () => {
    useStore.getState().setLang('en');
    expect(useStore.getState().settings.lang).toBe('en');
    useStore.getState().setLang('mr');
    expect(useStore.getState().settings.lang).toBe('mr');
  });

  it('normalises a service URL and persists the settings block', () => {
    useStore.getState().setModelServiceUrl('http://127.0.0.1:8123///');
    expect(useStore.getState().settings.modelServiceUrl).toBe('http://127.0.0.1:8123');

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    // v3: crop scope narrowed to cotton + soybean only; older datasets are
    // discarded and re-seeded rather than rendered with obsolete crop ids.
    expect(persisted.version).toBe(3);
    expect(persisted.state.settings.modelServiceUrl).toBe('http://127.0.0.1:8123');
    useStore.getState().setModelServiceUrl(DEFAULT_SERVICE_URL);
  });

  it('seeds the demonstration dataset deterministically and keeps the chosen language', async () => {
    useStore.getState().setLang('en');
    await bootstrap();
    const s = useStore.getState();
    expect(s.seeded).toBe(true);
    expect(s.farms.length).toBeGreaterThan(0);
    expect(s.settings.lang).toBe('en');

    const firstIds = s.scans.map((x) => x.id);
    await useStore.getState().resetData();
    expect(useStore.getState().scans.map((x) => x.id)).toEqual(firstIds);
  });

  it('gives every seeded scan the new model-metadata fields', async () => {
    await bootstrap();
    for (const scan of useStore.getState().scans) {
      expect(scan.result).toHaveProperty('modelInference');
      expect(scan.result).toHaveProperty('dispositionSource');
      expect(scan.result).toHaveProperty('ruleAssessment');
      // Seeded scans are produced from synthetic images, so no trained model ran.
      expect(scan.result.modelInference).toBeNull();
      expect(scan.result.isDemonstration).toBe(true);
      expect(scan.result.confidence).toBeNull();
    }
  });

  it('seeds conditions from both model-backed crops', async () => {
    await bootstrap();
    const ids = new Set(useStore.getState().scans.map((s) => s.result.conditionId));
    expect(ids.has('cotton_bacterial_blight') || ids.has('soybean_rust')).toBe(true);
  });

  it('contains no duplicate farms (same farmer at the same location)', async () => {
    await bootstrap();
    const { farms } = useStore.getState();
    const keys = farms.map((f) => `${f.farmerName}|${f.village}|${f.district}|${f.lat}|${f.lng}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every seeded farm at least one plot', async () => {
    await bootstrap();
    const { farms, plots } = useStore.getState();
    for (const farm of farms) {
      const owned = plots.filter((p) => p.farmId === farm.id);
      expect(owned.length, `farm ${farm.id} (${farm.name}) has no plots`).toBeGreaterThan(0);
      // The total seeded plot area of a farm may not exceed its recorded size.
      expect(owned.reduce((a, p) => a + p.areaHa, 0)).toBeLessThanOrEqual(farm.totalAreaHa + 1e-9);
    }
  });

  it('binds every plot to an existing farm and to a supported crop', async () => {
    await bootstrap();
    const { farms, plots } = useStore.getState();
    const farmIds = new Set(farms.map((f) => f.id));
    for (const plot of plots) {
      expect(farmIds.has(plot.farmId), `plot ${plot.id} has an orphan farmId`).toBe(true);
      expect(['cotton', 'soybean']).toContain(plot.cropId);
      expect(plot.crop).toBe(plot.cropId);
    }
  });

  it('keeps every seeded scan consistent with its plot crop and farm', async () => {
    await bootstrap();
    const { scans, plots } = useStore.getState();
    const plotById = new Map(plots.map((p) => [p.id, p]));
    for (const scan of scans) {
      const plot = plotById.get(scan.plotId);
      expect(plot, `scan ${scan.id} references a missing plot`).toBeTruthy();
      expect(scan.cropId).toBe(plot!.cropId);
      expect(scan.crop).toBe(scan.cropId);
      expect(scan.farmId).toBe(plot!.farmId);
    }
  });
});
