/** Classes used ONLY to document the API in Swagger. Real validation lives in src/domain/validation.ts. */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ANOMALY_TYPES, FILE_FORMATS, ML_MODES, PROCESSING_MODES, RISK_LEVELS, SENSITIVITIES } from '../domain';

export class FindingDoc {
  @ApiProperty({ nullable: true, type: Number, description: 'Índice global 0-based; null = hallazgo de columna completa' }) recordIndex!: number | null;
  @ApiPropertyOptional() recordId?: string;
  @ApiProperty({ enum: ANOMALY_TYPES }) type!: string;
  @ApiProperty({ enum: RISK_LEVELS }) risk!: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) score!: number;
  @ApiProperty({ nullable: true, type: String }) field!: string | null;
  @ApiPropertyOptional() value?: string;
  @ApiProperty({ description: 'Explicación en español' }) explanation!: string;
  @ApiProperty({ example: 'range' }) detector!: string;
}

export class ColumnDoc {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['integer', 'decimal', 'date', 'boolean', 'email', 'string', 'mixed'] }) type!: string;
  @ApiProperty({ minimum: 0, maximum: 1 }) nullRate!: number;
  @ApiProperty({ nullable: true, type: Number }) distinct!: number | null;
}

export class SaveAnalysisDoc {
  @ApiProperty() fileName!: string;
  @ApiProperty({ enum: FILE_FORMATS }) format!: string;
  @ApiProperty() fileSizeBytes!: number;
  @ApiProperty() rows!: number;
  @ApiProperty({ type: [ColumnDoc] }) columns!: ColumnDoc[];
  @ApiProperty() durationMs!: number;
  @ApiProperty({ enum: PROCESSING_MODES }) mode!: string;
  @ApiProperty() workers!: number;
  @ApiProperty({ enum: SENSITIVITIES }) sensitivity!: string;
  @ApiProperty({ enum: ML_MODES }) mlMode!: string;
  @ApiPropertyOptional() baselineId?: string;
  @ApiProperty({ type: [FindingDoc], description: 'Máximo 100 000' }) findings!: FindingDoc[];
}

export class CreateBaselineDoc {
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) columns!: string[];
  @ApiPropertyOptional({ type: [String], description: 'numeric | date | missing | rarity (se infiere por sufijo si falta)' }) kinds?: string[];
  @ApiProperty({ description: 'Filas × columnas; null = valor desconocido', example: [[3, 120.5], [2, null]] }) matrix!: Array<Array<number | null>>;
  @ApiPropertyOptional() schemaSignature?: string;
  @ApiPropertyOptional({ minimum: 0.0001, maximum: 0.25 }) contamination?: number;
  @ApiPropertyOptional() seed?: number;
}

export class ScoreBaselineDoc {
  @ApiProperty({ example: [[3, 120.5]] }) matrix!: Array<Array<number | null>>;
  @ApiPropertyOptional({ enum: ['flagged', 'all', 'none'] }) explain?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10 }) topK?: number;
}
