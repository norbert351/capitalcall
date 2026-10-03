# CapitalCall — Architecture

A governed **capital-call / private fund-ops rail** for HackCanton Season 3 (Track 3,
Investment Infrastructure) + the BitSafe governed-treasury challenge. Built on Canton
(Daml 2.10) with a zero-dependency Node backend that speaks to a **real Canton ledger**
through the Daml HTTP JSON API, and an offline `SimulatedCanton` that mirrors the same
contract semantics so the product runs and demos with no ledger attached.

The thesis: **private fund capital is raised on emails + spreadsheets and LPs miss
calls.** Canton turns each call into a *single atomic pay↔issue transaction* (DvP) —
the LP's token deposit and the GP's share mint land in ONE Canton transaction — with
configurable privacy (each LP sees only its own obligation) and a governed treasury
where no single GP can move LP capital below the approval threshold.

---

## 1. Components

```
daml/                     Daml 2.10 contracts (compiled to capitalcall.dar)
backend/                  Node HTTP API + ledger seam
  src/canton.js           ledger seam: SimulatedCanton (offline) | CantonJsonApi (real)
  src/db.js               node:sqlite persistence + party/contract mirror
  src/index.js            zero-dep REST server (auth, role views, DvP settle, treasury, agent)
  src/agent.js            fund-servicing agent (outputs over the live ledger)
backend/public/           marketing landing + role-aware product console (vanilla JS)
docker/                   docker-compose LocalNet: real Canton + demo parties + backend
web/design.md             UI design notes
docs/                     this submission pack
```

## 2. The Daml contract model (the spine)

| Contract | Signatory → observers | Role |
|---|---|---|
| `Fund` | GP → LP roster, auditor | Private fund entity; `AddLp`, `GetRoster` |
| `LPCommitment` | LP (+ GP) | LP's committed capital; `ConfirmCommitment`, `RevokeLP` |
| `CapitalCall` | GP | A draw against the roster; `nonconsuming IssueObligations`, `CloseCall` |
| `LPObligation` | GP → that LP, auditor | **private** per-LP liability; `Settle` (dual-control), `Decline` |
| `CallPaymentEscrow` | payer LP → GP | LP locks tokens for a specific obligation |
| `LPShare` | LP | the asset minted on settlement (the "issued" leg) |
| `GovernedTreasury` | vault → governors | threshold-quorum spend; `Credit`, `ProposeTransfer` |
| `TransferProposal` | proposer → governors | accumulates approvals; `Approve` |
| `TransferReceipt` | — | final executed-payout record |

**Authorisation model (the part that cost the most iteration):** a choice body that
*creates* contracts is stricter than a direct `create`. `submitMulti [a,b] [] (createCmd ...)`
works for two signatories, but adding actAs parties does NOT extend create-authorization
inside a choice body. Consequence:
- **Issuing** an obligation is a single-authority action on the choice controller — the GP
  issues (`LPObligation.signatory = GP` only).
- **Settling** (money movement) is the joint/dual-control action: `Settle` is
  `controller obGp, obLp` (both parties), invoked with a dual `actAs:[GP,LP]` token.

This is both Daml-correct **and** the right fund semantics — a GP must be able to issue a
call, but can never move an LP's money alone.

**Atomic DvP settle.** `LPObligation.Settle` takes the `CallPaymentEscrow` as an argument:
fetch the escrow → assert it matches THIS obligation (key, amount, currency, still
`CallPending`) → `create LPShare` → `archive escrow` → return `(shareCid, SettledOk)`.
Neither leg can land without the other. This is the answer to *"tokenization without
atomic settlement is just digitization"* — the escrow spend and the share mint commit in
one transaction, executed on the participant by `capitalcall.dar`.

## 3. The ledger seam (one interface, two backends)

`src/canton.js` exposes two classes behind `getLedger()`:

- **`SimulatedCanton`** (`CANTON_LEDGER=sim`, default) — an in-memory mirror that
  replicates the disclosure predicate (GP/auditor see all, an LP sees ONLY its own —
  the privacy rail) and the settle/quorum guards, persisted via `node:sqlite`. No Canton
  needed; deterministic, reproducible demo.
- **`CantonJsonApi`** (`CANTON_LEDGER=json`) — a **real** Daml JSON-API client. Each
  method (`createFund / issueCall / settle / createTreasury / propose / approve`) awaits a
  real `POST /v1/create`, `POST /v1/exercise`, or `GET /v1/query`. Both backends emit
  **identical response shapes**, so the frontend ships ONE contract.

The JSON-API integration solves the real-LocalNet pain points:
- **JWT auth** — minted in-process (HS256, `secret`), claims under
  `https://daml.com/ledger-api` with `ledgerId:"sandbox"`, `actAs`/`readAs`/`admin`.
- **Party + package discovery** — opaque `Hint::<namespaceHash>` party ids and the
  64-hex package id both change on ledger restart, so nothing is hardcoded: `bootParties()`
  reads `/v1/parties`, `packageId()` reads `/v1/packages` and probes the template, both
  cached after first resolve.
- **Multi-party commands** — the atomic `Settle` is exercised with ONE token whose
  `actAs:[GP,LP]`, so escrow-spend + share-mint commit in a single Canton transaction.

## 4. Backend + auth

Zero-dependency Node (HTTP server + `node:sqlite`), no frameworks, no build step. Native
password auth (scrypt hash + salt), `HttpOnly` `cc_sess` session cookie. Three roles —
`GP`, `LP`, `AUDITOR` — gate every route. Role-scoped views are applied server-side;
the frontend never fetches data it cannot see.

Routes: `register / login / logout / me`, `funds` (create/list), `calls`
(issue/visible), `obligations` (role-private), **`POST /obligations/:call/:lp/settle`**
(GP-confirmed, DvP), treasuries (create/list), `treasuries/propose`, `treasuries/approve`,
`treasuries/proposals`, plus the **servicing agent** endpoints in §5.

## 5. The servicing agent (`src/agent.js`)

A grounded, deterministic fund-administration layer that reads the **live ledered
records** (the same sqlite mirror both backends write after every commit) and produces the
maintenance outputs a fund admin needs — **no external LLM call**, so the demo is
reproducible and every output is auditable against the ledger:

- **LP notices** — per-LP plain-language notice of what they owe, its call, amount, and
  due-state (`due / approaching / overdue / settled`), each with a prescribed action.
- **Underfunded-call flagging** — a call is flagged *at risk* when remaining unpaid
  obligations place it below `COVERAGE_TARGET` (80%) of the drawn total.
- **Manager overview** — funding coverage %, calls at risk, overdue count, open
  obligations, and a queued-outreach footer.

Endpoints: `GET /api/agent/overview` (GP/AUDITOR), `GET /api/agent/notices` (the LP's own).
Full design: `docs/AGENT.md`. **Verified live** (see `docs/VERIFICATION.md`).

## 6. UI

- **Marketing landing** (`backend/public/index.html`) — the pitch site (atomic DvP,
  governed treasury, configurable privacy).
- **Product console** (`backend/public/app.html`) — role-aware SPA with five views:
  **Dashboard, Funds & Calls, Treasury, Audit Ledger, Servicing Agent.** Relative asset/API
  paths so it serves under any URL prefix (Caddy `handle_path /capitalcall/` and root).

## 7. Run it

```bash
# offline demo (no Canton)
cd backend && PORT=8080 node src/index.js        # ledger=sim

# real Canton LocalNet (docker)
docker compose -f docker/docker-compose.yml up --build   # ledger=json, party+package auto-discovered
```

Demo parties: `gp1` / `lp1` / `audit1` · password `pass1234`.