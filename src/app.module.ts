import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core.module';
import type { AppConfig, FetchLike } from './domain';
import { ApiKeyGuard } from './http/api-key.guard';
import { AuthGuard } from './http/auth.guard';
import { AllExceptionsFilter } from './http/exceptions.filter';
import { AnalysesController } from './modules/analyses.controller';
import { AuthController } from './modules/auth.controller';
import { BaselinesController } from './modules/baselines.controller';
import { HealthController } from './modules/health.controller';
import { MetricsController } from './modules/metrics.controller';
import { RealtimeGateway } from './modules/realtime.gateway';
import { RetentionScheduler } from './modules/retention.scheduler';

@Module({})
export class AppModule {
  static register(config: AppConfig, fetchImpl?: FetchLike): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, fetchImpl), ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.throttleLimit }])],
      controllers: [HealthController, AuthController, AnalysesController, BaselinesController, MetricsController],
      providers: [
        RealtimeGateway,
        RetentionScheduler,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
