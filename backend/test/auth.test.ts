import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPrincipal, parseGroups } from '../src/lib/auth';
import { Router } from '../src/lib/router';
import { handler } from '../src/functions/api';

const event = (claims?: Record<string, unknown>, method = 'GET', rawPath = '/graduation/me'): any => ({
  rawPath,
  headers: {},
  requestContext: { http: { method }, requestId: 'test', authorizer: claims ? { jwt: { claims, scopes: [] } } : undefined },
});

test('groups arrive in every format API Gateway uses', () => {
  assert.deepEqual(parseGroups(['student', 'staff']), ['student', 'staff']);
  assert.deepEqual(parseGroups('[student staff]'), ['student', 'staff']);
  assert.deepEqual(parseGroups('["student","staff"]'), ['student', 'staff']);
  assert.deepEqual(parseGroups('instructor'), ['instructor']);
  assert.deepEqual(parseGroups(undefined), []);
});

test('only exact group names become roles (no substring matching)', () => {
  const p = getPrincipal(event({ sub: 'u1', token_use: 'id', email: 'A@X.TH', 'cognito:groups': '[student-coordinator staff]' }));
  assert.deepEqual([...(p?.roles ?? [])], ['staff']);
  assert.equal(p?.email, 'a@x.th');
});

test('access tokens and unverified emails do not identify a user', () => {
  assert.equal(getPrincipal(event({ sub: 'u1', token_use: 'access', 'cognito:groups': ['student'] })), null);
  const p = getPrincipal(event({ sub: 'u1', email: 'a@x.th', email_verified: 'false', 'cognito:groups': ['student'] }));
  assert.equal(p?.email, null);
});

test('router extracts params and tells wrong method from unknown path', () => {
  const r = new Router().add({ method: 'GET', path: '/graduation/students/{code}', auth: true, handler: async () => ({ statusCode: 200 }) });
  const m = r.match('GET', '/graduation/students/6609650011');
  assert.ok(m && m !== 'method');
  assert.equal(m.params.code, '6609650011');
  assert.equal(r.match('POST', '/graduation/students/1'), 'method');
  assert.equal(r.match('GET', '/nope'), null);
});

test('secure routes answer 401 without claims and 403 for the wrong role (no database needed)', async () => {
  const anon = await handler(event(), {} as any, () => undefined) as any;
  assert.equal(anon.statusCode, 401);
  const wrongRole = await handler(event({ sub: 'u1', token_use: 'id', email: 'i@x.th', 'cognito:groups': ['instructor'] }), {} as any, () => undefined) as any;
  assert.equal(wrongRole.statusCode, 403);
  const importAsStudent = await handler(
    { ...event({ sub: 'u2', token_use: 'id', email: 's@x.th', 'cognito:groups': ['student'] }, 'POST', '/registrar/imports'), body: '{}' },
    {} as any, () => undefined) as any;
  assert.equal(importAsStudent.statusCode, 403);
  const editAsStaff = await handler(
    { ...event({ sub: 'u3', token_use: 'id', email: 't@x.th', 'cognito:groups': ['staff'] }, 'PUT', '/curriculum/applied-cs/entries'), body: '{}' },
    {} as any, () => undefined) as any;
  assert.equal(editAsStaff.statusCode, 403);
});
