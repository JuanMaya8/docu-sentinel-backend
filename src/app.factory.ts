import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig, FetchLike } from './domain';

/** Builds (but does not start) the Nest app. Used by main.ts and by the e2e tests. */
export interface BuildOptions {
  fetchImpl?: FetchLike;
  /** false in tests run through tsx (esbuild emits no decorator metadata, which Swagger needs to infer property types) */
  swagger?: boolean;
}

export async function buildApp(config: AppConfig, options: BuildOptions = {}): Promise<NestExpressApplication> {
  const { fetchImpl, swagger = true } = options;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, fetchImpl), { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useBodyParser('json', { limit: `${config.bodyLimitMb}mb` });
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
    exposedHeaders: ['Content-Disposition'],
  });
  app.enableShutdownHooks();

  if (swagger) {
    const doc = new DocumentBuilder()
    .setTitle('Docu Sentinel — Backend')
    .setDescription('Historial de reportes de anomalías, líneas base históricas (delegadas a la IA) y eventos en tiempo real (socket.io, namespace /realtime).')
    .setVersion(config.version)
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }
  return app;
}
