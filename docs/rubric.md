# CapitalCall — rubric → evidence map (HackCanton S3)

Every judged criterion mapped to the artifact, endpoint, Daml test, or command that proves it.
Honest ⚠️ rows say *"built + previously verified, not re-booted this session"* — never silent claims.

## Track 3 — Investment Infrastructure (fund management / capital coordination)
Judge asks: *real fund/DAO/capital-coordination MVP, role workflows, transparency + auditability + operational logic.*

| Criterion | Where it lives | Evidence |
|---|---|---|
| Capital-coordination MVP (issue capital call → LPs settle → shares) | `daml/CapitalCall/` templates; `backend/src/index.js` `/api/calls`, `/api/funds`, `/api/obligations/:call/:lp/settle` | Live: `https://capitalcall.afterhourequity.xyz/app` (demo: gp1/lp1/lp2/audit1 · pass `pass1234`) |
| **Atomic DvP** (pay ↔ share in ONE tx — no T+1 gap) | `LPObligation.choice Settle` (controls escrow-spend + share-mint) | `daml test`: `test_issue_and_settle: ok, 2 active contracts, 4 transactions` |
| **Role workflows** (GP/LP/auditor see different scopes) | Daml signatory/observer + `backend/src/index.js` role-gated routes | `SimulatedCanton`/real JSON-API: GP & auditor see the book, LP sees only its own obligation (privacy proof) |
| **Configurable privacy** (ledger-enforced per-LP visibility) | Daml disclosure predicate (`LPObligation` observers) + `visibleCalls`/`visibleObligations` | curl: GP sees N obligations, `lp1` sees only its own |
| **Auditability / immutable trail** (create→call→settle→share) | `CallPaymentEscrow`, `LPShare`, `outreach` log; Audit Ledger view | Console view `Audit Ledger` renders every obligation + shareId; `daml test` green |
| **Operational logic** (governed decision-making, no unilateral GP capital movement) | `GovernedTreasury`/`TransferProposal` quorum (BitSafe) | `daml test`: `test_governed_treasury_quorum: ok, 2 active contracts, 3 transactions` |
| One-page business brief (ICP, use case, who pays, why Canton) | `docs/PITCH.md` (problem → ICP → why Canton → GTM → pricing) | `docs/PITCH.md` |

## BitSafe challenge — "Decentralizing Apps on Canton" (Contribution Pool, 20,000 CC)
Judge asks (1–5): relevance · decentralization+originality · working implementation · path beyond hackathon. **"Show the decentralization, don't just claim it."**

| Criterion | Where it lives | Evidence |
|---|---|---|
| Governed treasury (shared approval for sensitive transfers; no single point of failure) | `GovernedTreasury` + `TransferProposal.choice Approve` threshold quorum | `daml test` green (quorum); `POST /api/treasuries/propose` + `/approve` |
| **Reproducible LocalNet demo (Docker+Compose, no node needed)** | `docker/docker-compose.yml` (canton + bootstrap + backend), `daml start` via `digitalasset/daml-sdk:2.10.2` | ⚠️ built + verified in prior session; one command `docker compose -f docker/docker-compose.yml up --build` — re-boot this session gated on box RAM headroom (166 MiB free with 4 live services) |
| "Show the decentralization" — prove threshold/outage behavior | `TransferProposal` accumulates `approvals` until `>= threshold`, then dispatches atomically | `daml test`: quorum test (2 sigs → executed profile) |
| Path beyond hackathon | `docs/ARCHITECTURE.md`, ledger seam `CANTON_LEDGER=sim|json` (swap = real fin-rail, no rewrite) | Seam + runtime party/package discovery in `backend/src/canton.js` |

## Cross-cutting (sponsor thesis)
| Criterion | Where it lives | Evidence |
|---|---|---|
| **"Production workflows, not sandbox demos"** | Full lifecycle: register GP/LP/auditor → create fund → issue call → settle → govern treasury | Live HTTPS product (sim) + real-LocalNet compose for the contribution pool |
| **AI-encouraged axis** | `backend/src/agent.js` — deterministic fund-servicing agent over the live ledger (no external LLM → reproducible & auditable) | `GET /api/agent/overview` (coverage, at-risk, outreach footer), `GET /api/agent/notices` (per-LP own notice), `POST /api/agent/outreach` (persisted dispatch) |
| Sponsor counterfactual | Remove Canton → no atomic DvP (pay/share can land one-sided), no ledger-enforced per-LP privacy, no quorum-governed capital movement. **Remove Canton and the product's core value stops.** | `docs/ARCHITECTURE.md` |

## Not built (honest)
- Live **Decentralized Party on DevNet/MainNet** (BitSafe **Gold**, 30,000 CC): requires a Canton node + application-by-Oct-4 deployment path. Opted for the Contribution Pool (20,000 CC, Docker LocalNet) — no node, 9-day-feasible. Revisit only if node access lands before Oct 9.
- Grofty Wallet (CIP-0103) connect/sign flow: MainNet + invitation-only access — not exercised.