# CapitalCall — atomic fund operations on Canton

A governed **capital-call / private fund-ops rail** for HackCanton Season 3, Track 3
(Investment Infrastructure) + the BitSafe governed-treasury challenge.

**Thesis:** private fund capital is raised on emails + spreadsheets and LPs miss calls.
Canton makes each call a **single atomic pay↔issue transaction** (DvP): the LP's token
deposit and the GP's share mint land in ONE Daml transaction — no T+1 counterparty gap —
with configurable privacy (each LP sees only its own obligation) and a **governed
treasury** where no single GP can move LP capital below the approval threshold.

## Repo layout
```
daml/                  Daml 2.10 contracts (Types, Fund, Call, Governance, Test)
  capitalcall.dar      compiled package
backend/               Node HTTP API (role routes + SimulatedCanton ledger seam)
web/                   React role UI (GP / LP / auditor)
docker/                docker-compose LocalNet (BitSafe Contribution Pool demo)
docs/                  submission pack, demo script, verified-vs-unverified matrix
```

## Daml model (the spine)
- `CapitalCall` — GP issues a call against the LP roster (GP is signatory)
- `LPObligation` — per-LP obligation; **private** to that LP + GP + auditor
- `CallPaymentEscrow` — LP locks tokens for a specific obligation
- `Settle` — dual-control choice: consumes escrow AND mints `LPShare` **atomically**
- `GovernedTreasury` — threshold-quorum spend (BitSafe "governed treasury")
- `TransferProposal` / `TransferReceipt` — no single GP moves capital below threshold

## Verify the core
Requires Docker (the VM has Docker 29 + compose, no local Java — Daml compiles in-container):
```bash
cd daml
docker run --rm -v "$PWD":/home/daml/work -w /home/daml/work \
  digitalasset/daml-sdk:2.10.2 daml test
```
Both tests green: `test_issue_and_settle` (atomic DvP) and `test_governed_treasury_quorum`.

## Dates
Submission **Oct 9 2026 23:59 UTC** · Grand Final Oct 21 2026.