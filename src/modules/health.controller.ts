import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AiClient, AppConfig } from '../domain';
import { TOKENS } from '../tokens';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(@Inject(TOKENS.AI) private readonly ai: AiClient, @Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  @Get()
  @ApiOperation({ summary: 'Estado del backend y de la IA' })
  async health(): Promise<{ status: 'ok'; ai: 'up' | 'down'; version: string }> {
    const ai = await this.ai.health().then(() => 'up' as const, () => 'down' as const);
    return { status: 'ok', ai, version: this.config.version };
  }
}
