import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ValidationError, type AnalysisService, type AnalysisSummary, type AnalysisDetail, type FindingDto, type Page } from '../domain';
import { Owner } from '../http/auth.guard';
import { SaveAnalysisDoc } from '../http/dto';
import { TOKENS } from '../tokens';

function pageParam(raw: unknown, name: string, def: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError([`«${name}» debe ser un entero entre ${min} y ${max}.`]);
  return n;
}

@ApiTags('analyses')
@ApiSecurity('api-key')
@ApiBearerAuth()
@Controller('analyses')
export class AnalysesController {
  constructor(@Inject(TOKENS.ANALYSES) private readonly analyses: AnalysisService) {}

  @Post()
  @ApiOperation({ summary: 'Guarda el reporte de un análisis (solo resultados, nunca el archivo)' })
  @ApiBody({ type: SaveAnalysisDoc })
  save(@Body() body: unknown, @Owner() owner?: string): Promise<AnalysisSummary> {
    return this.analyses.save(body, owner);
  }

  @Get()
  @ApiOperation({ summary: 'Lista los reportes, el más reciente primero' })
  @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'offset', required: false })
  list(@Query('limit') limit?: string, @Query('offset') offset?: string, @Owner() owner?: string): Promise<Page<AnalysisSummary>> {
    return this.analyses.list(pageParam(limit, 'limit', 20, 1, 200), pageParam(offset, 'offset', 0, 0, 10_000_000), owner);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Resumen y columnas de un reporte' })
  async get(@Param('id') id: string, @Owner() owner?: string): Promise<AnalysisDetail> {
    const { ownerId: _o, ...detail } = await this.analyses.get(id, owner);
    return detail;
  }

  @Get(':id/findings')
  @ApiOperation({ summary: 'Hallazgos con filtros, búsqueda, orden y paginación' })
  @ApiQuery({ name: 'risk', required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @ApiQuery({ name: 'type', required: false }) @ApiQuery({ name: 'field', required: false }) @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['score:desc', 'score:asc', 'record:asc', 'record:desc', 'risk:desc'] })
  @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'offset', required: false })
  findings(@Param('id') id: string, @Query() query: Record<string, unknown>, @Owner() owner?: string): Promise<Page<FindingDto>> {
    return this.analyses.findings(id, query, owner);
  }

  @Get(':id/export.csv')
  @ApiOperation({ summary: 'CSV (UTF-8 con BOM): Registro, Tipo de anomalía, Nivel de riesgo, Campo afectado, Explicación' })
  async exportCsv(@Param('id') id: string, @Res() res: Response, @Owner() owner?: string): Promise<void> {
    const { fileName, csv } = await this.analyses.exportCsv(id, owner);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  }

  @Get(':id/export.json')
  @ApiOperation({ summary: 'JSON con el resumen del reporte y todos sus hallazgos' })
  async exportJson(@Param('id') id: string, @Res() res: Response, @Owner() owner?: string): Promise<void> {
    const { fileName, json } = await this.analyses.exportJson(id, owner);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(json);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina un reporte' })
  async remove(@Param('id') id: string, @Owner() owner?: string): Promise<void> {
    await this.analyses.remove(id, owner);
  }
}
