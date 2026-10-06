import { AiUnavailableError, DomainError } from './errors';
import type { AiModelInfo, AiScoreResponse, FeatureKind } from './types';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface AiClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface TrainBody {
  name: string;
  columns: string[];
  kinds?: FeatureKind[];
  matrix: Array<Array<number | null>>;
  schema_signature?: string;
  contamination?: number;
  seed?: number;
}

export interface ScoreBody {
  columns: string[];
  kinds?: string[];
  matrix: Array<Array<number | null>>;
  explain?: 'flagged' | 'all' | 'none';
  top_k?: number;
}

/**
 * HTTP client for docu-sentinel-ai. Network errors, timeouts and 5xx become AiUnavailableError (503 AI_UNAVAILABLE),
 * which the frontend answers by falling back to its local model. 4xx errors from the AI keep their own code/message.
 */
export class AiClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: AiClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.opts.apiKey) headers['X-API-Key'] = this.opts.apiKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new AiUnavailableError(ctrl.signal.aborted ? 'tiempo de espera agotado' : e instanceof Error ? e.message : undefined);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500) throw new AiUnavailableError(`HTTP ${res.status}`);
    if (!res.ok) {
      let code = `AI_HTTP_${res.status}`;
      let message = `La IA respondió ${res.status}.`;
      try {
        const err = (await res.json()) as { code?: string; message?: string; detail?: unknown };
        if (err.code) code = err.code;
        if (err.message) message = err.message;
        else if (Array.isArray(err.detail)) message = 'Datos rechazados por la IA: ' + err.detail.slice(0, 3).map((d) => (d as { msg?: string }).msg ?? '').filter(Boolean).join('; ');
      } catch {
        /* not JSON */
      }
      // 401/403 from the AI is a configuration problem of OUR server, not of the caller
      if (res.status === 401 || res.status === 403) throw new AiUnavailableError('la IA rechazó la clave del backend');
      throw new DomainError(res.status === 404 ? 404 : res.status === 409 ? 409 : 422, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<{ status: string }> {
    return this.call('GET', '/health', undefined, 3000);
  }
  train(body: TrainBody): Promise<AiModelInfo> {
    return this.call('POST', '/v1/models', body);
  }
  score(modelId: string, body: ScoreBody): Promise<AiScoreResponse> {
    return this.call('POST', `/v1/models/${encodeURIComponent(modelId)}/score`, body);
  }
  deleteModel(modelId: string): Promise<void> {
    return this.call('DELETE', `/v1/models/${encodeURIComponent(modelId)}`);
  }
}
