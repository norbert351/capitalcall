// CapitalCall backend API tests — zero dependencies, Node's built-in runner.
//
//   node --test backend/test/
//
// Boots the real server against a THROWAWAY sqlite db (CAPITALCALL_DB) on an
// ephemeral port and exercises the claims the pitch makes: native auth, role
// enforcement, ledger-enforced per-LP privacy, and treasury quorum.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const BACKEND = path.join(__dirname, '..', 'src', 'index.js');
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

// --- tiny cookie-aware fetch helper (the API is cookie-session authenticated) ---
function jar() {
  const cookies = {};
  return async function (method, p, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (Object.keys(cookies).length) headers.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, ct };
  };
}

before(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  proc = spawn(process.execPath, [BACKEND], {
    env: { ...process.env, PORT: String(PORT), CANTON_LEDGER: 'sim', CAPITALCALL_DB: path.join(tmp, 'test.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('server did not start');
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(() => { if (proc) proc.kill('SIGKILL'); });

// ---------------------------------------------------------------- auth
test('unauthenticated requests are rejected', async () => {
  const anon = jar();
  assert.strictEqual((await anon('GET', '/api/funds')).status, 401);
  assert.strictEqual((await anon('GET', '/api/me')).status, 401);
});

test('register issues a session and a role', async () => {
  const gp = jar();
  const r = await gp('POST', '/api/register', { handle: 'gp1', password: 'pw-secret', role: 'GP' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.role, 'GP');
  assert.ok(r.data.party, 'a Canton party id is resolved');
  const me = await gp('GET', '/api/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.data.handle, 'gp1');
});

test('duplicate handle is rejected', async () => {
  const j = jar();
  assert.strictEqual((await j('POST', '/api/register', { handle: 'gp1', password: 'x', role: 'GP' })).status, 409);
});

test('bad password does not authenticate', async () => {
  const j = jar();
  assert.strictEqual((await j('POST', '/api/login', { handle: 'gp1', password: 'wrong' })).status, 401);
  assert.strictEqual((await j('POST', '/api/login', { handle: 'nobody', password: 'x' })).status, 401);
});

test('logout invalidates the session', async () => {
  const j = jar();
  await j('POST', '/api/register', { handle: 'temp1', password: 'pw-secret', role: 'LP' });
  assert.strictEqual((await j('GET', '/api/me')).status, 200);
  await j('POST', '/api/logout');
  assert.strictEqual((await j('GET', '/api/me')).status, 401);
});

// ------------------------------------------------- role enforcement (GP-only surfaces)
test('role enforcement: LP cannot use GP-only surfaces', async () => {
  const lp = jar();
  await lp('POST', '/api/register', { handle: 'lp1', password: 'pw-secret', role: 'LP' });
  assert.strictEqual((await lp('POST', '/api/funds', { name: 'X' })).status, 403, 'LP cannot create a fund');
  assert.strictEqual((await lp('POST', '/api/calls', { fundId: 'F' })).status, 403, 'LP cannot issue a call');
  assert.strictEqual((await lp('GET', '/api/agent/overview')).status, 403, 'LP cannot read the manager overview');
  assert.strictEqual((await lp('POST', '/api/agent/outreach')).status, 403, 'LP cannot dispatch outreach');
});

// -------------------------------------------------- ledger-enforced per-LP privacy
test('per-LP privacy: each LP sees only its own obligation, GP sees the book', async () => {
  const gp = jar(), lp1 = jar(), lp2 = jar(), audit = jar();
  await gp('POST', '/api/register', { handle: 'gpP', password: 'pw-secret', role: 'GP' });
  await lp1('POST', '/api/register', { handle: 'lpP1', password: 'pw-secret', role: 'LP' });
  await lp2('POST', '/api/register', { handle: 'lpP2', password: 'pw-secret', role: 'LP' });
  await audit('POST', '/api/register', { handle: 'audP', password: 'pw-secret', role: 'AUDITOR' });

  const fund = await gp('POST', '/api/funds', { name: 'Privacy Fund', auditor: 'audP', lps: ['lpP1', 'lpP2'] });
  assert.strictEqual(fund.status, 201);
  const call = await gp('POST', '/api/calls', { fundId: fund.data.id, currency: 'cBTC' });
  assert.strictEqual(call.status, 201);

  const gpObs = await gp('GET', '/api/obligations');
  const l1Obs = await lp1('GET', '/api/obligations');
  const l2Obs = await lp2('GET', '/api/obligations');
  const aObs = await audit('GET', '/api/obligations');
  const me1 = (await lp1('GET', '/api/me')).data.party;
  const me2 = (await lp2('GET', '/api/me')).data.party;

  assert.strictEqual(gpObs.data.length, 2, 'GP sees both obligations');
  assert.strictEqual(l1Obs.data.length, 1, 'lp1 sees exactly one');
  assert.strictEqual(l2Obs.data.length, 1, 'lp2 sees exactly one');
  assert.strictEqual(aObs.data.length, 2, 'auditor sees the book');
  assert.notStrictEqual(me1, me2, 'the two LPs are different parties');
  assert.strictEqual(l1Obs.data[0].obLp, me1, 'lp1 sees only its OWN obligation');
  assert.strictEqual(l2Obs.data[0].obLp, me2, 'lp2 sees only its OWN obligation');
});

// ------------------------------------------------------------- governance quorum
test('treasury quorum: below threshold does not dispatch, reaching it does', async () => {
  const gp1 = jar(), gp2 = jar(), gp3 = jar();
  await gp1('POST', '/api/register', { handle: 'govA', password: 'pw-secret', role: 'GP' });
  await gp2('POST', '/api/register', { handle: 'govB', password: 'pw-secret', role: 'GP' });
  await gp3('POST', '/api/register', { handle: 'govC', password: 'pw-secret', role: 'GP' });

  // 3-of-3: the proposer's approval counts, so it takes 2 more to reach quorum.
  const t = await gp1('POST', '/api/treasuries', { governors: ['govA', 'govB', 'govC'], threshold: 3, balanceMicro: 5_000_000, currency: 'cBTC' });
  assert.strictEqual(t.status, 201);

  const p = await gp1('POST', '/api/treasuries/propose', { treasuryId: t.data.id, amountMicro: 1_000_000, dest: 'vendor', reason: 'audit fee' });
  assert.strictEqual(p.status, 201);
  assert.ok(!p.data.executed, 'a fresh proposal has not dispatched');

  const one = await gp2('POST', '/api/treasuries/approve', { proposalId: p.data.id });
  assert.strictEqual(one.status, 200);
  assert.ok(!one.data.executed, '2 of 3 must NOT dispatch below a 3-of-3 threshold');

  const two = await gp3('POST', '/api/treasuries/approve', { proposalId: p.data.id });
  assert.strictEqual(two.status, 200);
  assert.ok(two.data.executed, 'the threshold approval dispatches');

  // a governor cannot vote twice, and an executed proposal cannot be re-run
  assert.strictEqual((await gp3('POST', '/api/treasuries/approve', { proposalId: p.data.id })).status, 409, 'double approval rejected');
});

// ------------------------------------------------------------- static + routing
test('serves the product UI and 404s unknown routes', async () => {
  const j = jar();
  const home = await j('GET', '/');
  assert.strictEqual(home.status, 200);
  assert.match(home.ct, /text\/html/);
  assert.match(home.data, /CapitalCall/);
  assert.strictEqual((await j('GET', '/api/nope')).status, 404);
});
