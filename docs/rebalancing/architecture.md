# Architecture — Morpho V2 Rebalancing Bot

> Referenced from [SPEC.md](../../SPEC.md) — Technical Patterns section.
> Companion walkthrough with line-level references: [presentation.md](./presentation.md).

---

## Service Architecture

The bot is a single Fastify process on Bun. Internally, six concrete roles are strictly layered and wired by constructor injection at the composition root ([src/index.ts](../../src/index.ts)):

```
┌─────────────────────────────────────────────────────────────┐
│                 Fastify (HTTP + Plugins)                     │
│  health.ts   api.ts   scheduler.ts                           │
│  /health     /api/v1/status + /api/v1/rebalance   cron tick  │
└──────────────────────┬───────────────────────────────────────┘
                       │ triggers via DI (fastify.decorate)
                       ▼
            ┌──────────────────────┐
            │   RebalanceService   │  ← orchestrator, owns the flow
            │ read → compute →     │    single-flight `isRunning` lock
            │ execute → notify     │
            └─┬──────┬──────┬────┬─┘
   ┌──────────┘      │      │    └──────────────┐
   ▼                 ▼      ▼                   ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐
│ VaultReader│ │MorphoReader│ │  Executor  │ │ Notifier │
│ (chain rd) │ │ (chain rd) │ │ (chain wr) │ │(Telegram)│
│            │ │            │ │            │ │          │
│ vault state│ │ market +   │ │ allocate() │ │ success /│
│ startup    │ │ IRM reads  │ │ deallocate │ │ failure /│
│ invariants │ │            │ │ gas + tx   │ │ skipped  │
│ cap ids    │ │            │ │ DryRun var │ │ cooldown │
└────────────┘ └─────┬──────┘ └─────┬──────┘ └──────────┘
                     │              │
                     └──────┬───────┘
                            ▼
               ┌───────────────────────────┐
               │   Strategy Engine (PURE)  │
               │ irm.ts → strategy.ts →    │
               │ engine.ts                 │
               │ no async · no RPC · no I/O│
               └───────────────────────────┘
```

**Why this separation matters:**
- `VaultReader` and `MorphoReader` are split (ISP) — the strategy engine never depends on vault-specific reads, and consumers import only what they need.
- `Strategy` is pure functions — unit testable with hardcoded inputs, no chain dependency at all.
- `Executor` and `DryRunExecutor` both implement `IExecutor` — the service cannot tell which it received (LSP). `DRY_RUN=true` swaps the concrete class at the composition root.
- `Notifier` is fire-and-forget — if Telegram is down, the rebalance still completes.

> **Scope note.** The bot manages **one adapter** with **many managed markets** under it (see the v2 single-adapter refactor, `MANAGED_MARKETS_PATH`). Readers and strategy iterate over markets, not adapters.

---

## Plugin Pattern — Fastify

Each concern registers as an independent Fastify plugin:

```
src/plugins/
  scheduler.ts  → registers a croner Cron(CRON_SCHEDULE) that calls
                  RebalanceService.run() on each tick. No initial run on boot.
  health.ts     → GET /health — in-memory timestamps only, zero RPC calls,
                  must respond in < 50 ms. Returns 503 when lastCheck is
                  older than 2 × cronInterval.
  api.ts        → GET /api/v1/status   (re-reads vault state, serialises caps)
                  POST /api/v1/rebalance (preflight isRunning → 409 on race)
```

Plugins don't know about each other. They all receive `RebalanceService` (and, for `api.ts`, `VaultReader`) via Fastify's dependency injection (`fastify.decorate`). This means:
- You can disable the scheduler plugin and trigger rebalances only via API (useful for testing).
- You can add a Prometheus metrics plugin later without touching any existing code.
- Each plugin has its own tests in isolation.

### Dependency Injection — composition root

All wiring happens exactly once in [src/index.ts](../../src/index.ts), roughly:

```typescript
const clients       = createClients(config);
const vaultReader   = new VaultReader(clients.publicClient, vaultAddress, adapterAddress, managedMarkets);
await vaultReader.assertStartupInvariants(botWallet);   // refuses to boot on misconfig
const morphoReader  = new MorphoReader(clients.publicClient);
const executor      = config.DRY_RUN
  ? new DryRunExecutor(clients.publicClient)
  : new Executor(clients.publicClient, clients.walletClient, config);
const notifier      = new Notifier(config);
const service       = new RebalanceService(vaultReader, morphoReader, executor, notifier, strategyConfig);

await fastify.register(healthPlugin,    { service });
await fastify.register(apiPlugin,       { service, vaultReader });
await fastify.register(schedulerPlugin, { service, cron: config.CRON_SCHEDULE });
```

Every concrete class is constructed here and only here — nothing new's its own collaborators. That is the entire "D" in SOLID for this project.

---

## Pure Core Logic

The strategy core is **pure** — no `await`, no RPC calls, no side effects — and it is split across three files in [src/core/rebalancer/](../../src/core/rebalancer/):

| File | Role |
|---|---|
| [irm.ts](../../src/core/rebalancer/irm.ts) | `computeBorrowRate`, `computeSupplyAPY`, `projectUtilization`, `projectSupplyAPY` — two-segment linear-kink math, per-second compounding. |
| [strategy.ts](../../src/core/rebalancer/strategy.ts) | `computeScore`, `enforceCapConstraints`, `isWithinDriftThreshold`, `computeRebalance` — pure scoring and delta math. |
| [engine.ts](../../src/core/rebalancer/engine.ts) | `computeRebalanceActions` — thin entry point: input validation → delegates to `computeRebalance`. |

The public entry point has roughly this shape:

```typescript
// engine.ts — PURE function
function computeRebalanceActions(
  state: VaultReadState,          // current on-chain snapshot (already read)
  config: StrategyConfig          // drift threshold, caps, concentration limits
): RebalanceAction[]              // [{ direction, marketId, amount, data }, ...]

// Returns actions but NEVER executes them.
// Zero dependencies — testable with plain objects.
```

**Why this matters for a DeFi bot:**
- You can replay historical states through the strategy to backtest.
- You can write 50 unit tests with different market conditions without ever touching a chain.
- You can audit the allocation logic by reading three files — no hidden RPC calls buried in the math.
- Dry-run mode is trivial: `DryRunExecutor` satisfies the same `IExecutor` interface and logs instead of submitting.

---

## Hybrid IRM (Interest Rate Model)

The bot needs to predict what APY will be *after* a rebalance, not just read the current APY.

**Approach:** Read a per-market IRM sample on-chain each cycle, then compute projected rates off-chain in TypeScript using the two-segment linear-kink formula.

```
On-chain (per market, per cycle)        Off-chain (per candidate allocation)
┌──────────────────────────┐           ┌──────────────────────────────────┐
│ MorphoReader.readMarket  │           │ For each candidate delta:        │
│ - totalSupply, Borrow    │──────────→│ 1. Project new utilization       │
│ - IRM.borrowRateView()   │           │ 2. Apply linear-kink IRM         │
│ - deriveIRMParams()      │           │ 3. Get projected supply APY      │
│   (approximates params)  │           │ 4. Feed into scoring formula     │
└──────────────────────────┘           └──────────────────────────────────┘
```

**Why hybrid over pure on-chain:** Fewer RPC calls (read once, simulate many allocations). Faster iteration in the scoring loop.

**Why hybrid over pure off-chain:** IRM parameters can change. Sampling each cycle keeps the bot in sync with on-chain reality.

> ⚠️ **Known weakness — `deriveIRMParams` is an approximation.** Morpho Blue's `AdaptiveCurveIRM` only exposes `borrowRateView(marketParams, market)`; it has no getters for `slope1`, `slope2`, or `optimalUtilization`. [MorphoReader.deriveIRMParams()](../../src/core/chain/morpho.ts) therefore *infers* these from a single `borrowRateView` sample (hard-coded `optU = 0.9 × WAD`, `slope2 = 4 × slope1`, `baseRate = 0`). This is the biggest correctness gap in the strategy today — see § 7.1 in [presentation.md](./presentation.md) for the two ways to harden it (multi-sample back-solve, or replicate the on-chain math in TS).

---

## Error Boundaries

Each layer catches its own errors and never propagates them to crash the bot. [RebalanceService.run()](../../src/services/rebalance.service.ts) wraps each phase in its own `try` / `catch`:

```
┌─────────────────────────────────────────────────────────┐
│              RebalanceService.run()                      │
│                                                          │
│  if (isRunning) return null   ←── single-flight guard:   │
│  isRunning = true                  cron + manual trigger │
│  try {                             never overlap         │
│                                                          │
│   try {                                                  │
│     state = vaultReader.readFullState()                  │
│             + morphoReader.readMarketsFor(...)           │
│   } ←── RPC failure: sanitise URL/hex in the error,      │
│         notify (failed), return null, bot stays alive    │
│                                                          │
│   actions = engine.computeRebalanceActions(state)        │
│   ←── pure, can't throw on well-typed input;             │
│       empty actions → return no-op result                │
│                                                          │
│   try {                                                  │
│     result = executor.execute(actions, vaultAddress)     │
│   } ←── gas-ceiling exceeded → skipped result + alert    │
│       tx reverts → stop, partial result, failure alert   │
│       (never retry a reverted tx)                        │
│                                                          │
│   try {                                                  │
│     notifier.notifyRebalanceSuccess(result)              │
│   } ←── Telegram failure: log locally, NEVER propagate   │
│                                                          │
│  } finally { isRunning = false }                         │
└─────────────────────────────────────────────────────────┘
```

**Key rules:**
- A failure in layer N never kills the bot process. Worst case: one cycle does nothing, logs the error, alerts if possible, and the bot tries again next tick.
- Every error message crossing a boundary (log, Telegram, HTTP response) is sanitised — URL and long-hex substrings are redacted to prevent leaking `RPC_URL`, `PRIVATE_KEY` fragments, or Telegram tokens.
- **No in-process retries** on failed reads or reverted txs. The cron tick *is* the retry loop — simpler and prevents runaway RPC use.

---

## Stateless Design (No Database)

All state comes from two sources:
1. **On-chain** — vault allocations, per-market caps, market rates, IRM samples (read fresh every cycle via multicall with `allowFailure: false`).
2. **In-memory** — `lastCheckTimestamp`, `lastRebalanceTimestamp`, the `isRunning` single-flight flag, and the per-alert-type cooldown map in `Notifier`.

The `isRunning` flag is the only thing that enforces "no two cycles at once": if a cron tick fires while a manual `POST /api/v1/rebalance` is still running (or vice versa), the second caller sees `isRunning === true` and bails out — cron logs "skipped", the API returns `409`.

On restart, the bot loses only the in-memory timestamps and cooldowns. The next cron tick runs normally — startup invariants ([VaultReader.assertStartupInvariants](../../src/core/chain/vault.ts)) re-validate the adapter, allocator role, cap ids, and `relativeCap != 0` before Fastify even listens, so a misconfigured restart fails fast instead of silently.

**Why no database in v1:** The blockchain *is* the database. Every piece of data the bot needs to make a decision is already on-chain. A DB is only useful for historical analytics and an audit trail — a v2 candidate, not a v1 blocker.

---

## Concurrency Model

| Source of `run()` | Guard |
|---|---|
| Cron tick ([scheduler.ts](../../src/plugins/scheduler.ts)) | Checks `getStatus().isRunning` before invoking; logs "skipped" otherwise. |
| Manual `POST /api/v1/rebalance` ([api.ts](../../src/plugins/api.ts)) | Preflight `isRunning` check returns HTTP `409` before the call. |
| `RebalanceService.run()` itself | Rechecks `isRunning` at the top ([rebalance.service.ts](../../src/services/rebalance.service.ts)); always releases in `finally`. |

This belt-and-braces approach means even if the plugin-level check races, the service layer still guarantees single-flight execution.

---

> _Last verified against [src/](../../src/) on 2026-04-07. If you change the service wiring, readers, or error boundaries, re-check this document — and [presentation.md](./presentation.md) — against the code._
