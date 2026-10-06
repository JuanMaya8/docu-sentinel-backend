import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { AiScoreResponse, BaselineDto, BaselineService } from '../domain';
import { CreateBaselineDoc, ScoreBaselineDoc } from '../http/dto';
import { TOKENS } from '../tokens';

@ApiTags('baselines')
@ApiSecurity('api-key')
@Controller('baselines')
export class BaselinesController {
  constructor(@Inject(TOKENS.BASELINES) private readonly baselines: BaselineService) {}

  @Post()
  @ApiOperation({ summary: 'Entrena una línea base histórica en la IA con una matriz de características' })
  @ApiBody({ type: CreateBaselineDoc })
  create(@Body() body: unknown): Promise<BaselineDto> {
    return this.baselines.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'Lista las líneas base' })
  list(): Promise<BaselineDto[]> {
    return this.baselines.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BaselineDto> {
    return this.baselines.get(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina la línea base (y su modelo en la IA, si responde)' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.baselines.remove(id);
  }

  @Post(':id/score')
  @HttpCode(200)
  @ApiOperation({ summary: 'Puntúa filas nuevas contra la línea base (las columnas las pone el backend)' })
  @ApiBody({ type: ScoreBaselineDoc })
  score(@Param('id') id: string, @Body() body: unknown): Promise<AiScoreResponse> {
    return this.baselines.score(id, body);
  }
}
