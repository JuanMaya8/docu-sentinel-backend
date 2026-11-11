import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { AnalysisService, AppConfig } from '../domain';
import { TOKENS } from '../tokens';

/**
 * Retention job: when RETENTION_DAYS > 0, deletes saved analyses older than that many days, once at boot and then
 * every RETENTION_INTERVAL_MS. The rule itself lives in the domain (`AnalysisService.purgeOlderThan`), so it is unit-tested
 * without Nest; this class only schedules it (plain timer, no extra dependency).
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Retention');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(TOKENS.CONFIG) private readonly config: AppConfig,
    @Inject(TOKENS.ANALYSES) private readonly analyses: AnalysisService,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.config.retentionDays > 0)) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.config.retentionIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Public so it can be triggered from tests. Never throws. */
  async runOnce(now: Date = new Date()): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const removed = await this.analyses.purgeOlderThan(this.config.retentionDays, now);
      if (removed.length) this.log.log(`Eliminados ${removed.length} reportes con más de ${this.config.retentionDays} días.`);
      return removed;
    } catch (e) {
      this.log.warn(`La limpieza de reportes falló: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    } finally {
      this.running = false;
    }
  }
}
