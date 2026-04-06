import type { Address, Hash } from "viem";
import type { BotPublicClient, BotWalletClient } from "./client.js";
import type { RebalanceAction, RebalanceResult } from "../rebalancer/types.js";
import type { Config } from "../../config/env.js";
import { VAULT_V2_ABI } from "../../config/constants.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Conversion factor: 1 gwei = 1e9 wei */
const GWEI_TO_WEI = 1_000_000_000n;

/**
 * Sentinel selector value passed to allocate/deallocate when no specific
 * callback selector is needed. Matches the Vault V2 convention of `bytes4(0)`.
 */
const ZERO_SELECTOR = "0x00000000" as const;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Executor interface — identical contract for live and dry-run implementations.
 * Callers (RebalanceService) depend on this interface, never on a concrete class.
 *
 * Responsibilities:
 *   1. Gas ceiling check — skip all txs if current gas price exceeds the ceiling.
 *   2. Submit deallocate/allocate transactions in the order provided by the caller.
 *   3. Wait for each receipt before moving to the next tx.
 *   4. Stop immediately on any tx revert and return a partial result.
 */
export interface IExecutor {
  execute(
    actions: RebalanceAction[],
    vaultAddress: Address
  ): Promise<RebalanceResult>;
}

// ---------------------------------------------------------------------------
// Live executor
// ---------------------------------------------------------------------------

/**
 * Concrete executor that submits real transactions via a viem wallet client.
 *
 * The caller is responsible for ordering actions correctly (deallocates first,
 * allocates second). This class preserves that order exactly.
 */
export class Executor implements IExecutor {
  private readonly walletClient: BotWalletClient;
  private readonly publicClient: BotPublicClient;
  private readonly config: Pick<Config, "GAS_CEILING_GWEI" | "DRY_RUN">;

  constructor(
    walletClient: BotWalletClient,
    publicClient: BotPublicClient,
    config: Pick<Config, "GAS_CEILING_GWEI" | "DRY_RUN">
  ) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
    this.config = config;
  }

  /**
   * Execute the given ordered list of rebalance actions against `vaultAddress`.
   *
   * Steps:
   *   1. Check current gas price against the configured ceiling. If exceeded,
   *      return immediately with an empty result and a reason string.
   *   2. If `config.dryRun` is true, log actions and return a mock result
   *      without submitting any transaction.
   *   3. Submit each action as a `writeContract` call, then wait for its
   *      receipt. On revert, stop and return a partial result.
   */
  async execute(
    actions: RebalanceAction[],
    vaultAddress: Address
  ): Promise<RebalanceResult> {
    const timestamp = new Date().toISOString();

    // ---- 1. Gas ceiling check ---------------------------------------------
    const gasPrice = await this.publicClient.getGasPrice();
    // GAS_CEILING_GWEI is a JS number; BigInt() requires an integer value.
    const gasCeilingWei = BigInt(Math.trunc(this.config.GAS_CEILING_GWEI)) * GWEI_TO_WEI;

    if (gasPrice > gasCeilingWei) {
      return buildSkippedResult(actions, timestamp, "gas ceiling exceeded");
    }

    // ---- 2. Dry-run mode ---------------------------------------------------
    if (this.config.DRY_RUN) {
      logDryRunActions(actions);
      return buildDryRunResult(actions, timestamp);
    }

    // ---- 3. Submit transactions in order -----------------------------------
    if (actions.length === 0) {
      return buildEmptyResult(timestamp);
    }

    const txHashes: Hash[] = [];

    for (const action of actions) {
      const functionName = action.direction === "allocate" ? "allocate" : "deallocate";

      let txHash: Hash;
      try {
        txHash = await this.walletClient.writeContract({
          address: vaultAddress,
          abi: VAULT_V2_ABI,
          functionName,
          args: [action.adapter, action.data, action.amount, ZERO_SELECTOR],
        });
      } catch (err) {
        // Transaction submission failed (e.g. simulation revert, nonce error).
        return buildRevertResult(actions, txHashes, timestamp, err);
      }

      // Wait for on-chain confirmation.
      let receipt: Awaited<ReturnType<BotPublicClient["waitForTransactionReceipt"]>>;
      try {
        receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
      } catch (err) {
        // Receipt polling failed (RPC error, timeout, etc.).
        txHashes.push(txHash);
        return buildRevertResult(actions, txHashes, timestamp, err);
      }

      if (receipt.status === "reverted") {
        txHashes.push(txHash);
        return buildRevertResult(
          actions,
          txHashes,
          timestamp,
          new Error(`Transaction reverted: ${txHash}`)
        );
      }

      txHashes.push(txHash);
    }

    return {
      actions,
      txHashes,
      newAllocations: [],
      timestamp,
    };
  }
}

// ---------------------------------------------------------------------------
// Dry-run executor
// ---------------------------------------------------------------------------

/**
 * Dry-run executor — implements `IExecutor` but never submits any transaction.
 * Logs proposed actions and returns a mock result. Used when `DRY_RUN=true` or
 * in test environments where no wallet is available.
 *
 * Callers that receive an `IExecutor` cannot tell which implementation they
 * have (Liskov Substitution Principle).
 */
export class DryRunExecutor implements IExecutor {
  async execute(
    actions: RebalanceAction[],
    _vaultAddress: Address
  ): Promise<RebalanceResult> {
    const timestamp = new Date().toISOString();
    logDryRunActions(actions);
    return buildDryRunResult(actions, timestamp);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Log proposed actions to stdout in a human-readable format.
 * This is the only place we emit output in dry-run mode — not a debug
 * statement left in production code, but an intentional informational log.
 */
function logDryRunActions(actions: RebalanceAction[]): void {
  if (actions.length === 0) {
    // eslint-disable-next-line no-console
    console.info("[DRY RUN] No rebalance actions proposed.");
    return;
  }
  // eslint-disable-next-line no-console
  console.info(`[DRY RUN] Proposed ${actions.length} action(s) — no transactions will be submitted:`);
  for (const [i, action] of actions.entries()) {
    // eslint-disable-next-line no-console
    console.info(
      `  [${i + 1}] ${action.direction.toUpperCase()} adapter=${action.adapter} amount=${action.amount.toString()}`
    );
  }
}

/**
 * Build a result for the case where no actions were needed.
 */
function buildEmptyResult(timestamp: string): RebalanceResult {
  return {
    actions: [],
    txHashes: [],
    newAllocations: [],
    timestamp,
  };
}

/**
 * Build a result for the case where the gas ceiling was exceeded.
 * We attach a `reason` field by casting through `unknown` to avoid widening
 * the `RebalanceResult` type — the reason surfaces in logs and Notifier alerts.
 */
function buildSkippedResult(
  actions: RebalanceAction[],
  timestamp: string,
  reason: string
): RebalanceResult & { reason: string } {
  return {
    actions,
    txHashes: [],
    newAllocations: [],
    timestamp,
    reason,
  };
}

/**
 * Build a result for dry-run mode.
 * Actions are preserved so callers can inspect them; txHashes is always empty.
 */
function buildDryRunResult(
  actions: RebalanceAction[],
  timestamp: string
): RebalanceResult {
  return {
    actions,
    txHashes: [],
    newAllocations: [],
    timestamp,
  };
}

/**
 * Build a partial result after a transaction revert or submission error.
 * Attaches the error so RebalanceService / Notifier can inspect it.
 */
function buildRevertResult(
  actions: RebalanceAction[],
  txHashes: Hash[],
  timestamp: string,
  error: unknown
): RebalanceResult & { error: unknown } {
  return {
    actions,
    txHashes,
    newAllocations: [],
    timestamp,
    error,
  };
}
