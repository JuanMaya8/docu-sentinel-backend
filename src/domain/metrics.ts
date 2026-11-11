/**
 * Minimal Prometheus registry (text exposition format 0.0.4), no dependency.
 * HTTP requests are counted by method/route/status and timed in a histogram; domain counters are added by name.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

type Labels = Record<string, string>;
const key = (l: Labels): string => Object.keys(l).sort().map((k) => `${k}="${l[k].replace(/["\\\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`))}"`).join(',');

interface Histogram {
  labels: Labels;
  counts: number[];
  sum: number;
  count: number;
}

export class Metrics {
  private readonly started = Date.now();
  private readonly requests = new Map<string, { labels: Labels; value: number }>();
  private readonly durations = new Map<string, Histogram>();
  private readonly counters = new Map<string, { help: string; values: Map<string, { labels: Labels; value: number }> }>();

  /** `route` must be the route pattern (e.g. /api/v1/analyses/:id), never the raw URL, to keep cardinality low. */
  observeRequest(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    const k = key(labels);
    const cur = this.requests.get(k) ?? { labels, value: 0 };
    cur.value++;
    this.requests.set(k, cur);
    const hl = { method, route };
    const hk = key(hl);
    const h = this.durations.get(hk) ?? { labels: hl, counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) h.counts[i]++;
    });
    h.sum += seconds;
    h.count++;
    this.durations.set(hk, h);
  }

  inc(name: string, help: string, labels: Labels = {}, by = 1): void {
    const c = this.counters.get(name) ?? { help, values: new Map() };
    const k = key(labels);
    const cur = c.values.get(k) ?? { labels, value: 0 };
    cur.value += by;
    c.values.set(k, cur);
    this.counters.set(name, c);
  }

  render(gauges: Record<string, { help: string; value: number }> = {}): string {
    const out: string[] = [];
    const wrap = (l: Labels): string => (Object.keys(l).length ? `{${key(l)}}` : '');
    out.push('# HELP ds_http_requests_total HTTP requests by method, route and status.', '# TYPE ds_http_requests_total counter');
    for (const r of this.requests.values()) out.push(`ds_http_requests_total${wrap(r.labels)} ${r.value}`);
    out.push('# HELP ds_http_request_duration_seconds HTTP request duration.', '# TYPE ds_http_request_duration_seconds histogram');
    for (const h of this.durations.values()) {
      BUCKETS.forEach((b, i) => out.push(`ds_http_request_duration_seconds_bucket${wrap({ ...h.labels, le: String(b) })} ${h.counts[i]}`));
      out.push(`ds_http_request_duration_seconds_bucket${wrap({ ...h.labels, le: '+Inf' })} ${h.count}`);
      out.push(`ds_http_request_duration_seconds_sum${wrap(h.labels)} ${h.sum.toFixed(6)}`);
      out.push(`ds_http_request_duration_seconds_count${wrap(h.labels)} ${h.count}`);
    }
    for (const [name, c] of this.counters) {
      out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
      for (const v of c.values.values()) out.push(`${name}${wrap(v.labels)} ${v.value}`);
    }
    const all = { ds_process_uptime_seconds: { help: 'Seconds since the process started.', value: (Date.now() - this.started) / 1000 }, ...gauges };
    for (const [name, g] of Object.entries(all)) out.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`, `${name} ${g.value}`);
    return out.join('\n') + '\n';
  }
}
