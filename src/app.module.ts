import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core.module';
import type { AppConfig, FetchLike } from './domain';
import { ApiKeyGuard } from './http/api-key.guard';
import { AllExceptionsFilter } from './http/exceptions.filter';
import { AnalysesController } from './modules/analyses.controller';
import { BaselinesController } from './modules/baselines.controller';
import { HealthController } from './modules/health.controller';
import { RealtimeGateway } from './modules/realtime.gateway';

@Module({})
export class AppModule {
  static register(config: AppConfig, fetchImpl?: FetchLike): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, fetchImpl), ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.throttleLimit }])],
      controllers: [HealthController, AnalysesController, BaselinesController],
      providers: [
        RealtimeGateway,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
    };
  }
}
