/**
 * PostgreSQL implementations. Skipped unless TEST_DATABASE_URL points to a disposable database, e.g.
 *   docker run -d --name ds-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=docu -p 55439:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55439/docu npm run test:pg
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { BaselineService, BlobUserRepository, AuthService, EventBus, AiClient, PgAnalysisRepository, PgBlobStore, ensureSchema } from '../src/domain';
import { FakeAi, matrix } from './helpers';
import { runRepositoryContract } from './repository.contract';

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  test('PostgreSQL tests (set TEST_DATABASE_URL to run them)', { skip: 'TEST_DATABASE_URL not set' }, () => undefined);
} else {
  const pool = new Pool({ connectionString: url, max: 5 });
  after(async () => {
    await pool.end();
  });

  test('schema is created and is idempotent', async () => {
    await pool.query('DROP TABLE IF EXISTS ds_findings, ds_analyses, ds_kv CASCADE');
    await ensureSchema(pool);
    await ensureSchema(pool);
    // the AI service may share the same database (Render Blueprint), so only the backend's tables are checked
    const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('ds_analyses', 'ds_findings', 'ds_kv') ORDER BY 1");
    assert.deepEqual(t.rows.map((r) => r.table_name), ['ds_analyses', 'ds_findings', 'ds_kv']);
  });

  runRepositoryContract('postgres', () => new PgAnalysisRepository(pool));

  test('[postgres] deleting an analysis cascades to its findings', async () => {
    const repo = new PgAnalysisRepository(pool);
    const { saveBody } = await import('./helpers');
    const s = await repo.save(saveBody());
    await repo.remove(s.id);
    const n = await pool.query('SELECT count(*) AS n FROM ds_findings WHERE analysis_id = $1', [s.id]);
    assert.equal(Number(n.rows[0].n), 0);
  });

  test('[postgres] PgBlobStore: read/write/list/remove with namespaced keys', async () => {
    const a = new PgBlobStore(pool, `t${Date.now()}a`);
    const b = new PgBlobStore(pool, `t${Date.now()}b`);
    assert.equal(await a.read('x.json'), null);
    await a.write('x.json', '1');
    await a.write('x.json', '2');
    await a.write('y_%.json', '3');
    assert.equal(await a.read('x.json'), '2');
    assert.deepEqual((await a.list('.json')).sort(), ['x.json', 'y_%.json']);
    assert.deepEqual(await b.list('.json'), []);
    await a.remove('x.json');
    assert.equal(await a.read('x.json'), null);
  });

  test('[postgres] baselines and users persist across service instances', async () => {
    const ai = new FakeAi();
    const client = new AiClient({ baseUrl: 'http://ai.test', fetchImpl: ai.fetch });
    const ns = `bl${Date.now()}`;
    const s1 = new BaselineService(new PgBlobStore(pool, ns), client, new EventBus());
    const created = await s1.create({ name: 'Histórico', columns: ['a', 'b'], matrix: matrix(30, 2) }, 'us_x');
    const s2 = new BaselineService(new PgBlobStore(pool, ns), client, new EventBus());
    assert.equal((await s2.get(created.id, 'us_x')).name, 'Histórico');

    const users = `us${Date.now()}`;
    const auth1 = new AuthService(new BlobUserRepository(new PgBlobStore(pool, users)), { secret: 's', ttlHours: 1, allowRegistration: true });
    await auth1.register({ email: 'pg@test.co', password: 'una-clave-larga' });
    const auth2 = new AuthService(new BlobUserRepository(new PgBlobStore(pool, users)), { secret: 's', ttlHours: 1, allowRegistration: true });
    const session = await auth2.login({ email: 'pg@test.co', password: 'una-clave-larga' });
    assert.equal(session.user.email, 'pg@test.co');
  });
}
