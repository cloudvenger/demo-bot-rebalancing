/**
 * rebalance.service.ts — Central orchestrator for the rebalance cycle.
 *
 * Implements the read → compute → execute → notify pipeline with layered error
 * boundaries.  Each layer catches its own errors; a failure in one layer never
 * propagates to crash the bot process.
 *
 * Architecture reference: docs/rebalancing/architecture.md — "Error Boundaries" section.
 */

import type { Address } from "viem";
import type { VaultReader } from "../core/chain/vault.js";
import type { MorphoReader } from "../core/chain/morpho.js";
import type { IExecutor } from "../core/chain/executor.js";
import { computeRebalanceActions } from "../core/rebalancer/engine.js";
import type { ManagedMarket, RebalanceResult, StrategyConfig } from "../core/rebalancer/types.js";
import type { Notifier } from "./notifier.js";
import type { Config } from "../config/env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Log prefix for all structured log lines emitted by this service. */
const LOG_PREFIX = "[RebalanceService]" as const;

/** Emitted when a cycle is skipped because the previous one is still running. */
const MSG_CYCLE_SKIPPED = "skipped — previous cycle still running" as const;

/** Emitted when the strategy finds no actions needed. */
const MSG_NO_REBALANCE_NEEDED = "no rebalance needed — all within drift threshold" as const;

// ---------------------------------------------------------------------------
// Service status snapshot
// ---------------------------------------------------------------------------

/**
 * Point-in-time status snapshot exposed to the health and API plugins.
 * All fields are read-only from the consumer's perspective.
 */
export interface ServiceStatus {
  lastCheckTimestamp: Date | null;
  lastRebalanceTimestamp: Date | null;
  lastRebalanceResult: RebalanceResult | null;
  isRunning: boolean;
}

// ---------------------------------------------------------------------------
// RebalanceService
// ---------------------------------------------------------------------------

/**
 * RebalanceService orchestrates the full rebalance cycle for a single vault.
 *
 * Dependencies are injected via the constructor to support:
 *   - Dry-run mode (DryRunExecutor swapped in for Executor)
 *   - Unit/integration testing with mocked readers and executors
 *
 * Public state is read by the health plugin and API plugin via `getStatus()`.
 * It is never mutated by callers — only by `run()` internally.
 *
 * Usage:
 * ```ts
 * const service = new RebalanceService(vaultReader, morphoReader, executor, notifier, config);
 * const result = await service.run();
 * ```
 */
export class RebalanceService {
  // -------------------------------------------------------------------------
  // Injected dependencies
  // -------------------------------------------------------------------------

  private readonly vaultReader: VaultReader;
  private readonly morphoReader: MorphoReader;
  private readonly executor: IExecutor;
  private readonly notifier: Notifier;
  private readonly vaultAddress: Address;
  private readonly strategyConfig: StrategyConfig;

  // -------------------------------------------------------------------------
  // In-memory state (exposed via getStatus())
  // -------------------------------------------------------------------------

  /** Timestamp of the last call to run(), whether or not a rebalance occurred. */
  lastCheckTimestamp: Date | null = null;

  /** Timestamp of the most recent successful rebalance execution. */
  lastRebalanceTimestamp: Date | null = null;

  /** Result of the most recent rebalance execution (null before first success). */
  lastRebalanceResult: RebalanceResult | null = null;

  /**
   * Cycle lock.  True while a `run()` call is in progress.
   * Prevents concurrent cycles from being triggered by cron or the API.
   */
  isRunning: boolean = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(
    vaultReader: VaultReader,
    morphoReader: MorphoReader,
    executor: IExecutor,
    notifier: Notifier,
    config: Pick<
      Config,
      | "VAULT_ADDRESS"
      | "DRIFT_THRESHOLD_BPS"
      | "GAS_CEILING_GWEI"
      | "DRY_RUN"
      | "MAX_MARKET_CONCENTRATION_PCT"
      | "MIN_LIQUIDITY_MULTIPLIER"
    >
  ) {
    this.vaultReader = vaultReader;
    this.morphoReader = morphoReader;
    this.executor = executor;
    this.notifier = notifier;
    this.vaultAddress = config.VAULT_ADDRESS as Address;
    this.strategyConfig = buildStrategyConfig(config);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute one full rebalance cycle: read → compute → execute → notify.
   *
   * Returns `null` when:
   *   - The cycle lock is held (previous cycle still running)
   *   - The READ phase fails after retries are exhausted (RPC failure)
   *   - The EXECUTE phase fails (tx revert or submission error)
   *
   * Returns a `RebalanceResult` with empty `txHashes` when no rebalance is
   * needed (all markets within drift threshold).
   *
   * The cycle lock (`isRunning`) is always released in the `finally` block —
   * even if an unhandled exception escapes a nested try/catch.
   *
   * Post-execution: re-reads vault state to populate `newAllocations` keyed
   * by `marketLabel` (the human-readable market name).
   */
  async run(): Promise<RebalanceResult | null> {
    // ---- Cycle lock check --------------------------------------------------
    if (this.isRunning) {
      console.info(`${LOG_PREFIX} ${MSG_CYCLE_SKIPPED}`);
      return null;
    }

    this.isRunning = true;
    this.lastCheckTimestamp = new Date();

    try {
      // ---- READ phase -------------------------------------------------------
      let state;

      try {
        console.info(`${LOG_PREFIX} reading vault state`);
        const vaultState = await this.vaultReader.readFullState();

        // MorphoReader reads market data for the active managed markets.
        // The markets are in the same positional order as vaultState.marketStates.
        const activeMarkets = this.vaultReader.activeMarkets;
        const marketData = await this.morphoReader.readMarketsForManagedMarkets(
          activeMarkets as ManagedMarket[]
        );

        state = {
          ...vaultState,
          marketData,
        };
      } catch (readError) {
        // RPC failure after retries exhausted — alert and abort this cycle.
        const message = readError instanceof Error ? readError.message : String(readError);
        // Sanitise before logging — RPC error messages may embed the full RPC URL
        // (including the provider API key as a path segment).
        const safeMessage = message.replace(/https?:\/\/\S+/gi, "[URL_REDACTED]");
        console.warn(`${LOG_PREFIX} READ phase failed: ${safeMessage}`);

        // Notifier failure is non-fatal — wrap in its own try/catch.
        try {
          await this.notifier.notifyHealthIssue("rpc_failure", message);
        } catch (notifyErr) {
          console.warn(
            `${LOG_PREFIX} Telegram notification failed during RPC failure alert:`,
            notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          );
        }

        return null;
      }

      // ---- COMPUTE phase (pure — cannot throw meaningfully) -----------------
      console.info(`${LOG_PREFIX} computing rebalance`);
      const actions = computeRebalanceActions(state, this.strategyConfig);

      if (actions.length === 0) {
        console.info(`${LOG_PREFIX} ${MSG_NO_REBALANCE_NEEDED}`);
        return buildNoOpResult();
      }

      // ---- EXECUTE phase ----------------------------------------------------
      console.info(`${LOG_PREFIX} executing ${actions.length} action(s)`);

      try {
        const result = await this.executor.execute(actions, this.vaultAddress);

        this.lastRebalanceTimestamp = new Date();

        // ---- Post-execute: re-read state for newAllocations -----------------
        // Re-read vault state to get the actual post-rebalance allocations.
        // These are keyed by marketLabel (human-readable) per the new API shape.
        const newAllocations = await this._readNewAllocations(result.txHashes.length > 0);

        const finalResult: RebalanceResult = {
          ...result,
          newAllocations,
        };

        this.lastRebalanceResult = finalResult;

        console.info(`${LOG_PREFIX} rebalance complete — ${result.txHashes.length} tx(s) submitted`);

        // ---- NOTIFY phase (fire-and-forget) ---------------------------------
        try {
          await this.notifier.notifyRebalanceSuccess(finalResult, this.vaultAddress);
        } catch (notifyErr) {
          // Telegram failure — log locally, never block.
          console.warn(
            `${LOG_PREFIX} Telegram notification failed after successful rebalance:`,
            notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          );
        }

        return finalResult;
      } catch (execError) {
        // tx revert or execution error — alert and return null.
        const safeError =
          execError instanceof Error ? execError : new Error(String(execError));

        console.warn(`${LOG_PREFIX} EXECUTE phase failed: ${safeError.message}`);

        try {
          await this.notifier.notifyRebalanceFailed(safeError, this.vaultAddress);
        } catch (notifyErr) {
          // Telegram failure — log locally, never block.
          console.warn(
            `${LOG_PREFIX} Telegram notification failed after execution error:`,
            notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          );
        }

        return null;
      }
    } finally {
      // Always release the lock so the next cron tick can proceed.
      this.isRunning = false;
    }
  }

  /**
   * Returns the current in-memory status snapshot.
   *
   * Consumed by:
   *   - `src/plugins/health.ts`  — lastCheckTimestamp, isRunning
   *   - `src/plugins/api.ts`     — full status including lastRebalanceResult
   */
  getStatus(): ServiceStatus {
    return {
      lastCheckTimestamp: this.lastCheckTimestamp,
      lastRebalanceTimestamp: this.lastRebalanceTimestamp,
      lastRebalanceResult: this.lastRebalanceResult,
      isRunning: this.isRunning,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Read the current vault state and compute allocation percentages by
   * marketLabel, to populate `newAllocations` in the final RebalanceResult.
   *
   * If the re-read fails (e.g. RPC error), returns an empty array — the
   * rebalance itself was still successful and we do not want to fail the
   * overall result.
   *
   * @param didExecute  Whether transactions were actually submitted. If not
   *                    (dry-run or no-op), we still compute allocations from
   *                    the current on-chain state.
   */
  private async _readNewAllocations(
    _didExecute: boolean
  ): Promise<Array<{ marketLabel: string; percentage: number }>> {
    try {
      const postState = await this.vaultReader.readFullState();

      return postState.marketStates.map((ms) => ({
        marketLabel: ms.market.label,
        percentage:
          postState.totalAssets > 0n
            ? Number((ms.allocation * 10_000n) / postState.totalAssets) / 100
            : 0,
      }));
    } catch {
      // Re-read failed — return empty rather than failing the whole result.
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build the StrategyConfig subset required by the strategy engine from the
 * full validated Config object.
 */
function buildStrategyConfig(
  config: Pick<
    Config,
    | "DRIFT_THRESHOLD_BPS"
    | "GAS_CEILING_GWEI"
    | "DRY_RUN"
    | "MAX_MARKET_CONCENTRATION_PCT"
    | "MIN_LIQUIDITY_MULTIPLIER"
  >
): StrategyConfig {
  return {
    driftThresholdBps: config.DRIFT_THRESHOLD_BPS,
    gasCeilingGwei: config.GAS_CEILING_GWEI,
    dryRun: config.DRY_RUN,
    maxMarketConcentrationPct: config.MAX_MARKET_CONCENTRATION_PCT,
    minLiquidityMultiplier: config.MIN_LIQUIDITY_MULTIPLIER,
  };
}

/**
 * Build a RebalanceResult representing a cycle where no actions were needed.
 * All arrays are empty; timestamp is the current ISO-8601 instant.
 */
function buildNoOpResult(): RebalanceResult {
  return {
    actions: [],
    txHashes: [],
    newAllocations: [],
    timestamp: new Date().toISOString(),
  };
}
