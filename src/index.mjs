const COOKIE_NAME = 'attendance_session';
const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_SESSION_HOURS = 168;
const encoder = new TextEncoder();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
};

function json(status, payload, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  return new Response(JSON.stringify(payload), { status, headers });
}

function configured(env) {
  return Boolean(env?.ATTENDANCE_PASSWORD && env?.ATTENDANCE_SECRET && String(env.ATTENDANCE_SECRET).length >= 32 && env?.DB);
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_JSON_BYTES) return null;
  try {
    const text = await request.text();
    if (encoder.encode(text).length > MAX_JSON_BYTES) return null;
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeTime(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return value;
}

function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function constantTimeBytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function passwordMatches(supplied, expected) {
  const [a, b] = await Promise.all([sha256(String(supplied)), sha256(String(expected))]);
  return constantTimeBytesEqual(a, b);
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

async function makeSession(env, nowMs = Date.now()) {
  const hours = Math.max(1, Number(env.ATTENDANCE_SESSION_HOURS || DEFAULT_SESSION_HOURS) || DEFAULT_SESSION_HOURS);
  const expiry = Math.floor(nowMs / 1000) + Math.floor(hours * 3600);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const payload = `${expiry}.${b64url(nonceBytes)}`;
  return `${payload}.${await hmac(String(env.ATTENDANCE_SECRET), payload)}`;
}

async function validSession(request, env, nowMs = Date.now()) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiryText, nonce, signature] = parts;
  if (!/^\d+$/.test(expiryText) || !nonce || !signature) return false;
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry < Math.floor(nowMs / 1000)) return false;
  const expected = await hmac(String(env.ATTENDANCE_SECRET), `${expiryText}.${nonce}`);
  const a = encoder.encode(signature);
  const b = encoder.encode(expected);
  return constantTimeBytesEqual(a, b);
}

function localParts(now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const pseudoLocalMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((pseudoLocalMs - now.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { date, time, iso: `${date}T${time}:${parts.second}${offset}` };
}

function nowLocal(env, now = new Date()) {
  const timeZone = String(env.ATTENDANCE_TIMEZONE || DEFAULT_TIMEZONE);
  try {
    return { ...localParts(now, timeZone), timeZone };
  } catch {
    return { ...localParts(now, DEFAULT_TIMEZONE), timeZone: DEFAULT_TIMEZONE };
  }
}

function row(record) {
  if (!record) return null;
  return {
    date: record.date,
    clock_in: record.clock_in ?? null,
    clock_out: record.clock_out ?? null,
    updated_at: record.updated_at,
  };
}

async function getRecord(env, date) {
  return row(await env.DB.prepare('SELECT date, clock_in, clock_out, updated_at FROM attendance WHERE date = ?').bind(date).first());
}

async function requireAuth(request, env) {
  if (!configured(env)) return json(503, { error: 'server_not_configured' });
  if (!(await validSession(request, env))) return json(401, { error: 'unauthorized' });
  return null;
}

async function login(request, env) {
  if (!configured(env)) return json(503, { error: 'server_not_configured' });
  const data = await readJson(request);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { error: 'invalid_json' });
  if (!(await passwordMatches(data.password ?? '', env.ATTENDANCE_PASSWORD))) return json(401, { error: 'invalid_password' });
  const token = await makeSession(env);
  const hours = Math.max(1, Number(env.ATTENDANCE_SESSION_HOURS || DEFAULT_SESSION_HOURS) || DEFAULT_SESSION_HOURS);
  const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(hours * 3600)}`;
  return json(200, { ok: true }, { 'Set-Cookie': cookie });
}

function logout() {
  return json(200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}

async function today(env) {
  const now = nowLocal(env);
  return json(200, {
    record: await getRecord(env, now.date),
    date: now.date,
    server_now: now.iso,
    timezone: now.timeZone,
  });
}

async function listRecords(request, env) {
  const url = new URL(request.url);
  const current = nowLocal(env).date;
  const currentDate = new Date(`${current}T00:00:00Z`);
  const defaultFromDate = new Date(currentDate.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const from = url.searchParams.get('from') || defaultFromDate;
  const to = url.searchParams.get('to') || current;
  if (!validDate(from) || !validDate(to) || from > to) return json(400, { error: 'invalid_date_range' });
  const result = await env.DB.prepare(
    'SELECT date, clock_in, clock_out, updated_at FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC',
  ).bind(from, to).all();
  return json(200, { records: (result.results || []).map(row) });
}

async function clock(request, env) {
  const data = await readJson(request);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { error: 'invalid_json' });
  const field = data.action === 'in' ? 'clock_in' : data.action === 'out' ? 'clock_out' : null;
  if (!field) return json(400, { error: 'invalid_action' });
  const replace = data.replace === true;
  const now = nowLocal(env);
  const existing = await getRecord(env, now.date);
  if (existing?.[field] && !replace) return json(409, { error: 'already_exists', field, record: existing });

  if (existing) {
    const sql = field === 'clock_in'
      ? 'UPDATE attendance SET clock_in = ?, updated_at = ? WHERE date = ?'
      : 'UPDATE attendance SET clock_out = ?, updated_at = ? WHERE date = ?';
    await env.DB.prepare(sql).bind(now.time, now.iso, now.date).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO attendance(date, clock_in, clock_out, updated_at) VALUES (?, ?, ?, ?)',
    ).bind(now.date, field === 'clock_in' ? now.time : null, field === 'clock_out' ? now.time : null, now.iso).run();
  }
  return json(200, { ok: true, record: await getRecord(env, now.date) });
}

async function editRecord(request, env, originalDate) {
  if (!validDate(originalDate)) return json(400, { error: 'invalid_original_date' });
  const data = await readJson(request);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { error: 'invalid_json' });
  const newDate = data.date;
  const clockIn = normalizeTime(data.clock_in);
  const clockOut = normalizeTime(data.clock_out);
  if (!validDate(newDate) || clockIn === false || clockOut === false) return json(400, { error: 'invalid_record' });
  if (clockIn == null && clockOut == null) return json(400, { error: 'empty_record' });

  const existing = await getRecord(env, originalDate);
  if (!existing) return json(404, { error: 'not_found' });
  if (newDate !== originalDate && await getRecord(env, newDate)) return json(409, { error: 'date_conflict' });

  const updatedAt = nowLocal(env).iso;
  await env.DB.prepare(
    'UPDATE attendance SET date = ?, clock_in = ?, clock_out = ?, updated_at = ? WHERE date = ?',
  ).bind(newDate, clockIn, clockOut, updatedAt, originalDate).run();
  return json(200, { ok: true, record: await getRecord(env, newDate) });
}

async function deleteRecord(env, date) {
  if (!validDate(date)) return json(400, { error: 'invalid_date' });
  const existing = await getRecord(env, date);
  if (!existing) return json(404, { error: 'not_found' });
  await env.DB.prepare('DELETE FROM attendance WHERE date = ?').bind(date).run();
  return json(200, { ok: true });
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/api/session') {
    const authenticated = configured(env) ? await validSession(request, env) : false;
    return json(200, { authenticated });
  }
  if (method === 'POST' && path === '/api/login') return login(request, env);
  if (method === 'POST' && path === '/api/logout') return logout();

  const authError = await requireAuth(request, env);
  if (authError) return authError;

  if (method === 'GET' && path === '/api/today') return today(env);
  if (method === 'GET' && path === '/api/records') return listRecords(request, env);
  if (method === 'POST' && path === '/api/clock') return clock(request, env);

  if (path.startsWith('/api/records/')) {
    let date;
    try { date = decodeURIComponent(path.slice('/api/records/'.length)); }
    catch { return json(400, { error: 'invalid_date' }); }
    if (method === 'PUT') return editRecord(request, env, date);
    if (method === 'DELETE') return deleteRecord(env, date);
  }
  return json(404, { error: 'not_found' });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return api(request, env);
  if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Unhandled worker error', error);
      return json(500, { error: 'internal_error' });
    }
  },
};

export const __test = { validDate, normalizeTime, nowLocal, makeSession, validSession };
