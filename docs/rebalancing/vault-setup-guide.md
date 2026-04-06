# Vault V2 Setup Guide — USDC with 3 Morpho Blue Markets

> Step-by-step guide to creating a Morpho Vault V2 for USDC and connecting it to 3 Morpho Blue lending markets on Ethereum mainnet.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **ETH** | Sufficient ETH in your deployer wallet for gas (~0.1 ETH recommended) |
| **USDC** | USDC to seed the vault after setup (optional for the deployment itself) |
| **Foundry** | Install via `curl -L https://foundry.paradigm.xyz | bash && foundryup` |
| **RPC URL** | An Ethereum mainnet RPC endpoint (Alchemy, Infura, or your own node) |
| **Private key** | The deployer wallet's private key (this wallet becomes the vault owner) |

---

## Overview

We are deploying:

1. **Vault V2** — A Morpho Vault V2 that holds USDC and allocates it across Morpho Blue markets
2. **3 MorphoMarketV1AdapterV2 adapters** — One per target market, bridging the vault to each Morpho Blue lending market:
   - USDC/WETH (high liquidity)
   - USDC/wstETH (LST demand)
   - USDC/WBTC (BTC collateral)

After deployment, we configure caps on each adapter and grant the **Allocator** role to the bot's wallet so it can rebalance automatically.

### Key Contract Addresses (Ethereum Mainnet)

| Contract | Address |
|---|---|
| VaultV2Factory | `0xA1D94F746dEfa1928926b84fB2596c06926C0405` |
| MorphoMarketV1AdapterV2Factory | `0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1` |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |
| WBTC | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` |
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| Adaptive Curve IRM | `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` |

> **Note:** The Adaptive Curve IRM address is the most commonly used IRM on Morpho Blue. Verify the IRM address for your target markets on [app.morpho.org](https://app.morpho.org) or via on-chain reads before deploying.

---

## Step 1: Deploy a Vault V2

Call `createVault()` on the VaultV2Factory to deploy a new vault with USDC as the underlying asset.

```bash
# Using cast (Foundry CLI)
cast send 0xA1D94F746dEfa1928926b84fB2596c06926C0405 \
  "createVault(address,address,string,string)" \
  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  <YOUR_OWNER_ADDRESS> \
  "USDC Yield Vault" \
  "yvUSDC" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

Parameters:
- `asset`: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC)
- `owner`: Your deployer/owner wallet address
- `name`: Human-readable vault name (e.g., "USDC Yield Vault")
- `symbol`: Vault share token symbol (e.g., "yvUSDC")

> **Note:** The exact function signature may vary. Check the VaultV2Factory ABI on Etherscan at the factory address to confirm the `createVault` parameters. The factory may also accept additional parameters such as a `timelock` duration or `guardian` address.

**Save the returned vault address** — you will need it for all subsequent steps.

### Verify the vault was deployed

```bash
# Read the vault's asset (should return USDC address)
cast call <VAULT_ADDRESS> "asset()" --rpc-url $RPC_URL

# Read total assets (should be 0 initially)
cast call <VAULT_ADDRESS> "totalAssets()" --rpc-url $RPC_URL
```

---

## Step 2: Deploy 3 MorphoMarketV1AdapterV2 Adapters

Each adapter connects the vault to a specific Morpho Blue lending market. A Morpho Blue market is identified by a `MarketParams` struct:

```solidity
struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}
```

> **Important:** You must use the exact `oracle`, `irm`, and `lltv` values for each market as they exist on-chain. The values below are representative — verify them on [app.morpho.org](https://app.morpho.org) or by querying `idToMarketParams(marketId)` on the Morpho Blue contract (`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`).

### Market 1: USDC/WETH

```bash
cast send 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1 \
  "createAdapter(address,(address,address,address,address,uint256))" \
  <VAULT_ADDRESS> \
  "(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,<ORACLE_ADDRESS>,0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC,<LLTV>)" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Market 2: USDC/wstETH

```bash
cast send 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1 \
  "createAdapter(address,(address,address,address,address,uint256))" \
  <VAULT_ADDRESS> \
  "(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0,<ORACLE_ADDRESS>,0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC,<LLTV>)" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Market 3: USDC/WBTC

```bash
cast send 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1 \
  "createAdapter(address,(address,address,address,address,uint256))" \
  <VAULT_ADDRESS> \
  "(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599,<ORACLE_ADDRESS>,0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC,<LLTV>)" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

> **How to find oracle and LLTV for each market:** Browse existing USDC markets on [app.morpho.org](https://app.morpho.org) or query the Morpho Blue contract:
> ```bash
> # Get MarketParams for a known market ID
> cast call 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb \
>   "idToMarketParams(bytes32)" <MARKET_ID> --rpc-url $RPC_URL
> ```

> **Note:** The exact `createAdapter` function signature may differ. Check the MorphoMarketV1AdapterV2Factory ABI on Etherscan. The factory may require additional parameters or use a different function name (e.g., `create`, `deploy`).

**Save all 3 adapter addresses.**

---

## Step 3: Enable Adapters on the Vault

Each adapter must be enabled on the vault before it can receive allocations.

```bash
# Enable adapter 1 (USDC/WETH)
cast send <VAULT_ADDRESS> \
  "enableAdapter(address)" \
  <ADAPTER_1_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Enable adapter 2 (USDC/wstETH)
cast send <VAULT_ADDRESS> \
  "enableAdapter(address)" \
  <ADAPTER_2_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Enable adapter 3 (USDC/WBTC)
cast send <VAULT_ADDRESS> \
  "enableAdapter(address)" \
  <ADAPTER_3_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

> **Note:** The function to enable an adapter may be named differently (e.g., `addAdapter`, `setAdapter`, or require going through a configuration function). Verify the vault's ABI.

### Verify adapters are enabled

```bash
# Check number of adapters
cast call <VAULT_ADDRESS> "adaptersLength()" --rpc-url $RPC_URL

# Read adapter at index 0, 1, 2
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 0 --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 1 --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 2 --rpc-url $RPC_URL
```

---

## Step 4: Set Caps on Each Adapter

Caps limit how much the vault can allocate to any single adapter. There are two types:

- **Absolute cap** — Maximum USDC amount (in raw units, 6 decimals for USDC). Example: 500,000 USDC = `500000000000`
- **Relative cap** — Maximum percentage of total vault assets (in basis points). Example: 50% = `5000`

Each adapter has a **risk ID** (a `bytes32` identifier) used by the vault's cap system. The risk ID is typically derived from the adapter's market parameters.

```bash
# Set caps for adapter 1 (USDC/WETH)
# Absolute cap: 500,000 USDC, Relative cap: 50% (5000 bps)
cast send <VAULT_ADDRESS> \
  "setCap(bytes32,uint256,uint256)" \
  <RISK_ID_1> \
  500000000000 \
  5000 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Set caps for adapter 2 (USDC/wstETH)
# Absolute cap: 300,000 USDC, Relative cap: 40% (4000 bps)
cast send <VAULT_ADDRESS> \
  "setCap(bytes32,uint256,uint256)" \
  <RISK_ID_2> \
  300000000000 \
  4000 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Set caps for adapter 3 (USDC/WBTC)
# Absolute cap: 200,000 USDC, Relative cap: 30% (3000 bps)
cast send <VAULT_ADDRESS> \
  "setCap(bytes32,uint256,uint256)" \
  <RISK_ID_3> \
  200000000000 \
  3000 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

> **Note:** The `setCap` function signature and how risk IDs are computed may differ in the actual Vault V2 contract. The risk ID might be derived from `keccak256(abi.encode(adapterAddress))` or from the market parameters. Check the vault contract source for the exact mechanism. The vault may also have a timelock on cap changes.

### Verify caps

```bash
cast call <VAULT_ADDRESS> "caps(bytes32)" <RISK_ID_1> --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "caps(bytes32)" <RISK_ID_2> --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "caps(bytes32)" <RISK_ID_3> --rpc-url $RPC_URL
```

---

## Step 5: Grant the Allocator Role

The bot's wallet needs the **Allocator** role to call `allocate()` and `deallocate()` on the vault. Only the vault owner can grant this role.

```bash
cast send <VAULT_ADDRESS> \
  "grantRole(address)" \
  <BOT_WALLET_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

> **Note:** The role-granting mechanism may use OpenZeppelin's AccessControl pattern (e.g., `grantRole(bytes32 role, address account)` with a specific role hash like `ALLOCATOR_ROLE`), or it may use a custom function like `setAllocator(address, bool)`. Verify the vault contract's role management interface.

---

## Step 6: Verify the Full Setup

Run these read calls to confirm everything is configured correctly:

```bash
echo "=== Vault Info ==="
cast call <VAULT_ADDRESS> "asset()" --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "totalAssets()" --rpc-url $RPC_URL

echo "=== Adapters ==="
cast call <VAULT_ADDRESS> "adaptersLength()" --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 0 --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 1 --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 2 --rpc-url $RPC_URL

echo "=== Caps ==="
cast call <VAULT_ADDRESS> "caps(bytes32)" <RISK_ID_1> --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "caps(bytes32)" <RISK_ID_2> --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "caps(bytes32)" <RISK_ID_3> --rpc-url $RPC_URL

echo "=== Adapter Assets (should all be 0 before first deposit) ==="
cast call <ADAPTER_1_ADDRESS> "realAssets()" --rpc-url $RPC_URL
cast call <ADAPTER_2_ADDRESS> "realAssets()" --rpc-url $RPC_URL
cast call <ADAPTER_3_ADDRESS> "realAssets()" --rpc-url $RPC_URL
```

---

## Testing on a Fork First

**Always test on a forked mainnet before deploying to production.** This lets you verify the entire setup without spending real ETH or risking real USDC.

```bash
# Start a local Anvil fork
anvil --fork-url $RPC_URL --chain-id 1

# In another terminal, run your deployment commands against the fork
export RPC_URL=http://127.0.0.1:8545

# Use one of Anvil's default funded accounts
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Alternatively, use the Foundry deployment script provided in this repo:

```bash
forge script script/DeployVault.s.sol \
  --fork-url $RPC_URL \
  --broadcast \
  -vvvv
```

See [`script/README.md`](../script/README.md) for full instructions on running the deployment script.

---

## Next Steps

Once the vault is deployed and verified:

1. **Configure the rebalancing bot** — Set `VAULT_ADDRESS` in your `.env` file to the deployed vault address
2. **Deposit USDC** — Transfer USDC to the vault (via the vault's `deposit()` function)
3. **Start the bot** — Run `bun run dev` to begin automated rebalancing
4. **Monitor** — Check the `/health` and `/api/v1/status` endpoints, and watch for Telegram alerts
