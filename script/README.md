# Deployment Script — Morpho Vault V2

Foundry script that deploys a complete Morpho Vault V2 setup against the **real V2 architecture** (verified against [`morpho-org/vault-v2`](https://github.com/morpho-org/vault-v2)):

- One Vault V2 with USDC as the underlying asset
- One `MorphoMarketV1AdapterV2` (V2 has a single adapter per protocol that routes to many Morpho Blue markets via `MarketParams` in the call data)
- Curator role granted to the deployer (`OWNER`)
- Allocator role granted to the bot wallet (`BOT_WALLET`)
- Three cap ids configured per managed market with absolute and relative caps via the curator timelock multicall

> ⚠ **The original script in this repo was rewritten on 2026-04-07.** It used to assume N market adapters per vault and used several function signatures that do not exist on the real V2 contracts. The current script matches the verified V2 ABIs documented in [PLAN.md § Morpho V2 Contract Interactions](../PLAN.md#morpho-v2-contract-interactions) and [PLAN.md § Verified cap-id preimages](../PLAN.md#verified-cap-id-preimages).

---

## Why one adapter, not three?

In Morpho Vault V2, an **adapter** is a per-protocol routing module, not a per-market handle. The single `MorphoMarketV1AdapterV2` instance deployed by this script routes allocations to any Morpho Blue market that satisfies `loanToken == USDC` and `irm == AdaptiveCurveIRM`. The choice of market is encoded in the `bytes` argument the bot passes to `vault.allocate(adapter, abi.encode(marketParams), assets)`.

This means the bot manages **one adapter address** and **N managed markets** configured at startup via `MANAGED_MARKETS_PATH` (a JSON file). The deploy script's job is to:
1. Deploy the vault and the single adapter
2. Set the curator
3. For every managed market in the JSON, set caps for the **3 cap ids** the adapter exposes (`adapterId`, `collateralTokenId`, `marketSpecificId` — see [PLAN.md § Verified cap-id preimages](../PLAN.md#verified-cap-id-preimages))
4. Grant the allocator role to the bot wallet

Steps 2–4 are batched into a single `vault.multicall(...)` because curator timelocks default to `0` at fresh deploy (verified in `morpho-org/vault-v2` source).

---

## Prerequisites

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Verify:

```bash
forge --version
cast --version
```

### forge-std submodule

`lib/forge-std` is checked into this repo as a submodule (commit `b1449bd` adds it). After cloning:

```bash
git submodule update --init --recursive
```

If you need to install it from scratch:

```bash
forge install foundry-rs/forge-std
```

### Compile

```bash
forge build
```

Should succeed with zero warnings.

---

## Environment setup

Create a `.env` file in the project root (or export the variables directly):

```bash
# --- Required ---
OWNER=0xYourDeployerAddress              # Deployer = vault owner = curator. Single EOA for the demo.
BOT_WALLET=0xYourBotWalletAddress        # Receives the allocator role. Least privilege.
PRIVATE_KEY=0xYourDeployerPrivateKey     # Must control OWNER. Has ETH for gas.
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY   # Ethereum mainnet RPC
MANAGED_MARKETS_PATH=./managed-markets.json             # JSON file describing the markets to manage

# --- Optional (sensible defaults) ---
# ABSOLUTE_CAP=500000000000        # 500,000 USDC per cap id (raw uint, 6 decimals). Default: 500_000e6
# RELATIVE_CAP_WAD=1000000000000000000  # WAD (1e18) = "no relative cap". Default: WAD.
                                          # For an explicit 50% cap use 500000000000000000 (5e17).
                                          # NEVER set to 0 — that forbids the market and the bot will refuse to start.
# VAULT_SALT=0x000...              # CREATE2 salt for deterministic vault address. Default: bytes32(0).
```

### managed-markets.json shape

The JSON file referenced by `MANAGED_MARKETS_PATH` must be a top-level array of market entries:

```json
[
  {
    "label":           "USDC/WETH 86%",
    "loanToken":       "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "collateralToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "oracle":          "0xVERIFY_ON_APP_MORPHO_ORG",
    "irm":             "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    "lltv":            "860000000000000000"
  },
  {
    "label":           "USDC/wstETH 86%",
    "loanToken":       "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "collateralToken": "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    "oracle":          "0xVERIFY_ON_APP_MORPHO_ORG",
    "irm":             "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    "lltv":            "860000000000000000"
  },
  {
    "label":           "USDC/WBTC 86%",
    "loanToken":       "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "collateralToken": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    "oracle":          "0xVERIFY_ON_APP_MORPHO_ORG",
    "irm":             "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    "lltv":            "860000000000000000"
  }
]
```

Required field rules:
- `loanToken` **must** equal USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`). The script reverts with `WrongLoanToken(index, got, expected)` otherwise.
- `irm` **must** equal `AdaptiveCurveIRM` (`0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC`). The adapter only supports markets using this IRM. The script reverts with `WrongIRM(index, got, expected)` otherwise.
- `lltv` is a decimal **string** representing the LLTV in WAD. Common values: `"860000000000000000"` (86%), `"915000000000000000"` (91.5%).

A working example is at `managed-markets.example.json` in the repo root.

### Finding oracle addresses and LLTVs

Browse [app.morpho.org](https://app.morpho.org) and find the live USDC market for each collateral token. The market detail page shows the exact oracle address and LLTV. You can also query Morpho Blue directly:

```bash
cast call 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb \
  "idToMarketParams(bytes32)" <MARKET_ID> \
  --rpc-url $RPC_URL
```

---

## Running on a forked mainnet (recommended first step)

Test the full deployment without spending real ETH or USDC:

```bash
source .env

forge script script/DeployVault.s.sol \
  --fork-url $RPC_URL \
  --broadcast \
  -vvvv
```

The `-vvvv` flag prints every transaction and the post-deployment verification reads. Look for the **DEPLOYMENT SUMMARY** block at the end — it prints the vault address, adapter address, all 3 cap ids per market, and a ready-to-paste `MANAGED_MARKETS JSON` block plus the `.env` lines for `VAULT_ADDRESS` and `ADAPTER_ADDRESS`.

### Using Anvil for interactive testing

For more control, run Anvil in one terminal and the script in another:

```bash
# Terminal 1 — start Anvil fork
anvil --fork-url $RPC_URL --chain-id 1

# Terminal 2 — run script against the fork
forge script script/DeployVault.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  -vvvv
```

This is the recommended setup for the bot's integration tests, which gate themselves on `ANVIL_RPC_URL` and need a deployed vault to read against.

---

## Running on mainnet (production)

Only after a successful fork run:

```bash
source .env

forge script script/DeployVault.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

The `--verify` flag attempts to verify the script's auxiliary contracts on Etherscan (requires `ETHERSCAN_API_KEY`). The vault and adapter themselves are deployed by the official factories and are already verified.

---

## What the script does

1. **STEP A — Read & validate JSON**. Parses every entry in `MANAGED_MARKETS_PATH`, asserts `loanToken == USDC` and `irm == AdaptiveCurveIRM` for each, prints the parsed market params to console.

2. **STEP B — Deploy vault**. `VaultV2Factory.createVaultV2(deployer, USDC, salt)` — owner / asset / salt order. Returns the new vault address.

3. **STEP C — Deploy adapter**. `MorphoMarketV1AdapterV2Factory.createMorphoMarketV1AdapterV2(vault)`. Single adapter per vault, no MarketParams at deploy time.

4. **STEP D — Set curator**. `vault.setCurator(deployer)`. Owner-only, NOT timelocked. Runs immediately, outside the multicall.

5. **STEP E — Build multicall**. Constructs an array of `2 + numMarkets * 3 * 4 + 2` calls:
   - `submit(addAdapter)` + `addAdapter(adapter)`
   - For each market and each of 3 cap ids: `submit(increaseAbsoluteCap)` + `increaseAbsoluteCap(idData, ABSOLUTE_CAP)` + `submit(increaseRelativeCap)` + `increaseRelativeCap(idData, RELATIVE_CAP_WAD)`
   - `submit(setIsAllocator)` + `setIsAllocator(BOT_WALLET, true)`

6. **STEP F — Execute multicall**. `vault.multicall(calls)`. With timelock=0, every `submit` is immediately followed by its execution in the same transaction.

7. **STEP G — Verification reads**. Reads back every cap and asserts it matches the value the script wrote. Refuses to declare success if any `relativeCap` was stored as 0 (which would forbid the market). Asserts `vault.adaptersLength() == 1`, `vault.adaptersAt(0) == adapter`, `vault.isAllocator(BOT_WALLET) == true`.

8. **STEP H — Console summary**. Prints the deployment summary, every cap id (in hex) with its absolute cap (formatted as USDC) and relative cap (raw WAD + human-readable percent), and a ready-to-paste JSON + `.env` block.

### Cap ids — the 3 per market

The script writes caps for **all 3 cap ids** the adapter exposes via `adapter.ids(marketParams)`:

| # | Semantics | Preimage `idData` |
|---|---|---|
| 0 | Adapter-wide cap | `abi.encode("this", adapter)` |
| 1 | Collateral-token cap | `abi.encode("collateralToken", marketParams.collateralToken)` |
| 2 | Market-specific cap | `abi.encode("this/marketParams", adapter, marketParams)` |

Each cap id is `keccak256(idData)`. **All 3 must have `absoluteCap > 0`** for `vault.allocate(...)` to succeed — that's why the script writes all three. See [PLAN.md § Verified cap-id preimages](../PLAN.md#verified-cap-id-preimages) for the source-verified definitions.

### Why `relativeCap` defaults to WAD

`relativeCap` is in **WAD** (`1e18` = 100%), not basis points. Special values:
- `WAD` (`1e18`) — sentinel meaning "no relative cap, rely on `absoluteCap` as the hard ceiling"
- `0` — `allocation <= 0`, i.e. forbids the market entirely. **The bot refuses to start if it sees this** (per [SPEC Story A2](../SPEC.md))

The script defaults to `WAD` so a fresh deploy never accidentally writes `0`. Operators wanting an explicit relative cap can pass e.g. `RELATIVE_CAP_WAD=500000000000000000` (5e17) for 50%.

---

## Verifying the deployment

After the script completes, the **DEPLOYMENT SUMMARY** block in the console output is the source of truth. To re-verify on demand:

```bash
# Replace <VAULT> and <ADAPTER> with the addresses from the script output

# Vault basics
cast call <VAULT> "asset()(address)" --rpc-url $RPC_URL                  # → USDC
cast call <VAULT> "adaptersLength()(uint256)" --rpc-url $RPC_URL          # → 1
cast call <VAULT> "adaptersAt(uint256)(address)" 0 --rpc-url $RPC_URL     # → <ADAPTER>
cast call <VAULT> "isAllocator(address)(bool)" <BOT_WALLET> --rpc-url $RPC_URL  # → true

# Per-market: read each of the 3 cap ids
# (Replace <CAP_ID> with the hash printed in the console summary.)
cast call <VAULT> "absoluteCap(bytes32)(uint256)" <CAP_ID> --rpc-url $RPC_URL
cast call <VAULT> "relativeCap(bytes32)(uint256)" <CAP_ID> --rpc-url $RPC_URL
cast call <VAULT> "allocation(bytes32)(uint256)" <CAP_ID> --rpc-url $RPC_URL    # → 0 before any deposit

# Adapter parent
cast call <ADAPTER> "parentVault()(address)" --rpc-url $RPC_URL          # → <VAULT>
```

---

## Troubleshooting

| Issue | Root cause | Fix |
|---|---|---|
| `WrongLoanToken(index, got, USDC)` | A market in your JSON has `loanToken != USDC` | Edit `managed-markets.json` so every entry uses USDC. The single adapter only supports USDC-loan markets because the vault asset is USDC. |
| `WrongIRM(index, got, AdaptiveCurveIRM)` | A market uses a non-AdaptiveCurve IRM | The adapter enforces `irm == AdaptiveCurveIRM` at allocate time. Pick a market that uses `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC`. |
| `DeployVault: RELATIVE_CAP_WAD is 0 ...` | You set `RELATIVE_CAP_WAD=0` | Set it to `1000000000000000000` (WAD) for "no cap" or any value in `(0, WAD]`. Never 0 — that forbids the market and the bot will refuse to start (SPEC Story A2). |
| `VerificationFailed("absoluteCap mismatch ...")` | The vault is in a state where caps cannot be increased to the requested value | Check the existing caps with `cast call <VAULT> "absoluteCap(bytes32)" <id>` — `increaseAbsoluteCap` only allows the new value to be ≥ the current one. |
| `forge: command not found` | Foundry not installed | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Submodule missing | Fresh clone without submodules | `git submodule update --init --recursive` |
| `forge script` reverts on the first call | Wrong RPC, wrong key, or insufficient ETH | Confirm `cast wallet address --private-key $PRIVATE_KEY` matches `OWNER` and that the wallet has ETH for gas |

---

## Next steps after a successful deployment

1. **Copy the printed `MANAGED_MARKETS JSON`** from the script output into a permanent file at `MANAGED_MARKETS_PATH`. The bot reads this on startup.
2. **Add `VAULT_ADDRESS` and `ADAPTER_ADDRESS`** to your bot's `.env` (the script prints both at the bottom of STEP H).
3. **Start the bot**: `bun run dev`. On startup, the bot calls `VaultReader.assertStartupInvariants(BOT_WALLET)`, which:
   - Verifies the configured adapter is enabled on the vault
   - Verifies the bot wallet has the allocator role
   - Verifies all 3 cap ids per market have `absoluteCap > 0` (ignores markets without caps)
   - **Refuses to start** if any `relativeCap == 0` with the explicit error message from [SPEC Story A2](../SPEC.md)
4. **Monitor**: `GET /api/v1/status` returns the per-market state (allocation, caps, percentages).

For the full bot configuration and rebalancing flow, see the project [README](../README.md), [SPEC.md](../SPEC.md), and [PLAN.md](../PLAN.md).
