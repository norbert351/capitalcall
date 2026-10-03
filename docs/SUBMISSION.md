# CapitalCall — HackCanton S3 submission

**Project:** CapitalCall — *atomic fund operations on Canton*
**Track:** 3 · Investment Infrastructure **+** BitSafe governed-treasury challenge
**Stack:** Daml 2.10 / Canton · Node (zero-dep) · vanilla-JS console · Docker LocalNet
**Demo:** `https://capitalcall.afterhourequity.xyz/` (console: `/app` as **gp1** ; LP view as **lp1**; auditor as **audit1**, password `pass1234`)
**Status:** submission-ready — docs, demo script, verification matrix in `docs/`.
Deadline **Oct 9 2026 23:59 UTC** · Grand Final **Oct 21 2026**.

---

## Elevator pitch (one paragraph, portal-ready)

> Private fund capital is raised on emails and spreadsheets, and LPs miss calls. **CapitalCall**
> puts every capital call and private fund operation on Canton as a **single atomic pay↔issue
> transaction (DvP)**: the LP's token deposit and the GP's share mint are committed to the ledger
> in ONE Daml transaction — no T+1 counterparty gap. Disclosure is **ledger-enforced and
> configurable** (each LP sees only its own obligation; GP and auditor see the book), and capital
> movement is **quorum-governed** so no single GP can move LP money below the approval threshold.
> On top, a **fund-servicing agent** reads the live obligations and tells each LP exactly what they
> owe and when, and flags underfunded calls to the GP automatically.

## Why Canton is load-bearing (sponsor-tech fit)

- **Atomic settlement** is the whole point, and it is *only possible* because `Settle` consumes
  the escrow **and** mints the share in a single multi-party Canton transaction, enforced by
  `capitalcall.dar` on the participant. "Tokenization without atomic settlement is just
  digitization" — Canton is what makes it settlement.
- **Configurable privacy** is officially hard; the Daml disclosure model delivers it for free
  (per-LP obligation visibility), which a naive SQL postgres deployment cannot.
- **Governed treasury (BitSafe)** is a first-class contract: `TransferProposal` accumulates
  `Approvals` until quorum and dispatches atomically — no GP is a single point of failure.

## What was built

**Daml spine** — `Fund`, `LPCommitment`, `CapitalCall` (non-consuming `IssueObligations`),
`LPObligation` (`Settle` dual-control / `Decline`), `CallPaymentEscrow`, `LPShare`,
`GovernedTreasury` (`ProposeTransfer`), `TransferProposal` (`Approve`), `TransferReceipt`.
Both Daml unit tests green (atomic DvP; governed-treasury quorum).

**Backend** — zero-dependency Node REST API speaking to a **real Canton JSON API**
(`CantonJsonApi`) with runtime party + package discovery and in-process HS256 JWT minting,
plus an offline `SimulatedCanton` seam with identical response shapes. Native password auth,
HttpOnly sessions, GP/LP/AUDITOR role-scoped views.

**Product console** — marketing landing + a role-aware console with Dashboard, Funds & Calls,
Treasury, Audit Ledger, and **Servicing Agent** views. Serves under any URL prefix (Caddy).

**Servicing agent** — deterministic asset-servicing layer over the live ledger: per-LP notices
with due-state + action, an 80%-coverage at-risk flag, and an automated outreach queue for the GP.

## Key differentiators

1. Atomic DvP capital call (escrow↔share in one Canton tx).
2. Ledger-enforced per-LP privacy.
3. Quorum-governed treasury (BitSafe).
4. The servicing agent — the "fund that runs itself" automation layer, grounded in real ledged data.

## Verified vs built-out (honest)

- ✅ Exercised live: Daml tests green, auth, console + **Servicing Agent** (at-risk call flagged,
  outreach queued), marketing site, Caddy prefix.
- ⚠️ Real-LocalNet is a one-command boot (`docker compose -f docker/docker-compose.yml up --build`);
  verified end-to-end in the prior session, re-runnable live. Full matrix: `docs/VERIFICATION.md`.

## Deliverables in-repo

`docs/ARCHITECTURE.md` · `docs/AGENT.md` · `docs/DEMO.md` · `docs/VERIFICATION.md` · `docs/SUBMISSION.md` · `docs/rubric.md` (criterion→evidence map) · `docker/{Dockerfile.backend,docker-compose.yml,bootstrap.sh}` · `daml/`

## Repro (for judges)

```bash
docker compose -f docker/docker-compose.yml up --build   # real Canton LocalNet, auto-discovered parties/package
# or offline (VIGIL owns :8080 on the shared VM — capitalcall serves on :8095):
cd backend && PORT=8095 node src/index.js               # ledger=sim
# demo parties: gp1(GP) / lp1 / lp2 (LP) / audit1(AUDITOR) · password: pass1234
```