// db.js — SQLite (node:sqlite) persistence layer. The ONLY SQL owner.
// Persists the ledger state the SimulatedCanton mirrors in memory, plus
// accounts (native password auth) and sessions (HttpOnly cookie tokens).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.CAPITALCALL_DB || path.join(__dirname, '..', 'data', 'capitalcall.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  handle        TEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('GP','LP','AUDITOR')),
  password_hash TEXT,
  password_salt TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- funds + calls persisted from the ledger mirror
CREATE TABLE IF NOT EXISTS funds (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  currency   TEXT NOT NULL,
  gp         TEXT NOT NULL,
  auditor    TEXT NOT NULL,
  lps        TEXT NOT NULL            -- JSON array of LP handles
);
CREATE TABLE IF NOT EXISTS calls (
  id            TEXT PRIMARY KEY,
  fundId        TEXT NOT NULL,
  gp            TEXT NOT NULL,
  auditor       TEXT NOT NULL,
  currency      TEXT NOT NULL,
  due           INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'CallPending'
);
CREATE TABLE IF NOT EXISTS obligations (
  callId   TEXT NOT NULL,
  lp       TEXT NOT NULL,
  gp       TEXT NOT NULL,
  auditor  TEXT NOT NULL,
  amountMicro INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status   TEXT NOT NULL,
  shareId  TEXT,
  PRIMARY KEY (callId, lp)
);
CREATE TABLE IF NOT EXISTS treasury (
  id         TEXT PRIMARY KEY,
  fundId     TEXT NOT NULL,
  currency   TEXT NOT NULL,
  governors  TEXT NOT NULL,       -- JSON array
  threshold  INTEGER NOT NULL,
  balanceMicro INTEGER NOT NULL,
  vault      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id            TEXT PRIMARY KEY,
  treasuryId    TEXT NOT NULL,
  currency      TEXT NOT NULL,
  governors     TEXT NOT NULL,
  threshold     INTEGER NOT NULL,
  amountMicro   INTEGER NOT NULL,
  dest          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  approvals     TEXT NOT NULL,     -- JSON array
  executed      INTEGER NOT NULL DEFAULT 0
);
`);

const stmts = {};

function getUsers()   { return db.prepare('SELECT * FROM users').all(); }
function userByHandle(h) { return db.prepare('SELECT * FROM users WHERE handle=?').get(h); }
function insertUser(h, role, hash, salt) {
  const r = db.prepare('INSERT INTO users(handle,role,password_hash,password_salt) VALUES(?,?,?,?)').run(h, role, hash, salt)
           .lastInsertRowid; return Number(r);
}
function createSession(token, userId, now, expires) {
  db.prepare('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(token, userId, now, expires);
}
function userByToken(token) {
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                     WHERE s.token=? AND s.expires_at > ?`).get(token, Date.now());
}
function deleteSession(token) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); }

// Ledger persistence helpers
function upsertFund(f) { db.prepare(`INSERT OR REPLACE INTO funds(id,name,currency,gp,auditor,lps) VALUES(?,?,?,?,?,?)`).run(f.id,f.name,f.currency,f.gp,f.auditor,JSON.stringify(f.lps)); }
function getFund(id) { const r=db.prepare('SELECT * FROM funds WHERE id=?').get(id); return r&&Object.assign({},r,{lps:JSON.parse(r.lps)}); }
function listFunds() { return db.prepare('SELECT * FROM funds').all().map(f=>Object.assign({},f,{lps:JSON.parse(f.lps)})); }
function upsertCall(c) { db.prepare(`INSERT OR REPLACE INTO calls(id,fundId,gp,auditor,currency,due,status) VALUES(?,?,?,?,?,?,?)`).run(c.id,c.fundId,c.gp,c.auditor,c.currency,c.due,c.status); }
function getCall(id) { return db.prepare('SELECT * FROM calls WHERE id=?').get(id); }
function listCalls() { return db.prepare('SELECT * FROM calls').all(); }

function upsertObligation(o) { db.prepare(`INSERT OR REPLACE INTO obligations(callId,lp,gp,auditor,amountMicro,currency,status,shareId) VALUES(?,?,?,?,?,?,?,?)`).run(o.callId,o.lp,o.gp,o.auditor,o.amountMicro,o.currency,o.status,o.shareId||null); }
function obligationsForLp(lp) { return db.prepare('SELECT * FROM obligations WHERE lp=?').all(lp); }
function obligation(callId,lp) { return db.prepare('SELECT * FROM obligations WHERE callId=? AND lp=?').get(callId,lp); }
function obligationsForCall(callId) { return db.prepare('SELECT * FROM obligations WHERE callId=?').all(callId); }

function upsertTreasury(t) { db.prepare(`INSERT OR REPLACE INTO treasury(id,fundId,currency,governors,threshold,balanceMicro,vault) VALUES(?,?,?,?,?,?,?)`).run(t.id,t.fundId,t.currency,JSON.stringify(t.governors),t.threshold,t.balanceMicro,t.vault); }
function getTreasury(id) { const r=db.prepare('SELECT * FROM treasury WHERE id=?').get(id); return r&&Object.assign({},r,{governors:JSON.parse(r.governors)}); }
function listTreasuries() { return db.prepare('SELECT * FROM treasury').all().map(t=>Object.assign({},t,{governors:JSON.parse(t.governors)})); }
function upsertProposal(p) { db.prepare(`INSERT OR REPLACE INTO proposals(id,treasuryId,currency,governors,threshold,amountMicro,dest,reason,approvals,executed) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(p.id,p.treasuryId,p.currency,JSON.stringify(p.governors),p.threshold,p.amountMicro,p.dest,p.reason,JSON.stringify(p.approvals),p.executed?1:0); }
function getProposal(id) { const r=db.prepare('SELECT * FROM proposals WHERE id=?').get(id); return r&&Object.assign({},r,{governors:JSON.parse(r.governors),approvals:JSON.parse(r.approvals),executed:!!r.executed}); }
function listProposals() { return db.prepare('SELECT * FROM proposals').all().map(p=>Object.assign({},p,{governors:JSON.parse(p.governors),approvals:JSON.parse(p.approvals),executed:!!p.executed})); }

module.exports = {
  db,
  getUsers, userByHandle, insertUser, createSession, userByToken, deleteSession,
  upsertFund, getFund, listFunds,
  upsertCall, getCall, listCalls,
  upsertObligation, obligationsForLp, obligation, obligationsForCall,
  upsertTreasury, getTreasury, listTreasuries,
  upsertProposal, getProposal, listProposals,
};