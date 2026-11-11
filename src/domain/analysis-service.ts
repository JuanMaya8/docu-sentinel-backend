import type { AnalysisRepository } from './analysis-repository';
import { findingsToCsv } from './csv';
import type { EventBus } from './events';
import { parseFindingsQuery } from './findings-query';
import { validateSaveAnalysis } from './validation';
import type { AnalysisDetail, AnalysisSummary, FindingDto, Page } from './types';

const safeName = (name: string): string => name.replace(/[^\w.-]+/g, '_');

/** Use cases for saved reports. Keeps validation + persistence + events in one framework-free place. */
export class AnalysisService {
  constructor(private readonly repo: AnalysisRepository, private readonly events: EventBus) {}

  async save(input: unknown, ownerId?: string): Promise<AnalysisSummary> {
    const dto = validateSaveAnalysis(input);
    const summary = await this.repo.save(dto, ownerId);
    this.events.publish('analysis.saved', summary, ownerId);
    return summary;
  }

  list(limit: number, offset: number, ownerId?: string): Promise<Page<AnalysisSummary>> {
    return this.repo.list(limit, offset, ownerId);
  }
  get(id: string, ownerId?: string): Promise<AnalysisDetail> {
    return this.repo.get(id, ownerId);
  }
  findings(id: string, rawQuery: Record<string, unknown>, ownerId?: string): Promise<Page<FindingDto>> {
    return this.repo.findings(id, parseFindingsQuery(rawQuery), ownerId);
  }
  async exportCsv(id: string, ownerId?: string): Promise<{ fileName: string; csv: string }> {
    const [findings, name] = await Promise.all([this.repo.allFindings(id, ownerId), this.repo.fileName(id, ownerId)]);
    return { fileName: `${safeName(name)}.anomalias.csv`, csv: findingsToCsv(findings) };
  }
  /** JSON export: the saved detail (without owner) plus every finding, in score order. */
  async exportJson(id: string, ownerId?: string): Promise<{ fileName: string; json: string }> {
    const [detail, findings] = await Promise.all([this.repo.get(id, ownerId), this.repo.allFindings(id, ownerId)]);
    const { ownerId: _o, ...analysis } = detail;
    return { fileName: `${safeName(detail.fileName)}.anomalias.json`, json: JSON.stringify({ analysis, findings }, null, 2) };
  }
  async remove(id: string, ownerId?: string): Promise<void> {
    const detail = await this.repo.get(id, ownerId);
    await this.repo.remove(id, ownerId);
    this.events.publish('analysis.deleted', { id }, detail.ownerId);
  }

  /** Retention: deletes the analyses older than `days` days (relative to `now`). Returns the removed ids. */
  async purgeOlderThan(days: number, now: Date = new Date()): Promise<string[]> {
    if (!(days > 0)) return [];
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    const removed: string[] = [];
    for (const id of await this.repo.idsCreatedBefore(cutoff)) {
      try {
        await this.remove(id); // retention ignores ownership on purpose
        removed.push(id);
      } catch {
        /* already gone (concurrent delete): ignore */
      }
    }
    return removed;
  }
}
