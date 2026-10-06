/**
 * HTTP + WebSocket tests against the real Nest app, with a fake AI service injected.
 * STATUS: written but NOT executed in the environment where this repo was created (npm registry blocked, Nest not installable).
 * Run with: npm run test:http   — if something fails here, fix it first (see AI_CONTEXT.md).
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
const dir = mkdtempSync(join(tmpdir(), 'ds-e2e-'));
let app: NestExpressApplication;
let base: string;
const API = '/api/v1';

before(async () => {
  const config = { ...loadConfig({ DATA_DIR: dir, AI_URL: 'http://ai.test', CORS_ORIGINS: 'http://localhost:3000', API_KEY: 'k-test', THROTTLE_LIMIT: '1000' }) };
  app = await buildApp(config, { fetchImpl: ai.fetch, swagger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const KEY = { 'X-API-Key': 'k-test' };

test('health reports ai up / down', async () => {
  const up = await request(base).get(`${API}/health`).expect(200);
  assert.deepEqual([up.body.status, up.body.ai], ['ok', 'up']);
  ai.down = true;
  assert.equal((await request(base).get(`${API}/health`).expect(200)).body.ai, 'down');
  ai.down = false;
});

test('writes need the API key; reads do not', async () => {
  await request(base).post(`${API}/analyses`).send(saveBody()).expect(401);
  const bad = await request(base).post(`${API}/analyses`).set('X-API-Key', 'nope').send(saveBody()).expect(401);
  assert.equal(bad.body.code, 'UNAUTHORIZED');
  await request(base).get(`${API}/analyses`).expect(200);
});

test('analyses: save, list, detail, findings, csv, delete — and the error shape', async () => {
  const saved = await request(base).post(`${API}/analyses`).set(KEY).send(saveBody()).expect(201);
  const id = saved.body.id as string;
  assert.equal(saved.body.findingsCount, 4);

  const list = await request(base).get(`${API}/analyses?limit=5`).expect(200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, id);

  const detail = await request(base).get(`${API}/analyses/${id}`).expect(200);
  assert.equal(detail.body.columns.length, 2);

  const f = await request(base).get(`${API}/analyses/${id}/findings?risk=critical`).expect(200);
  assert.equal(f.body.total, 1);

  const csv = await request(base).get(`${API}/analyses/${id}/export.csv`).expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /attachment; filename=/);
  assert.ok(csv.text.startsWith('﻿Registro,Tipo de anomalía'));

  const invalid = await request(base).post(`${API}/analyses`).set(KEY).send({ fileName: 'x' }).expect(400);
  assert.equal(invalid.body.code, 'VALIDATION_ERROR');
  assert.equal(typeof invalid.body.message, 'string');
  await request(base).get(`${API}/analyses/${id}/findings?limit=0`).expect(400);

  await request(base).delete(`${API}/analyses/${id}`).set(KEY).expect(204);
  const missing = await request(base).get(`${API}/analyses/${id}`).expect(404);
  assert.deepEqual([missing.body.statusCode, missing.body.code], [404, 'NOT_FOUND']);
  await request(base).get(`${API}/nope`).expect(404);
});

test('baselines: train, list, score, delete; AI down => 503 AI_UNAVAILABLE', async () => {
  const created = await request(base).post(`${API}/baselines`).set(KEY).send({ name: 'Hist', columns: ['a', 'b'], matrix: matrix(30, 2) }).expect(201);
  const id = created.body.id as string;
  assert.equal(created.body.rows, 30);
  const list = await request(base).get(`${API}/baselines`).expect(200);
  assert.equal(list.body.length, 1);
  const scored = await request(base).post(`${API}/baselines/${id}/score`).set(KEY).send({ matrix: matrix(2, 2) }).expect(200);
  assert.deepEqual(scored.body.flags, [true, false]);

  ai.down = true;
  const unavailable = await request(base).post(`${API}/baselines`).set(KEY).send({ name: 'X', columns: ['a'], matrix: matrix(30, 1) }).expect(503);
  assert.equal(unavailable.body.code, 'AI_UNAVAILABLE');
  ai.down = false;

  await request(base).delete(`${API}/baselines/${id}`).set(KEY).expect(204);
  await request(base).get(`${API}/baselines/${id}`).expect(404);
});

test('socket.io /realtime pushes analysis.saved', async () => {
  const socket: Socket = io(`${base}/realtime`, { transports: ['websocket'] });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });
    const got = new Promise<{ id: string }>((resolve) => socket.on('analysis.saved', resolve));
    const saved = await request(base).post(`${API}/analyses`).set(KEY).send(saveBody()).expect(201);
    const payload = await Promise.race([got, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no event received')), 4000))]);
    assert.equal(payload.id, saved.body.id);
  } finally {
    socket.close();
  }
});
