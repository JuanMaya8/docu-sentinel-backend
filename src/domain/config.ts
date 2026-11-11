export interface AppConfig {
  port: number;
  apiKey?: string;
  aiUrl: string;
  aiApiKey?: string;
  aiTimeoutMs: number;
  dataDir: string;
  corsOrigins: string[];
  bodyLimitMb: number;
  throttleLimit: number;
  /** analyses older than this many days are deleted automatically; 0 = keep forever */
  retentionDays: number;
  /** how often the retention job runs */
  retentionIntervalMs: number;
  /** PostgreSQL connection string; empty => JSON files in dataDir */
  databaseUrl?: string;
  /** use TLS for Postgres (external connection strings of managed databases) */
  databaseSsl: boolean;
  /** HS256 secret; when set, user accounts are enabled and /analyses + /baselines require a Bearer token */
  jwtSecret?: string;
  jwtTtlHours: number;
  allowRegistration: boolean;
  /** POSTed (JSON) when a saved analysis has findings at or above `webhookMinRisk` */
  webhookUrl?: string;
  webhookSecret?: string;
  webhookMinRisk: 'low' | 'medium' | 'high' | 'critical';
  /** when set, GET /metrics needs `Authorization: Bearer <token>` */
  metricsToken?: string;
  version: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const int = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
  };
  const bool = (v: string | undefined, d: boolean): boolean => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
  return {
    port: int(env.PORT, 3001),
    apiKey: env.API_KEY || undefined,
    aiUrl: env.AI_URL || 'http://localhost:8000',
    aiApiKey: env.AI_API_KEY || undefined,
    aiTimeoutMs: int(env.AI_TIMEOUT_MS, 120_000),
    dataDir: env.DATA_DIR || './data',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimitMb: int(env.BODY_LIMIT_MB, 100),
    throttleLimit: int(env.THROTTLE_LIMIT, 300),
    retentionDays: int(env.RETENTION_DAYS, 0),
    retentionIntervalMs: int(env.RETENTION_INTERVAL_MS, 3_600_000),
    databaseUrl: env.DATABASE_URL || undefined,
    databaseSsl: bool(env.DATABASE_SSL, false),
    jwtSecret: env.JWT_SECRET || undefined,
    jwtTtlHours: int(env.JWT_TTL_HOURS, 168),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    webhookUrl: env.WEBHOOK_URL || undefined,
    webhookSecret: env.WEBHOOK_SECRET || undefined,
    webhookMinRisk: (['low', 'medium', 'high', 'critical'] as const).find((r) => r === env.WEBHOOK_MIN_RISK) ?? 'critical',
    metricsToken: env.METRICS_TOKEN || undefined,
    version: env.npm_package_version ?? '0.3.0',
  };
}

/**
 * CORS origin check. Entries are exact origins (`https://app.example.com`) or a single `*` wildcard in the host
 * (`https://*.vercel.app`, handy for Vercel preview deployments). `*` alone allows any origin.
 */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // same-origin / server-to-server requests send no Origin header
  return allowed.some((rule) => {
    if (rule === '*') return true;
    if (!rule.includes('*')) return rule === origin;
    const re = new RegExp('^' + rule.split('*').map((p) => p.replace(/[.+?^${}()|[\]\/]/g, '\$&')).join('[a-z0-9-]+') + '$', 'i');
    return re.test(origin);
  });
}
