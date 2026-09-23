import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.mjs';
import { D1Mock } from './helpers/d1-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'migrations/0001_initial.sql'), 'utf8');

function makeEnv(db = new D1Mock()) {
  db.exec(SCHEMA);
  return {
    DB: db,
    ATTENDANCE_PASSWORD: 'test-pass-123',
    ATTENDANCE_SECRET: 'x'.repeat(64),
    ATTENDANCE_TIMEZONE: 'Asia/Bangkok',
    ATTENDANCE_SESSION_HOURS: '168',
  };
}

async function request(env, pathname, { method = 'GET', body, cookie } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  const req = new Request(`https://attendance.test${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  let data = {};
  try { data = await res.json(); } catch {}
  return { res, data };
}

async function login(env, password = 'test-pass-123') {
  const out = await request(env, '/api/login', { method: 'POST', body: { password } });
  const setCookie = out.res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  return { ...out, cookie, setCookie };
}

test('migration creates D1-compatible attendance schema with required columns', () => {
  const db = new D1Mock();
  db.exec(SCHEMA);
  const columns = db.db.prepare('PRAGMA table_info(attendance)').all();
  assert.deepEqual(columns.map((c) => c.name), ['date', 'clock_in', 'clock_out', 'updated_at']);
  assert.equal(columns.find((c) => c.name === 'date').pk, 1);
  assert.equal(columns.find((c) => c.name === 'updated_at').notnull, 1);
  db.close();
});

test('invalid login is rejected; valid login creates secure session; protected API requires auth', async () => {
  const env = makeEnv();
  const blocked = await request(env, '/api/today');
  assert.equal(blocked.res.status, 401);
  assert.equal(blocked.data.error, 'unauthorized');

  const bad = await login(env, 'wrong-password');
  assert.equal(bad.res.status, 401);
  assert.equal(bad.data.error, 'invalid_password');

  const good = await login(env);
  assert.equal(good.res.status, 200);
  assert.equal(good.data.ok, true);
  assert.match(good.setCookie, /HttpOnly/i);
  assert.match(good.setCookie, /Secure/i);
  assert.match(good.setCookie, /SameSite=Strict/i);

  const session = await request(env, '/api/session', { cookie: good.cookie });
  assert.equal(session.res.status, 200);
  assert.equal(session.data.authenticated, true);
  env.DB.close();
});

test('Clock In/Out persists in D1 and duplicate timestamps require explicit replace', async () => {
  const env = makeEnv();
  const { cookie } = await login(env);

  const clockIn = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'in' } });
  assert.equal(clockIn.res.status, 200);
  assert.match(clockIn.data.record.clock_in, /^\d{2}:\d{2}$/);

  const duplicateIn = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'in' } });
  assert.equal(duplicateIn.res.status, 409);
  assert.equal(duplicateIn.data.error, 'already_exists');

  const replaceIn = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'in', replace: true } });
  assert.equal(replaceIn.res.status, 200);

  const clockOut = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'out' } });
  assert.equal(clockOut.res.status, 200);
  assert.match(clockOut.data.record.clock_out, /^\d{2}:\d{2}$/);

  const duplicateOut = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'out' } });
  assert.equal(duplicateOut.res.status, 409);
  assert.equal(duplicateOut.data.error, 'already_exists');

  const today = await request(env, '/api/today', { cookie });
  assert.equal(today.res.status, 200);
  assert.equal(today.data.record.clock_in, clockOut.data.record.clock_in);
  assert.equal(today.data.record.clock_out, clockOut.data.record.clock_out);
  assert.equal(today.data.timezone, 'Asia/Bangkok');
  assert.match(today.data.server_now, /\+07:00$/);

  // A new request context using the same D1 instance sees the persisted row.
  const relogin = await login(env);
  const persisted = await request(env, '/api/today', { cookie: relogin.cookie });
  assert.equal(persisted.data.record.date, today.data.date);
  env.DB.close();
});

test('history, manual edit, date filtering and delete preserve frontend API contract', async () => {
  const env = makeEnv();
  const { cookie } = await login(env);
  const first = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'in' } });
  const originalDate = first.data.record.date;
  const newDate = originalDate === '2026-01-02' ? '2026-01-03' : '2026-01-02';

  const edited = await request(env, `/api/records/${originalDate}`, {
    method: 'PUT', cookie,
    body: { date: newDate, clock_in: '11:03', clock_out: '21:18' },
  });
  assert.equal(edited.res.status, 200);
  assert.deepEqual(
    { date: edited.data.record.date, clock_in: edited.data.record.clock_in, clock_out: edited.data.record.clock_out },
    { date: newDate, clock_in: '11:03', clock_out: '21:18' },
  );

  const included = await request(env, `/api/records?from=${newDate}&to=${newDate}`, { cookie });
  assert.equal(included.res.status, 200);
  assert.equal(included.data.records.length, 1);
  assert.equal(included.data.records[0].date, newDate);

  const excluded = await request(env, '/api/records?from=2025-01-01&to=2025-01-02', { cookie });
  assert.equal(excluded.res.status, 200);
  assert.deepEqual(excluded.data.records, []);

  const deleted = await request(env, `/api/records/${newDate}`, { method: 'DELETE', cookie });
  assert.equal(deleted.res.status, 200);
  assert.equal(deleted.data.ok, true);
  const after = await request(env, `/api/records?from=${newDate}&to=${newDate}`, { cookie });
  assert.deepEqual(after.data.records, []);
  env.DB.close();
});

test('invalid input returns controlled errors and does not crash Worker', async () => {
  const env = makeEnv();
  const { cookie } = await login(env);

  const badAction = await request(env, '/api/clock', { method: 'POST', cookie, body: { action: 'lunch' } });
  assert.equal(badAction.res.status, 400);
  assert.equal(badAction.data.error, 'invalid_action');

  const badRange = await request(env, '/api/records?from=bad&to=2026-09-23', { cookie });
  assert.equal(badRange.res.status, 400);
  assert.equal(badRange.data.error, 'invalid_date_range');

  const missing = await request(env, '/api/records/2026-09-23', {
    method: 'PUT', cookie, body: { date: 'bad-date', clock_in: '99:99', clock_out: null },
  });
  assert.equal(missing.res.status, 400);

  const stillAlive = await request(env, '/api/today', { cookie });
  assert.equal(stillAlive.res.status, 200);
  env.DB.close();
});

test('missing production secrets fails closed', async () => {
  const env = { DB: new D1Mock(), ATTENDANCE_PASSWORD: '', ATTENDANCE_SECRET: '' };
  env.DB.exec(SCHEMA);
  const res = await request(env, '/api/login', { method: 'POST', body: { password: 'anything' } });
  assert.equal(res.res.status, 503);
  assert.equal(res.data.error, 'server_not_configured');
  env.DB.close();
});
