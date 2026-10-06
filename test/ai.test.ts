import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { AiClient, AiUnavailableError, BaselineService, DomainError, EventBus, MemoryBlobStore, NotFoundError, ValidationError, loadConfig } from '../src/domain';
import { FakeAi, matrix } from './helpers';

function setup() {
  const ai = new FakeAi();
  const events: string[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => events.push(e));
  const store = new MemoryBlobStore();
  const client = new AiClient({ baseUrl: 'http://ai.test/', apiKey: 'secret', fetchImpl: ai.fetch });
  return { ai, events, store, svc: new BaselineService(store, client, bus), client, bus };
}
const body = (name = 'Facturas 2025') => ({ name, columns: ['quantity', 'unit_price'], kinds: ['numeric', 'numeric'], matrix: matrix(30, 2), schemaSignature: 'abc123' });

test('baseline: create trains in the AI service, stores metadata, publishes an event', async () => {
  const { ai, svc, events, store } = setup();
  const b = await svc.create(body());
  assert.match(b.id, /^bl_[0-9a-f]{12}$/);
  assert.equal(b.aiModelId, 'mdl_000000000001');
  assert.equal(b.rows, 30);
  assert.equal(b.threshold, 0.61);
  assert.equal(b.schemaSignature, 'abc123');
  assert.deepEqual(events, ['baseline.trained']);
  assert.equal(ai.calls[0].headers['X-API-Key'], 'secret');
  assert.equal(ai.calls[0].body.schema_signature, 'abc123');
  assert.equal(JSON.parse((await store.read('baselines.json'))!).length, 1);
  assert.deepEqual((await svc.list()).map((x) => x.name), ['Facturas 2025']);
});

test('baseline: score uses the stored columns and the AI model id', async () => {
  const { ai, svc } = setup();
  const b = await svc.create(body());
  const r = await svc.score(b.id, { matrix: matrix(3, 2), topK: 2 });
  assert.deepEqual(r.flags, [true, false, false]);
  const call = ai.calls.at(-1)!;
  assert.equal(call.path, `/v1/models/${b.aiModelId}/score`);
  assert.deepEqual(call.body.columns, ['quantity', 'unit_price']);
  assert.equal(call.body.top_k, 2);
  await assert.rejects(() => svc.score(b.id, { matrix: matrix(3, 5) }), ValidationError);
  await assert.rejects(() => svc.score('bl_nope', { matrix: matrix(1, 2) }), NotFoundError);
});

test('baseline: delete removes metadata and the AI model (best effort)', async () => {
  const { ai, svc, events } = setup();
  const b = await svc.create(body());
  await svc.remove(b.id);
  assert.equal(ai.models.size, 0);
  assert.deepEqual(await svc.list(), []);
  assert.deepEqual(events, ['baseline.trained', 'baseline.deleted']);
  ai.down = true;
  const b2 = await (async () => { ai.down = false; return svc.create(body('otra')); })();
  ai.down = true;
  await svc.remove(b2.id); // AI unreachable: metadata is still removed
  assert.deepEqual(await svc.list(), []);
});

test('AI down => 503 AI_UNAVAILABLE and nothing is stored', async () => {
  const { ai, svc, store } = setup();
  ai.down = true;
  await assert.rejects(() => svc.create(body()), (e: any) => e instanceof AiUnavailableError && e.status === 503 && e.code === 'AI_UNAVAILABLE' && /IA no está disponible/.test(e.message));
  assert.equal(await store.read('baselines.json'), null);
});

test('AI 5xx and AI auth errors => 503; AI 422 keeps its code and message', async () => {
  const { ai, svc } = setup();
  ai.failWith = { status: 500, body: { code: 'X', message: 'boom' } };
  await assert.rejects(() => svc.create(body()), AiUnavailableError);
  ai.failWith = { status: 401, body: { code: 'UNAUTHORIZED', message: 'no' } };
  await assert.rejects(() => svc.create(body()), AiUnavailableError);
  ai.failWith = { status: 422, body: { code: 'INVALID_TRAINING_DATA', message: 'Los datos de entrenamiento son constantes.' } };
  await assert.rejects(() => svc.create(body()), (e: any) => e instanceof DomainError && e.status === 422 && e.code === 'INVALID_TRAINING_DATA' && /constantes/.test(e.message));
  ai.failWith = { status: 422, body: { detail: [{ msg: 'campo inválido' }] } };
  await assert.rejects(() => svc.create(body()), /campo inválido/);
});

test('concurrent creates do not lose baselines (writes are serialised)', async () => {
  const { svc } = setup();
  await Promise.all(Array.from({ length: 8 }, (_, i) => svc.create(body(`b${i}`))));
  assert.equal((await svc.list()).length, 8);
});

test('invalid baseline bodies are rejected before calling the AI', async () => {
  const { ai, svc } = setup();
  await assert.rejects(() => svc.create({ name: 'x' }), ValidationError);
  assert.equal(ai.calls.length, 0);
});

// ---- real HTTP (global fetch) against a local server
async function withServer(handler: Parameters<typeof createServer>[1], fn: (url: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

test('AiClient over real HTTP: success, API key header, 5xx, timeout, connection refused', async () => {
  let seenKey: string | undefined;
  await withServer((req, res) => {
    seenKey = req.headers['x-api-key'] as string | undefined;
    if (req.url === '/health') { res.setHeader('content-type', 'application/json'); res.end('{"status":"ok"}'); }
    else if (req.url === '/slow') { /* never answers */ }
    else { res.statusCode = 502; res.end('bad gateway'); }
  }, async (url) => {
    const ok = new AiClient({ baseUrl: url, apiKey: 'k1' });
    assert.deepEqual(await ok.health(), { status: 'ok' });
    assert.equal(seenKey, 'k1');
    await assert.rejects(() => ok.deleteModel('x'), AiUnavailableError);
    const slow = new AiClient({ baseUrl: url, timeoutMs: 150, fetchImpl: ((u: string, i: any) => fetch(u.replace('/v1/models/slow', '/slow'), i)) as any });
    await assert.rejects(() => slow.deleteModel('slow'), /tiempo de espera/);
  });
  await assert.rejects(() => new AiClient({ baseUrl: 'http://127.0.0.1:1' }).health(), AiUnavailableError);
});

test('config: defaults and overrides', () => {
  const d = loadConfig({});
  assert.deepEqual([d.port, d.aiUrl, d.dataDir, d.corsOrigins, d.bodyLimitMb], [3001, 'http://localhost:8000', './data', ['http://localhost:3000'], 100]);
  const c = loadConfig({ PORT: '4000', API_KEY: 'k', CORS_ORIGINS: 'https://a.com, https://b.com', AI_URL: 'http://ai:8000', BODY_LIMIT_MB: 'x' });
  assert.deepEqual([c.port, c.apiKey, c.corsOrigins, c.aiUrl, c.bodyLimitMb], [4000, 'k', ['https://a.com', 'https://b.com'], 'http://ai:8000', 100]);
});
