import type { AnalysisDetail, AnalysisSummary, FindingDto, RiskLevel, SaveAnalysisDto } from './types';

export function buildSummary(id: string, createdAt: string, dto: SaveAnalysisDto): AnalysisSummary {
  const byRisk: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byType: Record<string, number> = {};
  const records = new Set<number>();
  for (const f of dto.findings) {
    byRisk[f.risk]++;
    byType[f.type] = (byType[f.type] ?? 0) + 1;
    if (f.recordIndex !== null) records.add(f.recordIndex);
  }
  return {
    id,
    createdAt,
    fileName: dto.fileName,
    format: dto.format,
    fileSizeBytes: dto.fileSizeBytes,
    rows: dto.rows,
    columnCount: dto.columns.length,
    durationMs: dto.durationMs,
    mode: dto.mode,
    workers: dto.workers,
    findingsCount: dto.findings.length,
    recordsAffected: records.size,
    byRisk,
    byType,
  };
}

export function buildDetail(summary: AnalysisSummary, dto: SaveAnalysisDto): AnalysisDetail {
  return { ...summary, columns: dto.columns, sensitivity: dto.sensitivity, mlMode: dto.mlMode, ...(dto.baselineId ? { baselineId: dto.baselineId } : {}) };
}

export function sortByScoreDesc(findings: FindingDto[]): FindingDto[] {
  return [...findings].sort((a, b) => b.score - a.score || (a.recordIndex ?? -1) - (b.recordIndex ?? -1));
}
