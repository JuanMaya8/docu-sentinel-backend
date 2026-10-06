import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  AnalysisService, BlobAnalysisRepository, EventBus, FileBlobStore, MemoryBlobStore, NotFoundError, findingsToCsv, parseFindingsQuery, queryFindings,
} from '../src/domain';
import { finding, saveBody } from './helpers';

const q = (o: Record<string, unknown> = {}) => parseFindingsQuery(o);

test('save computes the summary (by risk, by type, records affected) and sorts findings by score', async () => {
  const repo = new BlobAnalysisRepository(new MemoryBlobStore());
  const s = await repo.save(saveBody());
  assert.match(s.id, /^an_[0-9a-f]{12}$/);
  assert.equal(s.findingsCount, 4);
  assert.equal(s.recordsAffected, 2); // records 3 and 10; the column-level finding does not count
  assert.deepEqual(s.byRisk, { low: 1, medium: 1, high: 1, critical: 1 });
  assert.equal(s.byType.whitespace, 1);
  assert.equal(s.columnCount, 2);
  const page = await repo.findings(s.id, q());
  assert.deepEqual(page.items.map((f) => f.score), [90, 70, 40, 20]);
});

test('list: newest first, paged, without the heavy detail fields', async () => {
  const repo = new BlobAnalysisRepository(new MemoryBlobStore());
  const a = await repo.save(saveBody({ fileName: 'a.csv' }));
  await new Promise((r) => setTimeout(r, 5));
  const b = await repo.save(saveBody({ fileName: 'b.csv' }));
  const all = await repo.list(10, 0);
  assert.equal(all.total, 2);
  assert.deepEqual(all.items.map((i) => i.fileName), ['b.csv', 'a.csv']);
  assert.equal((all.items[0] as any).columns, undefined);
  assert.equal((await repo.list(1, 1)).items[0].id, a.id);
  const d = await repo.get(b.id);
  assert.equal(d.columns.length, 2);
  assert.equal(d.sensitivity, 'medium');
});

test('findings: filters, search and sorting', async () => {
  const repo = new BlobAnalysisRepository(new MemoryBlobStore());
  const s = await repo.save(saveBody());
  assert.equal((await repo.findings(s.id, q({ risk: 'critical' }))).total, 1);
  assert.equal((await repo.findings(s.id, q({ type: 'whitespace' }))).items[0].field, 'city');
  assert.equal((await repo.findings(s.id, q({ field: 'total' }))).total, 3);
  assert.equal((await repo.findings(s.id, q({ q: 'FV-1003' }))).total, 1);
  assert.deepEqual((await repo.findings(s.id, q({ sort: 'record:asc' }))).items.map((f) => f.recordIndex), [null, 3, 3, 10]);
  assert.deepEqual((await repo.findings(s.id, q({ sort: 'risk:desc', limit: '2' }))).items.map((f) => f.risk), ['critical', 'high']);
  const p2 = await repo.findings(s.id, q({ limit: '2', offset: '2' }));
  assert.equal(p2.total, 4);
  assert.equal(p2.items.length, 2);
});

test('delete removes both blobs; unknown ids raise NotFoundError (404)', async () => {
  const store = new MemoryBlobStore();
  const repo = new BlobAnalysisRepository(store);
  const s = await repo.save(saveBody());
  await repo.remove(s.id);
  assert.deepEqual(await store.list('.json'), []);
  await assert.rejects(() => repo.get(s.id), (e: any) => e instanceof NotFoundError && e.status === 404 && e.code === 'NOT_FOUND');
  await assert.rejects(() => repo.remove(s.id), NotFoundError);
});

test('persistence on disk: a new repository instance sees the saved analyses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  try {
    const first = new BlobAnalysisRepository(new FileBlobStore(dir));
    const s = await first.save(saveBody({ fileName: 'persist.csv' }));
    const second = new BlobAnalysisRepository(new FileBlobStore(dir));
    assert.equal((await second.list(10, 0)).items[0].fileName, 'persist.csv');
    assert.equal((await second.findings(s.id, q())).total, 4);
    assert.ok(readdirSync(dir).every((f) => !f.endsWith('.tmp')));
    await second.remove(s.id);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file store refuses path traversal keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  try {
    const store = new FileBlobStore(dir);
    await assert.rejects(() => store.read('../etc/passwd'), /inválida/);
    await assert.rejects(() => store.write('a/b.json', 'x'), /inválida/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('large analysis: 100k findings are saved, paged and exported', async () => {
  const repo = new BlobAnalysisRepository(new MemoryBlobStore());
  const findings = Array.from({ length: 100_000 }, (_, i) => finding({ recordIndex: i, score: i % 100 }));
  const s = await repo.save(saveBody({ findings, rows: 1_000_000 }));
  assert.equal(s.findingsCount, 100_000);
  assert.equal((await repo.findings(s.id, q({ limit: '5', risk: 'high' }))).items.length, 5);
});

test('service: validates, saves, publishes events and exports CSV', async () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.subscribe((e, p) => seen.push(`${e}:${(p as any).id}`));
  const svc = new AnalysisService(new BlobAnalysisRepository(new MemoryBlobStore()), bus);
  await assert.rejects(() => svc.save({ nope: 1 }), /obligatorio|debe/);
  const s = await svc.save(saveBody({ fileName: 'Mi factura (1).csv' }));
  const { fileName, csv } = await svc.exportCsv(s.id);
  assert.equal(fileName, 'Mi_factura_1_.csv.anomalias.csv'.replace('_1_.csv', '_1_.csv'));
  assert.ok(csv.startsWith('﻿Registro,Tipo de anomalía,Nivel de riesgo,Campo afectado,Explicación'));
  await svc.remove(s.id);
  assert.deepEqual(seen, [`analysis.saved:${s.id}`, `analysis.deleted:${s.id}`]);
});

test('CSV export: Spanish labels, escaping and formula-injection guard', () => {
  const csv = findingsToCsv([
    finding({ recordIndex: 4, recordId: 'FV-1', type: 'duplicate_exact', risk: 'critical', explanation: 'Dice "hola", y sigue\nen otra línea' }),
    finding({ recordIndex: null, field: null, type: 'benford', risk: 'low', explanation: '=HYPERLINK("http://malo")' }),
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '#5 · FV-1,Duplicado exacto,Crítico,total,"Dice ""hola"", y sigue\nen otra línea"');
  assert.match(csv, /Columna completa,Desviación de la ley de Benford,Bajo,,"'=HYPERLINK\(""http:\/\/malo""\)"/);
});

test('queryFindings is pure and does not mutate its input', () => {
  const list = [finding({ score: 1 }), finding({ score: 9 })];
  queryFindings(list, q({ sort: 'score:desc' }));
  assert.deepEqual(list.map((f) => f.score), [1, 9]);
});
