# Morpho V2 Rebalancing Bot

[![CI](https://github.com/cloudvenger/demo-bot-rebalancing/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudvenger/demo-bot-rebalancing/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-93.4%25-brightgreen)
![TypeScript](https://img.shields.io/badge/typescript-strict-blue)
![Runtime](https://img.shields.io/badge/runtime-bun-f9f1e1)
![License](https://img.shields.io/badge/license-MIT-green)

Automated allocation rebalancing for [Morpho Vault V2](https://docs.morpho.org/learn/concepts/vault-v2/) on Ethereum mainnet. The bot reads on-chain state, computes optimal allocations across Morpho Blue markets using projected post-rebalance APY, and executes `allocate` / `deallocate` transactions — all within configurable cap and gas constraints.

## How it works

```
Every N minutes (cron):

  1. READ    — vault adapters, market rates, IRM params, caps
  2. COMPUTE — score markets by projected APY, liquidity, concentration
  3. EXECUTE — deallocate overweight, allocate underweight
  4. NOTIFY  — Telegram alert with tx hashes and new allocations
```

The strategy uses a **hybrid IRM** approach: read Interest Rate Model parameters on-chain once per cycle, then simulate post-rebalance rates off-chain in TypeScript. This avoids chasing displayed APY — the bot predicts what it will *actually* earn after moving capital.


## Architecture

The bot follows a **service-oriented** pattern with strict separation of concerns. The strategy module is **pure** (no async, no RPC) — all chain interaction is isolated in the `chain/` layer. Each error boundary is independent: a Telegram outage never blocks rebalancing, a failed transaction never crashes the bot.

Guided walkthrough of the design and implementation: [docs/rebalancing/presentation.md](docs/rebalancing/presentation.md)

Full architecture with diagrams: [docs/rebalancing/architecture.md](docs/rebalancing/architecture.md)

## Stack

| Layer | Tool |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Framework | [Fastify](https://fastify.dev) |
| Chain interaction | [viem](https://viem.sh) + [@morpho-org/blue-sdk](https://github.com/morpho-org/morpho-blue-sdk) |
| Scheduler | [croner](https://github.com/hexagon/croner) |
| Testing | [Vitest](https://vitest.dev) + [Anvil](https://book.getfoundry.sh/reference/anvil/) |
| Config validation | [zod](https://zod.dev) |
| Alerts | Telegram Bot API |

## Quick start

```bash
# Install dependencies
bun install

# Copy env template and fill in your values
cp .env.example .env

# Start in dry-run mode (no transactions submitted)
DRY_RUN=true bun run dev

# Run tests
bun run test
```

See [walkthrough.md](walkthrough.md) for the full setup guide.

## Configuration

All settings are in `.env`, validated with zod at startup. The bot refuses to start with invalid config.

| Variable | Required | Default | Description |
|---|---|---|---|
| `RPC_URL` | Yes | — | Ethereum mainnet RPC endpoint |
| `PRIVATE_KEY` | Yes | — | Wallet with Allocator role on the vault |
| `VAULT_ADDRESS` | Yes | — | Morpho Vault V2 contract address |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | — | Telegram chat ID for alerts |
| `CRON_SCHEDULE` | No | `*/5 * * * *` | Rebalance check frequency |
| `DRIFT_THRESHOLD_BPS` | No | `500` (5%) | Min drift to trigger rebalance |
| `GAS_CEILING_GWEI` | No | `50` | Skip execution if gas exceeds this |
| `DRY_RUN` | No | `false` | Log actions without submitting txs |
| `MAX_MARKET_CONCENTRATION_PCT` | No | `10` | Max % of a market's supply to allocate |
| `MIN_LIQUIDITY_MULTIPLIER` | No | `2` | Reject markets with low exit liquidity |

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (200 ok / 503 degraded) |
| `GET` | `/api/v1/status` | Current vault allocations and bot state |
| `POST` | `/api/v1/rebalance` | Manually trigger a rebalance cycle |

## Project structure

```
src/
  index.ts                        # Fastify entry point
  config/
    env.ts                        # Zod-validated environment config
    constants.ts                  # Contract addresses, ABIs, chain config
  core/
    rebalancer/
      types.ts                    # Domain types
      irm.ts                     # Pure IRM simulation
      strategy.ts                # Scoring, delta computation, cap enforcement
      engine.ts                  # Strategy orchestrator
    chain/
      client.ts                  # viem client factory
      vault.ts                   # Vault V2 on-chain reads
      morpho.ts                  # Morpho Blue market reads
      executor.ts                # Transaction builder + submitter
  plugins/
    scheduler.ts                 # Cron trigger
    health.ts                    # GET /health
    api.ts                       # Status + manual rebalance endpoints
  services/
    rebalance.service.ts         # Read -> compute -> execute -> notify
    notifier.ts                  # Telegram alerts
test/
  unit/                          # Pure logic tests (no network)
  integration/                   # Mocked chain + API tests
script/
  DeployVault.s.sol              # Foundry vault deployment script
docs/
  project/
    architecture.md              # Service architecture and patterns
    vault-setup-guide.md         # Step-by-step vault creation tutorial
```

## Vault setup

If you don't have a Morpho Vault V2 yet:
- [Vault setup guide](docs/rebalancing/vault-setup-guide.md) — step-by-step with `cast` commands
- [Foundry deployment script](script/README.md) — automated deployment on a forked mainnet

## Development

```bash
just dev              # Start the bot
just test             # Run tests
bun run test:coverage # Run tests with coverage report
just check            # Lint + typecheck + tests
```

### End-to-end testing on a forked mainnet

For the full Anvil-fork verification (deploy a vault via the Forge script, run the Anvil-gated integration tests, and `DRY_RUN` the bot end-to-end against the deployed vault), follow the runbook at [`test/anvil-test-procedure.md`](test/anvil-test-procedure.md). It covers the two [`task.md`](task.md) Group 8.5 items that can't run in a no-RPC CI environment.

### Test coverage

| Module | Stmts | Branch | Funcs |
|---|---|---|---|
| config/ | 100% | 100% | 100% |
| core/rebalancer/ | 97.4% | 89.4% | 100% |
| core/chain/ | 95.2% | 98.0% | 96.4% |
| services/ | 97.5% | 76.9% | 100% |
| plugins/ | 76.4% | 95.2% | 87.5% |
| **Overall** | **93.4%** | **91.4%** | **97.0%** |

## v2 roadmap

- Multi-chain support (Base, Arbitrum)
- Event-driven triggers (hybrid cron + WebSocket)
- MEV protection (Flashbots Protect)
- AWS KMS key management
- Historical analytics database
- Multi-vault fleet management

## License

MIT
