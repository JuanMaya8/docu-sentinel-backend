/**
 * Real Nest app with accounts enabled (JWT_SECRET) and a fake AI. Uses PostgreSQL when TEST_DATABASE_URL is set,
 * JSON files otherwise — same assertions for both stores.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { buildApp } from '../../src/app.factory';
import { loadConfig } from '../../src/domain';
import { FakeAi, matrix, saveBody } from '../helpers';

const ai = new FakeAi();
const dir = mkdtempSync(join(tmpdir(), 'ds-auth-'));
const API = '/api/v1';
const store = process.env.TEST_DATABASE_URL ? 'postgres' : 'files';
let app: NestExpressApplication;
let base: string;

before(async () => {
  const config = loadConfig({
    DATA_DIR: dir, AI_URL: 'http://ai.test', CORS_ORIGINS: 'http://localhost:3000', THROTTLE_LIMIT: '1000',
    JWT_SECRET: 'e2e-secret', METRICS_TOKEN: 'm-token', DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
  app = await buildApp(config, { fetchImpl: ai.fetch, swagger: false, logRequests: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const unique = Date.now();
async function account(name: string): Promise<{ token: string; id: string; auth: Record<string, string> }> {
  const r = await request(base).post(`${API}/auth/register`).send({ email: `${name}.${unique}@test.co`, password: 'una-clave-larga', name }).expect(201);
  return { token: r.body.token, id: r.body.user.id, auth: { Authorization: `Bearer ${r.body.token}` } };
}

test(`[${store}] health is public and reports auth + store`, async () => {
  const h = await request(base).get(`${API}/health`).expect(200);
  assert.deepEqual([h.body.auth, h.body.store], [true, store]);
});

test(`[${store}] register, login, me; protected routes need a valid token`, async () => {
  const a = await account('ana');
  const login = await request(base).post(`${API}/auth/login`).send({ email: `ana.${unique}@test.co`, password: 'una-clave-larga' }).expect(200);
  assert.equal(login.body.user.id, a.id);
  const me = await request(base).get(`${API}/auth/me`).set(a.auth).expect(200);
  assert.equal(me.body.email, `ana.${unique}@test.co`);
  const bad = await request(base).post(`${API}/auth/login`).send({ email: `ana.${unique}@test.co`, password: 'equivocada' }).expect(401);
  assert.equal(bad.body.code, 'INVALID_CREDENTIALS');
  const none = await request(base).get(`${API}/analyses`).expect(401);
  assert.equal(none.body.code, 'AUTH_REQUIRED');
  const expired = await request(base).get(`${API}/analyses`).set('Authorization', 'Bearer a.b.c').expect(401);
  assert.match(expired.body.message, /sesión expiró/);
  await request(base).post(`${API}/auth/register`).send({ email: `ana.${unique}@test.co`, password: 'una-clave-larga' }).expect(409);
});

test(`[${store}] each user only sees their own analyses and baselines`, async () => {
  const ana = await account('ana2');
  const beto = await account('beto');
  const saved = await request(base).post(`${API}/analyses`).set(ana.auth).send(saveBody({ fileName: 'ana.csv' })).expect(201);
  const id = saved.body.id as string;
  assert.equal((await request(base).get(`${API}/analyses`).set(ana.auth).expect(200)).body.total, 1);
  assert.equal((await request(base).get(`${API}/analyses`).set(beto.auth).expect(200)).body.total, 0);
  await request(base).get(`${API}/analyses/${id}`).set(beto.auth).expect(404);
  await request(base).get(`${API}/analyses/${id}/export.csv`).set(beto.auth).expect(404);
  await request(base).delete(`${API}/analyses/${id}`).set(beto.auth).expect(404);
  const detail = await request(base).get(`${API}/analyses/${id}`).set(ana.auth).expect(200);
  assert.equal(detail.body.ownerId, undefined, 'owner id is not exposed');

  const json = await request(base).get(`${API}/analyses/${id}/export.json`).set(ana.auth).expect(200);
  assert.match(json.headers['content-disposition'], /ana\.csv\.anomalias\.json/);
  const parsed = JSON.parse(json.text);
  assert.equal(parsed.analysis.id, id);
  assert.equal(parsed.findings.length, 4);
  assert.equal(parsed.analysis.ownerId, undefined);

  const bl = await request(base).post(`${API}/baselines`).set(ana.auth).send({ name: 'Hist', columns: ['a', 'b'], matrix: matrix(30, 2) }).expect(201);
  assert.equal((await request(base).get(`${API}/baselines`).set(beto.auth).expect(200)).body.length, 0);
  await request(base).post(`${API}/baselines/${bl.body.id}/score`).set(beto.auth).send({ matrix: matrix(2, 2) }).expect(404);
  const re = await request(base).post(`${API}/baselines/${bl.body.id}/retrain`).set(ana.auth).send({ matrix: matrix(45, 2) }).expect(200);
  assert.deepEqual([re.body.version, re.body.rows], [2, 45]);
  await request(base).delete(`${API}/baselines/${bl.body.id}`).set(ana.auth).expect(204);
});

test(`[${store}] socket.io: token required, events only reach their owner`, async () => {
  const ana = await account('ana3');
  const beto = await account('beto3');
  const connect = (token?: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(`${base}/realtime`, { transports: ['websocket'], auth: token ? { token } : {}, reconnection: false });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  // anonymous client: the server sends auth.error and closes the connection
  const anon = io(`${base}/realtime`, { transports: ['websocket'], reconnection: false });
  const rejected = new Promise<string>((resolve) => {
    anon.on('auth.error', (e: { code: string }) => resolve(e.code));
    anon.on('disconnect', () => resolve('disconnected'));
  });
  const outcome = await Promise.race([rejected, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('anonymous socket not rejected')), 3000))]);
  assert.ok(['AUTH_REQUIRED', 'disconnected'].includes(outcome));
  anon.close();

  const sa = await connect(ana.token);
  const sb = await connect(beto.token);
  try {
    let betoGot = 0;
    sb.on('analysis.saved', () => betoGot++);
    const got = new Promise<{ id: string }>((resolve) => sa.on('analysis.saved', resolve));
    await new Promise((r) => setTimeout(r, 100)); // let the room join complete
    const saved = await request(base).post(`${API}/analyses`).set(ana.auth).send(saveBody()).expect(201);
    const payload = await Promise.race([got, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no event')), 4000))]);
    assert.equal(payload.id, saved.body.id);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(betoGot, 0);
  } finally {
    sa.close();
    sb.close();
  }
});

test(`[${store}] /metrics: outside the API prefix, token protected, counts requests by route`, async () => {
  await request(base).get('/metrics').expect(401);
  const m = await request(base).get('/metrics').set('Authorization', 'Bearer m-token').expect(200);
  assert.match(m.headers['content-type'], /text\/plain/);
  assert.match(m.text, /ds_http_requests_total\{method="GET",route="\/api\/v1\/health",status="200"\} \d+/);
  assert.match(m.text, /ds_domain_events_total\{event="analysis.saved"\} \d+/);
  await request(base).get(`${API}/metrics`).expect(404);
});

test(`[${store}] large responses are compressed`, async () => {
  const ana = await account('ana4');
  const findings = Array.from({ length: 2000 }, (_, i) => ({ ...saveBody().findings[0], recordIndex: i }));
  const saved = await request(base).post(`${API}/analyses`).set(ana.auth).send(saveBody({ findings })).expect(201);
  const r = await request(base).get(`${API}/analyses/${saved.body.id}/findings?limit=2000`).set(ana.auth).set('Accept-Encoding', 'gzip').expect(200);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(r.body.items.length, 2000);
});
