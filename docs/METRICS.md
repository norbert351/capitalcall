# CapitalCall — validation & metrics (honest)

Judging criterion 3 asks for **Metrics / Validation**, with every figure labelled
**observed / estimated / targeted**. This file separates the three so nothing is implied.
Every "observed" row was produced by a command in this repository and can be re-run.

---

## A · Observed (real tool output)

### A1 · Daml contracts & invariants — observed
| Metric | Value | How to reproduce |
|---|---|---|
| Daml modules / LOC | 5 modules · 457 LOC · 9 templates | `wc -l daml/daml/CapitalCall/*.daml` |
| Daml unit tests | **2 / 2 green** | `daml test` → `test_issue_and_settle: ok, 2 active contracts, 4 transactions` · `test_governed_treasury_quorum: ok, 2 active contracts, 3 transactions` |
| Atomic DvP (pay↔share, one tx) | ✓ enforced | `LPObligation.Settle` has `controller obGp, obLp`; asserts escrow key/amount/currency/not-already-paid; archives escrow + mints `LPShare` in the same transaction |
| Quorum gate | ✓ enforced | `TransferProposal.Approve` dispatches only when approvals ≥ threshold |

### A2 · Role enforcement & privacy — observed (live API, this repo's demo data)
Reproduce: log in as the four demo parties (`gp1`/`lp1`/`lp2`/`audit1`, password `pass1234`) and
call `/api/obligations`, `/api/calls`, `/api/funds`.

| Principal | Obligations visible | Calls | Funds |
|---|---|---|---|
| `gp1` (GP) | **2** | 1 | 1 |
| `lp1` (LP) | **1** | 1 | 1 |
| `lp2` (LP) | **1** | 1 | 1 |
| `audit1` (AUDITOR) | **2** | 1 | 1 |

→ **Per-LP privacy is live**: each LP sees only its own obligation while the GP and auditor see
the book. This is the Daml observer model, not an application filter.

| Access control | Observed |
|---|---|
| Unauthenticated → `/api/funds` | **401** |
| `lp1` (LP) → GP-only `/api/agent/overview` | **403** |
| `anon` → static console | 200 (landing is public by design) |

### A3 · Fund-ops state the servicing agent computes — observed
From `GET /api/agent/overview` on the live demo ledger:

| Metric | Value |
|---|---|
| Funds / calls in demo | 1 fund · 1 call (`CALL-50DFDCC3`) |
| Call total / settled / pending | 2,000,000 / 0 / **2,000,000 cBTC** |
| Funding coverage | **0 %** |
| State | `overdue` → flagged **at-risk / underfunded** automatically |
| Outstanding obligations | 2 |

→ The agent correctly derives the operator's question ("what is underfunded, by how much?")
from live ledger state with no manual sweep.

### A4 · Real Canton participant — observed (LocalNet, re-verified 2026-10-03/04)
Against a live `daml start` sandbox via the JSON API (`CANTON_LEDGER=json`): parties
`gp1/lp1/lp2/audit1/vault` allocated; fund create 201; `issueCall` → 2 live `LPObligation`
events; privacy GP 2 / `lp1` 1 / auditor 2; atomic settle `lp1` → share id `…:lp1`,
`liveLedger:true`; treasury quorum (threshold 2) `executed:true` + idempotent re-approve;
package id auto-resolved at runtime.

---

## B · NOT observed (stated explicitly — nothing here is claimed)

- **No user interviews, no design partners, no inbound users.** The ICP in `docs/PITCH.md` is a
  hypothesis.
- **No revenue, no AUM under management, no paid pilot.**
- **No retention or activation data** — no production deployment has any real fund on it.
- **No performance/latency benchmarks** at scale (the demo ledger is small).
- The **demo runs on `SimulatedCanton`** at the public URL; the real-ledger path is verified but
  is not the always-on demo (the Daml LocalNet is booted on demand).
- `web/` (an alternative React UI) is a stub — `docs/` and the working console are the product.

---

## C · Targeted (goals, clearly not results)

| Target | Value | Horizon |
|---|---|---|
| Design-partner funds onboarded | 10 | 90 days |
| Paid pilots | 1 | 90 days |
| **North-star (product KPI):** calls settled before due date | **≥ 90 %** for a pilot fund | first pilot quarter |
| Funding coverage on open calls | ≥ 80 % (the agent's at-risk threshold) | first pilot quarter |
| Activation event | first capital call issued **on-ledger** by a real GP | — |
| Retention | GP returns and issues call #2 within 60 days | — |

---

## D · Validation plan (how the targets get measured)

1. **Instrument the ledger, not a dashboard.** Call issued / obligation settled / share minted
   are contract events, so we can compute *time-to-settle*, *coverage at due date* and
   *% settled before due* directly and immutably — the north-star KPI is measurable by
   construction.
2. **Pilot shape.** 3–5 funds from the ICP, single-fund tier, one live call cycle each. Compare
   time-to-settle and coverage against the same fund's previous email/spreadsheet cycle
   (self-controlled before/after — no fabricated control group).
3. **Read the serving agent's own log as the activation signal.** `POST /api/agent/outreach`
   persists who was chased and when, so "was the agent actually used to close the call?" is
   answerable from data we already store.
4. **Auditor-side validation.** The auditor read-view is verified by the same per-party privacy
   proof as A2 (auditor sees the book; each LP sees only its own).
