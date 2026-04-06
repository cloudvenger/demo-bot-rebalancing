# How to run Morpho V2 Rebalancing Bot

## Prerequisites

- [Bun](https://bun.sh) v1.0+ (runtime)
- An Ethereum RPC endpoint (Alchemy, Infura, or any mainnet node)
- A wallet with the **Allocator** role on your Morpho Vault V2
- ETH in the wallet for gas
- A Telegram bot token + chat ID (create via [@BotFather](https://t.me/BotFather))
- [Foundry](https://book.getfoundry.sh) (optional — only for the vault deployment script)

## Setup

```bash
# Install dependencies
bun install

# Copy environment template and fill in your values
cp .env.example .env
```

### Required environment variables

| Variable | Description |
|---|---|
| `RPC_URL` | Ethereum mainnet RPC endpoint |
| `PRIVATE_KEY` | Wallet private key (Allocator role on your vault) |
| `VAULT_ADDRESS` | Your Morpho Vault V2 contract address |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Telegram chat ID to receive alerts |

### Optional environment variables (with defaults)

| Variable | Default | Description |
|---|---|---|
| `CRON_SCHEDULE` | `*/5 * * * *` | How often to check for rebalancing |
| `DRIFT_THRESHOLD_BPS` | `500` (5%) | Minimum drift to trigger rebalance |
| `GAS_CEILING_GWEI` | `50` | Max gas price — skips execution if exceeded |
| `MIN_ETH_BALANCE` | `0.05` | Alert when wallet ETH drops below this |
| `PORT` | `3000` | HTTP server port |
| `DRY_RUN` | `false` | Log actions without submitting transactions |
| `MAX_MARKET_CONCENTRATION_PCT` | `10` | Max % of a market's total supply to allocate |
| `MIN_LIQUIDITY_MULTIPLIER` | `2` | Reject markets with liquidity < Nx allocation |

## Development

```bash
# Start the bot
bun run dev

# Run tests
bun run test

# Type check
bun run typecheck

# Full quality gate (typecheck + tests)
bun run lint && bun run test
```

Or use the justfile:

```bash
just dev          # Start the bot
just test         # Run tests
just check        # Lint + typecheck + tests
```

## Key URLs

| Endpoint | Method | Description |
|---|---|---|
| `http://localhost:3000/health` | GET | Health check — 200 ok / 503 degraded |
| `http://localhost:3000/api/v1/status` | GET | Current vault allocations and bot state |
| `http://localhost:3000/api/v1/rebalance` | POST | Manually trigger a rebalance cycle |

## Dry-run mode

Set `DRY_RUN=true` in `.env` to run the bot without submitting transactions. The bot will read on-chain state, compute optimal allocations, and log proposed actions — but will not call `allocate()` or `deallocate()` on the vault.

## Vault setup

If you don't have a Morpho Vault V2 yet, see:
- [docs/rebalancing/vault-setup-guide.md](docs/rebalancing/vault-setup-guide.md) — step-by-step guide
- [script/README.md](script/README.md) — Foundry deployment script

## Architecture

See [docs/rebalancing/architecture.md](docs/rebalancing/architecture.md) for the service architecture, error boundary pattern, and hybrid IRM approach.
