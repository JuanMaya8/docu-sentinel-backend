/**
 * Behaviour every AnalysisRepository must have (file/memory and PostgreSQL run the SAME assertions).
 * Not a test file by itself (no `.test.ts`): imported by repository.test.ts and pg.test.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, parseFindingsQuery, type AnalysisRepository } from '../src/domain';
import { finding, saveBody } from './helpers';

const q = (o: Record<string, unknown> = {}) => parseFindingsQuery(o);

export function runRepositoryContract(label: string, make: () => Promise<AnalysisRepository> | AnalysisRepository): void {
  test(`[${label}] save → summary, detail and findings sorted by score`, async () => {
    const repo = await make();
    const s = await repo.save(saveBody());
    assert.match(s.id, /^an_[0-9a-f]{12}$/);
    assert.equal(s.findingsCount, 4);
    assert.equal(s.recordsAffected, 2);
    assert.deepEqual(s.byRisk, { low: 1, medium: 1, high: 1, critical: 1 });
    const d = await repo.get(s.id);
    assert.equal(d.columns.length, 2);
    assert.equal(d.sensitivity, 'medium');
    assert.deepEqual((await repo.findings(s.id, q())).items.map((f) => f.score), [90, 70, 40, 20]);
    const all = await repo.allFindings(s.id);
    assert.equal(all[0].recordId, 'FV-1003');
    assert.equal(all[3].recordIndex, null);
    assert.equal(await repo.fileName(s.id), 'facturas.csv');
  });

  test(`[${label}] findings: filters, search (escaped), sorts and paging`, async () => {
    const repo = await make();
    const s = await repo.save(saveBody({
      findings: [
        ...saveBody().findings,
        finding({ recordIndex: 7, score: 55, risk: 'medium', field: 'pct', explanation: 'Descuento de 100% sospechoso', value: '100%' }),
      ],
    }));
    assert.equal((await repo.findings(s.id, q({ risk: 'critical' }))).total, 1);
    assert.equal((await repo.findings(s.id, q({ type: 'whitespace' }))).items[0].field, 'city');
    assert.equal((await repo.findings(s.id, q({ field: 'total' }))).total, 3);
    assert.equal((await repo.findings(s.id, q({ q: 'fv-1003' }))).total, 1, 'search is case-insensitive');
    assert.equal((await repo.findings(s.id, q({ q: '100%' }))).total, 1, '% is literal, not a wildcard');
    assert.equal((await repo.findings(s.id, q({ q: '_' }))).total, 0, '_ is literal, not a wildcard');
    assert.deepEqual((await repo.findings(s.id, q({ sort: 'record:asc' }))).items.map((f) => f.recordIndex), [null, 3, 3, 7, 10]);
    assert.deepEqual((await repo.findings(s.id, q({ sort: 'record:desc' }))).items.map((f) => f.recordIndex), [10, 7, 3, 3, null]);
    assert.deepEqual((await repo.findings(s.id, q({ sort: 'score:asc' }))).items.map((f) => f.score), [20, 40, 55, 70, 90]);
    assert.deepEqual((await repo.findings(s.id, q({ sort: 'risk:desc', limit: '2' }))).items.map((f) => f.risk), ['critical', 'high']);
    const p2 = await repo.findings(s.id, q({ limit: '2', offset: '2' }));
    assert.deepEqual([p2.total, p2.items.length], [5, 2]);
    const past = await repo.findings(s.id, q({ limit: '2', offset: '50' }));
    assert.deepEqual([past.total, past.items.length], [5, 0], 'total is still reported past the end');
  });

  test(`[${label}] list: newest first, paged, without heavy fields`, async () => {
    const repo = await make();
    const owner = `us_list${Date.now()}`;
    const a = await repo.save(saveBody({ fileName: 'a.csv' }), owner);
    await new Promise((r) => setTimeout(r, 10));
    const b = await repo.save(saveBody({ fileName: 'b.csv' }), owner);
    const page = await repo.list(10, 0, owner);
    assert.equal(page.total, 2);
    assert.deepEqual(page.items.map((i) => i.id), [b.id, a.id]);
    assert.equal((page.items[0] as any).columns, undefined);
    assert.equal((page.items[0] as any).ownerId, undefined);
    assert.equal((await repo.list(1, 1, owner)).items[0].id, a.id);
    assert.equal((await repo.list(5, 10, owner)).total, 2);
  });

  test(`[${label}] ownership: another owner sees nothing and cannot read or delete`, async () => {
    const repo = await make();
    const alice = `us_a${Date.now()}`;
    const bob = `us_b${Date.now()}`;
    const s = await repo.save(saveBody(), alice);
    assert.equal((await repo.get(s.id, alice)).ownerId, alice);
    assert.equal((await repo.list(10, 0, bob)).total, 0);
    await assert.rejects(() => repo.get(s.id, bob), NotFoundError);
    await assert.rejects(() => repo.findings(s.id, q(), bob), NotFoundError);
    await assert.rejects(() => repo.allFindings(s.id, bob), NotFoundError);
    await assert.rejects(() => repo.remove(s.id, bob), NotFoundError);
    assert.ok((await repo.list(50, 0)).items.some((i) => i.id === s.id), 'without owner (accounts disabled) everything is visible');
    await repo.remove(s.id, alice);
    await assert.rejects(() => repo.get(s.id), NotFoundError);
  });

  test(`[${label}] delete and unknown ids raise NotFoundError (404)`, async () => {
    const repo = await make();
    const s = await repo.save(saveBody());
    await repo.remove(s.id);
    await assert.rejects(() => repo.get(s.id), (e: any) => e instanceof NotFoundError && e.status === 404);
    await assert.rejects(() => repo.remove(s.id), NotFoundError);
    await assert.rejects(() => repo.findings('an_000000000000', q()), NotFoundError);
  });

  test(`[${label}] idsCreatedBefore`, async () => {
    const repo = await make();
    const s = await repo.save(saveBody());
    assert.ok((await repo.idsCreatedBefore(new Date(Date.now() + 60_000).toISOString())).includes(s.id));
    assert.ok(!(await repo.idsCreatedBefore('2000-01-01T00:00:00.000Z')).includes(s.id));
  });

  test(`[${label}] large analysis: 100 000 findings saved, filtered and read back in order`, async () => {
    const repo = await make();
    const findings = Array.from({ length: 100_000 }, (_, i) => finding({ recordIndex: i, score: i % 100, risk: i % 100 >= 75 ? 'critical' : 'low' }));
    const s = await repo.save(saveBody({ findings, rows: 1_000_000 }));
    assert.equal(s.findingsCount, 100_000);
    const crit = await repo.findings(s.id, q({ limit: '5', risk: 'critical' }));
    assert.equal(crit.total, 25_000);
    assert.deepEqual(crit.items.map((f) => f.score), [99, 99, 99, 99, 99]);
    const all = await repo.allFindings(s.id);
    assert.equal(all.length, 100_000);
    assert.equal(all[0].score, 99);
    await repo.remove(s.id);
  });
}
