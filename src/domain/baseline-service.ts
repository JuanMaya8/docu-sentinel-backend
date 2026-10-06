import { randomBytes } from 'node:crypto';
import type { AiClient } from './ai-client';
import type { BlobStore } from './blob-store';
import { NotFoundError } from './errors';
import type { EventBus } from './events';
import { validateCreateBaseline, validateScoreBaseline } from './validation';
import type { AiScoreResponse, BaselineDto } from './types';

const KEY = 'baselines.json';

/** Historical baselines: metadata lives here, the model lives in the AI service (`aiModelId`). */
export class BaselineService {
  private cache: BaselineDto[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: BlobStore, private readonly ai: AiClient, private readonly events: EventBus) {}

  private async all(): Promise<BaselineDto[]> {
    if (!this.cache) {
      const raw = await this.store.read(KEY);
      try {
        this.cache = raw ? (JSON.parse(raw) as BaselineDto[]) : [];
      } catch {
        this.cache = [];
      }
    }
    return this.cache;
  }

  /** serialise read-modify-write cycles on baselines.json */
  private mutate<T>(fn: (list: BaselineDto[]) => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const list = await this.all();
      const result = await fn(list);
      await this.store.write(KEY, JSON.stringify(list));
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<BaselineDto[]> {
    return [...(await this.all())].sort((a, b) => (a.trainedAt < b.trainedAt ? 1 : -1));
  }

  async get(id: string): Promise<BaselineDto> {
    const b = (await this.all()).find((x) => x.id === id);
    if (!b) throw new NotFoundError('una línea base', id);
    return b;
  }

  async create(input: unknown): Promise<BaselineDto> {
    const dto = validateCreateBaseline(input);
    const info = await this.ai.train({
      name: dto.name, columns: dto.columns, kinds: dto.kinds, matrix: dto.matrix,
      schema_signature: dto.schemaSignature, contamination: dto.contamination, seed: dto.seed,
    });
    const baseline: BaselineDto = {
      id: `bl_${randomBytes(6).toString('hex')}`,
      name: dto.name,
      aiModelId: info.model_id,
      columns: info.columns,
      kinds: info.kinds,
      rows: info.rows,
      threshold: info.threshold,
      trainedAt: info.trained_at,
      ...(dto.schemaSignature ? { schemaSignature: dto.schemaSignature } : {}),
    };
    try {
      await this.mutate(async (list) => void list.push(baseline));
    } catch (e) {
      await this.ai.deleteModel(info.model_id).catch(() => undefined); // do not leave an orphan model
      throw e;
    }
    this.events.publish('baseline.trained', baseline);
    return baseline;
  }

  async remove(id: string): Promise<void> {
    const b = await this.get(id);
    await this.mutate(async (list) => {
      list.splice(list.findIndex((x) => x.id === id), 1);
    });
    await this.ai.deleteModel(b.aiModelId).catch(() => undefined); // best effort: the metadata is already gone
    this.events.publish('baseline.deleted', { id });
  }

  async score(id: string, input: unknown): Promise<AiScoreResponse> {
    const b = await this.get(id);
    const dto = validateScoreBaseline(input, b.columns.length);
    return this.ai.score(b.aiModelId, { columns: b.columns, kinds: b.kinds, matrix: dto.matrix, explain: dto.explain, top_k: dto.topK });
  }
}
