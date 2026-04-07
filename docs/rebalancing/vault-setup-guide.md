# Vault V2 Setup Guide — USDC with N Morpho Blue Markets

> Step-by-step guide to deploying a Morpho Vault V2 for USDC and configuring it to lend across multiple Morpho Blue markets on Ethereum mainnet, ready for the rebalancing bot to manage.

> **⚠ Rewritten 2026-04-07.** The original version of this guide assumed N market adapters per vault. Morpho Vault V2 actually exposes **one adapter per protocol** that routes to many Morpho Blue markets via `MarketParams` in the call data. Every command and signature in this guide has been verified against [`morpho-org/vault-v2`](https://github.com/morpho-org/vault-v2) source.

---

## Mental model — single adapter, N markets

In Morpho Vault V2, an **adapter** is a per-protocol routing module, not a per-market handle. The single `MorphoMarketV1AdapterV2` instance you deploy here handles **every** Morpho Blue USDC market that uses the AdaptiveCurveIRM. The bot picks which market to allocate to at runtime by encoding the target `MarketParams` into the `bytes` argument of `vault.allocate(adapter, abi.encode(marketParams), assets)`.

This means there are two layers of configuration:

| Layer | Where | Stored where |
|---|---|---|
| **Which markets are authorized** | Curator sets caps on the vault for each market's 3 cap ids | On-chain (vault storage) |
| **Which markets the bot considers** | `MANAGED_MARKETS_PATH` JSON file | Off-chain (bot config) |

The bot at startup walks the JSON list and asserts the on-chain caps are set for every entry. Markets without caps are ignored. Markets with `relativeCap == 0` cause the bot to refuse to start with an explicit error (per [SPEC Story A2](../../SPEC.md)).

## Role model

V2 uses a custom role system, **not** OpenZeppelin AccessControl. The roles, in order of trust:

| Role | Powers | How granted |
|---|---|---|
| **Owner** | Sets curator + sentinels; sets vault name/symbol | Constructor (the address passed to `createVaultV2`) |
| **Curator** | Configures adapters, caps, allocators, fees, gates, timelocks | `vault.setCurator(addr)` — owner-only, NOT timelocked |
| **Allocator** | Calls `allocate` / `deallocate` / `setLiquidityAdapterAndData` | `vault.setIsAllocator(addr, true)` — curator, timelocked |
| **Sentinel** | Emergency derisk: revoke pending actions, decrease caps | `vault.setIsSentinel(addr, true)` — owner |

For the demo deployment in this repo, **the deployer is owner AND curator**. This is the simplest setup — one EOA does the entire configuration in a single Forge script run. The bot wallet receives only the allocator role (least privilege). For production, you should split owner / curator into a multisig and a separate operator EOA.

> **Curator timelocks default to 0 at fresh deploy.** This is verified in the V2 source. It lets the deployment script batch every curator action (`addAdapter`, every cap change, `setIsAllocator`) into a single `vault.multicall(...)` transaction. After deployment you can call `increaseTimelock(selector, duration)` to enforce a delay on subsequent changes.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **ETH** | ~0.05 ETH in your deployer wallet for gas (mainnet). 0 ETH for fork testing. |
| **Foundry** | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| **forge-std** | Tracked as a submodule in this repo. Run `git submodule update --init --recursive` after cloning. |
| **RPC URL** | Ethereum mainnet RPC (Alchemy, Infura, or your own node) |
| **Two wallets** | (1) Deployer / owner / curator EOA; (2) Bot wallet that will receive the allocator role |
| **Bot config decided** | Which Morpho Blue USDC markets the bot will manage (e.g. USDC/WETH, USDC/wstETH, USDC/WBTC) |

### Key contract addresses (Ethereum mainnet)

| Contract | Address |
|---|---|
| VaultV2Factory | `0xA1D94F746dEfa1928926b84fB2596c06926C0405` |
| MorphoMarketV1AdapterV2Factory | `0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1` |
| AdaptiveCurveIRM | `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` |
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| WETH (collateral) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| wstETH (collateral) | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |
| WBTC (collateral) | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` |

---

## Recommended path: use the Foundry script

The repo includes [`script/DeployVault.s.sol`](../../script/DeployVault.s.sol) which automates **every** step in this guide in one transaction. **You should use the script unless you have a specific reason to do it manually.** See [`script/README.md`](../../script/README.md) for the full script docs (env vars, JSON shape, troubleshooting).

Quick start:

```bash
# 1. Install forge-std submodule (one-time)
git submodule update --init --recursive

# 2. Compile
forge build

# 3. Configure .env
cat > .env <<EOF
OWNER=0xYourDeployerAddress
BOT_WALLET=0xYourBotWalletAddress
PRIVATE_KEY=0xYourDeployerPrivateKey
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
MANAGED_MARKETS_PATH=./managed-markets.json
EOF

# 4. Create managed-markets.json (see script/README.md for the shape)

# 5. Dry-run on a forked mainnet first
source .env
forge script script/DeployVault.s.sol \
  --fork-url $RPC_URL \
  --broadcast \
  -vvvv

# 6. After verifying the fork run, repeat against mainnet (no --fork-url)
forge script script/DeployVault.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

The script prints a **DEPLOYMENT SUMMARY** at the end with the vault address, adapter address, every cap id (in hex with absolute and relative caps formatted), and a ready-to-paste `MANAGED_MARKETS JSON` block plus the `.env` lines for `VAULT_ADDRESS` and `ADAPTER_ADDRESS` you'll add to the bot's config.

---

## Doing it manually with `cast` (advanced)

If you need to deploy without the script — for instance if you want to use a hardware wallet via a custom signer — here is the equivalent step-by-step using `cast`. Each step matches one of the script's stages.

### Step 1: Deploy the vault

```bash
cast send 0xA1D94F746dEfa1928926b84fB2596c06926C0405 \
  "createVaultV2(address,address,bytes32)(address)" \
  $OWNER \
  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

Parameters:
- `owner`: your deployer EOA (will also become the curator in step 4)
- `asset`: USDC
- `salt`: `bytes32(0)` for a non-deterministic deploy. Use a different salt to get a deterministic CREATE2 address.

> The factory does **not** take name/symbol parameters. Vault name and symbol are set later via owner-only `setName` / `setSymbol` calls if needed.

**Save the returned vault address** as `$VAULT`.

### Step 2: Deploy the single adapter

```bash
cast send 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1 \
  "createMorphoMarketV1AdapterV2(address)(address)" \
  $VAULT \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

The adapter is deployed with the vault as its parent. It wires Morpho Blue (`0xBBBB...EFFCb`) and AdaptiveCurveIRM (`0x870a...00BC`) as immutables from the factory. **No `MarketParams` at deploy time** — the adapter routes to any market that satisfies `loanToken == USDC` and `irm == AdaptiveCurveIRM`.

**Save the returned adapter address** as `$ADAPTER`.

### Step 3: Set yourself as the curator

```bash
cast send $VAULT \
  "setCurator(address)" \
  $OWNER \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

This is owner-only and **not** timelocked. After this call you (the owner) are also the curator and can configure the vault.

### Step 4: Compute the cap ids for each market

For each Morpho Blue market you want the bot to manage, compute the 3 cap ids the adapter exposes. Pseudocode (use a small Solidity helper or the Forge script's `_buildIdDatas` function):

```
adapterIdData         = abi.encode("this", $ADAPTER)
collateralIdData[mkt] = abi.encode("collateralToken", marketParams.collateralToken)
marketIdData[mkt]     = abi.encode("this/marketParams", $ADAPTER, marketParams)

adapterId         = keccak256(adapterIdData)
collateralId[mkt] = keccak256(collateralIdData[mkt])
marketId[mkt]     = keccak256(marketIdData[mkt])
```

These exact preimages are verified against [`MorphoMarketV1AdapterV2.sol`](https://github.com/morpho-org/vault-v2/blob/main/src/adapters/MorphoMarketV1AdapterV2.sol#L267) and documented in [PLAN.md § Verified cap-id preimages](../../PLAN.md#verified-cap-id-preimages). **Any deviation in the preimage produces a different `keccak256`, and `vault.allocate(...)` will revert with `ZeroAbsoluteCap` at runtime.** The Forge script removes all chance of preimage drift; the manual path is error-prone.

You can verify your local computation against the on-chain truth by calling:

```bash
cast call $ADAPTER \
  "ids((address,address,address,address,uint256))(bytes32[])" \
  "($USDC,$COLLATERAL,$ORACLE,$IRM,$LLTV)" \
  --rpc-url $RPC_URL
```

This returns the 3 cap ids as the adapter computes them. They MUST match your locally derived values.

### Step 5: Set caps for each cap id

Curator config is timelocked, but the timelock defaults to 0, so you `submit` and execute in two consecutive transactions (or batch them via `vault.multicall(...)`).

For each market and each of its 3 cap ids, set both absolute and relative caps:

```bash
# 1. Submit increaseAbsoluteCap
cast send $VAULT \
  "submit(bytes)" \
  $(cast calldata "increaseAbsoluteCap(bytes,uint256)" $ID_DATA 500000000000) \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# 2. Execute it (timelock=0, immediately)
cast send $VAULT \
  "increaseAbsoluteCap(bytes,uint256)" \
  $ID_DATA 500000000000 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# 3. Submit increaseRelativeCap
cast send $VAULT \
  "submit(bytes)" \
  $(cast calldata "increaseRelativeCap(bytes,uint256)" $ID_DATA 1000000000000000000) \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# 4. Execute it
cast send $VAULT \
  "increaseRelativeCap(bytes,uint256)" \
  $ID_DATA 1000000000000000000 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

Repeat for each of the 3 ids per market. For 3 markets × 3 ids × 2 caps × 2 transactions (submit + execute) = **36 transactions**. The Forge script does this in a single multicall.

#### Important: cap units

| Cap | Unit | Notes |
|---|---|---|
| `absoluteCap` | uint256 in USDC native decimals (6) | `500000000000` = 500,000 USDC. Must be > 0 on every id for `allocate` to succeed. |
| `relativeCap` | **uint256 in WAD** (1e18 = 100%) | `1000000000000000000` (= WAD) means "no relative cap". `500000000000000000` (= 5e17) means 50%. **Never 0** — that forbids the market and the bot will refuse to start. |

### Step 6: Grant the allocator role to the bot wallet

Same submit-then-execute pattern (timelocked but timelock=0):

```bash
cast send $VAULT \
  "submit(bytes)" \
  $(cast calldata "setIsAllocator(address,bool)" $BOT_WALLET true) \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

cast send $VAULT \
  "setIsAllocator(address,bool)" \
  $BOT_WALLET true \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

### Step 7: Verify the full setup

```bash
# Vault basics
cast call $VAULT "asset()(address)" --rpc-url $RPC_URL                  # → USDC
cast call $VAULT "totalAssets()(uint256)" --rpc-url $RPC_URL            # → 0 before any deposit

# Adapter is enabled
cast call $VAULT "adaptersLength()(uint256)" --rpc-url $RPC_URL         # → 1
cast call $VAULT "adaptersAt(uint256)(address)" 0 --rpc-url $RPC_URL    # → $ADAPTER

# Bot wallet has allocator role
cast call $VAULT "isAllocator(address)(bool)" $BOT_WALLET --rpc-url $RPC_URL  # → true

# Caps for each id (per market)
cast call $VAULT "absoluteCap(bytes32)(uint256)" $ID --rpc-url $RPC_URL
cast call $VAULT "relativeCap(bytes32)(uint256)" $ID --rpc-url $RPC_URL  # → 1000000000000000000 (WAD) by default

# Adapter parent
cast call $ADAPTER "parentVault()(address)" --rpc-url $RPC_URL          # → $VAULT
```

> **Note:** There is no `realAssets()` per market in V2 — the bot reads `vault.allocation(id)` for the market-specific cap id (`id[2]`) instead. See [PLAN.md § MorphoMarketV1AdapterV2](../../PLAN.md#morphomarketv1adapterv2-single-adapter-per-vault).

---

## Testing on a fork first

**Always test on a forked mainnet before deploying to production.** Two options:

### Option A — Direct fork via the script

```bash
forge script script/DeployVault.s.sol \
  --fork-url $RPC_URL \
  --broadcast \
  -vvvv
```

`--broadcast` against `--fork-url` simulates the transactions in a forked context without actually sending them to mainnet. The post-deployment verification reads in the script (STEP G) confirm everything worked.

### Option B — Persistent Anvil fork for integration testing

```bash
# Terminal 1 — start Anvil
anvil --fork-url $RPC_URL --chain-id 1

# Terminal 2 — run script against the fork
export RPC_URL=http://127.0.0.1:8545
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # default Anvil acct 0
export OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266                                # acct 0 address
export BOT_WALLET=0x70997970C51812dc3A010C7d01b50e0d17dc79C8                           # acct 1 address
forge script script/DeployVault.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  -vvvv
```

The persistent Anvil instance is also what the bot's Anvil-gated integration tests use. After the script finishes, set `ANVIL_RPC_URL=http://127.0.0.1:8545` and run `bun test` to exercise the chain reader and executor against the deployed vault.

---

## Next steps — connect the bot

Once the vault and adapter are deployed and verified:

1. **Update `.env`** with the deployed addresses:
   ```bash
   VAULT_ADDRESS=0x...     # printed by the script in STEP H
   ADAPTER_ADDRESS=0x...   # printed by the script in STEP H
   MANAGED_MARKETS_PATH=./managed-markets.json
   ```
2. **Save the `MANAGED_MARKETS_PATH` JSON** — copy the JSON block from the script's STEP H output into `managed-markets.json`. Confirm every entry's `oracle` is the value you actually want (the script doesn't validate the oracle, only `loanToken` and `irm`).
3. **Start the bot** — `bun run dev`. The bot will:
   - Load `MANAGED_MARKETS_PATH`
   - Construct `VaultReader(publicClient, VAULT_ADDRESS, ADAPTER_ADDRESS, managedMarkets)`
   - Call `vaultReader.assertStartupInvariants(BOT_WALLET)` which:
     - Verifies the configured adapter is enabled on the vault
     - Verifies `adapter.parentVault() == VAULT_ADDRESS`
     - Verifies `vault.isAllocator(BOT_WALLET) == true`
     - Verifies the locally computed cap ids match `adapter.ids(marketParams)` (catches abi-encoding bugs)
     - Refuses to start if any `relativeCap == 0` with the explicit error message from [SPEC Story A2](../../SPEC.md)
     - Excludes markets without `absoluteCap > 0` and logs `"ignored: no absolute cap configured"`
4. **(Optional) Seed the vault with USDC** — `cast send $USDC "approve(address,uint256)" $VAULT 1000000000` then `cast send $VAULT "deposit(uint256,address)" 1000000000 $YOU`. The bot only operates on what's already in the vault.
5. **Monitor** — `GET /api/v1/status` returns the per-market state (allocation, all 3 caps per market, percentage of total). Watch for Telegram alerts on rebalance executions and failures.

For the bot's operational details, see the project [`README.md`](../../README.md), [`SPEC.md`](../../SPEC.md), and [`PLAN.md`](../../PLAN.md).
