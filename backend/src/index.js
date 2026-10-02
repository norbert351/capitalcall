// index.js — zero-dep Node HTTP server for CapitalCall.
// REST + native account auth (HttpOnly cookie) + role-scoped privacy views.
// Works with EITHER ledger (sim or real Canton JSON API) via getLedger().
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const { getLedger, canonParty } = require('./canton');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------- helpers ----------
function json(res, code, body, setCookie) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

function readBody(req, cap = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0, buf = [];
    req.on('data', (c) => { size += c.length; if (size > cap) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else buf.push(c); });
    req.on('end', () => { try { resolve(buf.length ? JSON.parse(Buffer.concat(buf).toString()) : {}); } catch { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
    req.on('error', reject);
  });
}

function parseCookie(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
const SESSION_COOKIE = 'cc_sess';

// ---------- auth ----------
function me(req) {
  const tok = parseCookie(req)[SESSION_COOKIE];
  if (!tok) return null;
  return db.userByToken(tok);
}
function requireAuth(req, res) {
  const u = me(req);
  if (!u) { json(res, 401, { error: 'unauthorized' }); return null; }
  return u;
}
function requireRole(req, res, role) {
  const u = requireAuth(req, res);
  if (!u) return null;
  if (u.role !== role) { json(res, 403, { error: `requires ${role} role` }); return null; }
  return u;
}

const SESSION_TTL = 86400 * 1000; // 24h
function loginResponse(res, user) {
  const token = 'cc_' + crypto.randomBytes(32).toString('hex');
  db.createSession(token, user.id, Date.now(), Date.now() + SESSION_TTL);
  const cookie = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`;
  return cookie;
}
function hashPass(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }

// Resolve a handle to its Canton party identifier (real on 'json', canonical in 'sim').
async function resolveParty(handle) {
  if (ledger.partyOf) { try { return await ledger.partyOf(handle); } catch { /* fallback */ } }
  return canonParty(handle);
}

// ---------- ledger instance ----------
const ledger = getLedger();

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  if (method === 'OPTIONS') return cors(req, res);

  try {
    // ---- static UI ----
    if (method === 'GET' && (p === '/' || p.startsWith('/static/'))) {
      let file = p === '/' ? 'index.html' : p.replace(/^\/static\//, '');
      const full = path.resolve(PUBLIC_DIR, file);
      if (!full.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(full)) return json(res, 404, { error: 'not found' });
      const ext = path.extname(full).toLowerCase();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(full));
    }

    // ---- account ----
    if (method === 'POST' && p === '/api/register') {
      const b = await readBody(req);
      if (typeof b.handle !== 'string' || typeof b.password !== 'string') return json(res, 400, { error: 'handle+password required' });
      if (db.userByHandle(b.handle)) return json(res, 409, { error: 'handle taken' });
      const role = ['GP', 'LP', 'AUDITOR'].includes(b.role) ? b.role : 'LP';
      const salt = crypto.randomBytes(16).toString('hex');
      const id = db.insertUser(b.handle, role, hashPass(b.password, salt), salt);
      const cookie = loginResponse(res, { id, handle: b.handle, role });
      return json(res, 201, { handle: b.handle, role, party: await resolveParty(b.handle) }, cookie);
    }
    if (method === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      const u2 = db.userByHandle(b.handle);
      if (!u2 || !u2.password_hash || !u2.password_salt) return json(res, 401, { error: 'bad credentials' });
      const got = hashPass(b.password, u2.password_salt);
      if (!crypto.timingSafeEqual(Buffer.from(got), Buffer.from(u2.password_hash))) return json(res, 401, { error: 'bad credentials' });
      const cookie = loginResponse(res, u2);
      return json(res, 200, { handle: u2.handle, role: u2.role, party: await resolveParty(u2.handle) }, cookie);
    }
    if (method === 'POST' && p === '/api/logout') {
      const tok = parseCookie(req)[SESSION_COOKIE];
      if (tok) db.deleteSession(tok);
      return json(res, 200, { ok: true }, `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly`);
    }
    if (method === 'GET' && p === '/api/me') {
      const u2 = me(req);
      if (!u2) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { handle: u2.handle, role: u2.role, party: await resolveParty(u2.handle) });
    }

    // ---- GP endpoints: fund + call issuance ----
    if (method === 'POST' && p === '/api/funds') {
      const gp = requireRole(req, res, 'GP'); if (!gp) return;
      const b = await readBody(req);
      const fund = await ledger.createFund({
        id: b.id || ('FUND-' + crypto.randomBytes(4).toString('hex').toUpperCase()),
        name: b.name || 'Paloma Capital III', currency: b.currency || 'cBTC',
        gp: gp.handle, auditor: b.auditor || 'auditor', lps: b.lps || [],
      });
      return json(res, 201, fund);
    }
    if (method === 'GET' && p === '/api/funds') {
      const u2 = requireAuth(req, res); if (!u2) return;
      const all = db.listFunds();
      return json(res, 200, all.filter(f => u2.role === 'GP' ? f.gp === u2.handle
        : u2.role === 'AUDITOR' ? f.auditor === u2.handle : f.lps.includes(u2.handle)));
    }
    if (method === 'POST' && p === '/api/calls') {
      const gp = requireRole(req, res, 'GP'); if (!gp) return;
      const b = await readBody(req);
      const call = await ledger.issueCall({ id: b.id || ('CALL-' + crypto.randomBytes(4).toString('hex').toUpperCase()), fundId: b.fundId, gp: gp.handle, currency: b.currency || 'cBTC', due: b.due || Date.now() });
      return json(res, 201, call);
    }
    if (method === 'GET' && p === '/api/calls') {
      const u2 = requireAuth(req, res); if (!u2) return;
      return json(res, 200, await ledger.visibleCalls(u2.handle));
    }
    if (method === 'GET' && p === '/api/obligations') {
      const u2 = requireAuth(req, res); if (!u2) return;
      return json(res, 200, await ledger.visibleObligations(u2.handle));
    }

    // ---- DvP settle (dual control: LP pays, GP confirms) ----
    const settleMatch = p.match(/^\/api\/obligations\/([^/]+)\/([^/]+)\/settle$/);
    if (method === 'POST' && settleMatch) {
      const u2 = requireAuth(req, res); if (!u2) return;
      const [, callId, lp] = settleMatch;
      const b = await readBody(req);
      if (u2.role !== 'GP') return json(res, 403, { error: 'only GP can confirm settlement' });
      const result = await ledger.settle({ callId, lp, gp: u2.handle, auditNote: b.auditNote });
      return json(res, 200, result);
    }

    // ---- governed treasury (BitSafe) ----
    if (method === 'POST' && p === '/api/treasuries') {
      const gp = requireRole(req, res, 'GP'); if (!gp) return;
      const b = await readBody(req);
      const vault = b.vault || gp.handle;
      const t = await ledger.createTreasury({
        id: b.id || ('TREAS-' + crypto.randomBytes(4).toString('hex').toUpperCase()),
        fundId: b.fundId || (db.listFunds()[0] || {}).id || 'FUND-NA',
        currency: b.currency || 'cBTC',
        governors: b.governors || [gp.handle], threshold: b.threshold || 1,
        balanceMicro: b.balanceMicro || 0, vault,
      });
      return json(res, 201, t);
    }
    if (method === 'GET' && p === '/api/treasuries') {
      const u2 = requireAuth(req, res); if (!u2) return;
      const all = db.listTreasuries();
      return json(res, 200, all.filter(t => t.governors.includes(u2.handle) || u2.role === 'AUDITOR'));
    }
    if (method === 'POST' && p === '/api/treasuries/propose') {
      const u2 = requireAuth(req, res); if (!u2) return;
      const b = await readBody(req);
      const prop = await ledger.propose({ id: b.id || ('P-' + crypto.randomBytes(4).toString('hex').toUpperCase()), treasuryId: b.treasuryId, proposer: u2.handle, amountMicro: b.amountMicro, dest: b.dest, reason: b.reason });
      return json(res, 201, prop);
    }
    if (method === 'POST' && p === '/api/treasuries/approve') {
      const u2 = requireAuth(req, res); if (!u2) return;
      const b = await readBody(req);
      const result = await ledger.approve({ proposalId: b.proposalId, approver: u2.handle });
      return json(res, 200, result);
    }
    if (method === 'GET' && p === '/api/treasuries/proposals') {
      const u2 = requireAuth(req, res); if (!u2) return;
      const all = db.listProposals();
      return json(res, 200, all.filter(pr => pr.governors.includes(u2.handle)));
    }

    // ---- health + ledger mode ----
    if (method === 'GET' && p === '/api/health') {
      return json(res, 200, { ok: true, ledger: process.env.CANTON_LEDGER || 'sim', time: new Date().toISOString() });
    }

    json(res, 404, { error: `no route ${method} ${p}` });
  } catch (e) {
    const code = Number.isFinite(e.code) ? e.code : 500;
    json(res, code, { error: e.message || 'internal error' });
  }
});

server.listen(PORT, () => console.log(`CapitalCall backend on :${PORT} (ledger=${process.env.CANTON_LEDGER || 'sim'})`));