import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { AiScoreResponse, BaselineDto, BaselineService } from '../domain';
import { Owner } from '../http/auth.guard';
import { CreateBaselineDoc, RetrainBaselineDoc, ScoreBaselineDoc } from '../http/dto';
import { TOKENS } from '../tokens';

@ApiTags('baselines')
@ApiSecurity('api-key')
@ApiBearerAuth()
@Controller('baselines')
export class BaselinesController {
  constructor(@Inject(TOKENS.BASELINES) private readonly baselines: BaselineService) {}

  @Post()
  @ApiOperation({ summary: 'Entrena una línea base histórica en la IA con una matriz de características' })
  @ApiBody({ type: CreateBaselineDoc })
  create(@Body() body: unknown, @Owner() owner?: string): Promise<BaselineDto> {
    return this.baselines.create(body, owner);
  }

  @Get()
  @ApiOperation({ summary: 'Lista las líneas base' })
  list(@Owner() owner?: string): Promise<BaselineDto[]> {
    return this.baselines.list(owner);
  }

  @Get(':id')
  get(@Param('id') id: string, @Owner() owner?: string): Promise<BaselineDto> {
    return this.baselines.get(id, owner);
  }

  @Post(':id/retrain')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reentrena la línea base con datos nuevos (mismas columnas); sube la versión y reemplaza el modelo' })
  @ApiBody({ type: RetrainBaselineDoc })
  retrain(@Param('id') id: string, @Body() body: unknown, @Owner() owner?: string): Promise<BaselineDto> {
    return this.baselines.retrain(id, body, owner);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina la línea base (y su modelo en la IA, si responde)' })
  async remove(@Param('id') id: string, @Owner() owner?: string): Promise<void> {
    await this.baselines.remove(id, owner);
  }

  @Post(':id/score')
  @HttpCode(200)
  @ApiOperation({ summary: 'Puntúa filas nuevas contra la línea base (las columnas las pone el backend)' })
  @ApiBody({ type: ScoreBaselineDoc })
  score(@Param('id') id: string, @Body() body: unknown, @Owner() owner?: string): Promise<AiScoreResponse> {
    return this.baselines.score(id, body, owner);
  }
}
