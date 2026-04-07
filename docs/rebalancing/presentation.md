# Interview Walkthrough — Morpho V2 Rebalancing Bot

> A backend-only bot that automates allocation rebalancing for a **Morpho Vault V2**, optimising yield across Morpho Blue markets on Ethereum mainnet.
>
> Conceptual overview lives in the main sections; deep code references (file paths, line numbers, function names) live in the [Annexe](#annexe--code-deep-dive).

---

## 1. The Problem

Solo DeFi vault operators managing a Morpho Vault V2 have to:

1. Watch multiple Morpho Blue markets to track shifting borrow demand and supply APYs.
2. Compute an optimal allocation that respects per-market caps and risk constraints.
3. Manually push `allocate` / `deallocate` transactions through the Curator UI.

By the time a human notices a rate shift and acts, the optimal window is gone. The bot replaces that loop with an **always-on, configurable rebalancing engine**: read on-chain → compute optimal allocation → execute → notify.

---

## 2. High-Level Architecture

The bot is a **single Fastify process** running on Bun. Internally it follows a strict **service-oriented layered architecture** with dependency injection.

```
┌──────────────────────────── Fastify (HTTP) ────────────────────────────┐
│                                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐      │
│  │ health plugin│   │  api plugin  │   │   scheduler plugin      │      │
│  │ GET /health  │   │ /api/v1/...  │   │ croner cron tick → run()│      │
│  └──────┬───────┘   └──────┬───────┘   └─────────────┬───────────┘      │
│         │                  │                         │                  │
│         └──────────────────┴────────┬────────────────┘                  │
│                                     ▼                                   │
│                       ┌──────────────────────────┐                      │
│                       │     RebalanceService     │  ← orchestrator      │
│                       │  read → compute → exec   │                      │
│                       │       → notify           │                      │
│                       └─┬────────┬────────┬────┬─┘                      │
│                         │        │        │    │                        │
│           ┌─────────────┘        │        │    └────────────┐           │
│           ▼                      ▼        ▼                 ▼           │
│   ┌──────────────┐      ┌─────────────┐ ┌───────────┐ ┌────────────┐    │
│   │ VaultReader  │      │MorphoReader │ │ Executor  │ │  Notifier  │    │
│   │ vault state  │      │ market+IRM  │ │ tx submit │ │ Telegram   │    │
│   │  (chain rd)  │      │  (chain rd) │ │ (chain wr)│ │ alerts     │    │
│   └──────────────┘      └─────────────┘ └─────┬─────┘ └────────────┘    │
│                                               │                         │
│                       ┌───────────────────────┴───────────┐             │
│                       │       Strategy Engine (PURE)      │             │
│                       │  irm.ts → strategy.ts → engine.ts │             │
│                       │  no async / no RPC / no I/O       │             │
│                       └───────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Layering rules

| Layer | Responsibility | What it CAN'T do |
|---|---|---|
| **Plugins** (`src/plugins/`) | HTTP routing, cron registration | No business logic, no chain reads |
| **Services** (`src/services/`) | Orchestration of the rebalance flow | No on-chain calls of its own (delegates to readers/executor) |
| **Core / Strategy** (`src/core/rebalancer/`) | Pure scoring, delta math, IRM simulation | No `await`, no RPC, no side effects |
| **Core / Chain** (`src/core/chain/`) | viem clients, multicall reads, tx submission | No business decisions about WHAT to allocate |
| **Notifier** (`src/services/notifier.ts`) | Telegram alerts | Must never block rebalancing — fire-and-forget |

This is a textbook **SOLID** layout:

- **S** — Each module has one reason to change (`VaultReader` reads vault, `MorphoReader` reads markets, `Strategy` decides, `Executor` submits).
- **O** — New scoring factors plug into `computeScore` without modifying `computeRebalance`.
- **L** — `Executor` and `DryRunExecutor` both implement `IExecutor`; the service can't tell which it has.
- **I** — `VaultReader` and `MorphoReader` are split so consumers depend on only what they need.
- **D** — `RebalanceService` receives every dependency via constructor injection (see [src/index.ts](../../src/index.ts)).

---

## 3. The Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Native TypeScript, fast cold start |
| Framework | **Fastify** | Plugin system, JSON-schema validation, Pino logging |
| Chain | **viem** + `@morpho-org/blue-sdk` | Type-safe, modern, native EIP-1559 |
| Scheduler | **croner** | Lightweight cron for Bun, no Redis |
| Config | **zod** | Runtime validation of env vars |
| Logging | **Pino** | JSON, zero-overhead |
| Telegram | **Direct Bot API via fetch** | One endpoint — no SDK needed |
| Tests | **Vitest + Anvil** | Unit + forked-mainnet integration |
| DB | **None** | Blockchain *is* the database in v1 |

---

## 4. End-to-End Rebalance Flow

A single cycle is the heart of the bot. It runs every `CRON_SCHEDULE` tick (default `*/5 * * * *`), or on demand via `POST /api/v1/rebalance`.

```
┌─────────────┐
│  cron tick  │  croner fires every CRON_SCHEDULE tick
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ RebalanceService│  isRunning lock — skip if previous cycle still in flight
│     .run()      │
└──────┬──────────┘
       │
       ▼  ──── READ ────
┌─────────────────────────────────────┐
│ VaultReader.readFullState()         │  multicall snapshot of:
│  - totalAssets                      │   • vault.totalAssets()
│  - per market: allocation + 3 caps  │   • vault.allocation(id[2])
│                                     │   • vault.absoluteCap(id[0..2])
│                                     │   • vault.relativeCap(id[0..2])
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ MorphoReader.readMarketsFor...()    │  per market on Morpho Blue:
│  - totalSupply, totalBorrow         │   • morpho.market(id)
│  - utilization, available liquidity │   • morpho.idToMarketParams(id)
│  - borrowRate from IRM              │   • IRM.borrowRateView(...)
└──────┬──────────────────────────────┘
       │
       ▼  ──── COMPUTE (PURE) ────
┌─────────────────────────────────────┐
│ engine.computeRebalanceActions()    │  no async, no I/O
│  → strategy.computeRebalance()      │
│      1. score each market           │
│      2. proportional targets        │
│      3. enforce caps                │
│      4. delta vs current            │
│      5. drift filter                │
│      6. order: deallocates first    │
└──────┬──────────────────────────────┘
       │  RebalanceAction[]
       ▼  ──── EXECUTE ────
┌─────────────────────────────────────┐
│ Executor.execute()                  │
│  1. gas ceiling check (skip if hi)  │
│  2. if DRY_RUN → log only           │
│  3. for each action sequentially:   │
│       writeContract(allocate /      │
│         deallocate, 3 args)         │
│       waitForTransactionReceipt()   │
│       on revert → stop, return      │
└──────┬──────────────────────────────┘
       │
       ▼  ──── NOTIFY (fire-and-forget) ────
┌─────────────────────────────────────┐
│ Notifier.notifyRebalanceSuccess()   │  Telegram Markdown message
│  (or notifyRebalanceFailed)         │  cooldown per alert type (15min)
└─────────────────────────────────────┘
```

### Key invariants

- **Single-flight cycle** — `isRunning` flag in [rebalance.service.ts](../../src/services/rebalance.service.ts) means cron + manual trigger can never overlap.
- **Deallocates always before allocates** — overweight markets free up the idle pool first, then underweight markets pull from it.
- **Error boundaries per phase** — RPC failure aborts the cycle but does not crash the bot. Telegram failure logs locally and continues. Tx revert stops execution immediately and alerts.
- **Multicall snapshots** — every read uses `allowFailure: false` so we always get a consistent block snapshot or no state at all.
- **Re-read after execute** — after submitting txs, the service re-reads the vault state to populate `newAllocations` accurately for the API + Telegram message.

---

## 5. Strategy: How the Rebalance Decision is Made

> This is the part the interviewer will probe hardest. It lives in the **pure** strategy layer — no chain calls, no async, fully unit-testable.

The strategy answers two questions, in order:

1. **What is each market worth right now?** → `computeScore(market)` returns a single risk-adjusted yield number.
2. **Given those scores, what should each market hold?** → proportional target allocation, then clamp to caps, then filter by drift threshold.

### 5.1 Scoring formula (the *what*)

For each managed market the bot computes a single floating-point score:

```
score = projected_APY × liquidity_safety_factor × (1 − concentration_penalty)
```

| Component | Meaning | Range |
|---|---|---|
| `projected_APY` | The supply APY **after** the proposed allocation delta is applied (not the current APY). Computed off-chain via `irm.ts` using the linear-kink IRM formula. | `[0, ∞)` |
| `liquidity_safety_factor` | `min(1, available_liquidity / (minLiquidityMultiplier × allocation))` — penalises markets that don't have at least `2×` the proposed allocation in spare liquidity (so the bot can always exit). | `[0, 1]` |
| `concentration_penalty` | `max(0, allocation/total_supply − maxMarketConcentrationPct/100)` — penalises being more than 10% of a market's total supply (i.e. the bot would move the rate against itself). | `[0, ~1)` |

If `projected_APY ≤ 0`, the score is forced to `0` and the market gets nothing new.

### 5.2 IRM simulation (the *how*)

The bot uses a **hybrid IRM** approach: parameters read from chain, projections computed in TypeScript.

The Morpho Blue IRM is a **two-segment linear kink model**:

```
                 borrow rate
                      │
                      │           ╱   ← slope2 (steep)
                      │          ╱
                base + slope1 ───●  ← kink (optimal utilization, ~90%)
                      │        ╱
                      │      ╱      ← slope1 (gentle)
                base ─●────╱
                      │  ╱
                      │╱
                      └──────────────── utilization
                      0%    optU      100%
```

For utilization `u`:

- **Below kink:** `rate = baseRate + (u × slope1 / optU)`
- **Above kink:** `rate = baseRate + slope1 + ((u − optU) × slope2 / (WAD − optU))`

The strategy then projects:

```
newSupply      = currentSupply + supplyDelta            // delta may be negative
newUtilization = currentBorrow × WAD / newSupply        // clamped to [0, WAD]
borrowRate     = computeBorrowRate(params, newUtil)
supplyRate     = borrowRate × newUtilization / WAD      // per second, WAD-scaled
APY            = (1 + supplyRatePerSecond)^secondsPerYear − 1
```

The compounding step matches Morpho Blue's per-second accrual exactly.

> ⚠️ **Honest caveat:** the on-chain `AdaptiveCurveIRM` does **not** expose individual slope/kink getters — it only has `borrowRateView(marketParams, market)`. So `MorphoReader.deriveIRMParams()` actually approximates `slope1`, `slope2`, and `optimalUtilization` from a single `borrowRateView` sample. This is the **biggest known weakness** of the strategy and the first thing to harden for production (see § 7).

### 5.3 Target allocation, cap clamping, and drift filtering

```
1. score every market         → Map<i, number>
2. totalScore = Σ scores
3. rawTarget[i] = totalAssets × score[i] / totalScore
   (if totalScore = 0, distribute equally as fallback)
4. capped[i] = min over all 3 cap ids of:
        absoluteCap[id]
        totalAssets × relativeCap[id] / WAD     (if relativeCap ≠ WAD)
5. delta[i] = capped[i] − current[i]
6. drop markets where |delta[i]| / totalAssets ≤ DRIFT_THRESHOLD_BPS
7. emit deallocate actions first, then allocate actions
```

A few subtleties:

- **3 cap ids per market.** Vault V2 has an *adapter-wide* cap, a *collateral-token* cap, and a *market-specific* cap. The most restrictive of the three wins. The bot computes the keccak preimages itself in TypeScript and asserts at startup that they match `adapter.ids(marketParams)` exactly — if they don't, the bot refuses to start.
- **`relativeCap` is in WAD, not BPS.** This is the most dangerous gotcha in the codebase: `WAD` (`1e18`) is the sentinel for "no relative cap"; `0n` means "this market is forbidden". The bot fails-fast at startup if any managed market has `relativeCap == 0n`, and defensively clamps to `0` even if it slips through.
- **Forbidden-market exception to drift filtering.** If a market gets `relativeCap == 0` after the bot has already allocated to it, the strategy emits a `deallocate` action regardless of the drift threshold — the goal is to drain it.
- **Drift threshold** is in basis points of total assets, defaulting to `500` (5%). Below that, the cycle is a no-op.

---

## 6. Security & Secret Handling

Security is layered across three concerns: secrets, gas, and on-chain invariants.

### 6.1 Secrets

| Secret | Where it lives | Protection |
|---|---|---|
| `PRIVATE_KEY` | env var only | Listed in `SENSITIVE_FIELDS` in [env.ts](../../src/config/env.ts); `safeConfig()` redacts it before any startup log. Never written to disk. |
| `TELEGRAM_BOT_TOKEN` | env var only | Same redaction list. Token is interpolated only at the moment of `fetch()` — never logged in the URL. |
| `RPC_URL` | env var only | **Also** redacted, because Infura/Alchemy URLs embed the API key as a path segment (`/v3/<KEY>`), so leaking the URL leaks the key. |

### 6.2 Error sanitisation

Every error message that could possibly cross a boundary (logs, Telegram, Fastify response) goes through a sanitisation step that:

- replaces any `https?://...` substring with `[URL_REDACTED]`
- replaces any `0x[a-f0-9]{20+}` substring with `[HEX_REDACTED]` (catches private-key fragments and long hex blobs)
- strips stack-trace lines
- truncates to 200 chars for Telegram readability

This logic is duplicated in three places (intentional defence-in-depth): the startup error handler in `index.ts`, the READ error path in `rebalance.service.ts`, and the Notifier's `sanitiseErrorMessage`.

### 6.3 Gas safety

- **EIP-1559 only.** viem's `writeContract` uses `maxFeePerGas` natively.
- **Hard ceiling.** Before submitting any tx, `Executor.execute()` reads the current gas price and aborts the entire cycle (returning a `"gas ceiling exceeded"` reason) if it exceeds `GAS_CEILING_GWEI`. Default: `50` gwei.
- **Sequential submission.** Transactions go out one at a time and the bot waits for each receipt before the next, so a single revert can never leave half a rebalance hanging in the mempool.
- **Stop-on-revert.** Any reverted receipt aborts the rest of the cycle, returns a partial `RebalanceResult`, and triggers a Telegram failure alert.

### 6.4 On-chain invariants asserted at startup

`VaultReader.assertStartupInvariants()` runs **before** the Fastify server even starts listening. If any check fails, the process refuses to boot — much safer than discovering a misconfiguration mid-flight.

The checks, in order:

1. The configured `ADAPTER_ADDRESS` is enumerated in `vault.adapters(0..n)`.
2. `adapter.parentVault() == VAULT_ADDRESS` (the adapter actually belongs to this vault).
3. `vault.isAllocator(botWallet) == true` (the bot's wallet has the role).
4. **For each managed market,** the 3 cap-id keccak preimages computed locally exactly match `adapter.ids(marketParams)`. This is a defence against a typo in the ABI encoding silently routing allocations to a cap of `0` and reverting.
5. **No `relativeCap == 0`** on any cap id of any managed market — fail-fast with an explicit error naming the offending market and id.
6. Markets where `absoluteCap == 0` on any id are *not* fatal — they're logged and excluded from the active set (the operator just hasn't set the cap yet).

### 6.5 Other security rules

- API endpoints have no authentication in v1 — assumed to run on a private network with a single operator. Auth is a v2 candidate.
- Health check makes **zero** RPC calls and must respond in `< 50 ms` (it only reads in-memory state).
- No `eval()`, no dynamic code execution anywhere.
- `console.warn` for diagnostics only — production logging is structured Pino via Fastify.

---

## 7. What's Missing for Production + Evolution to Event-Driven

The current bot is intentionally a **v1 demo**: simple, auditable, and tightly scoped. Several things should change before it manages real money.

### 7.1 Strategy hardening

| Gap | Why it matters | Fix |
|---|---|---|
| **IRM params are approximated from one sample** | `deriveIRMParams` in `morpho.ts` guesses `slope1`, `slope2`, and `optimalUtilization` from a single `borrowRateView` reading. Projected APYs can be significantly wrong. | Either: (a) sample `borrowRateView` at multiple synthetic utilization points and back-solve the curve, or (b) replicate the on-chain `AdaptiveCurveIRM` math in TypeScript using its public constants. |
| **Scoring uses current allocation as the candidate** | `computeRebalance` scores each market with `marketState.allocation`, not the *proposed* target. This makes the optimisation a fixed-point step, not a true optimum. | Solve a constrained optimisation (e.g. iterative water-filling): allocate small chunks of capital to the highest-marginal-APY market until depleted. |
| **Pure proportional split** | Targets are `totalAssets × score / Σscore`. A small score gap leads to a large reallocation. | Add a hysteresis band, an EMA-smoothed score, or a per-cycle move cap. |
| **No fee modelling** | Vault performance fees and gas cost aren't part of the score. The bot can rebalance for a profit smaller than the gas it just burned. | Subtract `gas_used_estimate × gas_price / totalAssets` from the projected APY uplift before triggering. |

### 7.2 Operational hardening

- **Real signer:** move the private key to **AWS KMS** (or HSM) and inject a viem `account` adapter — eliminates the env-var attack surface entirely.
- **Database for audit trail:** persist every cycle's `RebalanceResult`, gas costs, and reasons in Postgres. Required for SOX-style audit and for measuring the success metrics from the SPEC.
- **Authenticated API:** JWT + role-based access on `/api/v1/*`, even for solo operators. The current "private network" assumption is fragile.
- **MEV protection:** route transactions through Flashbots Protect RPC or MEV-Share. Today the bot signals its intent in the public mempool and is sandwich-able on large reallocations.
- **Bundler integration:** for large rebalances, route via Morpho's `Bundler3` so deallocate + allocate land in a single atomic call (no idle-pool exposure between txs).
- **Multi-vault / multi-chain:** today the bot is single-vault on mainnet. A fleet runner would re-use the same `RebalanceService` per vault behind a registry.
- **Structured metrics:** Prometheus `/metrics` endpoint with cycle latency, RPC retry counts, gas burned, and current vs target drift histograms. Pair with Grafana + Alertmanager.

### 7.3 Evolution: Cron → Event-Driven

The cron-only model has two fundamental weaknesses:

1. **Latency.** The default 5-minute tick means the bot reacts ~150 seconds late on average. In a fast rate-shift event (e.g. a large borrow on a small market) that's enough to leave 100+ bps on the table.
2. **Wasted RPC.** 99% of cron ticks are no-ops — most drift never crosses the threshold. Each tick still pays the multicall cost.

The right v2 architecture is **hybrid: cron baseline + event-driven trigger**.

```
                       ┌──────────────────────────────────────┐
                       │           RebalanceService           │
                       │   .run()  (single-flight, debounced) │
                       └──────────────────┬───────────────────┘
                                          │
       ┌──────────────────────┬───────────┴───────────┬────────────────────┐
       │                      │                       │                    │
       ▼                      ▼                       ▼                    ▼
┌──────────────┐      ┌────────────────┐     ┌──────────────────┐   ┌────────────┐
│  cron tick   │      │ Morpho Blue    │     │ Vault V2 events  │   │ Manual API │
│  (15-min     │      │ events         │     │ AddAdapter,      │   │ POST       │
│   safety net)│      │ Supply/Borrow/ │     │ SetAllocator,    │   │ /rebalance │
│              │      │ AccrueInterest │     │ SetCap, etc.     │   │            │
└──────────────┘      └────────┬───────┘     └─────────┬────────┘   └────────────┘
                               │                       │
                               ▼                       ▼
                      ┌─────────────────────────────────────┐
                      │       Event Pipeline                │
                      │  WebSocket subscription (viem       │
                      │  watchEvent) + reconnect + dedup    │
                      │  + utilization-delta debouncer      │
                      └─────────────────────────────────────┘
```

Concretely:

1. **Subscribe via `publicClient.watchContractEvent`** to Morpho Blue `Supply`, `Borrow`, `Repay`, `Withdraw`, and `AccrueInterest` events on every managed market id. viem handles the polling/WS plumbing.
2. **Debounce in TypeScript.** Wait `N` seconds after the last event before triggering — many borrow/repay events arrive in bursts within the same block.
3. **Threshold trigger.** Only call `RebalanceService.run()` when the cumulative utilization shift since the last rebalance exceeds, say, 200 bps. This is cheap to track in memory.
4. **Cron stays as a safety net** at a longer interval (15-30 min) to catch missed events from a WebSocket dropout or subscription gap.
5. **Reconnection + dedup.** WS subscriptions die. The pipeline needs reconnect-with-backoff and a `lastProcessedBlock` cursor so we never miss or double-process an event after a reconnect.
6. **Vault-event listener too.** The bot should react to Vault V2 governance events (`AddAdapter`, `SetCap`, `SetAllocator`) by re-running `assertStartupInvariants` and potentially re-scoping its managed market set, instead of requiring a restart.

The big architectural win: **the existing pure strategy layer doesn't change at all**. Only the *trigger source* changes. That's exactly what the SOLID layering buys you — the cron plugin can be swapped for an event plugin without touching `RebalanceService`, `Strategy`, or any of the chain reads.

---

# Annexe — Code Deep Dive

## A. Repository Layout

| Path | Role |
|---|---|
| [src/index.ts](../../src/index.ts) | Bootstrap: load config → load markets → DI wiring → invariants → register plugins → listen |
| [src/config/env.ts](../../src/config/env.ts) | Zod schema for env vars + `safeConfig()` redaction |
| [src/config/managed-markets.ts](../../src/config/managed-markets.ts) | Loader for the `MANAGED_MARKETS_PATH` JSON file |
| [src/config/constants.ts](../../src/config/constants.ts) | ABIs, `WAD`, `BPS_DENOMINATOR`, `SECONDS_PER_YEAR`, `MARKET_PARAMS_ABI_COMPONENTS` |
| [src/core/chain/client.ts](../../src/core/chain/client.ts) | viem `publicClient` + `walletClient` factory |
| [src/core/chain/vault.ts](../../src/core/chain/vault.ts) | `VaultReader` — startup invariants + multicall snapshot |
| [src/core/chain/morpho.ts](../../src/core/chain/morpho.ts) | `MorphoReader` — Blue market + IRM reads |
| [src/core/chain/executor.ts](../../src/core/chain/executor.ts) | `Executor` + `DryRunExecutor` (both implement `IExecutor`) |
| [src/core/rebalancer/types.ts](../../src/core/rebalancer/types.ts) | All domain types — `MarketParams`, `ManagedMarket`, `MarketAllocationState`, `VaultState`, `RebalanceAction`, `StrategyConfig`, `RebalanceResult`, `IRMParams` |
| [src/core/rebalancer/irm.ts](../../src/core/rebalancer/irm.ts) | Pure IRM math: `computeBorrowRate`, `computeSupplyAPY`, `projectUtilization`, `projectSupplyAPY` |
| [src/core/rebalancer/strategy.ts](../../src/core/rebalancer/strategy.ts) | Pure strategy: `computeScore`, `enforceCapConstraints`, `isWithinDriftThreshold`, `computeRebalance` |
| [src/core/rebalancer/engine.ts](../../src/core/rebalancer/engine.ts) | Thin entry point: `computeRebalanceActions` (input validation → delegates to `computeRebalance`) |
| [src/services/rebalance.service.ts](../../src/services/rebalance.service.ts) | The orchestrator: `RebalanceService.run()` |
| [src/services/notifier.ts](../../src/services/notifier.ts) | Telegram alerts with cooldown |
| [src/plugins/scheduler.ts](../../src/plugins/scheduler.ts) | croner plugin |
| [src/plugins/health.ts](../../src/plugins/health.ts) | `GET /health` |
| [src/plugins/api.ts](../../src/plugins/api.ts) | `GET /api/v1/status`, `POST /api/v1/rebalance` |

## B. Bootstrap sequence

[src/index.ts:60-95](../../src/index.ts#L60-L95) — `start()`:

1. Build Fastify with Pino logger ([index.ts:62](../../src/index.ts#L62)).
2. `loadManagedMarkets(config.MANAGED_MARKETS_PATH)` ([index.ts:68](../../src/index.ts#L68)) — parses + zod-validates the JSON file.
3. `createClients(config)` ([index.ts:74](../../src/index.ts#L74)) — viem public + wallet.
4. `new VaultReader(publicClient, vaultAddress, adapterAddress, managedMarkets)` ([index.ts:78-83](../../src/index.ts#L78-L83)).
5. `await vaultReader.assertStartupInvariants(botWallet)` ([index.ts:90](../../src/index.ts#L90)) — **mutates `managedMarkets[].capIds` in place** with the on-chain values.
6. Construct `MorphoReader`, `Executor` (or `DryRunExecutor` if `DRY_RUN`), `Notifier`, `RebalanceService`.
7. Register plugins: `healthPlugin`, `apiPlugin`, `schedulerPlugin`.
8. `fastify.listen({ port: PORT, host: "0.0.0.0" })`.
9. Wire `SIGINT` / `SIGTERM` to `fastify.close()` with a 10s grace window.

Startup-error handler at [index.ts:167-179](../../src/index.ts#L167-L179) — sanitises the message (URL/hex redaction) before printing, then `process.exit(1)`.

## C. `RebalanceService.run()` — line by line

[src/services/rebalance.service.ts:147-263](../../src/services/rebalance.service.ts#L147-L263).

| Step | Lines | What happens |
|---|---|---|
| Cycle lock check | [149-152](../../src/services/rebalance.service.ts#L149-L152) | Returns `null` if `isRunning`. |
| Lock acquire | [154-155](../../src/services/rebalance.service.ts#L154-L155) | `isRunning = true`, stamp `lastCheckTimestamp`. |
| READ phase | [161-195](../../src/services/rebalance.service.ts#L161-L195) | `vaultReader.readFullState()` then `morphoReader.readMarketsForManagedMarkets(activeMarkets)`. On error: redact URL, alert, `return null`. |
| COMPUTE phase | [198-204](../../src/services/rebalance.service.ts#L198-L204) | `computeRebalanceActions(state, strategyConfig)`. If `actions.length === 0`, return a no-op `RebalanceResult`. |
| EXECUTE phase | [206-258](../../src/services/rebalance.service.ts#L206-L258) | `executor.execute(actions, vaultAddress)` — wrapped in try/catch that triggers `notifier.notifyRebalanceFailed`. |
| Post-execute | [217-225](../../src/services/rebalance.service.ts#L217-L225) | `_readNewAllocations()` re-reads vault state to populate `newAllocations` keyed by `marketLabel`. |
| NOTIFY phase | [229-237](../../src/services/rebalance.service.ts#L229-L237) | `notifier.notifyRebalanceSuccess(...)` in its own try/catch — Telegram failure never propagates. |
| Lock release | [259-262](../../src/services/rebalance.service.ts#L259-L262) | `finally` block sets `isRunning = false`. |

## D. `VaultReader` deep dive

### Startup validation

[src/core/chain/vault.ts:219-241](../../src/core/chain/vault.ts#L219-L241) — `assertStartupInvariants(botWallet)`:

- [`_assertAdapterEnabled()`](../../src/core/chain/vault.ts#L378-L423) — multicalls `vault.adapters(0..n)` and checks the configured address is present.
- [`_assertAdapterParentVault()`](../../src/core/chain/vault.ts#L428-L446) — `adapter.parentVault() == vaultAddress`.
- [`_assertAllocatorRole(botWallet)`](../../src/core/chain/vault.ts#L451-L471) — `vault.isAllocator(botWallet) == true`.
- [`_validateMarketAndPopulateCapIds(market)`](../../src/core/chain/vault.ts#L485-L636) — for each market:
  1. Compute the 3 cap ids locally via [`computeMarketCapIds`](../../src/core/chain/vault.ts#L103-L136).
  2. Call `adapter.ids(marketParams)`.
  3. Assert all 3 hashes match exactly — throws `StartupValidationError` with a precise message if not.
  4. Mutate `market.capIds` in place with the on-chain ids.
  5. Read all 3 `relativeCap` + 3 `absoluteCap` values via multicall.
  6. Refuse to start on `relativeCap == 0n` ([vault.ts:604-613](../../src/core/chain/vault.ts#L604-L613)).
  7. Exclude (not error) markets with `absoluteCap == 0n` ([vault.ts:619-632](../../src/core/chain/vault.ts#L619-L632)).

### `readFullState()` multicall structure

[src/core/chain/vault.ts:263-368](../../src/core/chain/vault.ts#L263-L368). For `N` active markets, the multicall is `1 + N×7` calls:

- `[0]` — `vault.totalAssets()`
- For each market `i`, indices `[1 + i×7 + k]`:
  - `+0`: `vault.allocation(id[2])` (market-specific id)
  - `+1..3`: `vault.absoluteCap(id[0..2])`
  - `+4..6`: `vault.relativeCap(id[0..2])`

`allowFailure: false` — partial state is worse than no state for a rebalancing bot.

### Cap-id preimages

[`computeMarketCapIds()`](../../src/core/chain/vault.ts#L103-L136) — verified against [`MorphoMarketV1AdapterV2.sol`](https://github.com/morpho-org/vault-v2/blob/main/src/adapters/MorphoMarketV1AdapterV2.sol):

| # | Semantics | Preimage |
|---|---|---|
| 0 | Adapter-wide | `keccak256(abi.encode("this", adapter))` |
| 1 | Per-collateral-token | `keccak256(abi.encode("collateralToken", marketParams.collateralToken))` |
| 2 | Market-specific | `keccak256(abi.encode("this/marketParams", adapter, marketParams))` |

These exact strings are what the on-chain adapter uses; any deviation produces a different hash and `vault.allocate` reverts with `ZeroAbsoluteCap`.

## E. `Strategy` deep dive

[src/core/rebalancer/strategy.ts](../../src/core/rebalancer/strategy.ts).

### `computeScore()` — [strategy.ts:82-133](../../src/core/rebalancer/strategy.ts#L82-L133)

```ts
const supplyDelta  = allocation - marketState.allocation;
const projectedAPY = projectSupplyAPY(market.irmParams, market.totalSupply,
                                       market.totalBorrow, supplyDelta);
if (projectedAPY <= 0) return 0;

const liquidityFloor       = minLiquidityMultiplier * allocation;
const liquiditySafetyFactor = min(1, availableLiquidity / liquidityFloor);

const concentration        = allocation / market.totalSupply;
const concentrationPenalty = max(0, concentration - maxMarketConcentrationPct/100);

return projectedAPY * liquiditySafetyFactor * (1 - concentrationPenalty);
```

Note the `Number()` conversions on bigints — fine for scoring (we don't need wei precision for a comparison) but worth being aware of for very large vaults.

### `enforceCapConstraints()` — [strategy.ts:156-200](../../src/core/rebalancer/strategy.ts#L156-L200)

For each market, iterates all 3 cap ids and clamps the proposed allocation to the most restrictive of:

- `absoluteCap` (asset native decimals)
- `totalAssets × relativeCap / WAD` if `relativeCap ∉ {0, WAD}`
- `0` if `relativeCap == 0n` (forbidden — though startup invariants should have prevented this)
- (no clamp) if `relativeCap == WAD` ("no relative cap" sentinel)

### `computeRebalance()` — [strategy.ts:278-412](../../src/core/rebalancer/strategy.ts#L278-L412)

Pipeline:

1. **Score** every market with current allocation as the candidate ([strategy.ts:294-308](../../src/core/rebalancer/strategy.ts#L294-L308)). This is the simplification flagged in § 7.1 — a true optimum would require iterating.
2. **Proportional split** of `totalAssets` by relative score ([strategy.ts:313-336](../../src/core/rebalancer/strategy.ts#L313-L336)). Equal split if all scores are zero. BigInt math is preserved by scaling the float score by `1e18` before integer division.
3. **Cap clamping** ([strategy.ts:341](../../src/core/rebalancer/strategy.ts#L341)).
4. **Delta + drift filter** ([strategy.ts:349-406](../../src/core/rebalancer/strategy.ts#L349-L406)) — special-cases the `relativeCap == 0` "drain me" exit at [strategy.ts:359-370](../../src/core/rebalancer/strategy.ts#L359-L370).
5. **Order** — deallocates first, then allocates ([strategy.ts:411](../../src/core/rebalancer/strategy.ts#L411)).

The action's `data` field is built by `encodeMarketParams()` ([strategy.ts:52-57](../../src/core/rebalancer/strategy.ts#L52-L57)) — the ABI-encoded `MarketParams` tuple that the vault forwards to the adapter.

### `isWithinDriftThreshold()` — [strategy.ts:215-227](../../src/core/rebalancer/strategy.ts#L215-L227)

Pure bigint comparison: `|delta| × BPS_DENOMINATOR <= total × thresholdBps`. No floats.

## F. `IRM` deep dive

[src/core/rebalancer/irm.ts](../../src/core/rebalancer/irm.ts).

- [`computeBorrowRate(params, utilization)`](../../src/core/rebalancer/irm.ts#L46-L71) — two-segment linear kink, both branches guard against zero divisors at the kink boundaries.
- [`computeSupplyAPY(params, utilization)`](../../src/core/rebalancer/irm.ts#L88-L105) — `borrowRate × utilization / WAD` then per-second compounding via `Math.pow(1 + r, secondsPerYear) - 1`.
- [`projectUtilization(supply, borrow, supplyDelta)`](../../src/core/rebalancer/irm.ts#L121-L136) — clamps to `[0, WAD]`, treats `newSupply ≤ 0` as `WAD` (100% utilized) so the strategy refuses to allocate to a fully-drawn market.
- [`projectSupplyAPY(...)`](../../src/core/rebalancer/irm.ts#L149-L161) — composition of the two above, the only thing `strategy.ts` actually calls.

## G. `Executor` deep dive

[src/core/chain/executor.ts](../../src/core/chain/executor.ts).

- `IExecutor` interface — [executor.ts:28-33](../../src/core/chain/executor.ts#L28-L33). One method: `execute(actions, vaultAddress) → RebalanceResult`.
- `Executor.execute()` — [executor.ts:75-150](../../src/core/chain/executor.ts#L75-L150):
  1. Read `getGasPrice()`, compare to `GAS_CEILING_GWEI × 1e9`. If exceeded → `buildSkippedResult` ([executor.ts:82-88](../../src/core/chain/executor.ts#L82-L88)).
  2. If `DRY_RUN` → log + `buildDryRunResult` ([executor.ts:91-94](../../src/core/chain/executor.ts#L91-L94)).
  3. For each action: `walletClient.writeContract({ address, abi: VAULT_V2_ABI, functionName: "allocate"|"deallocate", args: [adapter, data, amount] })` ([executor.ts:103-119](../../src/core/chain/executor.ts#L103-L119)).
  4. `waitForTransactionReceipt({ hash })` ([executor.ts:124](../../src/core/chain/executor.ts#L124)).
  5. On `receipt.status === "reverted"` → `buildRevertResult` and stop ([executor.ts:131-139](../../src/core/chain/executor.ts#L131-L139)).
- `DryRunExecutor` — [executor.ts:165-174](../../src/core/chain/executor.ts#L165-L174). Same `IExecutor` interface, never touches the wallet. Used when `DRY_RUN=true` or in tests.

## H. `MorphoReader` deep dive

[src/core/chain/morpho.ts](../../src/core/chain/morpho.ts).

- [`readMarketData(marketId)`](../../src/core/chain/morpho.ts#L183-L276) — two batches:
  - **Batch 1** (multicall, same block): `morpho.market(id)` + `morpho.idToMarketParams(id)`.
  - **Batch 2** (single read): `IRM.borrowRateView(marketParams, marketState)` — wrapped in try/catch because some IRMs don't expose this.
- [`deriveIRMParams(currentBorrowRate, utilization)`](../../src/core/chain/morpho.ts#L113-L138) — **the approximation that needs replacing** for production. Hard-codes `optimalUtilization = 0.9 × WAD`, sets `slope2 = 4 × slope1`, `baseRate = 0`. Acknowledged in the inline comments.
- [`readMarketsForManagedMarkets(markets)`](../../src/core/chain/morpho.ts#L308-L326) — fan-out via `Promise.all`, individual failures are filtered out instead of failing the batch.

## I. `Notifier` deep dive

[src/services/notifier.ts](../../src/services/notifier.ts).

- Cooldown map keyed by `AlertType`. `canSend()` ([notifier.ts:198-202](../../src/services/notifier.ts#L198-L202)) checks the last successful send was more than `cooldownMs` (default 15 min) ago.
- `send()` ([notifier.ts:218-252](../../src/services/notifier.ts#L218-L252)) — `fetch` to `https://api.telegram.org/bot<token>/sendMessage` with Markdown body. The token is interpolated only here and never logged. Network errors caught and logged via `console.error`. The cooldown timestamp is updated **only** after a successful send so transient failures don't reset the clock.
- `sanitiseErrorMessage()` ([notifier.ts:290-305](../../src/services/notifier.ts#L290-L305)) — URL redaction, hex redaction, stack trace stripping, 200-char truncation.

## J. Plugins

### `scheduler.ts`

[src/plugins/scheduler.ts:65-110](../../src/plugins/scheduler.ts#L65-L110). Registers a `Cron(config.CRON_SCHEDULE, handler)` on Fastify's `onReady` hook. Each tick:

1. Check `rebalanceService.getStatus().isRunning` and log "skipped" if true.
2. `await rebalanceService.run()` inside a try/catch — defensive, since `run()` already has its own boundaries.
3. On `onClose`, `job.stop()`.

The cron does **not** trigger an initial run on boot — first run is on the first tick.

### `health.ts`

[src/plugins/health.ts:127-165](../../src/plugins/health.ts#L127-L165). Returns `{ status, lastCheck, lastRebalance, uptime }` from in-memory state. Returns `503` when `lastCheck` is older than `2 × cronInterval`. Cron interval is parsed from `CRON_SCHEDULE` via a small regex that handles `*/N * * * *` and `0 */N * * *` ([health.ts:70-93](../../src/plugins/health.ts#L70-L93)), falling back to 10 min for anything else.

### `api.ts`

[src/plugins/api.ts](../../src/plugins/api.ts).

- `GET /api/v1/status` ([api.ts:139-246](../../src/plugins/api.ts#L139-L246)) — re-reads the vault state via `vaultReader.readFullState()` and serialises every market's allocation, percentage, and 3 cap entries. BigInts → strings for JSON.
- `POST /api/v1/rebalance` ([api.ts:265-311](../../src/plugins/api.ts#L265-L311)) — preflight `isRunning` check returns `409`. Otherwise calls `rebalanceService.run()`. A `null` return becomes `409` (race), an empty `actions` array becomes `200` with `{ action: "none", reason: "within drift threshold" }`, and a populated result becomes `200` with the actions paired with their tx hashes.
- All responses use the `{ data, error }` envelope ([api.ts:86-95](../../src/plugins/api.ts#L86-L95)).

## K. Config & secrets

[src/config/env.ts](../../src/config/env.ts).

- All env vars validated by zod at module load time — bot crashes immediately on misconfig.
- Required: `RPC_URL`, `PRIVATE_KEY`, `VAULT_ADDRESS`, `ADAPTER_ADDRESS`, `MANAGED_MARKETS_PATH`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Optional with defaults: `CRON_SCHEDULE=*/5 * * * *`, `DRIFT_THRESHOLD_BPS=500`, `GAS_CEILING_GWEI=50`, `MIN_ETH_BALANCE=0.05`, `PORT=3000`, `DRY_RUN=false`, `MAX_MARKET_CONCENTRATION_PCT=10`, `MIN_LIQUIDITY_MULTIPLIER=2`.
- `SENSITIVE_FIELDS = ["PRIVATE_KEY", "TELEGRAM_BOT_TOKEN", "RPC_URL"]` ([env.ts:162](../../src/config/env.ts#L162)).
- `safeConfig()` ([env.ts:174-182](../../src/config/env.ts#L174-L182)) returns a redacted copy for logging.

## L. Testing

- **Unit tests** ([test/unit/](../../test/unit/)) — pure strategy + IRM, no chain dependency.
- **Integration tests** ([test/integration/](../../test/integration/)) — Anvil forked mainnet for `VaultReader`, `MorphoReader`, `Executor`, and full API routes.
- **Vitest** + Bun test runner. `just check` runs lint + typecheck + test as the quality gate.
