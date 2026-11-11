import type { AnalysisRepository } from './analysis-repository';
import { findingsToCsv } from './csv';
import type { EventBus } from './events';
import { parseFindingsQuery } from './findings-query';
import { validateSaveAnalysis } from './validation';
import type { AnalysisDetail, AnalysisSummary, FindingDto, Page } from './types';

/** Use cases for saved reports. Keeps validation + persistence + events in one framework-free place. */
export class AnalysisService {
  constructor(private readonly repo: AnalysisRepository, private readonly events: EventBus) {}

  async save(input: unknown): Promise<AnalysisSummary> {
    const dto = validateSaveAnalysis(input);
    const summary = await this.repo.save(dto);
    this.events.publish('analysis.saved', summary);
    return summary;
  }

  list(limit: number, offset: number): Promise<Page<AnalysisSummary>> {
    return this.repo.list(limit, offset);
  }
  get(id: string): Promise<AnalysisDetail> {
    return this.repo.get(id);
  }
  findings(id: string, rawQuery: Record<string, unknown>): Promise<Page<FindingDto>> {
    return this.repo.findings(id, parseFindingsQuery(rawQuery));
  }
  async exportCsv(id: string): Promise<{ fileName: string; csv: string }> {
    const [findings, name] = await Promise.all([this.repo.allFindings(id), this.repo.fileName(id)]);
    return { fileName: `${name.replace(/[^\w.-]+/g, '_')}.anomalias.csv`, csv: findingsToCsv(findings) };
  }
  async remove(id: string): Promise<void> {
    await this.repo.remove(id);
    this.events.publish('analysis.deleted', { id });
  }

  /** Retention: deletes the analyses older than `days` days (relative to `now`). Returns the removed ids. */
  async purgeOlderThan(days: number, now: Date = new Date()): Promise<string[]> {
    if (!(days > 0)) return [];
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    const removed: string[] = [];
    for (const id of await this.repo.idsCreatedBefore(cutoff)) {
      try {
        await this.remove(id);
        removed.push(id);
      } catch {
        /* already gone (concurrent delete): ignore */
      }
    }
    return removed;
  }
}
