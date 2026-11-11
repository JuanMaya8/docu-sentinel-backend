import { randomBytes } from 'node:crypto';
import type { AiClient } from './ai-client';
import type { BlobStore } from './blob-store';
import { DomainError, NotFoundError, SchemaMismatchError } from './errors';
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

  /** `ownerId` given => only that user's baselines (authentication enabled); omitted => all. */
  async list(ownerId?: string): Promise<BaselineDto[]> {
    return [...(await this.all())].filter((b) => !ownerId || b.ownerId === ownerId).sort((a, b) => (a.trainedAt < b.trainedAt ? 1 : -1));
  }

  async get(id: string, ownerId?: string): Promise<BaselineDto> {
    const b = (await this.all()).find((x) => x.id === id);
    if (!b || (ownerId && b.ownerId !== ownerId)) throw new NotFoundError('una línea base', id);
    return b;
  }

  async create(input: unknown, ownerId?: string): Promise<BaselineDto> {
    const dto = validateCreateBaseline(input);
    const info = await this.ai.train({
      name: dto.name, columns: dto.columns, kinds: dto.kinds, matrix: dto.matrix,
      schema_signature: dto.schemaSignature, contamination: dto.contamination, seed: dto.seed,
      threshold_floor: dto.thresholdFloor,
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
      ...(info.threshold_floor !== undefined ? { thresholdFloor: info.threshold_floor } : dto.thresholdFloor !== undefined ? { thresholdFloor: dto.thresholdFloor } : {}),
      version: 1,
      ...(ownerId ? { ownerId } : {}),
    };
    try {
      await this.mutate(async (list) => void list.push(baseline));
    } catch (e) {
      await this.ai.deleteModel(info.model_id).catch(() => undefined); // do not leave an orphan model
      throw e;
    }
    this.events.publish('baseline.trained', baseline, ownerId);
    return baseline;
  }

  /**
   * Retrains an existing baseline with new data (same columns, same order): a new model is trained in the AI, the
   * baseline keeps its id and name, `version` goes up by one and the previous model is deleted (best effort).
   */
  async retrain(id: string, input: unknown, ownerId?: string): Promise<BaselineDto> {
    const current = await this.get(id, ownerId);
    const raw = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    const sent = Array.isArray(raw.columns) ? (raw.columns as unknown[]) : current.columns;
    if (sent.length !== current.columns.length || sent.some((c, i) => c !== current.columns[i])) {
      throw new DomainError(422, 'SCHEMA_MISMATCH', 'Para reentrenar, los datos deben tener las mismas columnas (y en el mismo orden) que la línea base. Crea una línea base nueva para otro formato.');
    }
    const dto = validateCreateBaseline({ ...raw, name: current.name, columns: current.columns, kinds: raw.kinds ?? current.kinds });
    const info = await this.ai.train({
      name: current.name, columns: current.columns, kinds: dto.kinds, matrix: dto.matrix,
      schema_signature: current.schemaSignature, contamination: dto.contamination, seed: dto.seed,
      threshold_floor: dto.thresholdFloor ?? current.thresholdFloor,
    });
    let updated!: BaselineDto;
    try {
      await this.mutate(async (list) => {
        const at = list.findIndex((x) => x.id === id);
        if (at < 0) throw new NotFoundError('una línea base', id);
        updated = {
          ...list[at],
          aiModelId: info.model_id,
          kinds: info.kinds,
          rows: info.rows,
          threshold: info.threshold,
          trainedAt: info.trained_at,
          ...(info.threshold_floor !== undefined ? { thresholdFloor: info.threshold_floor } : {}),
          version: (list[at].version ?? 1) + 1,
        };
        list[at] = updated;
      });
    } catch (e) {
      await this.ai.deleteModel(info.model_id).catch(() => undefined);
      throw e;
    }
    await this.ai.deleteModel(current.aiModelId).catch(() => undefined);
    this.events.publish('baseline.trained', updated, updated.ownerId);
    return updated;
  }

  async remove(id: string, ownerId?: string): Promise<void> {
    const b = await this.get(id, ownerId);
    await this.mutate(async (list) => {
      list.splice(list.findIndex((x) => x.id === id), 1);
    });
    await this.ai.deleteModel(b.aiModelId).catch(() => undefined); // best effort: the metadata is already gone
    this.events.publish('baseline.deleted', { id }, b.ownerId);
  }

  async score(id: string, input: unknown, ownerId?: string): Promise<AiScoreResponse> {
    const b = await this.get(id, ownerId);
    const dto = validateScoreBaseline(input, b.columns.length);
    // checked BEFORE calling the AI: a different feature layout would give meaningless scores
    if (dto.schemaSignature && b.schemaSignature && dto.schemaSignature !== b.schemaSignature) {
      throw new SchemaMismatchError(b.schemaSignature, dto.schemaSignature);
    }
    return this.ai.score(b.aiModelId, { columns: b.columns, kinds: b.kinds, matrix: dto.matrix, explain: dto.explain, top_k: dto.topK });
  }
}
