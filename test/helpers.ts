import type { AiModelInfo, AiScoreResponse, FindingDto, SaveAnalysisDto } from '../src/domain';
import type { FetchLike } from '../src/domain/ai-client';

export function finding(over: Partial<FindingDto> = {}): FindingDto {
  return { recordIndex: 0, type: 'out_of_range', risk: 'high', score: 70, field: 'total', explanation: 'El valor 9.000 en «total» es muy alto.', detector: 'range', ...over };
}

export function saveBody(over: Partial<SaveAnalysisDto> = {}): SaveAnalysisDto {
  return {
    fileName: 'facturas.csv', format: 'csv', fileSizeBytes: 1234, rows: 100,
    columns: [{ name: 'total', type: 'decimal', nullRate: 0.01, distinct: 90 }, { name: 'city', type: 'string', nullRate: 0, distinct: null }],
    durationMs: 850, mode: 'pool', workers: 4, sensitivity: 'medium', mlMode: 'local',
    findings: [
      finding({ recordIndex: 3, score: 90, risk: 'critical', type: 'impossible_relation', field: 'total', recordId: 'FV-1003' }),
      finding({ recordIndex: 3, score: 40, risk: 'medium', type: 'whitespace', field: 'city' }),
      finding({ recordIndex: 10, score: 70 }),
      finding({ recordIndex: null, score: 20, risk: 'low', type: 'benford', field: 'total', explanation: 'Distribución de primeros dígitos atípica.' }),
    ],
    ...over,
  };
}

/** In-memory fake of docu-sentinel-ai speaking the same contract. */
export class FakeAi {
  models = new Map<string, AiModelInfo>();
  calls: Array<{ method: string; path: string; body?: any; headers: Record<string, string> }> = [];
  down = false;
  failWith: { status: number; body: unknown } | null = null;
  private n = 0;

  fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    this.calls.push({ method: init.method, path, body, headers: init.headers });
    if (this.down) throw new TypeError('fetch failed');
    if (init.method === 'GET' && path === '/health') return reply(200, { status: 'ok' });
    if (this.failWith) return reply(this.failWith.status, this.failWith.body);
    if (init.method === 'POST' && path === '/v1/models') {
      const id = `mdl_${String(++this.n).padStart(12, '0')}`;
      const info: AiModelInfo = { model_id: id, name: body.name, columns: body.columns, kinds: body.kinds ?? body.columns.map(() => 'numeric'), rows: body.matrix.length, threshold: 0.61, contamination: 0.01, seed: 42, trained_at: '2026-01-01T00:00:00Z', schema_signature: body.schema_signature ?? null, engine: 'fake' };
      this.models.set(id, info);
      return reply(201, info);
    }
    const m = /^\/v1\/models\/([^/]+)(\/score)?$/.exec(path);
    if (m) {
      const info = this.models.get(m[1]);
      if (!info) return reply(404, { code: 'MODEL_NOT_FOUND', message: 'No existe ese modelo.' });
      if (init.method === 'DELETE') {
        this.models.delete(m[1]);
        return reply(204, null);
      }
      if (m[2]) {
        const res: AiScoreResponse = { model_id: info.model_id, threshold: info.threshold, scores: body.matrix.map((_: unknown, i: number) => (i === 0 ? 0.9 : 0.5)), flags: body.matrix.map((_: unknown, i: number) => i === 0), contributions: {} };
        return reply(200, res);
      }
    }
    return reply(404, { code: 'NOT_FOUND', message: 'ruta' });
  };
}

function reply(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
}

export function matrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * 0.5 + c));
}
