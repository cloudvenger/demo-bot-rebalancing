# Product Specification — Morpho V2 Rebalancing Bot

> A backend-only bot that automates allocation rebalancing for a Morpho Vault V2, optimizing yield across Morpho Blue markets.

---

## Problem Statement

Solo DeFi vault operators managing Morpho V2 vaults must manually monitor market rates, compute optimal allocations, and submit rebalancing transactions through the Curator app. This process is slow, error-prone, and reactive — by the time a human notices a rate shift and acts, the optimal window has passed. The result: suboptimal yield, wasted time, and missed opportunities. This bot replaces that manual loop with an automated, configurable, always-on rebalancing engine that reads on-chain state, computes optimal allocations within cap constraints, and executes transactions autonomously.

---

## User Personas

| Persona | Description | Key needs |
|---|---|---|
| **Vault Operator** | Solo DeFi operator running a Morpho V2 vault on Ethereum mainnet. Has the Allocator role on the vault contract. Technically proficient — comfortable with CLI, env vars, and RPC endpoints. | Automated rebalancing that respects caps, configurable drift thresholds, real-time Telegram alerts on execution/failure, health monitoring endpoint |

---

## User Stories

### Feature Area: Vault State Reading

**Story A1** — Read current allocations
As a vault operator, I want the bot to read the current allocation state of my vault (per-adapter assets, total assets, cap limits) so that it has an accurate picture before computing any rebalance.

Acceptance criteria:
- [ ] Bot reads `realAssets()` for every enabled adapter on the configured vault
- [ ] Bot reads `totalAssets()` on the vault contract
- [ ] Bot reads absolute and relative caps via `caps(id)` for each risk ID
- [ ] Bot reads market rates and utilization from Morpho Blue `market()` view for each underlying market
- [ ] All reads complete within a single block snapshot (consistent state)
- [ ] If RPC call fails, bot retries up to 3 times with exponential backoff before alerting

**Story A2** — Read enabled adapters
As a vault operator, I want the bot to automatically discover all enabled adapters on my vault so that I don't have to manually configure market lists.

Acceptance criteria:
- [ ] Bot queries the vault for the list of enabled adapters
- [ ] Bot identifies adapter type (MorphoMarketV1AdapterV2 vs MorphoVaultV1Adapter)
- [ ] New adapters added to the vault are picked up on next cron cycle without restart

---

### Feature Area: Rebalancing Engine

**Story B1** — Compute optimal allocation
As a vault operator, I want the bot to compute the optimal allocation across markets based on yield, market depth, and constraints so that my vault earns the best risk-adjusted return without moving markets or getting trapped in illiquid positions.

Acceptance criteria:
- [ ] Strategy scores each market by **projected post-rebalance APY** (not current APY)
- [ ] Strategy reads IRM (Interest Rate Model) parameters from on-chain once per cycle, then computes projected rates off-chain in TypeScript (hybrid IRM approach)
- [ ] Strategy reads total supply, total borrow, and available liquidity per market
- [ ] Strategy rejects markets where available liquidity < configurable minimum (default: 2x the bot's potential allocation to that market)
- [ ] Strategy caps allocation to any single market at configurable % of that market's total supply (default: 10%) to limit rate impact
- [ ] Strategy simulates post-rebalance utilization and uses the projected APY for scoring
- [ ] Scoring formula: `score = projected_APY × liquidity_safety_factor × (1 - concentration_penalty)` where liquidity_safety_factor = `min(1, available_liquidity / (2 × allocation))` and concentration_penalty = `your_assets / market_total_supply` above threshold
- [ ] Strategy respects absolute cap constraints (no adapter exceeds its absolute cap)
- [ ] Strategy respects relative cap constraints (no adapter exceeds its % of total assets)
- [ ] Strategy computes a delta (target - current) for each adapter
- [ ] If all adapters are within drift threshold, no rebalance is triggered
- [ ] Drift threshold is configurable via environment variable (default: 5%)

**Story B2** — Execute rebalance transactions
As a vault operator, I want the bot to submit rebalance transactions on-chain so that allocations are adjusted without manual intervention.

Acceptance criteria:
- [ ] Bot calls `deallocate()` first for all overweight adapters (delta < 0) to fill the idle pool
- [ ] Bot then calls `allocate()` for all underweight adapters (delta > 0) from the idle pool
- [ ] Each transaction includes gas price ceiling check — skip execution if gas exceeds configured max (in gwei)
- [ ] Bot uses EIP-1559 gas pricing (`maxFeePerGas` ceiling); viem handles this natively
- [ ] Bot waits for transaction confirmation before proceeding to the next
- [ ] If a transaction reverts, bot logs the error, sends Telegram alert, and stops the current rebalance cycle (does not continue with remaining txs)
- [ ] Successful rebalance logs: adapter addresses, amounts moved, gas used, new allocation percentages
- [ ] When `DRY_RUN=true`, bot logs proposed actions without submitting transactions

**Story B3** — Configurable rebalance trigger
As a vault operator, I want the bot to check for rebalancing opportunities on a configurable cron schedule so that I control how frequently it runs.

Acceptance criteria:
- [ ] Cron interval is configurable via environment variable (default: every 5 minutes)
- [ ] Cron uses standard cron expression syntax (e.g., `*/5 * * * *`)
- [ ] Only one rebalance cycle runs at a time — if a previous cycle is still executing, the next cron tick is skipped
- [ ] Bot logs each cron tick: "checking allocations" or "skipped — previous cycle still running"

---

### Feature Area: Telegram Alerts

**Story C1** — Rebalance execution alerts
As a vault operator, I want to receive a Telegram message when a rebalance is executed so that I have real-time visibility without watching logs.

Acceptance criteria:
- [ ] On successful rebalance: message includes vault address, adapters affected, amounts moved (human-readable with token symbol), tx hash(es), new allocation percentages
- [ ] On failed rebalance: message includes vault address, failing adapter, revert reason (decoded if possible), tx hash
- [ ] Telegram bot token and chat ID configured via environment variables
- [ ] If Telegram API is unreachable, bot logs the alert locally and continues (Telegram failure never blocks rebalancing)

**Story C2** — Health alerts
As a vault operator, I want to receive Telegram alerts when the bot encounters health issues so that I can intervene before problems compound.

Acceptance criteria:
- [ ] Alert on: RPC connection failure (after 3 retries exhausted)
- [ ] Alert on: missed cron heartbeat (no rebalance check ran in 2x the configured interval)
- [ ] Alert on: wallet balance below configurable ETH threshold (can't pay gas)
- [ ] Each alert type has a cooldown (default: 15 minutes) to prevent spam

---

### Feature Area: Health & Monitoring

**Story D1** — Health endpoint
As a vault operator, I want a `/health` HTTP endpoint so that I can monitor the bot with external uptime tools.

Acceptance criteria:
- [ ] `GET /health` returns 200 with JSON: `{ "status": "ok", "lastCheck": "<ISO timestamp>", "lastRebalance": "<ISO timestamp or null>", "uptime": <seconds> }`
- [ ] Returns 503 if the last cron check is older than 2x the configured interval
- [ ] Response time < 50ms (no on-chain calls in the health check)

**Story D2** — Status endpoint
As a vault operator, I want a `/api/v1/status` endpoint that shows current vault state so that I can inspect allocations without reading the chain directly.

Acceptance criteria:
- [ ] Returns current allocation per adapter: adapter address, adapter type, assets (raw + human-readable), percentage of total, cap limits
- [ ] Returns total vault assets
- [ ] Returns last rebalance timestamp and tx hashes
- [ ] Returns current gas price vs configured ceiling
- [ ] Endpoint is read-only, no authentication in v1 (solo operator on private network; auth deferred to v2)

**Story D3** — Manual rebalance trigger
As a vault operator, I want a `POST /api/v1/rebalance` endpoint so that I can force a rebalance cycle outside the cron schedule.

Acceptance criteria:
- [ ] Triggers a full rebalance cycle (read → compute → execute)
- [ ] Returns 409 if a rebalance cycle is already running
- [ ] Returns 200 with rebalance result (actions taken, tx hashes) on success
- [ ] Returns 200 with `{ "action": "none", "reason": "within drift threshold" }` if no rebalance needed

---

### Feature Area: Configuration

**Story E1** — Environment-based configuration
As a vault operator, I want all bot settings in a `.env` file validated at startup so that misconfiguration is caught immediately.

Acceptance criteria:
- [ ] All config validated with zod schema on boot — bot refuses to start with invalid config
- [ ] Required: `RPC_URL`, `PRIVATE_KEY`, `VAULT_ADDRESS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- [ ] Optional with defaults: `CRON_SCHEDULE` (default: `*/5 * * * *`), `DRIFT_THRESHOLD_BPS` (default: 500 = 5%), `GAS_CEILING_GWEI` (default: 50), `MIN_ETH_BALANCE` (default: 0.05), `PORT` (default: 3000), `DRY_RUN` (default: false), `MAX_MARKET_CONCENTRATION_PCT` (default: 10), `MIN_LIQUIDITY_MULTIPLIER` (default: 2)
- [ ] Sensitive values (`PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`) are never logged, even at debug level
- [ ] Bot logs all non-sensitive config values at startup for debugging

---

### Feature Area: Tutorial — Vault V2 Setup

**Story F1** — Written guide for Morpho Vault V2 setup
As a vault operator, I want a step-by-step guide to create a Morpho Vault V2 for USDC with 2-3 Morpho Blue markets so that I can set up the vault my bot will manage.

Acceptance criteria:
- [ ] Guide is a markdown file at `docs/rebalancing/vault-setup-guide.md`
- [ ] Covers: prerequisites (ETH for gas, USDC, Foundry installed)
- [ ] Covers: deploying a Vault V2 via VaultV2Factory with USDC as asset
- [ ] Covers: deploying 2-3 MorphoMarketV1AdapterV2 adapters for specific USDC markets: USDC/WETH (high liquidity), USDC/wstETH (LST demand), USDC/WBTC (BTC collateral)
- [ ] Covers: setting caps (absolute and relative) on each adapter
- [ ] Covers: granting the Allocator role to the bot's wallet address
- [ ] Covers: verifying the setup via on-chain reads
- [ ] All contract addresses reference Ethereum mainnet
- [ ] Includes a note about testing on a fork first

**Story F2** — Foundry deployment script
As a vault operator, I want a Foundry script that deploys the vault and adapters on a forked mainnet so that I can test the full setup locally before going live.

Acceptance criteria:
- [ ] Script lives at `script/DeployVault.s.sol`
- [ ] Script deploys: VaultV2 (USDC), 2-3 MorphoMarketV1AdapterV2 adapters, sets caps, grants Allocator role
- [ ] Script uses `vm.envAddress()` / `vm.envUint()` for configurable parameters
- [ ] Script can be run against a forked mainnet via `forge script --fork-url`
- [ ] Script logs all deployed addresses at the end
- [ ] README in `script/` explains how to run it

---

## Out of Scope (v1)

- **Frontend dashboard / UI** — bot is backend-only, operated via CLI + API + Telegram
- **Multi-chain support** — Ethereum mainnet only; Base, Arbitrum, etc. deferred to v2
- **Multi-vault management** — one bot instance per vault; fleet management deferred to v2
- **MEV protection** — no Flashbots/private mempool integration in v1 (v2 candidate)
- **Flash loan rebalancing** — no flash-loan-assisted large reallocations in v1 (v2 candidate)
- **Event-driven triggers** — no WebSocket/on-chain event listener; cron only in v1 (v2: hybrid cron + events)
- **Automated vault creation CLI** — tutorial is docs + Foundry script only; interactive CLI tool deferred to v2
- **Team access / multi-user auth** — single operator, no auth on API endpoints in v1
- **Historical performance tracking / analytics** — no database, no historical data storage in v1
- **AWS KMS key management** — env var only in v1; KMS integration deferred to v2

---

## V2 Candidates (explicitly deferred)

| Feature | Why deferred | V2 approach |
|---|---|---|
| Multi-chain | Adds complexity to RPC management, contract addresses, gas strategies | Chain-agnostic config with per-chain adapters |
| Multi-vault | Requires fleet orchestration, shared gas wallet logic | Single process managing multiple vault configs |
| MEV protection | Requires Flashbots integration, private mempool submission | Flashbots Protect RPC or MEV-Share |
| Flash loan rebalancing | Complex, high-risk, requires audited bundler integration | Via Morpho Bundler3 |
| Event-driven triggers | WebSocket infrastructure, reconnection handling, event dedup | Hybrid: cron baseline + event listener for urgent rate shifts |
| Vault creation CLI | Interactive prompts, contract deployment, adapter configuration | CLI tool wrapping Foundry scripts |
| AWS KMS | Infrastructure dependency, IAM setup | `@aws-sdk/client-kms` signer adapter for viem |
| Team access | Auth layer, role-based API access | JWT auth + role system on API endpoints |

---

## Technical Constraints

| Constraint | Requirement |
|---|---|
| **Runtime** | Bun (native TypeScript, fast startup) |
| **Framework** | Fastify (structured plugins, JSON schema validation, Pino logging) |
| **Chain interaction** | viem (type-safe, modern, Morpho SDK compatible) |
| **Morpho SDK** | `@morpho-org/blue-sdk` + `@morpho-org/blue-sdk-viem` |
| **Scheduler** | croner (lightweight cron for Bun) |
| **Testing** | Vitest + Anvil (forked mainnet for integration tests) |
| **Logging** | Pino (Fastify-native, structured JSON logs) |
| **Config validation** | zod (runtime schema validation for env vars) |
| **Telegram** | Direct Bot API via fetch (no heavy SDK dependency) |
| **Chain** | Ethereum mainnet only (chain ID 1) |
| **Wallet** | Private key via env var (v1); AWS KMS (v2) |
| **Hosting** | No preference — recommend Railway or any VPS with persistent process |
| **Budget** | No constraint specified |
| **Gas** | EIP-1559 pricing; configurable `maxFeePerGas` ceiling in gwei |

---

## Technical Patterns

> Full architecture elaboration with diagrams: [docs/rebalancing/architecture.md](docs/rebalancing/architecture.md)

Summary:
- **Service-oriented**: `RebalanceService` orchestrates the flow, `ChainReader` reads on-chain state, `Strategy` computes allocations (pure), `Executor` submits transactions, `Notifier` sends Telegram alerts
- **Plugin pattern**: Fastify plugins for scheduler, health, API routes — independently testable, loosely coupled
- **Pure core logic**: Strategy module is pure functions (no async, no RPC) — takes state in, returns actions out. All chain interaction isolated in `chain/` layer
- **Hybrid IRM**: Read Interest Rate Model parameters from on-chain once per cycle, compute projected rates off-chain in TypeScript
- **Error boundaries**: Chain errors, Telegram errors, and API errors are isolated — a Telegram outage never blocks rebalancing, a failed tx never crashes the bot
- **No database**: All state derived from on-chain reads + in-memory timestamps. Stateless between restarts (except logs). The blockchain is the database.

---

## Success Metrics

1. **Drift detection**: Bot detects allocation drift exceeding the configured threshold and rebalances within the next cron cycle (configurable, default 5 minutes)
2. **Transaction reliability**: Rebalance transactions succeed on first attempt >95% of the time (measured over 30-day rolling window via logs)
3. **Uptime**: Health endpoint reports `status: ok` >99.9% of the time when the host is running
4. **Alert latency**: Telegram notification delivered within 10 seconds of rebalance completion or failure

---

## Open Questions

| Question | Decision | Status |
|---|---|---|
| Should the bot support dry-run mode? | Yes — `DRY_RUN=true` env var logs proposed actions without submitting txs | Decided |
| Should the status endpoint require API key auth in v1? | No — solo operator on private network; add auth in v2 with team access | Decided |
| Which USDC Morpho Blue markets for the tutorial? | USDC/WETH (high liquidity), USDC/wstETH (LST demand), USDC/WBTC (BTC collateral) | Decided |
| EIP-1559 or legacy gas pricing? | EIP-1559 — use `maxFeePerGas` ceiling; viem handles this natively | Decided |
| Zero idle assets scenario? | Deallocate always runs before allocate — handled by execution order | Decided |
| IRM simulation approach? | Hybrid — read parameters on-chain, compute projections off-chain in TypeScript | Decided |
