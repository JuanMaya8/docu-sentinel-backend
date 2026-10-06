import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { buildApp } from './app.factory';
import { loadConfig } from './domain';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen(config.port, '0.0.0.0');
  const log = new Logger('Bootstrap');
  log.log(`API:     http://localhost:${config.port}/api/v1`);
  log.log(`Swagger: http://localhost:${config.port}/docs`);
  log.log(`IA:      ${config.aiUrl}  ·  datos: ${config.dataDir}  ·  API key: ${config.apiKey ? 'activada' : 'desactivada'}`);
}

void bootstrap();
