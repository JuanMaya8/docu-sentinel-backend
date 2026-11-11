/**
 * Webhook notifier: when a saved analysis has findings at or above `minRisk`, POSTs a JSON summary to `url`.
 * Best effort (never breaks the request that saved the report), 5 s timeout, optional HMAC-SHA256 signature in
 * `X-DocuSentinel-Signature: sha256=<hex>` computed over the raw body with `secret`.
 */
import { createHmac } from 'node:crypto';
import type { EventBus } from './events';
import type { FetchLike } from './ai-client';
import type { AnalysisSummary, RiskLevel } from './types';

const ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export interface WebhookOptions {
  url: string;
  secret?: string;
  minRisk: RiskLevel;
  fetchImpl?: FetchLike;
  onError?: (message: string) => void;
}

export function shouldNotify(summary: AnalysisSummary, minRisk: RiskLevel): boolean {
  return ORDER.slice(ORDER.indexOf(minRisk)).some((r) => (summary.byRisk[r] ?? 0) > 0);
}

export function signBody(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function attachWebhook(events: EventBus, opts: WebhookOptions): () => void {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return events.subscribe((event, payload) => {
    if (event !== 'analysis.saved') return;
    const summary = payload as AnalysisSummary;
    if (!shouldNotify(summary, opts.minRisk)) return;
    const body = JSON.stringify({
      event: 'analysis.flagged',
      minRisk: opts.minRisk,
      analysis: {
        id: summary.id, createdAt: summary.createdAt, fileName: summary.fileName, rows: summary.rows,
        findingsCount: summary.findingsCount, recordsAffected: summary.recordsAffected, byRisk: summary.byRisk,
      },
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'docu-sentinel-backend' };
    if (opts.secret) headers['X-DocuSentinel-Signature'] = signBody(body, opts.secret);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    void doFetch(opts.url, { method: 'POST', headers, body, signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) opts.onError?.(`El webhook respondió ${res.status}`);
      })
      .catch((e: unknown) => opts.onError?.(`El webhook falló: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => clearTimeout(timer));
  });
}
