import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { originAllowed, type AppConfig, type FetchLike, type Metrics } from './domain';
import { requestId } from './http/request-id.middleware';
import { TOKENS } from './tokens';

/** Builds (but does not start) the Nest app. Used by main.ts and by the e2e tests. */
export interface BuildOptions {
  fetchImpl?: FetchLike;
  /** false in tests run through tsx (esbuild emits no decorator metadata, which Swagger needs to infer property types) */
  swagger?: boolean;
  /** one JSON access-log line per request (default true) */
  logRequests?: boolean;
}

export async function buildApp(config: AppConfig, options: BuildOptions = {}): Promise<NestExpressApplication> {
  const { fetchImpl, swagger = true, logRequests = true } = options;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, fetchImpl), { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  app.set('trust proxy', 1); // Render / Vercel / any reverse proxy: real client IP for throttling and logs
  app.use(requestId({ logRequests }));
  const metrics = app.get<Metrics>(TOKENS.METRICS);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path as string}` : 'unmatched';
      metrics.observeRequest(req.method, route, res.statusCode, Number(process.hrtime.bigint() - started) / 1e9);
    });
    next();
  });
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.useBodyParser('json', { limit: `${config.bodyLimitMb}mb` });
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => cb(null, originAllowed(origin, config.corsOrigins)),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Request-ID', 'Authorization'],
    exposedHeaders: ['Content-Disposition', 'X-Request-ID'],
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
