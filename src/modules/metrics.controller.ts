import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { type AppConfig, type Metrics } from '../domain';
import { Public } from '../http/auth.guard';
import { TOKENS } from '../tokens';

/** Prometheus scrape endpoint at /metrics (outside the /api/v1 prefix). Protected by METRICS_TOKEN when set. */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(TOKENS.METRICS) private readonly metrics: Metrics, @Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  @Get()
  scrape(@Req() req: Request, @Res() res: Response): void {
    const expected = this.config.metricsToken;
    if (expected) {
      const sent = Buffer.from((req.header('authorization') ?? '').replace(/^Bearer\s+/i, ''));
      const want = Buffer.from(expected);
      if (sent.length !== want.length || !timingSafeEqual(sent, want)) {
        res.status(401).json({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Token de métricas inválido.' });
        return;
      }
    }
    const mem = process.memoryUsage();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(
      this.metrics.render({
        ds_process_resident_memory_bytes: { help: 'Resident memory size in bytes.', value: mem.rss },
        ds_process_heap_used_bytes: { help: 'V8 heap used in bytes.', value: mem.heapUsed },
      }),
    );
  }
}
