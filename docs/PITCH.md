# CapitalCall — one-page business brief

*HackCanton Season 3 · Track 3 (Investment Infrastructure) · written for the judging
criteria: Value/Problem (1), ICP (2), Metrics (3), GTM (4).*

---

## 1 · Problem

A private fund capital call is a **payment for a share**. Today that trade is split across
two systems and two days: the LP wires the money (bank, T+1 or worse) and the GP's fund
admin later mints/records the LP's share. Between those two moments there is a
**counterparty gap** — the LP's cash has left and their stake does not exist yet — and the
reconciliation runs on **email + spreadsheets**:

- **LPs miss calls.** There is no single authoritative notice of what an LP owes, when, and
  what state it is in; a missed call is discovered late, after the due date.
- **The GP has no coverage view.** Nobody can answer "which calls are underfunded right now,
  and by how much?" without a manual sweep.
- **Disclosure is all-or-nothing.** Sharing the capital-call book with every LP leaks the
  whole cap table; keeping it private makes verification manual.
- **Capital movement is unilateral.** Once the money is in, a single GP signatory can move
  it. Governance is a policy document, not an enforced control.
- **The audit trail is reconstructive.** The auditor rebuilds what happened from statements
  rather than reading an immutable record.

**Why existing solutions fall short.** Fund-admin SaaS and cap-table tools digitise the
*record*, not the *settlement*: they still sit on top of a T+1 payment rail, so the
counterparty gap remains, and privacy is enforced by the vendor's application code (and its
admins) rather than by the ledger. A database cannot make "pay" and "issue" **one atomic
event**, and it cannot enforce per-LP disclosure as a property of the data model.

## 2 · ICP (concrete segment)

**Primary — emerging private-fund managers (GPs) running tokenised/crypto-native vehicles of
$5M–$100M with 10–100 LPs.** Typically 2–10 people, no in-house fund administrator, already
comfortable with on-chain rails, and currently running calls on email + spreadsheets. Risk
appetite: operational-integrity focused (they are the ones personally exposed to a missed
call). Capital size: $5M–$100M AUM (below the tier where a bank fund-admin relationship is
worth it). Frequency: **4–12 capital calls per fund per year**, plus treasury movements.

**Secondary — their LPs** (family offices / HNW crypto-native investors) who want an
authoritative notice and a proof-of-holding, and **their auditors / fund admins**, who need
a read-only, immutable view of the whole book.

**Who pays:** the **GP** — they bear the cost of a missed call and of manual reconciliation
today. (A per-fund subscription; see GTM.)

*Honest label: this ICP is a **hypothesis** from the team's domain research, not yet
validated with customer interviews. See `docs/METRICS.md` for what is observed vs targeted.*

**Primary use case (one sentence):** a GP issues a capital call to 20 LPs; each LP settles
their slice as an atomic pay↔share transaction with the obligation private to them; the GP
sees coverage and at-risk calls in one view; every step is an immutable, auditor-readable
ledger transaction.

## 3 · Why Canton is load-bearing

Remove Canton and the product's core value stops:

- **Atomic DvP** — `Settle` consumes the LP's escrow **and** mints `LPShare` in ONE
  multi-party transaction. That is only possible because both are contracts on the same
  ledger; a bank rail cannot do it, and a database can only *pretend* it did.
- **Ledger-enforced privacy** — per-LP disclosure is the Daml signatory/observer model
  (`LPObligation` is signed by the GP and observed by that LP + the auditor), not an
  application filter that an admin could bypass.
- **Quorum-governed capital** — `TransferProposal` accumulates approvals until the threshold
  and dispatches atomically; no single GP key moves LP capital below the threshold.

## 4 · GTM

**Wedge:** the atomic capital call. It is a narrow, high-pain, recurring operation that the
GP already performs — and it is the operation Canton does uniquely well.

**Motion (targeted, not yet run):**
1. **Land** — free single-fund tier; onboard via the servicing agent (the agent computes what
   each LP owes and chases them), so the product is useful on day one.
2. **Expand** — multi-fund + treasury governance; the auditor read-view is the wedge into the
   fund's professional ecosystem (auditors bring the next fund).
3. **Channels** — Canton-ecosystem integrators/BitSafe, crypto fund administrators, and
   tokenisation platforms that need a fund-ops layer for their issuers.

**Retention hook:** the GP's own operational KPI — **% of calls settled before the due date**
— which the ledger measures natively and which the servicing agent actively improves.

**Pricing (targeted, unvalidated):** per-fund subscription sized to the fund's LP count, plus
a per-call settlement fee; treasury governance included as the retention layer.

## 5 · Beyond the hackathon

`CANTON_LEDGER=sim|json` is a single seam: the same product runs against the offline simulator
for local dev/demo and against a **real Canton participant** for production, with parties and
package IDs discovered at runtime. Going live is a configuration change, not a rewrite.
