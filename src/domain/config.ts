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
  version: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const int = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
  };
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
    version: env.npm_package_version ?? '0.2.0',
  };
}
