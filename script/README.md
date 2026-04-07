# Deployment Script — Morpho Vault V2

Foundry script that deploys a complete Morpho Vault V2 setup:
- Vault V2 with USDC as the underlying asset
- 3 MorphoMarketV1AdapterV2 adapters (USDC/WETH, USDC/wstETH, USDC/WBTC)
- Caps configured on each adapter
- Allocator role granted to the bot wallet

---

## Prerequisites

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Verify installation:

```bash
forge --version
cast --version
```

### Install forge-std

From the project root:

```bash
forge install foundry-rs/forge-std
```

---

## Environment Setup

Create a `.env` file in the project root (or export variables directly):

```bash
# Required
OWNER=0xYourOwnerAddress            # Vault owner — can configure adapters, caps, roles
ALLOCATOR=0xYourBotWalletAddress     # Bot wallet — receives the Allocator role
PRIVATE_KEY=0xYourPrivateKey         # Deployer private key (must have ETH for gas)
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY   # Ethereum mainnet RPC

# Cap configuration
ABSOLUTE_CAP=500000000000            # Max USDC per adapter in raw units (500,000 USDC = 500000000000)
RELATIVE_CAP=5000                    # Max % of total assets in basis points (5000 = 50%)

# Oracle addresses — MUST match existing Morpho Blue markets
# Find these on app.morpho.org or via on-chain reads (see below)
ORACLE_WETH=0x...                    # Oracle for USDC/WETH market
ORACLE_WSTETH=0x...                  # Oracle for USDC/wstETH market
ORACLE_WBTC=0x...                    # Oracle for USDC/WBTC market

# LLTV values — in WAD (1e18 = 100%). Defaults to 86% if not set.
# LLTV_WETH=860000000000000000
# LLTV_WSTETH=860000000000000000
# LLTV_WBTC=860000000000000000
```

### Finding Oracle Addresses and LLTVs

Query existing Morpho Blue markets to find the correct oracle and LLTV for each market pair:

```bash
# Look up MarketParams for a known market ID on Morpho Blue
cast call 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb \
  "idToMarketParams(bytes32)" <MARKET_ID> \
  --rpc-url $RPC_URL
```

You can also browse markets on [app.morpho.org](https://app.morpho.org) and find the oracle address and LLTV for each USDC market.

---

## Running on a Forked Mainnet (Recommended First Step)

Fork mainnet locally to test the deployment without spending real ETH:

```bash
# Load environment variables
source .env

# Run the script against a forked mainnet
forge script script/DeployVault.s.sol \
  --fork-url $RPC_URL \
  --broadcast \
  -vvvv
```

The `-vvvv` flag provides maximum verbosity so you can see every transaction and its result.

### Using Anvil for Interactive Testing

For more control, start Anvil separately:

```bash
# Terminal 1: Start Anvil fork
anvil --fork-url $RPC_URL --chain-id 1

# Terminal 2: Run script against local fork
forge script script/DeployVault.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  -vvvv
```

---

## Running on Mainnet (Production)

Only after verifying on a fork:

```bash
source .env

forge script script/DeployVault.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

The `--verify` flag will attempt to verify contracts on Etherscan (requires `ETHERSCAN_API_KEY` env var).

---

## Verifying the Deployment

After the script completes, verify the setup using `cast`:

```bash
# Replace <VAULT_ADDRESS> with the address printed by the script

# Check vault asset is USDC
cast call <VAULT_ADDRESS> "asset()" --rpc-url $RPC_URL

# Check adapters are enabled
cast call <VAULT_ADDRESS> "adaptersLength()" --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 0 --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 1 --rpc-url $RPC_URL
cast call <VAULT_ADDRESS> "adaptersAt(uint256)" 2 --rpc-url $RPC_URL

# Check each adapter's realAssets (should be 0 before any deposit)
cast call <ADAPTER_ADDRESS> "realAssets()" --rpc-url $RPC_URL
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `ORACLE_WETH not set` | Set the oracle address env vars — see "Finding Oracle Addresses" above |
| Script reverts on `createVault` | Verify the VaultV2Factory ABI matches the interface in the script |
| Script reverts on `enableAdapter` | The function name may differ — check the vault implementation ABI |
| Script reverts on `setCap` | Risk ID computation may differ — check how the vault derives risk IDs |
| Script reverts on `grantRole` | The role management pattern may differ — check if it uses AccessControl or a custom pattern |
| `forge: command not found` | Install Foundry: `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Missing forge-std | Run `forge install foundry-rs/forge-std --no-commit` from the project root |

> **Important:** The interfaces in `DeployVault.s.sol` are best-effort approximations. Before running on mainnet, verify the exact function signatures against the deployed contract ABIs on Etherscan.
