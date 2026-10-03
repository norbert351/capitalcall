// agent.js — the fund-servicing agent.
//
// Reads the LIVE ledger state (obligations, calls, treasury) and produces the
// servicing outputs a fund administrator needs — exactly the "AI axis" of the
// HackCanton pitch, but grounded: it executes over the real on-ledger records,
// never over a fake snapshot. No external LLM call is made; the "agent" is a
// deterministic scoring/decision layer over real surfaced data, so the demo is
// reproducible and the outputs are auditable against the ledger.
//
// Outputs:
//   - LP notices: a per-LP plain-language notice of what they owe, its call,
//     amount, and due state (pending / drafts).
//   - Underfunded-call flagging: a call is flagged "at risk" when remaining
//     unpaid obligations place it below a configured funding ratio vs target.
//   - Outreach states: due / approaching / overdue — so the agent drives the
//     notices, not the GP by hand.

const db = require('./db');

// A call is "sufficiently funded" when settled.value >= coverage * total.value.
const COVERAGE_TARGET = 0.8;          // want >=80% of the call covered
const APPROACHING_HOURS = 72;          // flag "approaching" within 3 days of due
const DUE_MS = 24 * 60 * 60 * 1000;

function microNum(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && 'micro' in v) return Number(v.micro) || 0;
  return Number(v) || 0;
}

// Pull all obligations mirrored from the ledger (this is the same store the
// sim and the real Canton backend both write to after every commit).
function allObligations() {
  return db.listCalls()
    .map((c) => ({ call: c, obs: db.obligationsForCall(c.id) }))
    .filter((r) => r.obs.length);
}

// --- underfunded-call detection --------------------------------------------
function fundingStats(call, obs) {
  const total = obs.reduce((s, o) => s + microNum(o.amountMicro), 0);
  const settled = obs.filter((o) => o.status === 'paid').reduce((s, o) => s + microNum(o.amountMicro), 0);
  const pending = obs.filter((o) => o.status !== 'paid');
  const pendingValue = pending.reduce((s, o) => s + microNum(o.amountMicro), 0);
  return { total, settled, pendingValue, pendingCount: pending.length, ratio: total ? settled / total : 1 };
}

function dueState(call) {
  const due = call.due ? Number(call.due) : Date.now();
  if (call.status === 'CallClosed') return 'closed';
  const now = Date.now();
  if (due - now <= 0) return 'overdue';
  if (due - now <= APPROACHING_HOURS * 3600 * 1000) return 'approaching';
  return 'due';
}

function buildCalls() {
  return allObligations().map(({ call, obs }) => {
    const stats = fundingStats(call, obs);
    const underfunded = stats.total > 0 && stats.ratio < COVERAGE_TARGET && call.status !== 'CallClosed';
    const state = dueState(call);
    return {
      callId: call.id,
      fundId: call.fundId,
      currency: call.currency,
      due: call.due,
      status: call.status,
      state,
      stats,
      underfunded,
      uncovered: Math.max(0, stats.total - stats.settled),
    };
  });
}

// --- LP notices -------------------------------------------------------------
function lpNotices(party) {
  const rows = allObligations();
  const notices = [];
  for (const { call, obs } of rows) {
    for (const o of obs) {
      if (o.lp !== party) continue;
      const state = dueState(call);
      const amt = microNum(o.amountMicro);
      let tone, action;
      if (o.status === 'paid') { tone = 'settled'; action = 'Share issued — nothing to do.'; }
      else if (state === 'overdue') { tone = 'overdue'; action = 'Settle now to keep the fund on schedule.'; }
      else if (state === 'approaching') { tone = 'approaching'; action = 'Due within 72h — please settle.'; }
      else { tone = 'due'; action = 'Awaiting settlement by the due date.'; }
      notices.push({
        callId: call.id, fundId: call.fundId, currency: call.currency,
        amountMicro: amt, amount: amt / 1e6,
        due: call.due, state: o.status === 'paid' ? 'settled' : tone, action, settled: o.status === 'paid',
      });
    }
  }
  return notices.sort((a, b) => (a.settled === b.settled ? (b.amountMicro - a.amountMicro) : a.settled ? 1 : -1));
}

// --- manager dashboard ------------------------------------------------------
function managerOverview() {
  const calls = buildCalls();
  const funded = calls.filter((c) => !c.underfunded && c.status !== 'CallClosed');
  const atRisk = calls.filter((c) => c.underfunded);
  const overdue = calls.filter((c) => c.state === 'overdue');
  const openObligations = allObligations().reduce(
    (s, { obs }) => s + obs.filter((o) => o.status !== 'paid').length, 0);
  return {
    calls,
    fundingCoverage: calls.length ? Math.round(calls.reduce((s, c) => s + c.stats.ratio, 0) / calls.length * 100) : 100,
    atRisk,
    overdue,
    openObligations,
    footer: {
      notice: atRisk.length
        ? `${atRisk.length} call(s) below ${Math.round(COVERAGE_TARGET * 100)}% funded — outreach queued to the LPs who still owe.`
        : 'All open calls are sufficiently funded. No outreach required.',
    },
  };
}

// --- outreach queue (who the agent will contact, grounded in live ledger) --
// The outreach set = every un-paid obligation on an underfunded call. Dispatching
// persists a row per LP so the action is auditable ("who we told, when").
function outreachQueue() {
  const out = [];
  for (const { call, obs } of allObligations()) {
    const stats = fundingStats(call, obs);
    const underfunded = stats.total > 0 && stats.ratio < COVERAGE_TARGET && call.status !== 'CallClosed';
    if (!underfunded) continue;
    const state = dueState(call);
    for (const o of obs) {
      if (o.status === 'paid') continue;
      const amt = microNum(o.amountMicro);
      let action;
      if (state === 'overdue') action = 'Settle now to keep the fund on schedule.';
      else if (state === 'approaching') action = 'Due within 72h — please settle.';
      else action = 'Awaiting settlement by the due date.';
      out.push({
        callId: call.id, fundId: call.fundId, currency: call.currency, lp: o.lp,
        amountMicro: amt, amount: amt / 1e6, state, action,
      });
    }
  }
  return out;
}

module.exports = { lpNotices, managerOverview, buildCalls, outreachQueue, COVERAGE_TARGET };