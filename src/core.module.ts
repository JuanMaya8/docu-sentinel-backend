import { DynamicModule, Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  AiClient, AnalysisService, AuthService, BaselineService, BlobAnalysisRepository, BlobUserRepository, EventBus, FileBlobStore,
  Metrics, PgAnalysisRepository, PgBlobStore, attachWebhook, type AnalysisRepository, type AppConfig, type BlobStore, type FetchLike,
} from './domain';
import { TOKENS } from './tokens';

/** Closes the Postgres pool and detaches listeners on shutdown. */
@Injectable()
class Lifecycle implements OnModuleDestroy {
  constructor(@Inject(TOKENS.DB) private readonly pool: Pool | null, @Inject('DS_DISPOSERS') private readonly disposers: Array<() => void>) {}
  async onModuleDestroy(): Promise<void> {
    for (const d of this.disposers) d();
    await this.pool?.end().catch(() => undefined);
  }
}

/**
 * Wires the framework-free domain objects.
 *  - storage: PostgreSQL when DATABASE_URL is set, JSON files in DATA_DIR otherwise
 *  - accounts: enabled when JWT_SECRET is set
 *  - `fetchImpl` is injectable so e2e tests can fake the AI service (and the webhook receiver)
 */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig, fetchImpl?: FetchLike): DynamicModule {
    const log = new Logger('Core');
    const events = new EventBus();
    const metrics = new Metrics();
    const ai = new AiClient({ baseUrl: config.aiUrl, apiKey: config.aiApiKey, timeoutMs: config.aiTimeoutMs, fetchImpl });

    let pool: Pool | null = null;
    let analysesRepo: AnalysisRepository;
    let store: (name: string) => BlobStore;
    if (config.databaseUrl) {
      pool = new Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined });
      pool.on('error', (e) => log.error(`PostgreSQL: ${e.message}`));
      analysesRepo = new PgAnalysisRepository(pool);
      const p = pool;
      store = (name) => new PgBlobStore(p, name);
    } else {
      analysesRepo = new BlobAnalysisRepository(new FileBlobStore(join(config.dataDir, 'analyses')));
      store = (name) => new FileBlobStore(join(config.dataDir, name));
    }

    const analyses = new AnalysisService(analysesRepo, events);
    const baselines = new BaselineService(store('baselines'), ai, events);
    const auth = config.jwtSecret
      ? new AuthService(new BlobUserRepository(store('users')), { secret: config.jwtSecret, ttlHours: config.jwtTtlHours, allowRegistration: config.allowRegistration })
      : null;

    const disposers: Array<() => void> = [];
    disposers.push(
      events.subscribe((event) => metrics.inc('ds_domain_events_total', 'Domain events published.', { event })),
    );
    if (config.webhookUrl) {
      disposers.push(attachWebhook(events, {
        url: config.webhookUrl, secret: config.webhookSecret, minRisk: config.webhookMinRisk, fetchImpl,
        onError: (m) => {
          metrics.inc('ds_webhook_failures_total', 'Webhook deliveries that failed.');
          log.warn(m);
        },
      }));
    }

    const providers = [
      { provide: TOKENS.CONFIG, useValue: config },
      { provide: TOKENS.EVENTS, useValue: events },
      { provide: TOKENS.AI, useValue: ai },
      { provide: TOKENS.ANALYSES, useValue: analyses },
      { provide: TOKENS.BASELINES, useValue: baselines },
      { provide: TOKENS.AUTH, useValue: auth },
      { provide: TOKENS.METRICS, useValue: metrics },
      { provide: TOKENS.DB, useValue: pool },
      { provide: 'DS_DISPOSERS', useValue: disposers },
    ];
    return { module: CoreModule, providers: [...providers, Lifecycle], exports: providers.map((p) => p.provide) };
  }
}
