# CapitalCall — Demo script

Two demo paths. Both end at the same product console; the difference is whether a **real
Canton node** honours the transactions (`CANTON_LEDGER=json`) or the `SimulatedCanton`
mirror does (`CANTON_LEDGER=sim`).

Demo parties: **`gp1`** (GP) · **`lp1`** (LP) · **`audit1`** (AUDITOR) · password **`pass1234`**.

---

## Path A — offline / self-contained (fastest, 30 seconds)

```bash
cd ~/capitalcall/backend
PORT=8080 node src/index.js            # ledger=sim
```

Then open **`http://<host>/app`** (behind Caddy: `http://129.226.83.2/capitalcall/app`).

### The real-ledger path (choosing this for the demo is the stronger pitch)
```bash
docker compose -f docker/docker-compose.yml up --build   # real Canton sandbox, party+package auto-discovered
# backend serves on :8080 in CANTON_LEDGER=json
```

---

## Script (Path A default; identical clicks for Path B)

**1. Sign in as GP.** `gp1` / `pass1234` → **Servicing Agent** nav.

> On a truly empty ledger the agent reports *No notices — nothing outstanding.* To show
> the agent doing real work, seed one underfunded call first (GP → **Funds & Calls** →
> create fund w/ LP `lp1`, issue a call). The agent then flags it *at risk*.

**2. Agent overview (as GP).** Show:
- funding coverage **0%**, **1 call at risk** (`CALL-… — 0% funded · uncovered 1.00 cBTC`),
- Agent action: *"1 call(s) below 80% funded — outreach queued to the LPs who still owe."*

**3. Sign out → sign in as LP (`lp1` / `pass1234`) → Servicing Agent.** The LP's own
**notice** appears: their obligation, amount, due-state and the action (*"Awaiting
settlement by the due date."*). They do **not** see the other LP's obligations.

**4. The atomic settle (dual-control).** GP confirms the LP payment → the LP's escrow is
consumed AND an `LPShare` minted in the **same Canton transaction**. The obligation flips
`CallPending → CallClosed` and the minted share id is shown.

**5. Re-open Agent (as GP).** Coverage is now ≥80%, call leaves the at-risk set →
*"All open calls are sufficiently funded. No outreach required."*

**6. Governed treasury (BitSafe track).** GP → **Treasury** → `ProposeTransfer`
(5,000,000 → guilded). With valid `threshold=2`, a second governor's approval dispatches
atomically and the vault debits (5,000,000 → 4,000,000 in the seeded demo). **A single
GP cannot move capital below the quorum.**

**7. Audit (as `audit1 / pass1234`).** **Audit Ledger** shows the full role-private trail —
GP sees all, auditor sees all, an LP sees only its own.

---

## The three things a judge should leave believing

1. **Atomic DvP** — the LP's token deposit and the GP's share mint land in ONE
   `capitalcall.dar` transaction on Canton. Ethernet-clear lifecycle: pending → *paid with
   minted share id*.
2. **Configurable privacy** — disclosure is enforced by the ledger: each LP sees only its
   own obligation; GP and auditor see the full book.
3. **Governed treasury** — capital movement is quorum-gated in-contract, no single GP can
   move LP money.

## What the agent adds
The **Servicing Agent** view is the automation story on top of all three: it reads the
live obligations and tells each LP exactly what they owe and when, and flags underfunded
calls to the GP automatically — the "fund that runs itself" layer (see `docs/AGENT.md`).