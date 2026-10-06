import { DynamicModule, Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import {
  AiClient, AnalysisService, BaselineService, BlobAnalysisRepository, EventBus, FileBlobStore,
  type AppConfig, type FetchLike,
} from './domain';
import { TOKENS } from './tokens';

/** Wires the framework-free domain objects. `fetchImpl` is injectable so e2e tests can fake the AI service. */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig, fetchImpl?: FetchLike): DynamicModule {
    const events = new EventBus();
    const ai = new AiClient({ baseUrl: config.aiUrl, apiKey: config.aiApiKey, timeoutMs: config.aiTimeoutMs, fetchImpl });
    const analyses = new AnalysisService(new BlobAnalysisRepository(new FileBlobStore(join(config.dataDir, 'analyses'))), events);
    const baselines = new BaselineService(new FileBlobStore(join(config.dataDir, 'baselines')), ai, events);
    const providers = [
      { provide: TOKENS.CONFIG, useValue: config },
      { provide: TOKENS.EVENTS, useValue: events },
      { provide: TOKENS.AI, useValue: ai },
      { provide: TOKENS.ANALYSES, useValue: analyses },
      { provide: TOKENS.BASELINES, useValue: baselines },
    ];
    return { module: CoreModule, providers, exports: providers.map((p) => p.provide) };
  }
}
