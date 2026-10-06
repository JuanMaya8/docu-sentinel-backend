import { randomBytes } from 'node:crypto';
import type { BlobStore } from './blob-store';
import { NotFoundError } from './errors';
import { queryFindings, type FindingsQuery } from './findings-query';
import { buildDetail, buildSummary, sortByScoreDesc } from './summary';
import type { AnalysisDetail, AnalysisSummary, FindingDto, Page, SaveAnalysisDto } from './types';

export interface AnalysisRepository {
  save(dto: SaveAnalysisDto): Promise<AnalysisSummary>;
  list(limit: number, offset: number): Promise<Page<AnalysisSummary>>;
  get(id: string): Promise<AnalysisDetail>;
  findings(id: string, query: FindingsQuery): Promise<Page<FindingDto>>;
  allFindings(id: string): Promise<FindingDto[]>;
  fileName(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}

const ID_RE = /^an_[0-9a-f]{12}$/;
const detailKey = (id: string): string => `${id}.detail.json`;
const findingsKey = (id: string): string => `${id}.findings.json`;

/**
 * Stores each analysis as two JSON blobs (`<id>.detail.json` = summary + metadata, `<id>.findings.json`),
 * so listing never has to read big findings files. Findings are kept sorted by score desc.
 * Swap this class for a Postgres implementation of `AnalysisRepository` without touching callers.
 */
export class BlobAnalysisRepository implements AnalysisRepository {
  private index: Map<string, AnalysisDetail> | null = null;
  private loading: Promise<Map<string, AnalysisDetail>> | null = null;
  private cache = new Map<string, FindingDto[]>(); // tiny LRU
  constructor(private readonly store: BlobStore, private readonly cacheSize = 3) {}

  private async load(): Promise<Map<string, AnalysisDetail>> {
    if (this.index) return this.index;
    this.loading ??= (async () => {
      const map = new Map<string, AnalysisDetail>();
      for (const key of await this.store.list('.detail.json')) {
        const raw = await this.store.read(key);
        if (!raw) continue;
        try {
          const d = JSON.parse(raw) as AnalysisDetail;
          if (ID_RE.test(d.id)) map.set(d.id, d);
        } catch {
          /* ignore corrupt files */
        }
      }
      this.index = map;
      return map;
    })();
    return this.loading;
  }

  async save(dto: SaveAnalysisDto): Promise<AnalysisSummary> {
    const index = await this.load();
    const id = `an_${randomBytes(6).toString('hex')}`;
    const summary = buildSummary(id, new Date().toISOString(), dto);
    const detail = buildDetail(summary, dto);
    const sorted = sortByScoreDesc(dto.findings);
    await this.store.write(findingsKey(id), JSON.stringify(sorted));
    await this.store.write(detailKey(id), JSON.stringify(detail));
    index.set(id, detail);
    this.remember(id, sorted);
    return summary;
  }

  async list(limit: number, offset: number): Promise<Page<AnalysisSummary>> {
    const all = [...(await this.load()).values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const items = all.slice(offset, offset + limit).map(({ columns: _c, sensitivity: _s, mlMode: _m, baselineId: _b, ...summary }) => summary);
    return { items, total: all.length };
  }

  async get(id: string): Promise<AnalysisDetail> {
    const d = (await this.load()).get(id);
    if (!d) throw new NotFoundError('un análisis', id);
    return d;
  }

  async fileName(id: string): Promise<string> {
    return (await this.get(id)).fileName;
  }

  async allFindings(id: string): Promise<FindingDto[]> {
    await this.get(id);
    const hit = this.cache.get(id);
    if (hit) {
      this.cache.delete(id);
      this.cache.set(id, hit);
      return hit;
    }
    const raw = await this.store.read(findingsKey(id));
    const list = raw ? (JSON.parse(raw) as FindingDto[]) : [];
    this.remember(id, list);
    return list;
  }

  async findings(id: string, query: FindingsQuery): Promise<Page<FindingDto>> {
    return queryFindings(await this.allFindings(id), query);
  }

  async remove(id: string): Promise<void> {
    const index = await this.load();
    if (!index.has(id)) throw new NotFoundError('un análisis', id);
    index.delete(id);
    this.cache.delete(id);
    await this.store.remove(detailKey(id));
    await this.store.remove(findingsKey(id));
  }

  private remember(id: string, list: FindingDto[]): void {
    this.cache.set(id, list);
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value as string);
  }
}
