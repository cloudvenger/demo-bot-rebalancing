# Architecture — Morpho V2 Rebalancing Bot

> Referenced from [SPEC.md](../../SPEC.md) — Technical Patterns section.

---

## Service Architecture

The bot has 5 distinct responsibilities that never bleed into each other:

```
┌─────────────────────────────────────────────────────────┐
│                    Fastify (HTTP + Plugins)              │
│  /health   /api/v1/status   /api/v1/rebalance   cron   │
└──────────────────────┬──────────────────────────────────┘
                       │ triggers
                       ▼
            ┌─────────────────────┐
            │  RebalanceService   │  ← orchestrator, owns the flow
            │  read → compute →   │
            │  execute → notify   │
            └──┬───────┬───────┬──┘
               │       │       │
       ┌───────┘       │       └────────┐
       ▼               ▼                ▼
┌─────────────┐ ┌────────────┐ ┌──────────────┐
│ ChainReader │ │  Strategy  │ │   Executor   │
│ (reads)     │ │  (pure)    │ │ (writes)     │
│             │ │            │ │              │
│ vault state │ │ scores     │ │ deallocate() │
│ market data │ │ deltas     │ │ allocate()   │
│ IRM params  │ │ projections│ │ gas mgmt     │
│ adapter list│ │            │ │ tx confirm   │
└─────────────┘ └────────────┘ └──────────────┘
                                      │
                               ┌──────┘
                               ▼
                        ┌─────────────┐
                        │  Notifier   │
                        │ (Telegram)  │
                        └─────────────┘
```

**Why this separation matters:**
- `ChainReader` can be tested with a mocked RPC (or Anvil fork) without touching strategy logic
- `Strategy` is pure functions — unit testable with hardcoded inputs, no chain dependency at all
- `Executor` can be tested in dry-run mode — same interface, logs instead of submitting
- `Notifier` is fire-and-forget — if Telegram is down, the rebalance still completes

---

## Plugin Pattern — Fastify

Each concern registers as an independent Fastify plugin:

```
src/plugins/
  scheduler.ts    → registers cron job, calls RebalanceService.run()
  health.ts       → registers GET /health (reads in-memory timestamps only)
  api.ts          → registers GET /api/v1/status + POST /api/v1/rebalance
```

Plugins don't know about each other. They all receive `RebalanceService` via Fastify's dependency injection (`fastify.decorate`). This means:
- You can disable the scheduler plugin and trigger rebalances only via API (useful for testing)
- You can add a Prometheus metrics plugin later without touching any existing code
- Each plugin has its own tests in isolation

---

## Pure Core Logic

The strategy module is **pure** — no `await`, no RPC calls, no side effects:

```typescript
// strategy.ts — PURE function
function computeRebalance(
  adapters: AdapterState[],       // current on-chain state (already read)
  marketData: MarketData[],       // rates, utilization, IRM params
  totalAssets: bigint,
  config: StrategyConfig          // drift threshold, caps, concentration limits
): RebalanceAction[]              // list of { adapter, direction, amount }

// Returns actions but NEVER executes them
// This function has zero dependencies — testable with plain objects
```

**Why this matters for a DeFi bot:**
- You can replay historical states through the strategy to backtest
- You can write 50 unit tests with different market conditions without ever touching a chain
- You can audit the allocation logic by reading one file — no hidden RPC calls buried in the math
- Dry-run mode is trivial: just skip the Executor, log the actions

---

## Hybrid IRM (Interest Rate Model)

The bot needs to predict what APY will be *after* a rebalance, not just read the current APY.

**Approach:** Read IRM parameters from on-chain once per cycle, compute projected rates off-chain in TypeScript.

```
On-chain (once per cycle)          Off-chain (per adapter)
┌──────────────────────┐          ┌──────────────────────────────┐
│ Read IRM contract:   │          │ For each candidate allocation: │
│ - base rate          │────────→ │ 1. Compute new utilization     │
│ - slope1, slope2     │          │ 2. Apply IRM formula           │
│ - optimal util point │          │ 3. Get projected supply APY    │
│ - jump multiplier    │          │ 4. Feed into scoring formula   │
└──────────────────────┘          └──────────────────────────────┘
```

**Why hybrid over pure on-chain:** Fewer RPC calls (read params once, simulate many allocations). Faster iteration in the scoring loop.

**Why hybrid over pure off-chain:** IRM parameters can change. Reading them each cycle ensures the bot stays in sync with on-chain reality.

---

## Error Boundaries

Each layer catches its own errors and never propagates them to crash the bot:

```
┌──────────────────────────────────────────────┐
│              RebalanceService.run()           │
│                                              │
│  try {                                       │
│    state = ChainReader.readAll()  ←── if RPC fails: retry 3x,
│  }                                    then alert + abort cycle
│                                              │
│  actions = Strategy.compute(state) ←── pure, can't fail
│                                       (bad input = empty actions)
│                                              │
│  try {                                       │
│    Executor.execute(actions)      ←── if tx reverts: log + alert
│  }                                    + abort remaining txs
│                                       (never retry a reverted tx)
│                                              │
│  try {                                       │
│    Notifier.send(result)          ←── if Telegram fails: log locally
│  }                                    + continue (NEVER block)
│                                              │
│  // Bot is still alive for next cron tick    │
└──────────────────────────────────────────────┘
```

**Key rule:** A failure in layer N never kills the bot process. The worst case is: one cron cycle does nothing, logs the error, alerts if possible, and the bot tries again next tick.

---

## Stateless Design (No Database)

All state comes from two sources:
1. **On-chain** — vault allocations, market rates, adapter list (read fresh every cycle)
2. **In-memory** — last check timestamp, last rebalance timestamp, cycle lock flag

On restart, the bot loses only the timestamps (first cycle runs immediately, which is the correct behavior anyway). There's no migration, no schema, no data corruption risk.

**Why no database in v1:** The blockchain *is* the database. Every piece of data the bot needs is already on-chain. Adding a DB would only be useful for historical analytics (v2 candidate).
