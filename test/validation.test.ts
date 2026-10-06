import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError, validateCreateBaseline, validateSaveAnalysis, validateScoreBaseline, parseFindingsQuery } from '../src/domain';
import { finding, matrix, saveBody } from './helpers';

test('save: a valid body passes and unknown properties are dropped', () => {
  const out = validateSaveAnalysis({ ...saveBody(), hacker: 'x', findings: [{ ...finding(), extra: 1 }] });
  assert.equal((out as any).hacker, undefined);
  assert.equal((out.findings[0] as any).extra, undefined);
  assert.equal(out.findings.length, 1);
});

test('save: column-level findings (recordIndex null) are accepted', () => {
  const out = validateSaveAnalysis(saveBody({ findings: [finding({ recordIndex: null })] }));
  assert.equal(out.findings[0].recordIndex, null);
});

test('save: errors are listed in Spanish', () => {
  assert.throws(() => validateSaveAnalysis(null), ValidationError);
  try {
    validateSaveAnalysis({ ...saveBody(), format: 'xlsx', rows: -1, findings: [{ ...finding(), risk: 'extreme', score: 500 }] });
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    const text = e.details!.join(' | ');
    assert.match(text, /format/);
    assert.match(text, /rows/);
    assert.match(text, /risk/);
    assert.match(text, /score/);
    assert.equal(e.status, 400);
    assert.equal(e.code, 'VALIDATION_ERROR');
  }
});

test('save: more than 100000 findings is rejected', () => {
  const big = Array.from({ length: 100_001 }, () => finding());
  assert.throws(() => validateSaveAnalysis(saveBody({ findings: big })), /máximo 100000/);
});

test('save: wrong types are rejected', () => {
  assert.throws(() => validateSaveAnalysis({ ...saveBody(), fileName: 42 }), /fileName/);
  assert.throws(() => validateSaveAnalysis({ ...saveBody(), findings: 'no' }), /findings/);
  assert.throws(() => validateSaveAnalysis({ ...saveBody(), durationMs: NaN }), /durationMs/);
});

test('baseline: valid body, then every kind of invalid body', () => {
  const ok = validateCreateBaseline({ name: 'Facturas', columns: ['a', 'b'], matrix: matrix(25, 2) });
  assert.equal(ok.matrix.length, 25);
  assert.throws(() => validateCreateBaseline({ name: '', columns: ['a'], matrix: matrix(25, 1) }), /name/);
  assert.throws(() => validateCreateBaseline({ name: 'x', columns: ['a', 'a'], matrix: matrix(25, 2) }), /repetidos/);
  assert.throws(() => validateCreateBaseline({ name: 'x', columns: ['a', 'b'], matrix: matrix(25, 3) }), /fila 0/);
  assert.throws(() => validateCreateBaseline({ name: 'x', columns: ['a'], matrix: matrix(5, 1) }), /al menos 20 filas/);
  assert.throws(() => validateCreateBaseline({ name: 'x', columns: ['a'], matrix: [...matrix(24, 1), ['no']] }), /número o null/);
  assert.throws(() => validateCreateBaseline({ name: 'x', columns: ['a'], kinds: ['bad'], matrix: matrix(25, 1) }), /kinds/);
});

test('baseline: nulls are allowed in the matrix', () => {
  const m: Array<Array<number | null>> = matrix(25, 2);
  m[3][1] = null;
  assert.doesNotThrow(() => validateCreateBaseline({ name: 'x', columns: ['a', 'b'], matrix: m }));
});

test('score body: width must match the baseline', () => {
  assert.equal(validateScoreBaseline({ matrix: matrix(3, 2) }, 2).matrix.length, 3);
  assert.throws(() => validateScoreBaseline({ matrix: matrix(3, 3) }, 2), /fila 0/);
  assert.throws(() => validateScoreBaseline({ matrix: [] }, 2), /vacía/);
  assert.throws(() => validateScoreBaseline({ matrix: matrix(1, 2), explain: 'bad' }, 2), /explain/);
});

test('query string parsing: defaults, limits and errors', () => {
  const q = parseFindingsQuery({});
  assert.deepEqual([q.sort, q.limit, q.offset], ['score:desc', 100, 0]);
  assert.equal(parseFindingsQuery({ risk: 'high', type: 'out_of_range', limit: '10', offset: '5', q: 'abc' }).limit, 10);
  assert.throws(() => parseFindingsQuery({ risk: 'meh' }), /risk/);
  assert.throws(() => parseFindingsQuery({ limit: '0' }), /limit/);
  assert.throws(() => parseFindingsQuery({ sort: 'x' }), /sort/);
  assert.throws(() => parseFindingsQuery({ offset: 'a' }), /offset/);
});
