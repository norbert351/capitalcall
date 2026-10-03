# CapitalCall — the Fund-Servicing Agent

The "AI axis" of the HackCanton pitch, kept honest: the agent is a **deterministic
scoring/decision layer executed over the real on-ledger records**, not a chatbot over a
fake snapshot. Every output it produces traces back to a live obligation or call in the
ledger, so a fund administrator (or a judge) can audit the decision against the source
of truth.

**Why deterministic?** Fund administration is policy, not prose. An 80% funding
threshold, a 72h "approaching" window, and an overdue flag are *rules*, and rules should
be reproducible and auditable. The agent is the productization of those rules over the
ledger. (It slots behind the same endpoint as any LLM later — the interface is
`/api/agent/*` — but the demo never depends on an external service going up.)

## Inputs

Both ledger backends (`SimulatedCanton` and `CantonJsonApi`) mirror every committed
contract into `node:sqlite` (`db.listCalls()`, `db.obligationsForCall(id)`). The agent
reads *that* — the same store the API reports to users — so in `CANTON_LEDGER=json` mode
the agent runs over real Canton state with zero code change.

## Metrics

| Metric | Definition |
|---|---|
| `fundingStats.total` | Σ obligation value across a call |
| `fundingStats.settled` | Σ value of `paid` obligations on that call |
| `coverage ratio` | `settled / total` (a closed/empty call = 1) |
| **at-risk flag** | `ratio < 0.80` on a non-closed call with `total > 0` |
| `due state` | `overdue` (past due) · `approaching` (≤72h) · `due` · `closed` |

## Outputs

### 1. Per-LP notices — `GET /api/agent/notices` (the LP's own)

For each obligation where the authenticated user is the controlling LP:

| due-state | tone | action text |
|---|---|---|
| paid | `settled` | "Share issued — nothing to do." |
| overdue | `overdue` | "Settle now to keep the fund on schedule." |
| ≤72h | `approaching` | "Due within 72h — please settle." |
| else | `due` | "Awaiting settlement by the due date." |

Sorted: outstanding (by amount desc) before settled. Amount surfaced in both micro-units
and human `amount` (÷1e6).

### 2. Manager overview — `GET /api/agent/overview` (GP / AUDITOR)

- `fundingCoverage` — aggregate coverage % across open calls.
- `atRisk` — calls below the 80% coverage target.
- `overdue` — calls in the overdue state.
- `openObligations` — count of unpaid obligations across all calls.
- `footer.notice` — a plain-language outreach status ("1 call(s) below 80% funded —
  outreach queued to the LPs who still owe." / "All open calls are sufficiently funded.").

Drives the **Servicing Agent** view in the console: the *outreach queue* is exactly the
set of LPs whose obligations are unpaid on at-risk calls — generated from the ledger,
not typed by the GP by hand.

## Why this closes the pitch

HackCanton's BitSafe/Track-3 surface asks for infrastructure, and the weakest part of the
capital-call story in practice is **collection follow-up** — the GP is the one manually
chasing LPs. The servicing agent turns that manual loop into an automated, auditable one
built directly on the DvP obligations: it tells each LP *exactly* what they owe and when,
and tells the GP *which* calls are falling below coverage *before* they become a
shortfall. It is the difference between "a ledger that settles" and "a fund that runs
itself."