/* =========================================================================
   CropSentinel AI — CSV export & print helpers
   Everything runs locally in the browser; nothing is uploaded anywhere.
   ========================================================================= */

import type { Farm, Plot, Scan } from '../domain/types';

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Protect against spreadsheet formula injection from free-text notes.
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([`\uFEFF${text}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  downloadText(filename, toCsv(headers, rows));
}

export function printPage(): void {
  window.print();
}

/* ------------------------------------------------- Screening CSV (testable) */

/**
 * The screening CSV, built here rather than inside the page so the columns can
 * be asserted in a test. Two columns exist specifically so a reader can never
 * be misled about what produced a row:
 *
 * - `is_demonstration` is true whenever no trained model produced the answer.
 * - `confidence` is always empty, because no integrated model is calibrated.
 *   The raw softmax value lives in `image_model_raw_score` and is named as such.
 */
export function screeningCsvHeader(): string[] {
  return [
    'scan_id', 'date', 'plot', 'farm', 'district', 'crop', 'variety', 'stage',
    'engine', 'is_demonstration', 'condition', 'disposition', 'severity',
    'evidence_strength', 'confidence', 'referral_required',
    'disposition_source', 'image_model_outcome', 'image_model_id', 'image_model_revision',
    'image_model_class', 'image_model_raw_score', 'image_model_abstained', 'image_model_calibrated',
    'symptoms', 'submitted_by',
  ];
}

export function screeningCsvRows(scans: Scan[], plots: Plot[], farms: Farm[]): CsvCell[][] {
  return scans.map((s) => {
    const plot = plots.find((p) => p.id === s.plotId);
    const farm = farms.find((f) => f.id === s.farmId);
    const model = s.result.modelInference;
    return [
      s.id,
      s.createdAt,
      plot?.name ?? '',
      farm?.name ?? '',
      farm?.district ?? '',
      s.cropId,
      s.variety,
      s.stage,
      s.result.engineId,
      s.result.isDemonstration ? 'yes' : 'no',
      // Never export a raw 'healthy' top match for a result the engine could not
      // name, or a reader would see a reassurance that was not given.
      s.result.disposition === 'inconclusive' && s.result.conditionId === 'healthy'
        ? 'not-named (inconclusive)'
        : s.result.conditionId,
      s.result.disposition,
      s.result.severity,
      s.result.evidenceStrength,
      s.result.confidence === null ? '' : s.result.confidence,
      s.result.referralRequired ? 'yes' : 'no',
      s.result.dispositionSource ?? '',
      model?.outcome ?? 'none',
      model?.modelId ?? '',
      model?.modelRevision ?? '',
      model?.predictedClassName ?? '',
      model?.probability ?? '',
      model ? (model.abstained ? 'yes' : 'no') : '',
      model ? String(model.calibrated) : '',
      s.symptoms.join(' | '),
      s.submittedBy,
    ];
  });
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}
