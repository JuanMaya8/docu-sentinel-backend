/**
 * Request validation written by hand (no decorators) so it is framework-free and unit-tested.
 * Every function returns a clean, typed copy (unknown properties are dropped) or throws ValidationError (Spanish messages).
 */
import { ValidationError } from './errors';
import {
  ANOMALY_TYPES, COLUMN_TYPES, FEATURE_KINDS, FILE_FORMATS, ML_MODES, PROCESSING_MODES, RISK_LEVELS, SENSITIVITIES,
  type ColumnSummaryDto, type CreateBaselineDto, type FeatureKind, type FindingDto, type SaveAnalysisDto, type ScoreBaselineDto,
} from './types';

export const LIMITS = {
  maxFindings: 100_000,
  maxColumns: 2_000,
  maxMatrixRows: 200_000,
  maxMatrixCells: 8_000_000,
  maxFeatureColumns: 512,
  maxExplanation: 2_000,
  maxValue: 200,
} as const;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

class Checker {
  readonly errors: string[] = [];
  fail(msg: string): void {
    if (this.errors.length < 20) this.errors.push(msg);
  }
  done(): void {
    if (this.errors.length) throw new ValidationError(this.errors);
  }
  str(o: Rec, key: string, opts: { max: number; min?: number; optional?: boolean; path?: string }): string | undefined {
    const v = o[key];
    const label = opts.path ?? key;
    if (v === undefined || v === null) {
      if (!opts.optional) this.fail(`«${label}» es obligatorio.`);
      return undefined;
    }
    if (typeof v !== 'string') {
      this.fail(`«${label}» debe ser texto.`);
      return undefined;
    }
    if (v.length < (opts.min ?? 0) || v.length > opts.max) {
      this.fail(`«${label}» debe tener entre ${opts.min ?? 0} y ${opts.max} caracteres.`);
      return undefined;
    }
    return v;
  }
  num(o: Rec, key: string, opts: { min?: number; max?: number; int?: boolean; optional?: boolean; nullable?: boolean; path?: string }): number | undefined {
    const v = o[key];
    const label = opts.path ?? key;
    if (v === undefined || (v === null && !opts.nullable)) {
      if (!opts.optional) this.fail(`«${label}» es obligatorio.`);
      return undefined;
    }
    if (v === null) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(`«${label}» debe ser un número.`);
      return undefined;
    }
    if (opts.int && !Number.isInteger(v)) this.fail(`«${label}» debe ser un entero.`);
    if (opts.min !== undefined && v < opts.min) this.fail(`«${label}» debe ser ≥ ${opts.min}.`);
    if (opts.max !== undefined && v > opts.max) this.fail(`«${label}» debe ser ≤ ${opts.max}.`);
    return v;
  }
  oneOf<T extends string>(o: Rec, key: string, allowed: readonly T[], optional = false): T | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (!optional) this.fail(`«${key}» es obligatorio (${allowed.join(' | ')}).`);
      return undefined;
    }
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.fail(`«${key}» debe ser uno de: ${allowed.join(', ')}.`);
      return undefined;
    }
    return v as T;
  }
}

function readColumn(raw: unknown, i: number, c: Checker): ColumnSummaryDto | null {
  if (!isRec(raw)) {
    c.fail(`columns[${i}] debe ser un objeto.`);
    return null;
  }
  const name = c.str(raw, 'name', { max: 300, min: 1, path: `columns[${i}].name` });
  const type = c.oneOf(raw, 'type', COLUMN_TYPES);
  const nullRate = c.num(raw, 'nullRate', { min: 0, max: 1, path: `columns[${i}].nullRate` });
  const distinct = c.num(raw, 'distinct', { min: 0, int: true, optional: true, nullable: true, path: `columns[${i}].distinct` });
  if (name === undefined || type === undefined || nullRate === undefined) return null;
  return { name, type, nullRate, distinct: distinct ?? null };
}

function readFinding(raw: unknown, i: number, c: Checker): FindingDto | null {
  if (!isRec(raw)) {
    c.fail(`findings[${i}] debe ser un objeto.`);
    return null;
  }
  const type = c.oneOf(raw, 'type', ANOMALY_TYPES);
  const risk = c.oneOf(raw, 'risk', RISK_LEVELS);
  const score = c.num(raw, 'score', { min: 0, max: 100, path: `findings[${i}].score` });
  const explanation = c.str(raw, 'explanation', { max: LIMITS.maxExplanation, path: `findings[${i}].explanation` });
  const detector = c.str(raw, 'detector', { max: 60, min: 1, path: `findings[${i}].detector` });
  const ri = raw.recordIndex;
  let recordIndex: number | null = null;
  if (ri !== null && ri !== undefined) {
    if (typeof ri !== 'number' || !Number.isInteger(ri) || ri < 0) c.fail(`findings[${i}].recordIndex debe ser un entero ≥ 0 o null.`);
    else recordIndex = ri;
  }
  const field = raw.field === null || raw.field === undefined ? null : typeof raw.field === 'string' && raw.field.length <= 300 ? raw.field : (c.fail(`findings[${i}].field inválido.`), null);
  const recordId = c.str(raw, 'recordId', { max: 200, optional: true, path: `findings[${i}].recordId` });
  const value = c.str(raw, 'value', { max: LIMITS.maxValue, optional: true, path: `findings[${i}].value` });
  if (!type || !risk || score === undefined || explanation === undefined || !detector) return null;
  const out: FindingDto = { recordIndex, type, risk, score, field, explanation, detector };
  if (recordId !== undefined) out.recordId = recordId;
  if (value !== undefined) out.value = value;
  return out;
}

export function validateSaveAnalysis(input: unknown): SaveAnalysisDto {
  const c = new Checker();
  if (!isRec(input)) throw new ValidationError(['El cuerpo debe ser un objeto JSON.']);
  const fileName = c.str(input, 'fileName', { max: 300, min: 1 });
  const format = c.oneOf(input, 'format', FILE_FORMATS);
  const fileSizeBytes = c.num(input, 'fileSizeBytes', { min: 0, int: true });
  const rows = c.num(input, 'rows', { min: 0, int: true });
  const durationMs = c.num(input, 'durationMs', { min: 0 });
  const mode = c.oneOf(input, 'mode', PROCESSING_MODES);
  const workers = c.num(input, 'workers', { min: 1, max: 256, int: true });
  const sensitivity = c.oneOf(input, 'sensitivity', SENSITIVITIES);
  const mlMode = c.oneOf(input, 'mlMode', ML_MODES);
  const baselineId = c.str(input, 'baselineId', { max: 100, optional: true });

  const columns: ColumnSummaryDto[] = [];
  if (!Array.isArray(input.columns)) c.fail('«columns» debe ser una lista.');
  else if (input.columns.length > LIMITS.maxColumns) c.fail(`«columns» admite como máximo ${LIMITS.maxColumns} columnas.`);
  else input.columns.forEach((raw, i) => {
    const col = readColumn(raw, i, c);
    if (col) columns.push(col);
  });

  const findings: FindingDto[] = [];
  if (!Array.isArray(input.findings)) c.fail('«findings» debe ser una lista.');
  else if (input.findings.length > LIMITS.maxFindings) c.fail(`«findings» admite como máximo ${LIMITS.maxFindings} hallazgos; recorta por puntaje antes de enviar.`);
  else for (let i = 0; i < input.findings.length && c.errors.length < 20; i++) {
    const f = readFinding(input.findings[i], i, c);
    if (f) findings.push(f);
  }
  c.done();
  return {
    fileName: fileName!, format: format!, fileSizeBytes: fileSizeBytes!, rows: rows!, columns, durationMs: durationMs!,
    mode: mode!, workers: workers!, sensitivity: sensitivity!, mlMode: mlMode!, ...(baselineId !== undefined ? { baselineId } : {}), findings,
  };
}

function readMatrix(input: Rec, c: Checker, width: number): Array<Array<number | null>> {
  const m = input.matrix;
  if (!Array.isArray(m)) {
    c.fail('«matrix» debe ser una lista de filas.');
    return [];
  }
  if (m.length === 0) c.fail('«matrix» no puede estar vacía.');
  if (m.length > LIMITS.maxMatrixRows) c.fail(`«matrix» admite como máximo ${LIMITS.maxMatrixRows} filas.`);
  if (m.length * width > LIMITS.maxMatrixCells) c.fail(`«matrix» admite como máximo ${LIMITS.maxMatrixCells} celdas.`);
  if (c.errors.length) return [];
  for (let r = 0; r < m.length; r++) {
    const row = m[r];
    if (!Array.isArray(row) || row.length !== width) {
      c.fail(`La fila ${r} debe tener ${width} valores.`);
      break;
    }
    for (let k = 0; k < row.length; k++) {
      const v = row[k];
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
        c.fail(`matrix[${r}][${k}] debe ser un número o null.`);
        return [];
      }
    }
  }
  return m as Array<Array<number | null>>;
}

function readColumns(input: Rec, c: Checker): string[] {
  const cols = input.columns;
  if (!Array.isArray(cols) || cols.length === 0 || cols.length > LIMITS.maxFeatureColumns || cols.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 300)) {
    c.fail(`«columns» debe ser una lista de 1 a ${LIMITS.maxFeatureColumns} nombres de texto.`);
    return [];
  }
  if (new Set(cols).size !== cols.length) c.fail('«columns» contiene nombres repetidos.');
  return cols as string[];
}

export function validateCreateBaseline(input: unknown): CreateBaselineDto {
  const c = new Checker();
  if (!isRec(input)) throw new ValidationError(['El cuerpo debe ser un objeto JSON.']);
  const name = c.str(input, 'name', { max: 120, min: 1 });
  const columns = readColumns(input, c);
  let kinds: FeatureKind[] | undefined;
  if (input.kinds !== undefined && input.kinds !== null) {
    if (!Array.isArray(input.kinds) || input.kinds.length !== columns.length || input.kinds.some((k) => !(FEATURE_KINDS as readonly unknown[]).includes(k))) c.fail(`«kinds» debe tener un valor por columna (${FEATURE_KINDS.join(', ')}).`);
    else kinds = input.kinds as FeatureKind[];
  }
  const matrix = columns.length ? readMatrix(input, c, columns.length) : [];
  if (matrix.length > 0 && matrix.length < 20) c.fail('Se necesitan al menos 20 filas para entrenar una línea base.');
  const schemaSignature = c.str(input, 'schemaSignature', { max: 200, optional: true });
  const contamination = c.num(input, 'contamination', { min: 0.0001, max: 0.25, optional: true });
  const seed = c.num(input, 'seed', { int: true, optional: true });
  c.done();
  return { name: name!, columns, ...(kinds ? { kinds } : {}), matrix, ...(schemaSignature !== undefined ? { schemaSignature } : {}), ...(contamination !== undefined ? { contamination } : {}), ...(seed !== undefined ? { seed } : {}) };
}

export function validateScoreBaseline(input: unknown, width: number): ScoreBaselineDto {
  const c = new Checker();
  if (!isRec(input)) throw new ValidationError(['El cuerpo debe ser un objeto JSON.']);
  const matrix = readMatrix(input, c, width);
  const explain = input.explain === undefined ? undefined : c.oneOf(input, 'explain', ['flagged', 'all', 'none'] as const);
  const topK = c.num(input, 'topK', { min: 1, max: 10, int: true, optional: true });
  c.done();
  return { matrix, ...(explain ? { explain } : {}), ...(topK !== undefined ? { topK } : {}) };
}
