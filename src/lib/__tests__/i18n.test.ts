/* =========================================================================
   Localisation tests.

   Marathi is the default farmer-facing language and English is the secondary
   option. A missing key must fall back to English rather than render as a raw
   key, so every key used anywhere in the UI is checked to exist in the English
   dictionary, and the model-facing keys are checked to exist in Marathi too.
   ========================================================================= */

/// <reference types="node" />
// See the note in domain/__tests__/modelLabels.test.ts: the app tsconfig narrows
// `types` to `vite/client`; tests that read files opt back into Node types here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LANGS, makeT, translate } from '../i18n';
import { useStore } from '../store';
import { MEASURED_PERFORMANCE } from '../../domain/modelLabels';

const srcRoot = resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Literal keys passed to t('...'), collected from every source file. */
function literalKeysUsed(): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = [];
  for (const file of walk(srcRoot)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.+-]+)'/g)) {
      found.push({ key: match[1], file: file.slice(srcRoot.length + 1) });
    }
  }
  return found;
}

describe('language configuration', () => {
  it('offers English and Marathi with Marathi as the default', () => {
    expect(LANGS.map((l) => l.id)).toEqual(['mr', 'en']);
    expect(useStore.getState().settings.lang).toBe('mr');
  });

  it('falls back to English for a key a translation does not define', () => {
    expect(translate('mr', 'scanner.title')).not.toBe('scanner.title');
    expect(translate('mr', 'this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('interpolates parameters', () => {
    const t = makeT('en');
    expect(t('model.measuredBody', { n: 210, f1: '53.4%', acc: '55.2%', cov: '84.8%' })).toContain('210');
    expect(t('model.measuredBody', { n: 210, f1: '53.4%', acc: '55.2%', cov: '84.8%' })).not.toContain('{n}');
  });
});

describe('key coverage', () => {
  const used = literalKeysUsed();

  it('finds keys to check', () => {
    expect(used.length).toBeGreaterThan(100);
  });

  it('defines every literal key used in the UI in English', () => {
    const missing = used
      .filter(({ key }) => translate('en', key) === key)
      .map(({ key, file }) => `${key} (${file})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('translates every model-facing key into Marathi, not just English', () => {
    const modelKeys = [...new Set(used.map((u) => u.key))].filter((k) =>
      /^(model|ds|unc\.model|scf\.contribModel|step\.model|settings\.(inference|service|measured|runCmd|defaultLang|modelBacked|notBacked))/.test(k),
    );
    expect(modelKeys.length).toBeGreaterThan(25);
    const untranslated = modelKeys.filter((key) => translate('mr', key) === translate('en', key));
    expect(untranslated).toEqual([]);
  });

  it('translates the condition, symptom, disposition and uncertainty keys into Marathi', () => {
    const keys = [
      'cond.cotton_bacterial_blight',
      'cond.soybean_septoria_brown_spot.short',
      'sym.rust_pustules',
      'ds.model+rule-agree',
      'unc.modelOnly',
      'unc.modelAbstained',
      'step.modelConfirm',
    ];
    for (const key of keys) {
      expect(translate('en', key), key).not.toBe(key);
      expect(translate('mr', key), `${key} (mr)`).not.toBe(translate('en', key));
    }
  });

  it('keeps the evaluation dataset for each measured crop named in the UI copy', () => {
    for (const [, perf] of Object.entries(MEASURED_PERFORMANCE)) {
      expect(perf.dataset.length).toBeGreaterThan(10);
      expect(perf.datasetUrl).toMatch(/^https?:\/\//);
    }
  });
});
