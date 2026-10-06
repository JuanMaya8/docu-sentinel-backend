import { RISK_LABELS_ES, TYPE_LABELS_ES } from './labels';
import type { FindingDto } from './types';

export const CSV_HEADERS_ES = ['Registro', 'Tipo de anomalía', 'Nivel de riesgo', 'Campo afectado', 'Explicación'] as const;

const esc = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Spreadsheet formula injection guard: a cell that starts with = + - @ is prefixed with a quote. */
const safe = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function recordLabel(f: FindingDto): string {
  if (f.recordIndex === null) return 'Columna completa';
  return `#${f.recordIndex + 1}${f.recordId ? ` · ${f.recordId}` : ''}`;
}

/** UTF-8 CSV with BOM (Excel-friendly), same columns as the on-screen report. */
export function findingsToCsv(findings: Iterable<FindingDto>): string {
  const lines = [CSV_HEADERS_ES.join(',')];
  for (const f of findings) {
    lines.push([recordLabel(f), TYPE_LABELS_ES[f.type], RISK_LABELS_ES[f.risk], f.field ?? '', f.explanation].map((c) => esc(safe(c))).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
