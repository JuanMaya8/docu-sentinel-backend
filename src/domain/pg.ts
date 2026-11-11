/**
 * PostgreSQL storage (selected when DATABASE_URL is set). Same contracts as the file-based classes:
 *  - PgAnalysisRepository implements AnalysisRepository with tables `analyses` + `findings`
 *    (filters, search, sort and paging run in SQL; 100 000 findings are inserted in batches with unnest)
 *  - PgBlobStore implements BlobStore on a small key/value table (used for baselines and users)
 * The schema is created on first use (`CREATE TABLE IF NOT EXISTS`), so no migration tool is needed.
 */
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AnalysisRepository } from './analysis-repository';
import type { BlobStore } from './blob-store';
import { NotFoundError } from './errors';
import type { FindingsQuery } from './findings-query';
import { buildDetail, buildSummary, sortByScoreDesc } from './summary';
import type { AnalysisDetail, AnalysisSummary, FindingDto, Page, RiskLevel, SaveAnalysisDto } from './types';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ds_analyses (
  id          text PRIMARY KEY,
  owner_id    text,
  created_at  timestamptz NOT NULL,
  detail      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ds_analyses_owner_created ON ds_analyses (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ds_analyses_created ON ds_analyses (created_at);
CREATE TABLE IF NOT EXISTS ds_findings (
  analysis_id  text NOT NULL REFERENCES ds_analyses(id) ON DELETE CASCADE,
  ord          integer NOT NULL,
  record_index integer,
  record_id    text,
  type         text NOT NULL,
  risk         text NOT NULL,
  risk_rank    smallint NOT NULL,
  score        double precision NOT NULL,
  field        text,
  value        text,
  explanation  text NOT NULL,
  detector     text NOT NULL,
  PRIMARY KEY (analysis_id, ord)
);
CREATE INDEX IF NOT EXISTS ds_findings_risk ON ds_findings (analysis_id, risk);
CREATE INDEX IF NOT EXISTS ds_findings_type ON ds_findings (analysis_id, type);
CREATE INDEX IF NOT EXISTS ds_findings_record ON ds_findings (analysis_id, record_index);
CREATE TABLE IF NOT EXISTS ds_kv (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const BATCH = 5000;

/** Creates the schema once per pool (idempotent, safe with several instances). */
const ready = new WeakMap<Pool, Promise<void>>();
export function ensureSchema(pool: Pool): Promise<void> {
  let p = ready.get(pool);
  if (!p) {
    p = pool.query(SCHEMA_SQL).then(() => undefined);
    p.catch(() => ready.delete(pool));
    ready.set(pool, p);
  }
  return p;
}

const ORDER_BY: Record<FindingsQuery['sort'], string> = {
  'score:desc': 'score DESC, COALESCE(record_index, -1) ASC, ord ASC',
  'score:asc': 'score ASC, COALESCE(record_index, -1) ASC, ord ASC',
  'record:asc': 'COALESCE(record_index, -1) ASC, score DESC, ord ASC',
  'record:desc': 'COALESCE(record_index, -1) DESC, score DESC, ord ASC',
  'risk:desc': 'risk_rank DESC, score DESC, ord ASC',
};

function rowToFinding(r: Record<string, unknown>): FindingDto {
  const f: FindingDto = {
    recordIndex: r.record_index === null ? null : Number(r.record_index),
    type: r.type as FindingDto['type'],
    risk: r.risk as RiskLevel,
    score: Number(r.score),
    field: (r.field as string | null) ?? null,
    explanation: r.explanation as string,
    detector: r.detector as string,
  };
  if (r.record_id !== null && r.record_id !== undefined) f.recordId = r.record_id as string;
  if (r.value !== null && r.value !== undefined) f.value = r.value as string;
  return f;
}

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class PgAnalysisRepository implements AnalysisRepository {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    await ensureSchema(this.pool);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async save(dto: SaveAnalysisDto, ownerId?: string): Promise<AnalysisSummary> {
    const id = `an_${randomBytes(6).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const summary = buildSummary(id, createdAt, dto);
    const detail: AnalysisDetail = { ...buildDetail(summary, dto), ...(ownerId ? { ownerId } : {}) };
    const sorted = sortByScoreDesc(dto.findings);
    await this.tx(async (c) => {
      await c.query('INSERT INTO ds_analyses (id, owner_id, created_at, detail) VALUES ($1, $2, $3, $4)', [id, ownerId ?? null, createdAt, JSON.stringify(detail)]);
      for (let from = 0; from < sorted.length; from += BATCH) {
        const chunk = sorted.slice(from, from + BATCH);
        await c.query(
          `INSERT INTO ds_findings (analysis_id, ord, record_index, record_id, type, risk, risk_rank, score, field, value, explanation, detector)
           SELECT $1, * FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::smallint[], $8::float8[], $9::text[], $10::text[], $11::text[], $12::text[])`,
          [
            id,
            chunk.map((_, i) => from + i),
            chunk.map((f) => f.recordIndex),
            chunk.map((f) => f.recordId ?? null),
            chunk.map((f) => f.type),
            chunk.map((f) => f.risk),
            chunk.map((f) => RISK_RANK[f.risk]),
            chunk.map((f) => f.score),
            chunk.map((f) => f.field),
            chunk.map((f) => f.value ?? null),
            chunk.map((f) => f.explanation),
            chunk.map((f) => f.detector),
          ],
        );
      }
    });
    return summary;
  }

  async list(limit: number, offset: number, ownerId?: string): Promise<Page<AnalysisSummary>> {
    await ensureSchema(this.pool);
    const where = ownerId ? 'WHERE owner_id = $3' : '';
    const params: unknown[] = [limit, offset, ...(ownerId ? [ownerId] : [])];
    const rows = await this.pool.query(`SELECT detail, count(*) OVER () AS total FROM ds_analyses ${where} ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`, params);
    let total = rows.rows.length ? Number(rows.rows[0].total) : 0;
    if (!rows.rows.length && offset > 0) {
      const c = await this.pool.query(`SELECT count(*) AS n FROM ds_analyses ${ownerId ? 'WHERE owner_id = $1' : ''}`, ownerId ? [ownerId] : []);
      total = Number(c.rows[0].n);
    }
    const items = rows.rows.map((r) => {
      const { columns: _c, sensitivity: _s, mlMode: _m, baselineId: _b, ownerId: _o, ...summary } = r.detail as AnalysisDetail;
      return summary;
    });
    return { items, total };
  }

  async get(id: string, ownerId?: string): Promise<AnalysisDetail> {
    await ensureSchema(this.pool);
    const r = await this.pool.query('SELECT detail, owner_id FROM ds_analyses WHERE id = $1', [id]);
    if (!r.rows.length || (ownerId && r.rows[0].owner_id !== ownerId)) throw new NotFoundError('un análisis', id);
    return r.rows[0].detail as AnalysisDetail;
  }

  async fileName(id: string, ownerId?: string): Promise<string> {
    return (await this.get(id, ownerId)).fileName;
  }

  async allFindings(id: string, ownerId?: string): Promise<FindingDto[]> {
    await this.get(id, ownerId);
    const r = await this.pool.query('SELECT * FROM ds_findings WHERE analysis_id = $1 ORDER BY ord', [id]);
    return r.rows.map(rowToFinding);
  }

  async findings(id: string, q: FindingsQuery, ownerId?: string): Promise<Page<FindingDto>> {
    await this.get(id, ownerId);
    const where = ['analysis_id = $1'];
    const params: unknown[] = [id];
    const add = (sql: string, v: unknown): void => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.risk) add('risk = ?', q.risk);
    if (q.type) add('type = ?', q.type);
    if (q.field) add('field = ?', q.field);
    if (q.q) {
      params.push(`%${likeEscape(q.q)}%`);
      const p = `$${params.length}`;
      where.push(`(explanation ILIKE ${p} OR COALESCE(field,'') ILIKE ${p} OR COALESCE(record_id,'') ILIKE ${p} OR COALESCE(value,'') ILIKE ${p})`);
    }
    params.push(q.limit, q.offset);
    const r = await this.pool.query(
      `SELECT *, count(*) OVER () AS total FROM ds_findings WHERE ${where.join(' AND ')} ORDER BY ${ORDER_BY[q.sort]} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    let total = r.rows.length ? Number(r.rows[0].total) : 0;
    if (!r.rows.length && q.offset > 0) {
      const c = await this.pool.query(`SELECT count(*) AS n FROM ds_findings WHERE ${where.join(' AND ')}`, params.slice(0, -2));
      total = Number(c.rows[0].n);
    }
    return { total, items: r.rows.map(rowToFinding) };
  }

  async remove(id: string, ownerId?: string): Promise<void> {
    await this.get(id, ownerId);
    await this.pool.query('DELETE FROM ds_analyses WHERE id = $1', [id]);
  }

  async idsCreatedBefore(cutoffIso: string): Promise<string[]> {
    await ensureSchema(this.pool);
    const r = await this.pool.query('SELECT id FROM ds_analyses WHERE created_at < $1 ORDER BY created_at', [cutoffIso]);
    return r.rows.map((x) => x.id as string);
  }
}

/** Key/value BlobStore on Postgres. `prefix` namespaces keys so several stores can share the table. */
export class PgBlobStore implements BlobStore {
  constructor(private readonly pool: Pool, private readonly prefix: string) {}
  private k(key: string): string {
    return `${this.prefix}/${key}`;
  }
  async read(key: string): Promise<string | null> {
    await ensureSchema(this.pool);
    const r = await this.pool.query('SELECT value FROM ds_kv WHERE key = $1', [this.k(key)]);
    return r.rows.length ? (r.rows[0].value as string) : null;
  }
  async write(key: string, data: string): Promise<void> {
    await ensureSchema(this.pool);
    await this.pool.query('INSERT INTO ds_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [this.k(key), data]);
  }
  async remove(key: string): Promise<void> {
    await ensureSchema(this.pool);
    await this.pool.query('DELETE FROM ds_kv WHERE key = $1', [this.k(key)]);
  }
  async list(suffix: string): Promise<string[]> {
    await ensureSchema(this.pool);
    const r = await this.pool.query("SELECT key FROM ds_kv WHERE key LIKE $1 ESCAPE '\\'", [`${likeEscape(this.prefix)}/%${likeEscape(suffix)}`]);
    return r.rows.map((x) => (x.key as string).slice(this.prefix.length + 1));
  }
}
