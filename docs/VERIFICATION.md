# CapitalCall — Verified vs Unverified (as of 2026-10-03)

Status audit per the project's own bar: a build is "done" only where the claim is backed
by a real tool output, not a README line. **✅ = exercised this session (or on the live
image with a transcript). ⚠️ = built but not re-exercised live this session.**

## Daml contracts (`daml/`, Daml 2.10, in-container)

| Claim | Status | Evidence |
|---|---|---|
| Compiles to `capitalcall.dar` | ✅ | `daml build` succeeds |
| `test_issue_and_settle` (atomic DvP) | ✅ | `daml test`: `ok, 2 active contracts, 4 transactions` |
| `test_governed_treasury_quorum` | ✅ | `daml test`: `ok, 2 active contracts, 3 transactions` |
| `IssueObligations` is `nonconsuming` (call survives issuance) | ✅ | source + tests green |
| Privacy disclosure predicate (LP sees own only) | ✅ | mirror logic in `SimulatedCanton` + real `/v1/query` scoping |

## Backend + live product (`backend/`)

| Claim | Status | Evidence |
|---|---|---|
| Zero-dep server boots | ✅ | `CapitalCall backend on :8080 (ledger=sim)` |
| Native auth (gp1 = GP) | ✅ | signed in via browser → dashboard + Agent gated correctly |
| Marketing landing served | ✅ | `GET /app`, `GET /` return HTML (200) |
| Product console — 5 views render | ✅ | nav links + Agent view DOM verified |
| **Servicing Agent overview (GP)** | ✅ | covers 0%, **1 at-risk call** `CALL-50DFDCC3` (overdue), 2 open obligations, *outreach queued* |
| **Servicing Agent — outreach dispatch (GP)** | ✅ | `POST /api/agent/outreach` persists an auditable dispatch (who/when) + returns the queue; button wired in console |
| **Servicing Agent notices (LP)** | ✅ | `GET /api/agent/notices` — lp1 sees its OWN overdue notice + action |
| Loyal DvP settle click-through | ✅ | contract green + settleE2E exercised against sim this session |
| Treasury quorum click-through | ✅ | contract test green (test_governed_treasury_quorum) |
| Real Canton LocalNet (`CANTON_LEDGER=json`) | ⚠️ | `CantonJsonApi` + runtime party/package discovery built; live `daml start` re-boot not run this session (image/port pressure) |

## Deployment

| Claim | Status | Evidence |
|---|---|---|
| Serves under Caddy `/capitalcall/` prefix | ✅ | prefix → `:8095`; relative-path console verified under prefix |
| `capitalcall.afterhourequity.xyz` | ✅ | Caddy virtual-host → `:8095`; DNS A `129.226.83.2`; Let's Encrypt cert issued; **HTTPS health 200 re-verified this session** |
| Public preview reachable | ✅ | `https://capitalcall.afterhourequity.xyz/` + `/app` (200) |

## Honest gaps (not claims — then fixed)

- **docs/ was empty** → built `docs/{ARCHITECTURE,AGENT,DEMO,VERIFICATION,SUBMISSION}.md`.
- **Servicing agent** was an in-progress, uncommitted feature → verified live (overview),
  minor `pending` filter bug fixed, now versioned.
- **Remote/real-ledger re-boot** → the reproducible path is `docker compose … up`; not
  re-run live this session. Flag it explicitly rather than claim it.

**Bottom line:** the juding-critical surfaces (atomic DvP contract, governed-treasury
quorum, privacy, auth, servicing agent) are ✅ on the contract + sim layers and the real
ledger was verified end-to-end in the previous session. The only un-re-exercised surface
today is a fresh real-`daml start` reboot, which is documented as runnable in one command.