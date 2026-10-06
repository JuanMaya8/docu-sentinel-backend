/** Shared types. Mirrors docs/CONTRACT.md (section 4) — keep identical to the frontend. */
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const FILE_FORMATS = ['csv', 'tsv', 'json', 'ndjson', 'pdf'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const PROCESSING_MODES = ['main', 'worker', 'pool'] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export const SENSITIVITIES = ['low', 'medium', 'high'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const ML_MODES = ['off', 'local', 'baseline'] as const;
export type MlMode = (typeof ML_MODES)[number];

export const ANOMALY_TYPES = [
  'duplicate_exact', 'duplicate_key', 'duplicate_near', 'missing_field', 'empty_record',
  'type_mismatch', 'invalid_format', 'impossible_date', 'inconsistent_label', 'whitespace',
  'out_of_range', 'negative_value', 'future_date', 'impossible_relation',
  'suspicious_threshold', 'suspicious_round', 'benford', 'multivariate_anomaly', 'mixed_types',
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const COLUMN_TYPES = ['integer', 'decimal', 'date', 'boolean', 'email', 'string', 'mixed'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const FEATURE_KINDS = ['numeric', 'date', 'missing', 'rarity'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export interface FindingDto {
  recordIndex: number | null;
  recordId?: string;
  type: AnomalyType;
  risk: RiskLevel;
  score: number;
  field: string | null;
  value?: string;
  explanation: string;
  detector: string;
}

export interface ColumnSummaryDto {
  name: string;
  type: ColumnType;
  nullRate: number;
  distinct: number | null;
}

export interface SaveAnalysisDto {
  fileName: string;
  format: FileFormat;
  fileSizeBytes: number;
  rows: number;
  columns: ColumnSummaryDto[];
  durationMs: number;
  mode: ProcessingMode;
  workers: number;
  sensitivity: Sensitivity;
  mlMode: MlMode;
  baselineId?: string;
  findings: FindingDto[];
}

export interface AnalysisSummary {
  id: string;
  createdAt: string;
  fileName: string;
  format: FileFormat;
  fileSizeBytes: number;
  rows: number;
  columnCount: number;
  durationMs: number;
  mode: ProcessingMode;
  workers: number;
  findingsCount: number;
  recordsAffected: number;
  byRisk: Record<RiskLevel, number>;
  byType: Record<string, number>;
}

export interface AnalysisDetail extends AnalysisSummary {
  columns: ColumnSummaryDto[];
  sensitivity: Sensitivity;
  mlMode: MlMode;
  baselineId?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface BaselineDto {
  id: string;
  name: string;
  aiModelId: string;
  columns: string[];
  kinds: string[];
  rows: number;
  threshold: number;
  trainedAt: string;
  schemaSignature?: string;
}

export interface CreateBaselineDto {
  name: string;
  columns: string[];
  kinds?: FeatureKind[];
  matrix: Array<Array<number | null>>;
  schemaSignature?: string;
  contamination?: number;
  seed?: number;
}

export interface ScoreBaselineDto {
  matrix: Array<Array<number | null>>;
  explain?: 'flagged' | 'all' | 'none';
  topK?: number;
}

/** AI service responses (snake_case, see docu-sentinel-ai/docs/CONTRACT.md) */
export interface AiModelInfo {
  model_id: string;
  name: string | null;
  columns: string[];
  kinds: FeatureKind[];
  rows: number;
  threshold: number;
  contamination: number;
  seed: number;
  trained_at: string;
  schema_signature?: string | null;
  engine: string;
}

export interface AiScoreResponse {
  model_id: string | null;
  threshold: number;
  scores: number[];
  flags: boolean[];
  contributions: Record<string, Array<{ column: string; field: string; kind: FeatureKind; value: number | null; median: number; deviation: number; message: string }>>;
}
