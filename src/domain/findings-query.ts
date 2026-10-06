import { ValidationError } from './errors';
import { ANOMALY_TYPES, RISK_LEVELS, type AnomalyType, type FindingDto, type Page, type RiskLevel } from './types';

export type SortKey = 'score:desc' | 'score:asc' | 'record:asc' | 'record:desc' | 'risk:desc';
const SORTS: readonly SortKey[] = ['score:desc', 'score:asc', 'record:asc', 'record:desc', 'risk:desc'];
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface FindingsQuery {
  risk?: RiskLevel;
  type?: AnomalyType;
  field?: string;
  q?: string;
  sort: SortKey;
  limit: number;
  offset: number;
}

/** Parses the raw query string values (all strings) into a typed query; throws ValidationError in Spanish. */
export function parseFindingsQuery(raw: Record<string, unknown>): FindingsQuery {
  const errors: string[] = [];
  const s = (k: string): string | undefined => (typeof raw[k] === 'string' && (raw[k] as string) !== '' ? (raw[k] as string) : undefined);
  const risk = s('risk');
  if (risk && !(RISK_LEVELS as readonly string[]).includes(risk)) errors.push(`«risk» debe ser uno de: ${RISK_LEVELS.join(', ')}.`);
  const type = s('type');
  if (type && !(ANOMALY_TYPES as readonly string[]).includes(type)) errors.push('«type» no es un tipo de anomalía conocido.');
  const sort = s('sort') ?? 'score:desc';
  if (!(SORTS as readonly string[]).includes(sort)) errors.push(`«sort» debe ser uno de: ${SORTS.join(', ')}.`);
  const num = (k: string, def: number, min: number, max: number): number => {
    const v = s(k);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`«${k}» debe ser un entero entre ${min} y ${max}.`);
      return def;
    }
    return n;
  };
  const limit = num('limit', 100, 1, 5000);
  const offset = num('offset', 0, 0, 10_000_000);
  if (errors.length) throw new ValidationError(errors);
  return { risk: risk as RiskLevel | undefined, type: type as AnomalyType | undefined, field: s('field'), q: s('q'), sort: sort as SortKey, limit, offset };
}

export function queryFindings(all: FindingDto[], q: FindingsQuery): Page<FindingDto> {
  const needle = q.q?.toLowerCase();
  let out = all.filter((f) => (!q.risk || f.risk === q.risk) && (!q.type || f.type === q.type) && (!q.field || f.field === q.field)
    && (!needle || f.explanation.toLowerCase().includes(needle) || (f.field ?? '').toLowerCase().includes(needle) || (f.recordId ?? '').toLowerCase().includes(needle) || (f.value ?? '').toLowerCase().includes(needle)));
  const idx = (f: FindingDto): number => f.recordIndex ?? -1;
  switch (q.sort) {
    case 'score:desc': out = [...out].sort((a, b) => b.score - a.score || idx(a) - idx(b)); break;
    case 'score:asc': out = [...out].sort((a, b) => a.score - b.score || idx(a) - idx(b)); break;
    case 'record:asc': out = [...out].sort((a, b) => idx(a) - idx(b) || b.score - a.score); break;
    case 'record:desc': out = [...out].sort((a, b) => idx(b) - idx(a) || b.score - a.score); break;
    case 'risk:desc': out = [...out].sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || b.score - a.score); break;
  }
  return { total: out.length, items: out.slice(q.offset, q.offset + q.limit) };
}
