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
backend/               Node HTTP API + REAL Canton JSON-API client (CantonJsonApi)
  src/canton.js        ledger seam: SimulatedCanton (offline) OR real Canton via /v1/create,/v1/exercise,/v1/query
  src/index.js         zero-dep REST server (auth, role-scoped views, DvP settle, treasury)
  src/db.js            node:sqlite persistence + party mirror
docker/                docker-compose LocalNet: real Canton node + demo parties + backend
  Dockerfile.backend   node:22 zero-dep backend image
  bootstrap.sh         dev helper: boots `daml start`, allocates demo parties
web/                   React role UI (GP / LP / auditor)  [next milestone]
docs/                  submission pack, demo script, verified-vs-unverified matrix
```

## Daml model (the spine)
- `Fund` — private fund entity, GP signatory, LP + auditor observers
- `CapitalCall` — GP issues a call against the LP roster (GP is signatory)
- `LPObligation` — per-LP obligation; **private** to that LP + GP + auditor
- `CallPaymentEscrow` — LP locks tokens for a specific obligation
- `Settle` — dual-control (GP+LP) choice: consumes escrow AND mints `LPShare` atomically
- `GovernedTreasury` — threshold-quorum spend (BitSafe "governed treasury")
- `TransferProposal` / `TransferReceipt` — no single GP moves capital below threshold

## Verify the core (Daml unit tests)
Requires Docker (this VM: no system Java — Daml compiles in-container), or any JDK 17 box:
```bash
cd daml
docker run --rm -v "$PWD":/home/daml/work -w /home/daml/work \
  digitalasset/daml-sdk:2.10.2 daml test
```
Both tests green: `test_issue_and_settle` (atomic DvP) and `test_governed_treasury_quorum`.

## Run against a REAL Canton ledger (LocalNet)
The backend speaks to a **live Canton node** through the Daml HTTP JSON API. One command:
```bash
docker compose -f docker/docker-compose.yml up --build
```
This boots a real Canton sandbox (`daml start`), provisions the demo parties
(GP / LP1 / LP2 / AUDIT / VAULT) deterministically, and serves the API on `:8080`
in `CANTON_LEDGER=json` mode. Party + package IDs are **discovered at runtime**
from `/v1/parties` and `/v1/packages`, so they survive a ledger restart.

To run in **offline / self-contained** mode (no Canton needed), use the
`SimulatedCanton` seam — identical contract semantics, no ledger:
```bash
cd backend && PORT=8080 node src/index.js   # defaults to ledger=sim
```

## Verified end-to-end on the real ledger
Driven via the API against a live Canton node:
- **Atomic DvP settle** — LP escrow + GP share mint land in ONE multi-party Canton tx (`liveLedger=true`)
- **Pending→Closed lifecycle** — settled obligations show their minted share id
- **Ledger-enforced privacy** — LP1 sees only its obligation, LP2 only its own, auditor sees all
- **Governed-treasury quorum** — 1/2 approvals does NOT dispatch; the 2nd authority approval
  dispatches atomically and the treasury balance debits (5,000,000 → 4,000,000 in the demo)

Each of these is a real Canton transaction enforced by `capitalcall.dar` on the participant.

## Dates
Submission **Oct 9 2026 23:59 UTC** · Grand Final Oct 21 2026.