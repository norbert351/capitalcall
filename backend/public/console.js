/* CapitalCall — product console client. Wired to the live backend /api/*.
   Zero-dependency vanilla JS. Role-aware (GP/LP/AUDITOR). */
(function () {
  'use strict';
  var API = window.API_BASE || '';            // same-origin by default
  var $ = function (id) { return document.getElementById(id); };
  var toastEl = $('toast');
  var toastTimer = null;
  function toast(msg, ok) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + (ok ? 'ok' : 'err');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3200);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMicro(v) {
    var n = (typeof v === 'object' && v !== null && 'micro' in v) ? Number(v.micro) : Number(v);
    return (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function partyShort(p) { return p ? String(p).split('::')[0] : ''; }
  function api(path, opts) {
    return fetch(API + path, Object.assign({
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin'
    }, opts)).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function apiPost(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }

  /* ---------- STATE ---------- */
  var me = null;          // {handle, role, party}
  var funds = [], calls = [], obligations = [], treasuries = [], proposals = [];

  /* ---------- AUTH GATE ---------- */
  var gate = $('gate');
  var registerMode = false;
  function showGate() { gate.classList.add('show'); }
  function hideGate() { gate.classList.remove('show'); }

  $('tabLogin').addEventListener('click', setTab);
  $('tabRegister').addEventListener('click', setTab);
  function setTab() {
    registerMode = this.id === 'tabRegister';
    $('tabLogin').classList.toggle('on', !registerMode);
    $('tabRegister').classList.toggle('on', registerMode);
    $('roleRow').style.display = registerMode ? 'flex' : 'none';
    $('authBtn').textContent = registerMode ? 'Create account →' : 'Sign in →';
    $('fPass').name = registerMode ? 'new-password' : 'current-password';
  }

  $('authForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { handle: $('fHandle').value.trim(), password: $('fPass').value };
    if (registerMode) {
      var role = document.querySelector('input[name=role]:checked').value;
      body.role = role;
      apiPost('./api/register', body).then(enterApp).catch(function (er) { toast(er.message, false); });
    } else {
      apiPost('./api/login', body).then(enterApp).catch(function (er) { toast(er.message, false); });
    }
  });

  function enterApp(u) {
    me = u;
    hideGate();
    renderMe();
    loadAll();
  }

  function renderMe() {
    var html = esc(me.handle) + ' <span class="role">' + esc(me.role) + '</span>';
    $('mePill').innerHTML = html;
    $('mePill2').innerHTML = esc(me.handle) + ' <span class="role">' + esc(me.role) + '</span>';
  }

  $('logoutBtn').addEventListener('click', function () {
    apiPost('./api/logout', {}).finally(function () {
      me = null; showGate();
      ['mePill', 'mePill2'].forEach(function (id) { $(id).innerHTML = ''; });
    });
  });

  /* ---------- ROUTER ---------- */
  var routes = ['dashboard', 'funds', 'treasury', 'audit'];
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('[data-route]'));
  var crumb = $('crumb');
  var titles = { dashboard: 'Dashboard', funds: 'Funds & Calls', treasury: 'Treasury', audit: 'Audit Ledger' };
  function route() {
    var h = (location.hash || '#dashboard').replace('#', '') || 'dashboard';
    if (routes.indexOf(h) < 0) h = 'dashboard';
    navLinks.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + h); });
    Array.prototype.slice.call(document.querySelectorAll('.view')).forEach(function (v) {
      v.classList.toggle('on', v.dataset.view === h);
    });
    crumb.textContent = titles[h];
    $('sidebar').classList.remove('open');
    renderRoute(h);
  }
  window.addEventListener('hashchange', route);

  $('barBurger').addEventListener('click', function () { $('sidebar').classList.toggle('open'); });

  /* ---------- DATA LOAD ---------- */
  function loadAll() { loadFunds().then(route); loadTreasury().then(route); }

  function loadFunds() {
    return Promise.all([
      api('./api/funds').then(function (d) { funds = d; }).catch(function () { funds = []; }),
      api('./api/calls').then(function (d) { calls = d; }).catch(function () { calls = []; }),
      api('./api/obligations').then(function (d) { obligations = d; }).catch(function () { obligations = []; })
    ]);
  }
  function loadTreasury() {
    return Promise.all([
      api('./api/treasuries').then(function (d) { treasuries = d; }).catch(function () { treasuries = []; }),
      api('./api/treasuries/proposals').then(function (d) { proposals = d; }).catch(function () { proposals = []; })
    ]);
  }

  /* ---------- RENDERERS ---------- */
  function renderRoute(routeName) {
    if (routeName === 'dashboard') return renderDashboard();
    if (routeName === 'funds') return renderFunds();
    if (routeName === 'treasury') return renderTreasury();
    if (routeName === 'audit') return renderAudit();
  }

  function av() { return $('views').querySelector('[data-view=active]') || $('views'); }

  function renderDashboard() {
    var v = document.querySelector('[data-view=dashboard]');
    if (!v) return;
    var callCount = calls.length, unpaid = obligations.filter(function (o) { return o.obStatus === 'CallPending'; }).length;
    var settled = obligations.filter(function (o) { return o.obStatus === 'CallClosed' || o.shareId; }).length;
    var myOb = obligations.filter(function (o) { return o.obLp && partyShort(o.obLp) === me.handle; });
    var html = '';
    html += '<div class="page-head"><span class="kicker">console · live ledger</span><h1>Welcome back, ' + esc(me.handle) + '.</h1>';
    html += '<p>Here\'s the state of your ' + (me.role === 'GP' ? 'fund operations' : me.role === 'LP' ? 'capital obligations' : 'fund audits') + '.</p></div>';
    html += '<div class="card">';
    html += '<div class="settle-anim"><div class="sa-ring"><div class="sa-core">LP<b>$</b></div><div class="sa-arc a"></div></div>';
    html += '<div class="sa-line"></div><div class="sa-ring"><div class="sa-core">Share<b>mint</b></div><div class="sa-arc b"></div></div><div class="sa-done">atomic settle</div></div>';
    html += '</div>';
    html += '<div class="grid3">';
    html += '<div class="stat"><div class="lbl">Active calls</div><div class="val acc">' + callCount + '</div></div>';
    html += '<div class="stat"><div class="lbl">Pending obligations</div><div class="val brass">' + unpaid + '</div></div>';
    html += '<div class="stat"><div class="lbl">Settled (shares issued)</div><div class="val">' + settled + '</div></div>';
    html += '</div>';
    if (me.role === 'LP') {
      html += '<div class="card" style="margin-top:16px"><h3>Your obligations</h3>';
      if (!myOb.length) html += '<div class="empty"><div class="a">◔</div>You have no outstanding obligations.</div>';
      else {
        html += '<table><tr><th>Call</th><th>Amount</th><th>Status</th></tr>';
        myOb.forEach(function (o) {
          html += '<tr><td class="mono">' + esc(o.obCallId || o.callId) + '</td><td class="mono">' + fmtMicro(o.obAmount || o.amountMicro) + ' ' + esc(o.obCurrency || '') + '</td>';
          html += '<td>' + statusPill(o) + '</td></tr>';
        });
        html += '</table>';
      }
      html += '</div>';
    }
    v.innerHTML = html;
  }

  function statusPill(o) {
    var s = o.obStatus || 'CallPending';
    if (s === 'CallPending') return '<span class="pill pend">Pending</span>';
    if (s === 'CallClosed' || o.shareId) return '<span class="pill paid">Settled</span>';
    if (s === 'CallDeclined') return '<span class="pill decl">Declined</span>';
    return '<span class="pill pend">' + esc(s) + '</span>';
  }

  function renderFunds() {
    var v = document.querySelector('[data-view=funds]');
    if (!v) return;
    var html = '<div class="page-head"><span class="kicker">fund operations</span><h1>Funds & capital calls</h1>';
    html += '<p>' + (me.role === 'GP' ? 'Create funds and issue calls. Settle each obligation atomically.' : 'Review the calls issued to your fund.') + '</p></div>';

    if (me.role === 'GP') {
      html += '<div class="card"><h3>Create a fund</h3><div class="sub">A manager creates the fund on the ledger. Add LPs by handle.</div>';
      html += '<form id="fundForm" class="form-row"><div><label>Name<input type="text" id="fFundName" placeholder="Paloma Capital III"></div>';
      html += '<div><label>Currency<select id="fCur"><option>cBTC</option><option>USDC</option></select></div>';
      html += '<div><label>LP handles (comma)<input type="text" id="fLps" placeholder="lp1, lp2"></div>';
      html += '<div><label>Auditor<input type="text" id="fAud" placeholder="audit1"></div>';
      html += '</div><button class="btn gr-primary" type="submit" style="margin-top:4px">Create fund →</button></form></div>';

      html += '<div class="card"><h3>Issue a capital call</h3><div class="sub">Issue obligations against a fund\'s roster.</div>';
      html += '<form id="callForm" class="form-row"><div><label>Fund<select id="fFundSel">' + funds.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; }).join('') + '</select></div>';
      html += '<button class="btn gr-ghost" type="submit" style="align-self:flex-end">Issue call →</button></div></form></div>';
    }

    html += '<div class="card"><h3>Calls</h3>';
    if (!calls.length) html += '<div class="empty"><div class="a">◈</div>No capital calls yet.</div>';
    else {
      html += callTable(calls, obligations);
    }
    html += '</div>';
    v.innerHTML = html;

    if ($('fundForm')) $('fundForm').addEventListener('submit', createFund);
    if ($('callForm')) $('callForm').addEventListener('submit', createCall);
  }

  function callTable(cs, obs) {
    var rows = cs.map(function (c) {
      var myObs = obs.filter(function (o) { return (o.obCallId || o.callId) === c.id; });
      return { c: c, obs: myObs };
    }).filter(function (r) { return r.c.id; });
    var html = '<table><tr><th>Call</th><th>Fund</th><th>Currency</th><th>Obligations</th><th>Status</th>' + (me.role === 'GP' ? '<th>Actions</th>' : '') + '</tr>';
    rows.forEach(function (r) {
      var pending = r.obs.filter(function (o) { return o.obStatus === 'CallPending'; });
      html += '<tr><td class="mono">' + esc(r.c.id) + '</td><td>' + esc((r.c.capFundName) || r.c.fundId) + '</td>';
      html += '<td class="mono">' + esc(r.c.capCurrency || r.c.currency || '') + '</td>';
      html += '<td class="mono">' + r.obs.length + ' (' + pending.length + ' pending)</td>';
      html += '<td>' + statusPill(r.c) + '</td>';
      if (me.role === 'GP') {
        var buttons = pending.map(function (o) {
          return '<button class="btn mini gr-primary" data-settle="' + esc(r.c.id) + '" data-lp="' + esc(partyShort(o.obLp)) + '">Settle ' + esc(partyShort(o.obLp)) + '</button>';
        }).join('');
        var cell = buttons ? '<div class="row-actions">' + buttons + '</div>' : '<span class="sub">closed</span>';
        html += '<td>' + cell + '</td>';
      }
      html += '</tr>';
    });
    return html + '</table>';
  }

  function renderTreasury() {
    var v = document.querySelector('[data-view=treasury]');
    if (!v) return;
    var html = '<div class="page-head"><span class="kicker">governed treasury</span><h1>Governed treasury</h1>';
    html += '<p>Every payout requires a governor quorum on-chain. No single manager moves LP capital.</p></div>';

    if (me.role === 'GP') {
      html += '<div class="card"><h3>Create a treasury</h3><div class="sub">Fund the pool and set the multi-sig quorum.</div>';
      html += '<form id="treasForm" class="form-row"><div><label>Balance (whole cBTC)<input type="number" id="tBal" value="5"></div>';
      html += '<div><label>Governors (comma)<input type="text" id="tGov" placeholder="gp1, gp2"></div>';
      html += '<div><label>Quorum<input type="number" id="tQ" value="2" min="1"></div>';
      html += '<div><label>Vault party<input type="text" id="tVault" placeholder="vault1"></div>';
      html += '</div><button class="btn gr-primary" type="submit">Create treasury →</button></form></div>';
    }

    if (!treasuries.length) html += '<div class="empty"><div class="a">◉</div>No treasury created yet.</div>';
    else {
      html += '<div class="grid2">' + treasuries.map(function (t) {
        return '<div class="card"><h3>' + esc(t.id) + '</h3><div class="sub">' + esc(t.currency) + ' · quorum ' + t.threshold + ' of ' + t.governors.length + ' governors</div>' +
          '<div class="stat" style="border:none;padding:6px 0"><div class="lbl">Balance</div><div class="val brass">' + fmtMicro(t.balanceMicro) + '</div></div>' +
          (me.role === 'GP' ? '<button class="btn mini gr-ghost" data-propose="' + esc(t.id) + '">Propose payout</button>' : '') + '</div>';
      }).join('') + '</div>';
    }

    var myProps = proposals;
    if (myProps.length) {
      html += '<div class="card" style="margin-top:16px"><h3>Proposals</h3><table><tr><th>ID</th><th>Amount</th><th>Reason</th><th>Approvals</th><th>Status</th>' + (me.role === 'GP' ? '<th></th>' : '') + '</tr>';
      myProps.forEach(function (p) {
        html += '<tr><td class="mono">' + esc(p.id) + '</td><td class="mono">' + fmtMicro(p.amountMicro) + '</td><td>' + esc(p.reason) + '</td>';
        html += '<td class="mono">' + p.approvals.length + '/' + p.threshold + '</td><td>' + (p.executed ? '<span class="pill paid">dispatched</span>' : '<span class="pill pend">pending</span>') + '</td>';
        if (me.role === 'GP' && !p.executed) html += '<td><button class="btn mini gr-primary" data-approve="' + esc(p.id) + '">Approve</button></td>';
        else html += '<td></td>';
        html += '</tr>';
      });
      html += '</table></div>';
    }
    v.innerHTML = html;
    if ($('treasForm')) $('treasForm').addEventListener('submit', createTreasury);
  }

  function renderAudit() {
    var v = document.querySelector('[data-view=audit]');
    if (!v) return;
    var canSeeAll = me.role === 'AUDITOR' || me.role === 'GP';
    var html = '<div class="page-head"><span class="kicker">audit · immutable</span><h1>Audit ledger</h1>';
    html += '<p>' + (canSeeAll ? 'Every obligation and share, recorded immutably on the ledger.' : 'Your obligations and settled shares.') + '</p></div>';
    html += '<div class="card"><h3>Obligations</h3>';
    if (!obligations.length) html += '<div class="empty"><div class="a">≡</div>No obligations recorded.</div>';
    else {
      html += '<table><tr><th>Call</th><th>LP</th><th>Amount</th><th>Status</th><th>Share</th></tr>';
      obligations.forEach(function (o) {
        html += '<tr><td class="mono">' + esc(o.obCallId || o.callId) + '</td><td class="mono">' + esc(partyShort(o.obLp)) + '</td>';
        html += '<td class="mono">' + fmtMicro(o.obAmount || o.amountMicro) + ' ' + esc(o.obCurrency || '') + '</td>';
        html += '<td>' + statusPill(o) + '</td><td class="mono">' + esc(o.shareId || '—') + '</td></tr>';
      });
      html += '</table>';
    }
    html += '</div>';
    v.innerHTML = html;
  }

  /* ---------- ACTIONS ---------- */
  function createFund(e) {
    e.preventDefault();
    var lps = $('fLps').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    apiPost('./api/funds', { name: $('fFundName').value || 'Fund', currency: $('fCur').value, auditor: $('fAud').value || 'audit1', lps: lps })
      .then(function () { toast('Fund created ✓', true); $('fFundName').value = ''; $('fLps').value = ''; loadAll(); })
      .catch(function (er) { toast(er.message, false); });
  }
  function createCall(e) {
    e.preventDefault();
    var fid = $('fFundSel').value;
    apiPost('./api/calls', { fundId: fid, currency: 'cBTC' })
      .then(function () { toast('Capital call issued ✓', true); loadAll(); })
      .catch(function (er) { toast(er.message, false); });
  }
  function createTreasury(e) {
    e.preventDefault();
    apiPost('./api/treasuries', {
      balanceMicro: Number($('tBal').value || 0) * 1e6,
      governors: $('tGov').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      threshold: Number($('tQ').value || 1), vault: $('tVault').value || 'vault1'
    }).then(function () { toast('Treasury created ✓', true); loadAll(); })
      .catch(function (er) { toast(er.message, false); });
  }

  // delegated clicks: settle / propose / approve
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-settle]');
    if (t) { settleObligation(t.getAttribute('data-settle'), t.getAttribute('data-lp')); return; }
    var p = e.target.closest('[data-propose]');
    if (p) { openPropose(p.getAttribute('data-propose')); return; }
    var a = e.target.closest('[data-approve]');
    if (a) { approveProposal(a.getAttribute('data-approve')); return; }
  });

  function settleObligation(callId, lp) {
    apiPost('./api/obligations/' + encodeURIComponent(callId) + '/' + encodeURIComponent(lp) + '/settle', { auditNote: 'manager confirms atomic settle' })
      .then(function (d) { toast('Atomic settle ✓ share ' + esc(d.shareId), true); loadAll(); })
      .catch(function (er) { toast(er.message, false); });
  }
  function openPropose(treasuryId) {
    var amt = window.prompt('Payout amount (whole units):', '1');
    if (amt === null) return;
    apiPost('./api/treasuries/propose', { treasuryId: treasuryId, amountMicro: Number(amt) * 1e6, reason: 'management payout', dest: 'vault1' })
      .then(function () { toast('Proposal created — pending quorum', true); loadAll(); })
      .catch(function (er) { toast(er.message, false); });
  }
  function approveProposal(id) {
    apiPost('./api/treasuries/approve', { proposalId: id })
      .then(function (d) { toast(d.dispatched ? 'Quorum met — payout dispatched ✓' : 'Approval recorded', true); loadAll(); })
      .catch(function (er) { toast(er.message, false); });
  }

  /* ---------- BOOT ---------- */
  // ledger pill reflects real mode
  api('./api/health').then(function (h) {
    var pill = $('ledgerPill');
    var txt = document.createTextNode(' ' + (h.ledger === 'json' ? 'live Canton' : 'demo sim'));
    pill.appendChild(txt);
  }).catch(function () {});
  // gate: try to restore session
  api('./api/me').then(function (u) {
    if (u && u.handle) { enterApp(u); route(); }
    else showGate();
  }).catch(function () { showGate(); });
})();