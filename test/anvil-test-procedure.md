# Anvil test procedure — Morpho V2 rebalancing bot

End-to-end runbook to validate the bot against a forked-mainnet vault using Anvil. Covers the two [`task.md`](../task.md) Group 8.5 items that require an Anvil RPC: the gated integration tests and the `DRY_RUN` smoke test.

| Want to verify | Run steps |
|---|---|
| Bot reads on-chain state correctly | 1 → 5 |
| Strategy + read path end-to-end | 1 → 6 |
| Full execute path (real `vault.allocate(...)` tx) | 1 → 7 |

Estimated time: ~10 minutes the first time (mostly finding real Morpho Blue market params), ~3 minutes after that.

> ⚠ **Do not use your real `.env`**. Your `PRIVATE_KEY` is a real key with real funds — we will use **Anvil's well-known default test keys** instead. They have 10000 ETH on the fork and zero value on real mainnet. The keys below are publicly published in the Foundry source; they are safe to paste into commands.

---

## Prerequisites checklist

- [ ] Foundry installed (`forge`, `cast`, `anvil` on `PATH`)
- [ ] Bun installed (`bun --version`)
- [ ] `git submodule update --init --recursive` done (forge-std present at `lib/forge-std`)
- [ ] `bun install` done
- [ ] An Ethereum **mainnet** RPC URL with archive access (Alchemy or Infura free tier is fine) — used **only** by `anvil --fork-url` in Step 1, never by the bot itself

> Throughout this procedure, `RPC_URL` always means the **local Anvil URL** (`http://127.0.0.1:8545`) — same name as the bot's env var in [`src/config/env.ts`](../src/config/env.ts). The upstream mainnet URL is pasted inline in Step 1 and never stored as a variable, to avoid accidentally pointing the bot at mainnet.

---

## Step 1 — Start Anvil in Terminal 1

Replace `<YOUR_MAINNET_RPC_URL>` with your Alchemy/Infura mainnet endpoint:

```bash
anvil --fork-url <YOUR_MAINNET_RPC_URL> --chain-id 1
```

Leave this running. It listens on `http://127.0.0.1:8545` and prints 10 pre-funded accounts. We will use the first two:

| Role | Address | Private key |
|---|---|---|
| Deployer / owner / curator (acct 0) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| Bot wallet / allocator (acct 1) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |

> These are well-known public dev keys from the Foundry source — never use them on a real chain.

---

## Step 2 — In Terminal 2, find a USDC market on Morpho Blue

The deploy script enforces `loanToken == USDC` and `irm == AdaptiveCurveIRM`, so you need at least one real Morpho Blue USDC market. The fastest way:

1. Go to [app.morpho.org/markets?network=ethereum](https://app.morpho.org/markets?network=ethereum)
2. Filter "Loan asset" → USDC
3. Click any market (e.g. USDC/wstETH 86%)
4. The URL ends with the market id, e.g. `.../market/0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc`
5. Copy the market id

Verify the params on your fork (this also confirms Anvil is alive):

```bash
export RPC_URL=http://127.0.0.1:8545
export MARKET_ID=0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc  # ← replace with the id you copied

cast call 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb \
  "idToMarketParams(bytes32)(address,address,address,address,uint256)" \
  $MARKET_ID \
  --rpc-url $RPC_URL
```

Output is `(loanToken, collateralToken, oracle, irm, lltv)`. Confirm:

- `loanToken` is USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- `irm` is AdaptiveCurveIRM: `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC`

Save the `oracle` address — you'll need it in the next step.

Repeat for 1–2 more markets if you want to exercise multi-market scoring.

---

## Step 3 — Create the managed-markets JSON

```bash
cat > managed-markets.anvil.json <<'EOF'
[
  {
    "label":           "USDC/wstETH 86%",
    "loanToken":       "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "collateralToken": "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    "oracle":          "PASTE_THE_ORACLE_FROM_STEP_2",
    "irm":             "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    "lltv":            "860000000000000000"
  }
]
EOF
```

Edit the file and replace `PASTE_THE_ORACLE_FROM_STEP_2` with the actual oracle address. The `lltv` value must match what cast returned (most USDC markets are `860000000000000000` = 86%).

---

## Step 4 — Deploy the vault via the Forge script

```bash
# Anvil account 0 — deployer / owner / curator
export OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Anvil account 1 — bot wallet
export BOT_WALLET=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

# Inputs
export RPC_URL=http://127.0.0.1:8545
export MANAGED_MARKETS_PATH=$(pwd)/managed-markets.anvil.json

# Optional overrides (defaults: 500_000 USDC absolute, WAD relative)
# export ABSOLUTE_CAP=500000000000
# export RELATIVE_CAP_WAD=1000000000000000000

forge script script/DeployVault.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  -vvvv
```

Look for the **DEPLOYMENT SUMMARY** block in the output. Capture two addresses:

```bash
export VAULT_ADDRESS=0x...      # printed as "Vault:    " in STEP H
export ADAPTER_ADDRESS=0x...    # printed as "Adapter:  " in STEP H
```

The script also runs **STEP G — Verifying deployment**. If it logs `All verifications passed.`, the vault has the adapter enabled, all 3 cap ids per market have `absoluteCap > 0` AND `relativeCap == WAD`, and the bot wallet has the allocator role. If it reverts with `VerificationFailed(...)`, fix the inputs and re-run (the reverted script left no state behind because Anvil's snapshot mechanism rolls back failed broadcast txs).

---

## Step 5 — Run the Anvil-gated integration tests

```bash
export ANVIL_RPC_URL=http://127.0.0.1:8545
# VAULT_ADDRESS, ADAPTER_ADDRESS, BOT_WALLET still set from step 4
# MANAGED_MARKETS_PATH still set from step 4
just test
```

Expected: **412 tests, 0 skipped, 0 failed** (the 14 tests that were previously skipped now run because `ANVIL_RPC_URL` is set).

If any of the 14 newly-running tests fails, the failure tells you what part of the V2 contract interaction is broken. The most likely culprits:

| Failing test | Likely cause |
|---|---|
| `assertStartupInvariants — happy path` | The deployed vault is missing something the script should have set up. Re-check STEP G logs. |
| `readFullState` allocation/cap reads | ABI mismatch in [`src/config/constants.ts`](../src/config/constants.ts) against the real V2 contract. |
| `Executor` 3-arg `allocate` | The 3-arg signature is wrong, or `MARKET_PARAMS_ABI_COMPONENTS` produces a different encoding than the on-chain adapter expects. |

---

## Step 6 — `DRY_RUN` smoke test of the full bot

This validates the read path end-to-end (config → managed markets → vault reader → strategy → would-be-actions → notifier) without submitting any transactions.

In Terminal 2 (or a new terminal — as long as Anvil is still running in Terminal 1):

```bash
# Use the bot wallet (acct 1) — it's the one that holds the allocator role
export PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export RPC_URL=http://127.0.0.1:8545

# From Step 4 — already exported:
#   VAULT_ADDRESS, ADAPTER_ADDRESS, MANAGED_MARKETS_PATH

# Required by zod even in dry-run; fake values are OK because Telegram is fire-and-forget
export TELEGRAM_BOT_TOKEN=1234:fake
export TELEGRAM_CHAT_ID=1

# Critical
export DRY_RUN=true

# Fast cron so you don't wait 5 minutes
export CRON_SCHEDULE="*/10 * * * * *"   # every 10 seconds

just dev
```

Expected on startup, in order:

```
[VaultReader] startup invariants OK
[VaultReader] activeMarkets: 1 (USDC/wstETH 86%)
{"level":30,"msg":"Server listening at http://[::1]:3000"}
```

After the first cron tick (within 10 seconds):

```
[RebalanceService] reading vault state
[RebalanceService] computing rebalance
[RebalanceService] no rebalance needed — all within drift threshold
```

The "no rebalance needed" output is expected: the freshly-deployed vault has `totalAssets == 0`, so there's nothing to allocate. To smoke-test the **execute** path, see Step 7 below.

In another terminal, hit the HTTP endpoints:

```bash
curl -s http://localhost:3000/health | jq
curl -s http://localhost:3000/api/v1/status | jq
curl -s -X POST http://localhost:3000/api/v1/rebalance | jq
```

`/api/v1/status` should return the vault address, adapter address, `totalAssets: "0"`, and the managed markets array with each market's allocation/caps populated. The 3 caps per market should match what STEP H logged in the script output.

Stop the bot with `Ctrl+C`. ✅ smoke test done.

---

## Step 7 — (optional) Exercise the execute path with a real deposit

The previous step proves the read path works. To prove `allocate` works against a real Morpho Blue market, the vault needs USDC. The cleanest way on a fork is to impersonate a USDC whale:

```bash
# A well-known USDC whale (Circle treasury). Verify on Etherscan if it's still funded.
export USDC_WHALE=0x55FE002aefF02F77364de339a1292923A15844B8
export USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Step 7a — impersonate the whale
cast rpc anvil_impersonateAccount $USDC_WHALE --rpc-url $RPC_URL

# Step 7b — fund the whale with ETH for gas (anvil cheat)
cast rpc anvil_setBalance $USDC_WHALE 0xDE0B6B3A7640000 --rpc-url $RPC_URL    # 1 ETH

# Step 7c — whale approves the vault to pull USDC
cast send $USDC \
  "approve(address,uint256)" \
  $VAULT_ADDRESS 1000000000000 \
  --from $USDC_WHALE --unlocked \
  --rpc-url $RPC_URL

# Step 7d — whale deposits 1,000,000 USDC into the vault on its own behalf
cast send $VAULT_ADDRESS \
  "deposit(uint256,address)" \
  1000000000000 $USDC_WHALE \
  --from $USDC_WHALE --unlocked \
  --rpc-url $RPC_URL

# Step 7e — stop impersonating
cast rpc anvil_stopImpersonatingAccount $USDC_WHALE --rpc-url $RPC_URL

# Confirm the deposit
cast call $VAULT_ADDRESS "totalAssets()(uint256)" --rpc-url $RPC_URL
# → 1000000000000  (1,000,000 USDC)
```

Now turn `DRY_RUN` off and rerun the bot:

```bash
unset DRY_RUN   # or: export DRY_RUN=false
just dev
```

On the next cron tick the bot should compute a rebalance and submit a real `vault.allocate(adapter, abi.encode(marketParams), assets)` call against the Anvil fork. Watch the logs for:

```
[RebalanceService] executing 1 action(s)
[RebalanceService] rebalance complete — 1 tx(s) submitted
```

Then verify the on-chain state:

```bash
# Easiest: read it from the bot via the status endpoint:
curl -s http://localhost:3000/api/v1/status | jq '.data.markets[0].allocation'
# → "1000000000000"   (or close to it, depending on cap clamping)
```

Stop the bot with `Ctrl+C`. ✅ execute path validated.

---

## Cleanup

```bash
# Terminal 1: stop Anvil with Ctrl+C — fork state is volatile, nothing persists
# Terminal 2:
unset OWNER BOT_WALLET PRIVATE_KEY RPC_URL VAULT_ADDRESS ADAPTER_ADDRESS \
      MANAGED_MARKETS_PATH ANVIL_RPC_URL TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID DRY_RUN CRON_SCHEDULE
rm -f managed-markets.anvil.json
```

---

## Sign-off — what to mark done

If Steps 5, 6, and (optionally) 7 all pass, you can mark these two [`task.md`](../task.md) Group 8.5 items as `[x]`:

- `[qa] Run integration tests against a fresh Anvil fork with the new deployment script`
- `[qa] Dry-run the bot end-to-end (DRY_RUN=true) against the Anvil-deployed vault and verify it reads state, scores markets, and proposes actions correctly`

After that, PR #3 has zero outstanding ship blockers and is ready to merge. Per [`docs/workflow/git-strategy.md`](../docs/workflow/git-strategy.md), only after a clean fork run should you consider running the same flow against a mainnet RPC for the production deploy.

---

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `forge script` reverts on the first call | The mainnet URL passed to `anvil --fork-url` (Step 1) is wrong, rate-limited, or lacks archive access | Restart Anvil with a different mainnet RPC (Alchemy free tier supports archive on mainnet) |
| Bot or forge accidentally hits real mainnet | `RPC_URL` was set to your mainnet endpoint instead of `http://127.0.0.1:8545` | `export RPC_URL=http://127.0.0.1:8545` and re-run the failing command. The procedure never stores the mainnet URL as a variable for exactly this reason. |
| `Refusing to start: market <label> has relativeCap == 0` | The script's `RELATIVE_CAP_WAD` was overridden to 0 somewhere | `unset RELATIVE_CAP_WAD` and re-run; default is `WAD` |
| Bot startup error: `locally computed cap id [N] does not match adapter.ids(...)` | The `oracle` field in `managed-markets.anvil.json` doesn't match the real on-chain market | Re-run the cast call from Step 2 and copy the oracle exactly |
| `WrongLoanToken(0, 0x..., USDC)` | A market in the JSON has a loanToken that isn't USDC | Pick a USDC market on app.morpho.org |
| `WrongIRM(0, 0x..., 0x870a...)` | A market uses a non-AdaptiveCurve IRM | Pick a market that uses AdaptiveCurveIRM (most live USDC markets do) |
| Bot fails to start with `connect ECONNREFUSED 127.0.0.1:8545` | Anvil isn't running | Restart Terminal 1's anvil command |
| Tests still skip with `ANVIL_RPC_URL` set | `just test` uses the env at the time it's invoked — re-export or use `ANVIL_RPC_URL=... just test` inline |

For everything else, see [`walkthrough.md`](../walkthrough.md) (root) and [`docs/rebalancing/vault-setup-guide.md`](../docs/rebalancing/vault-setup-guide.md).
