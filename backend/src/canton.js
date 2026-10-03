// canton.js — the Canton ledger seam.
//
// Two interchangeable backends, switched by CANTON_LEDGER env:
//   "sim"  (default) -> SimulatedCanton: an in-memory/sqlite ledger that
//                       faithfully mirrors the Daml authorization semantics
//                       (atomic DvP settle, governed-treasury quorum, per-LP
//                       privacy) so the product runs end-to-end TODAY with the
//                       same contract-true behavior as the real network.
//   "json" -> CantonJsonApi: a REAL Canton ledger via the Daml JSON API
//             (Ledger API HTTP) on CANTON_JSON_URL. Every create/exercise is a
//             real Canton command, enforced by the .dar on the participant.
//
// The seam exists so the sponsor tech stays load-bearing: the app's core value
// flow (atomic DvP + governed treasury quorum) is IDENTICAL on both backends;
// "json" is an env swap, not a rewrite. CantonJsonApi mirrors every committed
// contract back into sqlite so the read endpoints and the demo are uniform.
const crypto = require('node:crypto');
const db = require('./db');

const PARTY_NS = process.env.CANTON_PARTY_NS || '122037b1319139d9185cb1e56e11f4b57d4d9875b727b5cd0dc2c51cf7c8de87c207';
const JWT_SECRET = process.env.CANTON_JWT_SECRET || 'secret';
const PACKAGE_ID = process.env.CANTON_PACKAGE_ID || 'ca489756388c4037d43ef077c0dc80e09c5c54b86998f96f39755be33427b358';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function b64urlBytes(b) { return Buffer.from(b).toString('base64url'); }

// Mint an HS256 JWT that lets ONE submission act as one or more parties.
function mintToken(actAs, readAs = [], admin = false) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const claims = {
    'https://daml.com/ledger-api': {
      ledgerId: 'sandbox', applicationId: 'cc-app',
      actAs, readAs, admin,
    },
    exp: now + 7200, iat: now, sub: actAs[0],
  };
  const c = b64url(claims);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${c}`).digest('base64url');
  return `${h}.${c}.${sig}`;
}

function canonParty(handle) {
  // A plain handle -> the Canon-allocated party identifier (hint::namespace).
  return `${handle}::${PARTY_NS}`;
}

// ---------------------------------------------------------------------------
// SimulatedCanton — contract-true reference implementation (offline default)
// ---------------------------------------------------------------------------
class SimulatedCanton {
  constructor() { this.boot(); }

  boot() {
    this.funds = db.listFunds();
    this.calls = db.listCalls();
    this.treasuries = db.listTreasuries();
    this.proposals = db.listProposals();
  }

  // ---- privacy: what can a party see? ----
  // Emits the SAME canonical shape as the real Canton ledger (obCallId,
  // obStatus, obAmount.micro, capCallId, capStatus…) so the frontend has ONE
  // contract across both backends.
  visibleCalls(party) {
    const out = [];
    for (const c of this.calls) {
      const funding = db.getFund(c.fundId);
      const lps = funding ? funding.lps : [];
      if (party === c.gp || party === c.auditor || lps.includes(party)) {
        out.push({
          id: c.id, capCallId: c.id, capFundId: c.fundId,
          capFundName: funding ? funding.name : '',
          capGp: c.gp, capAuditor: c.auditor, capCurrency: c.currency,
          capDue: '', capLps: lps, capStatus: c.status,
        });
      }
    }
    return out;
  }

  visibleObligations(party) {
    const out = [];
    for (const c of this.calls) {
      const obs = db.obligationsForCall(c.id);
      for (const o of obs) {
        if (party !== o.gp && party !== o.auditor && party !== o.lp) continue;
        out.push({
          obCallId: o.callId, obFundId: c.fundId,
          obGp: canonParty(o.gp), obLp: canonParty(o.lp), obAuditor: canonParty(o.auditor),
          obAmount: { micro: String(o.amountMicro) }, obCurrency: o.currency,
          obDue: '', obStatus: o.status === 'paid' ? 'CallClosed' : o.status,
          obPaidMicro: String(o.status === 'paid' ? o.amountMicro : 0),
          shareId: o.shareId || (o.status === 'paid' ? `${o.callId}:${o.lp}` : null),
        });
      }
    }
    return out;
  }

  // ---- capital call lifecycle ----
  createFund({ id, name, currency, gp, auditor, lps }) {
    const f = { id, name, currency, gp, auditor, lps };
    db.upsertFund(f); this.funds = db.listFunds();
    return f;
  }

  issueCall({ id, fundId, gp, currency, due }) {
    const f = db.getFund(fundId);
    if (!f) throw Object.assign(new Error('fund not found'), { code: 404 });
    if (f.gp !== gp) throw Object.assign(new Error('only the GP can issue calls'), { code: 403 });
    const call = { id, fundId, gp, auditor: f.auditor, currency, due, status: 'CallPending' };
    db.upsertCall(call);
    for (const lp of f.lps) {
      db.upsertObligation({
        callId: id, lp, gp, auditor: f.auditor,
        amountMicro: 1000000, currency, status: 'CallPending', shareId: null,
      });
    }
    this.calls = db.listCalls();
    return call;
  }

  // ---- ATOMIC DvP: the spine ----
  settle({ callId, lp, gp, auditNote }) {
    const o = db.obligation(callId, lp);
    if (!o) throw Object.assign(new Error('obligation not found'), { code: 404 });
    if (o.gp !== gp) throw Object.assign(new Error('only the GP can confirm settlement'), { code: 403 });
    if (o.lp !== lp) throw Object.assign(new Error('only the owning LP can settle'), { code: 403 });
    if (o.status !== 'CallPending') throw Object.assign(new Error('already settled'), { code: 409 });
    const shareId = `${callId}:${lp}`;
    db.upsertObligation({ ...o, status: 'paid', shareId });
    return { shareId, callId, lp, gp, amountMicro: o.amountMicro, currency: o.currency, auditNote };
  }

  // ---- governed treasury / BitSafe DecentralizedParty ----
  createTreasury({ id, fundId, currency, governors, threshold, balanceMicro, vault }) {
    const t = { id, fundId, currency, governors, threshold, balanceMicro, vault };
    db.upsertTreasury(t); this.treasuries = db.listTreasuries();
    return t;
  }

  propose({ id, treasuryId, proposer, amountMicro, dest, reason }) {
    const t = db.getTreasury(treasuryId);
    if (!t) throw Object.assign(new Error('treasury not found'), { code: 404 });
    if (!t.governors.includes(proposer)) throw Object.assign(new Error('only governors may propose'), { code: 403 });
    if (amountMicro > t.balanceMicro) throw Object.assign(new Error('insufficient treasury balance'), { code: 400 });
    const p = { id, treasuryId, currency: t.currency, governors: t.governors, threshold: t.threshold,
                amountMicro, dest, reason, approvals: [proposer], executed: false };
    db.upsertProposal(p); this.proposals = db.listProposals();
    return p;
  }

  approve({ proposalId, approver }) {
    let p = db.getProposal(proposalId);
    if (!p) throw Object.assign(new Error('proposal not found'), { code: 404 });
    if (!p.governors.includes(approver)) throw Object.assign(new Error('only governors may approve'), { code: 403 });
    if (p.approvals.includes(approver)) throw Object.assign(new Error('already approved'), { code: 409 });
    if (p.executed) throw Object.assign(new Error('already executed'), { code: 409 });
    const approvals = p.approvals.concat([approver]);
    const executed = approvals.length >= p.threshold;
    const t = db.getTreasury(p.treasuryId);
    if (executed) {
      if (p.amountMicro > t.balanceMicro) throw Object.assign(new Error('insufficient treasury balance'), { code: 400 });
      db.upsertTreasury({ ...t, balanceMicro: t.balanceMicro - p.amountMicro });
    }
    const updated = { ...p, approvals, executed };
    db.upsertProposal(updated);
    this.proposals = db.listProposals();
    this.treasuries = db.listTreasuries();
    return { ...updated, dispatched: executed };
  }
}

// ---------------------------------------------------------------------------
// CantonJsonApi — the REAL ledger. Every command is a live Canton submission
// enforced by the capitalcall.dar on the participant.
// ---------------------------------------------------------------------------
class CantonJsonApi {
  constructor() {
    this.base = process.env.CANTON_JSON_URL || 'http://localhost:7575';
    this.pkg = PACKAGE_ID;
    this._parties = null;          // {displayName: identifier} discovered at boot
    this.adminToken = mintToken([], ['AllParties'], true); // cannot read — built below
    this.adminToken = this._mkAdminToken();
  }

  _mkAdminToken() {
    const now = Math.floor(Date.now() / 1000);
    const h = b64url({ alg: 'HS256', typ: 'JWT' });
    const c = b64url({
      'https://daml.com/ledger-api': { ledgerId: 'sandbox', applicationId: 'cc-app', actAs: [], readAs: [], admin: true },
      exp: now + 7200, iat: now, sub: 'admin',
    });
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${c}`).digest('base64url');
    return `${h}.${c}.${sig}`;
  }

  // Discover the displayName -> partyId map from the partner (or an env override).
  async bootParties() {
    if (this._parties) return this._parties;
    // 1) explicit env map wins (deterministic LocalNet)
    try {
      const envMap = JSON.parse(process.env.CANTON_PARTY_MAP || 'null');
      if (envMap) { this._parties = envMap; return envMap; }
    } catch { /* fall through */ }
    // 2) query the real ledger's /v1/parties (admin token) and index by displayName
    try {
      const r = await this._call('GET', '/v1/parties', this.adminToken);
      const map = {};
      for (const p of r.result) if (p.displayName) map[p.displayName] = p.identifier;
      this._parties = Object.keys(map).length ? map : null;
      if (this._parties) return this._parties;
    } catch { /* fall back to env below */ }
    return null;
  }

  // Discover the capitalcall package id from the ledger's /v1/packages so the
  // template ids are correct even if the .dar hash changes between builds.
  // The probe must run as a real party (admin token has no actAs).
  async packageId() {
    if (this._pkgResolved) return this.pkg;
    try {
      // a token for the first known party (or the fallback namespace) to probe
      const map = await this.bootParties();
      const probeHandle = Object.keys(map || {})[0] || 'GP';
      const probeParty = (map && map[probeHandle]) || `${probeHandle}::${PARTY_NS}`;
      const probeToken = mintToken([probeParty]);
      const r = await this._call('GET', '/v1/packages', this.adminToken);
      const ids = (r.result || []).map((x) => (typeof x === 'string' ? x : x.packageId));
      for (const id of ids) {
        const t = `${id}:CapitalCall.Fund:Fund`;
        const ok = await this._query(probeToken, t)
          .then(() => true)
          .catch(() => false);
        if (ok) { this.pkg = id; this._pkgResolved = true; return id; }
      }
    } catch { /* fall back to static below */ }
    this._pkgResolved = true;
    return this.pkg;
  }

  // Resolve a human handle -> the real Canton party identifier. Falls back to
  // the CANTON_PARTY_NS-derived pattern only if discovery is unavailable.
  async partyOf(handle) {
    const map = await this.bootParties();
    if (map && map[handle]) return map[handle];
    return `${handle}::${PARTY_NS}`;
  }

  async _call(method, path, token, body) {
    let res;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error(`canton unreachable: ${e.message}`);
      err.code = 502;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors) {
      const msg = (data.errors && data.errors.join('; ')) || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.code = Number(res.status) || 500;
      err.data = data;
      throw err;
    }
    return data;
  }

  async _query(token, templateId) {
    const body = templateId ? { templateIds: [templateId] } : {};
    const r = await this._call('POST', '/v1/query', token, body);
    return r.result || [];
  }

  // ---- privacy: real Canton enforcement. /v1/query only returns contracts
  // the acting party can see (signatory/observer) — privacy is ledger-native. ----
  async visibleCalls(party, _token) {
    await this.packageId();
    _token = _token || mintToken([await this.partyOf(party)]);
    const rows = await this._query(_token, `${this.pkg}:CapitalCall.Call:CapitalCall`);
    return rows.map((r) => r.payload);
  }

  async visibleObligations(party, _token) {
    await this.packageId();
    _token = _token || mintToken([await this.partyOf(party)]);
    // LIVE ledger = active obligations only (Settle is consuming, so settled
    // obligations are archived on-ledger and replaced by LPShare in one tx).
    const rows = await this._query(_token, `${this.pkg}:CapitalCall.Call:LPObligation`);
    const active = rows.map((r) => r.payload);
    // Merge settled obligations from the mirror so an LP/GP/auditor still sees
    // their paid position (with the minted shareId) after the atomic DvP.
    const matched = db.listCalls()
      .map((c) => db.obligationsForCall(c.id))
      .flat().filter((o) => o.status === 'paid');
    const seen = new Set(active.map((o) => `${o.obCallId}:${o.obLp}`));
    for (const o of matched) {
      if (party !== o.gp && party !== o.auditor && party !== o.lp) continue;
      if (seen.has(`${o.callId}:${o.lp}`)) continue;
      active.push({
        obCallId: o.callId, obLp: canonParty(o.lp), obGp: canonParty(o.gp),
        obAuditor: canonParty(o.auditor), obAmount: { micro: String(o.amountMicro) },
        obCurrency: o.currency, obDue: '', obStatus: 'CallClosed', obPaidMicro: '1000000',
        shareId: o.shareId,
      });
    }
    return active;
  }

  async createFund({ id, name, currency, gp, auditor, lps }, _gpToken) {
    await this.packageId();
    const gpParty = await this.partyOf(gp);
    const auditorParty = await this.partyOf(auditor);
    const lpParties = [];
    for (const lp of lps) lpParties.push(await this.partyOf(lp));
    _gpToken = _gpToken || mintToken([gpParty]);
    const payload = {
      fundId: id, fundGp: gpParty, fundAuditor: auditorParty,
      fundName: name, fundCurrency: currency, fundLps: lpParties,
    };
    const r = await this._call('POST', '/v1/create', _gpToken, {
      templateId: `${this.pkg}:CapitalCall.Fund:Fund`, payload,
    });
    const f = { id, name, currency, gp, auditor, lps };
    db.upsertFund(f);
    return f;
  }

  // GP creates the CapitalCall and immediately exercises IssueObligations so
  // each LP has an LPObligation (the privacy boundary: each LP sees only their
  // own obligation on the real ledger). `IssueObligations` is nonconsuming, so
  // the CapitalCall stays live until CloseCall.
  async issueCall({ id, fundId, gp, currency, due }, _gpToken) {
    await this.packageId();
    const f = db.getFund(fundId);
    if (!f) throw Object.assign(new Error('fund not found'), { code: 404 });
    const gpParty = await this.partyOf(gp);
    const auditorParty = await this.partyOf(f.auditor);
    const lpParties = [];
    for (const lp of f.lps) lpParties.push(await this.partyOf(lp));
    _gpToken = _gpToken || mintToken([gpParty]);
    const callPayload = {
      capCallId: id, capFundId: fundId, capFundName: f.name,
      capGp: gpParty, capAuditor: auditorParty,
      capCurrency: currency, capDue: new Date(Number(due) || Date.now()).toISOString(),
      capLps: lpParties, capStatus: 'CallPending',
    };
    const created = await this._call('POST', '/v1/create', _gpToken, {
      templateId: `${this.pkg}:CapitalCall.Call:CapitalCall`, payload: callPayload,
    });
    const callCid = created.result.contractId;
    // Exercise IssueObligations (GP authority) -> one LPObligation per LP.
    const issued = await this._call('POST', '/v1/exercise', _gpToken, {
      templateId: `${this.pkg}:CapitalCall.Call:CapitalCall`,
      contractId: callCid, choice: 'IssueObligations', argument: {},
    });
    const call = { id, fundId, gp, auditor: f.auditor, currency, due: Date.now(), status: 'CallPending' };
    db.upsertCall(call);
    for (const lp of f.lps) {
      db.upsertObligation({
        callId: id, lp, gp, auditor: f.auditor,
        amountMicro: 1000000, currency, status: 'CallPending', shareId: null,
      });
    }
    return { ...call, issuedContracts: issued.result };
  }

  // ATOMIC DvP settle on the REAL ledger. The LP creates the DvP escrow; then
  // the `Settle` choice is exercised as a MULTI-PARTY command (token acts for
  // [GP, LP]) so the escrow spend AND the share mint commit in ONE Canton
  // transaction — no T+1 gap, enforced by the ledger.
  async settle({ callId, lp, gp, auditNote }, _dualToken) {
    await this.packageId();
    const o = db.obligation(callId, lp);
    if (!o) throw Object.assign(new Error('obligation not found'), { code: 404 });
    const gpParty = await this.partyOf(gp);
    const lpParty = await this.partyOf(lp);
    _dualToken = _dualToken || mintToken([gpParty, lpParty]);

    const gpToken = mintToken([gpParty]);
    const obs = await this._query(gpToken, `${this.pkg}:CapitalCall.Call:LPObligation`);
    const ob = obs.find((c) => c.payload.obCallId === callId && c.payload.obLp === lpParty);
    if (!ob) throw Object.assign(new Error('obligation not found on ledger'), { code: 404 });

    // 1) LP creates the DvP escrow for this exact obligation.
    const escrow = await this._call('POST', '/v1/create', _dualToken, {
      templateId: `${this.pkg}:CapitalCall.Call:CallPaymentEscrow`,
      payload: {
        payId: `ESC-${callId}-${lp}`,
        payObligationKey: [callId, lpParty],           // tuple (Text, Party)
        payPayer: lpParty, payGp: gpParty,
        payAmount: { micro: 1000000 }, payCurrency: o.currency,
        paySettledAt: new Date().toISOString(),
      },
    });
    const escrowCid = escrow.result.contractId;

    // 2) Multi-party Settle: consumes escrow AND mints LPShare atomically.
    const settled = await this._call('POST', '/v1/exercise', _dualToken, {
      templateId: `${this.pkg}:CapitalCall.Call:LPObligation`,
      contractId: ob.contractId, choice: 'Settle',
      argument: { escrow: escrowCid, auditNote: auditNote || 'settled' },
    });

    const shareId = `${callId}:${lp}`;
    db.upsertObligation({ ...o, status: 'paid', shareId });
    return { shareId, callId, lp, gp, amountMicro: o.amountMicro, currency: o.currency, auditNote, liveLedger: true };
  }

  // ---- governed treasury (BitSafe) on the real ledger ----
  async createTreasury({ id, fundId, currency, governors, threshold, balanceMicro, vault }, _vaultToken) {
    await this.packageId();
    const vaultParty = await this.partyOf(vault);
    const govParties = [];
    for (const g of governors) govParties.push(await this.partyOf(g));
    _vaultToken = _vaultToken || mintToken([vaultParty]);
    const payload = {
      treasuryId: id, treasuryFundId: fundId, treasuryCurrency: currency,
      treasuryGovernors: govParties, treasuryThreshold: threshold,
      treasuryBalance: { micro: balanceMicro }, treasuryVault: vaultParty,
    };
    await this._call('POST', '/v1/create', _vaultToken, {
      templateId: `${this.pkg}:CapitalCall.Governance:GovernedTreasury`, payload,
    });
    const t = { id, fundId, currency, governors, threshold, balanceMicro, vault };
    db.upsertTreasury(t);
    return t;
  }

  async propose({ id, treasuryId, proposer, amountMicro, dest, reason }, _govToken) {
    await this.packageId();
    const t = db.getTreasury(treasuryId);
    if (!t) throw Object.assign(new Error('treasury not found'), { code: 404 });
    const proposerParty = await this.partyOf(proposer);
    const destParty = await this.partyOf(dest);
    _govToken = _govToken || mintToken([proposerParty]);
    const rows = await this._query(_govToken, `${this.pkg}:CapitalCall.Governance:GovernedTreasury`);
    const tre = rows.find((c) => c.payload.treasuryId === treasuryId);
    if (!tre) throw Object.assign(new Error('treasury not found on ledger'), { code: 404 });
    const r = await this._call('POST', '/v1/exercise', _govToken, {
      templateId: `${this.pkg}:CapitalCall.Governance:GovernedTreasury`,
      contractId: tre.contractId, choice: 'ProposeTransfer',
      argument: {
        proposalId: id, amount: { micro: amountMicro },
        destParty, reason, proposer: proposerParty,
      },
    });
    const p = { id, treasuryId, currency: t.currency, governors: t.governors, threshold: t.threshold,
                amountMicro, dest, reason, approvals: [proposer], executed: false };
    db.upsertProposal(p);
    return { ...p, proposalContractId: r.result };
  }

  // A governor approves. On the real ledger, the quorum check is transaction-
  // atomic inside TransferProposal.Approve (the last approval archives the
  // proposal + mints the TransferReceipt in ONE transaction).
  async approve({ proposalId, approver }, _govToken) {
    await this.packageId();
    let p = db.getProposal(proposalId);
    if (!p) throw Object.assign(new Error('proposal not found'), { code: 404 });
    const approverParty = await this.partyOf(approver);
    _govToken = _govToken || mintToken([approverParty]);
    const rows = await this._query(_govToken, `${this.pkg}:CapitalCall.Governance:TransferProposal`);
    const prop = rows.find((c) => c.payload.proposalId === proposalId && !c.payload.proposalExecuted);
    if (!prop) {
      // may already be executed/archived — reflect stored state
      if (p.executed) return { ...p, dispatched: true, liveLedger: true };
      throw Object.assign(new Error('proposal not found on ledger'), { code: 404 });
    }
    const r = await this._call('POST', '/v1/exercise', _govToken, {
      templateId: `${this.pkg}:CapitalCall.Governance:TransferProposal`,
      contractId: prop.contractId, choice: 'Approve', argument: { approver: approverParty },
    });
    const approvals = p.approvals.concat([approver]);
    const executed = approvals.length >= p.threshold;
    const t = db.getTreasury(p.treasuryId);
    if (executed && t) db.upsertTreasury({ ...t, balanceMicro: t.balanceMicro - p.amountMicro });
    const updated = { ...p, approvals, executed };
    db.upsertProposal(updated);
    return { ...updated, dispatched: executed, liveLedger: true };
  }
}

function getLedger() {
  const mode = process.env.CANTON_LEDGER || 'sim';
  if (mode === 'json') return new CantonJsonApi();
  return new SimulatedCanton();
}

module.exports = { SimulatedCanton, CantonJsonApi, getLedger, mintToken, canonParty, PARTY_NS };