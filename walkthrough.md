# How to run — Morpho V2 Rebalancing Bot

A backend-only Bun + Fastify service that automates allocation rebalancing for a Morpho Vault V2 across Morpho Blue lending markets on Ethereum mainnet. **One adapter per vault, N managed markets** configured at startup via JSON (the V2 architecture — verified against [`morpho-org/vault-v2`](https://github.com/morpho-org/vault-v2)).

> **Architecture overview**: see [`SPEC.md`](SPEC.md), [`PLAN.md`](PLAN.md), [`docs/rebalancing/architecture.md`](docs/rebalancing/architecture.md). For the Morpho V2 model and verified ABIs, see [`PLAN.md § Morpho V2 Contract Interactions`](PLAN.md#morpho-v2-contract-interactions) and [`PLAN.md § Verified cap-id preimages`](PLAN.md#verified-cap-id-preimages).

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Bun** ≥ 1.0 | `curl -fsSL https://bun.sh/install \| bash` — runtime + package manager + test runner |
| **Foundry** | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` — needed only for the deploy script in `script/` |
| **forge-std submodule** | Tracked at `lib/forge-std`. After cloning run `git submodule update --init --recursive` |
| **Ethereum mainnet RPC URL** | Alchemy, Infura, or your own node. HTTPS endpoint. |
| **Two EOAs** | (1) **Deployer / owner / curator** — runs the deploy script; (2) **Bot wallet** — receives the allocator role and signs rebalance txs from the bot process |
| **(Optional) Anvil** | For local fork testing of the deploy script and the gated integration tests. Comes bundled with Foundry. |
| **(Optional) Telegram bot** | Create one via [@BotFather](https://t.me/BotFather), capture the bot token and chat id |

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url> demo-bot-rebalancing
cd demo-bot-rebalancing
git submodule update --init --recursive
just install        # or: bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Required variables (validated by zod at startup — bot refuses to start with anything missing or malformed):

| Var | Purpose |
|---|---|
| `RPC_URL` | Ethereum mainnet HTTPS RPC endpoint |
| `PRIVATE_KEY` | Bot wallet private key — must hold the allocator role on the vault and ETH for gas |
| `VAULT_ADDRESS` | The deployed Morpho Vault V2 address (set after running the deploy script) |
| `ADAPTER_ADDRESS` | The deployed `MorphoMarketV1AdapterV2` address (set after running the deploy script) |
| `MANAGED_MARKETS_PATH` | Absolute or relative path to a JSON file describing the markets the bot manages |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | Telegram chat id to post alerts to |

Optional with sensible defaults:

| Var | Default | Description |
|---|---|---|
| `CRON_SCHEDULE` | `*/5 * * * *` | How often the cron loop checks for rebalancing |
| `DRIFT_THRESHOLD_BPS` | `500` (5%) | Minimum drift before a rebalance is triggered |
| `GAS_CEILING_GWEI` | `50` | Skips execution if network gas price exceeds this |
| `MIN_ETH_BALANCE` | `0.05` | Alert when bot wallet ETH drops below this |
| `PORT` | `3000` | HTTP server port |
| `DRY_RUN` | `false` | Log proposed actions without submitting transactions |
| `MAX_MARKET_CONCENTRATION_PCT` | `10` | Max % of a market's total supply to allocate |
| `MIN_LIQUIDITY_MULTIPLIER` | `2` | Reject markets with liquidity < N× allocation |

### 3. Create the managed-markets JSON

The bot reads the list of Morpho Blue markets it manages from the file pointed to by `MANAGED_MARKETS_PATH`. See `managed-markets.example.json` for the shape:

```json
[
  {
    "label":           "USDC/WETH 86%",
    "loanToken":       "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "collateralToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "oracle":          "0xVERIFY_ON_APP_MORPHO_ORG",
    "irm":             "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    "lltv":            "860000000000000000"
  }
]
```

Rules: every entry's `loanToken` must equal USDC, every `irm` must equal `AdaptiveCurveIRM` (`0x870a...00BC`), and `lltv` is a decimal **string** in WAD. Find oracle addresses and live LLTVs for USDC markets at [app.morpho.org](https://app.morpho.org).

### 4. Deploy the vault (once, per environment)

The deploy script in `script/DeployVault.s.sol` deploys the vault, the single adapter, and configures all 3 cap ids per market plus the allocator role in a single multicall transaction. See [`script/README.md`](script/README.md) for the full instructions and troubleshooting.

Quick path against an Anvil fork (always test on a fork before mainnet):

```bash
# Terminal 1 — start Anvil fork
anvil --fork-url $RPC_URL --chain-id 1

# Terminal 2 — deploy
export OWNER=0xYourDeployer
export BOT_WALLET=0xYourBotWallet
export PRIVATE_KEY=0xYourDeployerKey
export RPC_URL=http://127.0.0.1:8545
export MANAGED_MARKETS_PATH=./managed-markets.json

forge script script/DeployVault.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  -vvvv
```

The script's STEP H console output prints the `VAULT_ADDRESS` and `ADAPTER_ADDRESS` to copy into the bot's `.env`, plus a ready-to-paste `MANAGED_MARKETS JSON` block. For mainnet, drop `--fork-url` and use your mainnet RPC.

---

## Development

### Run the bot

```bash
just dev          # or: bun run src/index.ts
```

On startup the bot will:

1. Validate every env var via zod (`src/config/env.ts`)
2. Load the managed markets JSON (`src/config/managed-markets.ts`)
3. Construct `VaultReader` and run `assertStartupInvariants(BOT_WALLET)`:
   - Asserts the configured adapter is enabled on the vault
   - Asserts `adapter.parentVault() == VAULT_ADDRESS`
   - Asserts `vault.isAllocator(BOT_WALLET) == true`
   - Asserts every locally computed cap id matches `adapter.ids(marketParams)` exactly (catches abi-encoding bugs deterministically)
   - **Refuses to start** if any managed market has `relativeCap == 0` on any of its 3 cap ids, with the explicit error message from [`SPEC § Story A2`](SPEC.md)
   - Excludes markets with `absoluteCap == 0` on any id and logs `"ignored: no absolute cap configured"`
4. Start the Fastify server, register cron via croner, and begin the rebalance loop

If any startup invariant fails, the bot logs the failure and exits **before** starting the HTTP server — no traffic is accepted against a misconfigured vault.

### Quality gate

```bash
just check        # lint + typecheck + test  (used by CI and the /check skill)
```

Individual gates:

```bash
just lint         # bunx tsc --noEmit
just typecheck    # bunx tsc --noEmit
just test         # vitest run
```

Current state: **12 test files, 398 passed, 14 skipped (Anvil-gated), 0 failed**.

### Anvil-gated integration tests

Some tests in `test/integration/` need a deployed vault on a forked mainnet to run. They're skipped by default and gated on `process.env.ANVIL_RPC_URL`. To run them:

```bash
# Terminal 1 — start Anvil fork
anvil --fork-url $MAINNET_RPC_URL --chain-id 1

# Terminal 2 — deploy a vault with the script (see Setup step 4)
forge script script/DeployVault.s.sol --rpc-url http://127.0.0.1:8545 --broadcast -vvvv

# Terminal 2 — run gated tests against the deployed vault
export ANVIL_RPC_URL=http://127.0.0.1:8545
export VAULT_ADDRESS=0x...      # printed by the deploy script
export ADAPTER_ADDRESS=0x...    # printed by the deploy script
export BOT_WALLET=0x...         # the EOA you granted the allocator role
just test
```

Without `ANVIL_RPC_URL`, the gated tests are skipped (not failures).

### Dry-run

```bash
DRY_RUN=true just dev
```

The bot logs every proposed rebalance action without submitting transactions. Useful for verifying the strategy and the Anvil deployment end-to-end.

### Build for production

```bash
just build        # bun build src/index.ts --outdir dist --target bun
just start        # bun run dist/index.js  (after build)
```

---

## Key URLs

The Fastify server listens on `PORT` (default `3000`):

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health`            | Liveness + last cron tick + last rebalance + uptime. Returns `503` when the last cron tick is older than 2× the configured interval. |
| `GET`  | `/api/v1/status`     | Per-market state: vault + adapter addresses, total assets, every managed market with allocation, percentage, and all 3 caps (id, absolute, relative). Reads live on-chain state on every request. |
| `POST` | `/api/v1/rebalance`  | Manually trigger one rebalance cycle (read → compute → execute → notify). Returns `409` if a cycle is already running. Body is ignored. |

Example smoke test once the bot is running:

```bash
curl -s http://localhost:3000/health | jq
curl -s http://localhost:3000/api/v1/status | jq
curl -s -X POST http://localhost:3000/api/v1/rebalance | jq
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Refusing to start: market <label> has relativeCap == 0 on cap id <id> ...` | The vault has `relativeCap == 0` on one of the 3 cap ids for a managed market | The intended "no relative cap" sentinel is `WAD` (`1e18`). Have the curator call `vault.increaseRelativeCap(idData, WAD)` for the offending id. If you meant to forbid the market, remove it from `MANAGED_MARKETS_PATH`. |
| `StartupValidationError: locally computed cap id [N] for market <label> does not match adapter.ids(...)` | The bot's local abi-encoding of the cap id preimage doesn't match what the on-chain adapter computes — typically because `MarketParams` was misconfigured | Verify every field of the market entry against the live Morpho Blue market on app.morpho.org. The 3 preimages are documented in [`PLAN.md § Verified cap-id preimages`](PLAN.md#verified-cap-id-preimages). |
| `StartupValidationError: configured adapter is not enabled on the vault` | `ADAPTER_ADDRESS` doesn't match any of the vault's enabled adapters | Re-deploy with `script/DeployVault.s.sol` and copy the printed addresses, OR have the curator call `vault.addAdapter(adapter)` to enable an existing adapter. |
| `StartupValidationError: BOT_WALLET is not an allocator` | The bot wallet hasn't been granted the allocator role | Have the curator call `vault.setIsAllocator(BOT_WALLET, true)`. |
| `gas ceiling exceeded` in logs | Network gas price > `GAS_CEILING_GWEI` | Either raise `GAS_CEILING_GWEI` in `.env` or wait for gas to drop. The bot logs and skips rather than submitting at the elevated price. |
| `409` from `POST /api/v1/rebalance` | A cycle is already running (cron + manual trigger collision) | Wait for the in-flight cycle to finish. The cycle lock is per-process. |
| Telegram alerts not arriving | `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` wrong, or Telegram API unreachable | Telegram failures NEVER block rebalancing — check the bot logs for `Failed to send Telegram alert` lines. Confirm the bot has been started in your chat (send `/start` to it) and that the chat id is correct. |
