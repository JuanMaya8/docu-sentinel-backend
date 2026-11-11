import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AiClient, AuthService, BaselineService, BlobUserRepository, DomainError, EventBus, InvalidCredentialsError, MemoryBlobStore, Metrics,
  NotFoundError, ValidationError, attachWebhook, hashPassword, originAllowed, shouldNotify, signBody, signToken, verifyPassword, verifyToken,
} from '../src/domain';
import { FakeAi, matrix, saveBody } from './helpers';
import { runRepositoryContract } from './repository.contract';
import { BlobAnalysisRepository } from '../src/domain';

runRepositoryContract('memory', () => new BlobAnalysisRepository(new MemoryBlobStore()));

const auth = (allowRegistration = true) =>
  new AuthService(new BlobUserRepository(new MemoryBlobStore()), { secret: 'test-secret', ttlHours: 1, allowRegistration });

test('passwords: scrypt hash verifies, wrong password and malformed hashes do not', async () => {
  const h = await hashPassword('una-clave-larga');
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, await hashPassword('una-clave-larga'), 'random salt');
  assert.equal(await verifyPassword('una-clave-larga', h), true);
  assert.equal(await verifyPassword('otra-clave', h), false);
  assert.equal(await verifyPassword('x', 'md5$abc'), false);
});

test('JWT HS256: valid, tampered, wrong secret and expired tokens', () => {
  const now = Date.UTC(2026, 0, 1);
  const { token } = signToken({ sub: 'us_1', email: 'a@b.co' }, 's3cret', 60, now);
  assert.equal(verifyToken(token, 's3cret', now + 1000)?.sub, 'us_1');
  assert.equal(verifyToken(token, 'otro', now), null);
  assert.equal(verifyToken(token, 's3cret', now + 61_000), null, 'expired');
  const [h, b, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'us_admin', email: 'x', iat: 0, exp: 9e9 })).toString('base64url');
  assert.equal(verifyToken(`${h}.${forged}.${s}`, 's3cret', now), null);
  const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  assert.equal(verifyToken(`${none}.${b}.${s}`, 's3cret', now), null);
  assert.equal(verifyToken('basura', 's3cret', now), null);
});

test('AuthService: register, login, duplicate email, bad credentials, authenticate', async () => {
  const svc = auth();
  const s = await svc.register({ email: '  Ana@Empresa.CO ', password: 'una-clave-larga', name: 'Ana' });
  assert.equal(s.user.email, 'ana@empresa.co');
  assert.match(s.user.id, /^us_[0-9a-f]{12}$/);
  assert.equal((s.user as any).passwordHash, undefined, 'never exposes the hash');
  assert.ok(new Date(s.expiresAt).getTime() > Date.now());
  await assert.rejects(() => svc.register({ email: 'ana@empresa.co', password: 'otra-clave-larga' }), (e: any) => e instanceof DomainError && e.code === 'EMAIL_TAKEN' && e.status === 409);
  const l = await svc.login({ email: 'ANA@empresa.co', password: 'una-clave-larga' });
  assert.equal((await svc.authenticate(l.token))?.id, s.user.id);
  await assert.rejects(() => svc.login({ email: 'ana@empresa.co', password: 'mala-clave' }), InvalidCredentialsError);
  await assert.rejects(() => svc.login({ email: 'nadie@empresa.co', password: 'una-clave-larga' }), InvalidCredentialsError);
  assert.equal(await svc.authenticate(undefined), null);
  assert.equal(await svc.authenticate('x.y.z'), null);
});

test('AuthService: validation messages and registration switch', async () => {
  await assert.rejects(() => auth().register({ email: 'no-es-correo', password: 'corta' }), (e: any) => e instanceof ValidationError && /correo válido/.test(e.message) && /8 y 200/.test(e.message));
  await assert.rejects(() => auth(false).register({ email: 'a@b.co', password: 'una-clave-larga' }), (e: any) => e.code === 'REGISTRATION_DISABLED' && e.status === 403);
});

test('baselines: ownership isolates users; retrain bumps the version and replaces the model', async () => {
  const ai = new FakeAi();
  const events: Array<[string, string | undefined]> = [];
  const bus = new EventBus();
  bus.subscribe((e, _p, owner) => events.push([e, owner]));
  const svc = new BaselineService(new MemoryBlobStore(), new AiClient({ baseUrl: 'http://ai.test', fetchImpl: ai.fetch }), bus);
  const b = await svc.create({ name: 'Hist', columns: ['a', 'b'], matrix: matrix(30, 2), thresholdFloor: 0.6 }, 'us_alice');
  assert.equal(b.version, 1);
  assert.equal(b.ownerId, 'us_alice');
  assert.deepEqual(events.at(-1), ['baseline.trained', 'us_alice']);
  assert.deepEqual(await svc.list('us_bob'), []);
  await assert.rejects(() => svc.get(b.id, 'us_bob'), NotFoundError);
  await assert.rejects(() => svc.score(b.id, { matrix: matrix(2, 2) }, 'us_bob'), NotFoundError);
  await assert.rejects(() => svc.retrain(b.id, { matrix: matrix(40, 2) }, 'us_bob'), NotFoundError);

  const oldModel = b.aiModelId;
  const r = await svc.retrain(b.id, { matrix: matrix(40, 2) }, 'us_alice');
  assert.deepEqual([r.id, r.name, r.version, r.rows], [b.id, 'Hist', 2, 40]);
  assert.notEqual(r.aiModelId, oldModel);
  assert.equal(ai.models.has(oldModel), false, 'previous model deleted');
  assert.equal(ai.calls.at(-2)!.body.threshold_floor, 0.6, 'keeps the floor when none is sent');
  assert.equal((await svc.list('us_alice')).length, 1);
  await assert.rejects(() => svc.retrain(b.id, { matrix: matrix(40, 3), columns: ['a', 'b', 'c'] }, 'us_alice'), (e: any) => e.code === 'SCHEMA_MISMATCH');
  await assert.rejects(() => svc.retrain(b.id, { matrix: matrix(5, 2) }, 'us_alice'), ValidationError);
});

test('metrics: Prometheus text with counters, histogram buckets and gauges', () => {
  const m = new Metrics();
  m.observeRequest('GET', '/api/v1/analyses', 200, 0.03);
  m.observeRequest('GET', '/api/v1/analyses', 200, 2);
  m.inc('ds_domain_events_total', 'Domain events.', { event: 'analysis.saved' });
  const out = m.render({ ds_test_gauge: { help: 'g', value: 7 } });
  assert.match(out, /ds_http_requests_total\{method="GET",route="\/api\/v1\/analyses",status="200"\} 2/);
  assert.match(out, /ds_http_request_duration_seconds_bucket\{le="0.05",method="GET",route="\/api\/v1\/analyses"\} 1/);
  assert.match(out, /ds_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/analyses"\} 2/);
  assert.match(out, /ds_domain_events_total\{event="analysis.saved"\} 1/);
  assert.match(out, /# TYPE ds_test_gauge gauge\nds_test_gauge 7/);
  assert.match(out, /ds_process_uptime_seconds \d/);
});

test('webhook: only risky analyses, signed body, failures reported but never thrown', async () => {
  const summary = { ...saveBody(), id: 'an_000000000001', createdAt: '2026-01-01T00:00:00Z', columnCount: 2, findingsCount: 4, recordsAffected: 2, byRisk: { low: 1, medium: 1, high: 1, critical: 1 }, byType: {} } as any;
  assert.equal(shouldNotify(summary, 'critical'), true);
  assert.equal(shouldNotify({ ...summary, byRisk: { low: 3, medium: 0, high: 0, critical: 0 } }, 'high'), false);
  const sent: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
  const errors: string[] = [];
  const bus = new EventBus();
  let fail = false;
  attachWebhook(bus, {
    url: 'https://hooks.test/x', secret: 'k', minRisk: 'high', onError: (m) => errors.push(m),
    fetchImpl: async (url, init) => {
      sent.push({ url, headers: init.headers, body: init.body });
      if (fail) throw new Error('caído');
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    },
  });
  bus.publish('analysis.saved', summary);
  bus.publish('analysis.saved', { ...summary, byRisk: { low: 1, medium: 0, high: 0, critical: 0 } });
  bus.publish('analysis.deleted', { id: 'x' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers['X-DocuSentinel-Signature'], signBody(sent[0].body!, 'k'));
  assert.equal(JSON.parse(sent[0].body!).analysis.id, 'an_000000000001');
  fail = true;
  bus.publish('analysis.saved', summary);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(errors[0], /caído/);
});

test('CORS origins: exact, wildcard subdomain and any', () => {
  const rules = ['http://localhost:3000', 'https://*.vercel.app'];
  assert.equal(originAllowed('http://localhost:3000', rules), true);
  assert.equal(originAllowed('https://docu-sentinel-git-main-juan.vercel.app', rules), true);
  assert.equal(originAllowed('https://vercel.app.evil.com', rules), false);
  assert.equal(originAllowed('https://a.b.vercel.app', rules), false, 'one label only');
  assert.equal(originAllowed('http://evil.com', rules), false);
  assert.equal(originAllowed(undefined, rules), true);
  assert.equal(originAllowed('http://x', ['*']), true);
});
