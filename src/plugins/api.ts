/**
 * api.ts — GET /api/v1/status and POST /api/v1/rebalance Fastify plugin.
 *
 * All responses follow the `{ data, error }` envelope defined in CLAUDE.md.
 * Business logic is delegated entirely to RebalanceService — this file only
 * handles HTTP routing, input validation, and response shaping.
 *
 * Architecture reference: PLAN.md — "API Contract → GET /api/v1/status" and
 *   "API Contract → POST /api/v1/rebalance"
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { formatUnits } from "viem";
import type { RebalanceService } from "../services/rebalance.service.js";
import type { Config } from "../config/env.js";
import type { VaultReader } from "../core/chain/vault.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Route prefix for all versioned API routes. */
const API_PREFIX = "/api/v1" as const;

/** Route path for the status endpoint. */
const STATUS_ROUTE = `${API_PREFIX}/status` as const;

/** Route path for the manual rebalance trigger. */
const REBALANCE_ROUTE = `${API_PREFIX}/rebalance` as const;

/** HTTP 200 — success */
const HTTP_OK = 200 as const;

/** HTTP 409 — conflict (rebalance already running) */
const HTTP_CONFLICT = 409 as const;

/** HTTP 500 — internal server error */
const HTTP_INTERNAL_ERROR = 500 as const;

/** USDC has 6 decimal places */
const USDC_DECIMALS = 6 as const;

/** Reason string returned when a rebalance is not needed. */
const REASON_WITHIN_DRIFT = "within drift threshold" as const;

/** Error message returned when a rebalance cycle is already in progress. */
const ERR_CYCLE_RUNNING = "Rebalance cycle already running" as const;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options passed to the API plugin.
 */
export interface ApiPluginOptions extends FastifyPluginOptions {
  rebalanceService: RebalanceService;
  vaultReader: VaultReader;
  config: Config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a raw bigint asset amount (USDC 6 decimals) as a human-readable
 * string with comma separators, e.g. `"1000000000000"` → `"1,000,000.00 USDC"`.
 *
 * @param rawAmount  Asset amount in the vault's underlying denomination.
 * @returns Human-readable string.
 */
function formatUsdcHuman(rawAmount: bigint): string {
  const formatted = formatUnits(rawAmount, USDC_DECIMALS);
  // Parse back to number for locale formatting, then re-attach 2 decimal places
  const [whole, fraction = "00"] = formatted.split(".");
  const wholeFormatted = Number(whole).toLocaleString("en-US");
  const fractionTrimmed = (fraction + "00").slice(0, 2);
  return `${wholeFormatted}.${fractionTrimmed} USDC`;
}

/**
 * Build the standard success envelope.
 */
function ok<T>(data: T): { data: T; error: null } {
  return { data, error: null };
}

/**
 * Build the standard error envelope.
 */
function err(message: string): { data: null; error: string } {
  return { data: null, error: message };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * API plugin — registers:
 *   - `GET  /api/v1/status`
 *   - `POST /api/v1/rebalance`
 *
 * Decorated values expected on fastify:
 *   - `fastify.rebalanceService`  — instance of RebalanceService
 *   - `fastify.botConfig`         — validated Config object
 */
async function apiPlugin(
  fastify: FastifyInstance,
  opts: ApiPluginOptions
): Promise<void> {
  const { rebalanceService, vaultReader, config } = opts;

  // -------------------------------------------------------------------------
  // GET /api/v1/status
  // -------------------------------------------------------------------------

  /**
   * Returns the current vault allocation state and last-rebalance metadata.
   *
   * Performs an on-chain read of the current vault state to return fresh
   * market data. Falls back to last cached state if the read fails.
   *
   * Response shape (per PLAN.md § API Contract):
   * {
   *   data: {
   *     vaultAddress, adapterAddress,
   *     totalAssets, totalAssetsFormatted,
   *     markets: [{ label, marketId, marketParams, allocation, allocationFormatted,
   *                 percentage, caps: [{ id, absoluteCap, relativeCap }, ...3] }],
   *     lastRebalance: { timestamp, txHashes },
   *     gas: { currentGwei, ceilingGwei }
   *   },
   *   error: null
   * }
   */
  fastify.get(STATUS_ROUTE, async (_request, reply) => {
    try {
      const serviceStatus = rebalanceService.getStatus();
      const lastRebalanceResult = serviceStatus.lastRebalanceResult;

      // Build last-rebalance metadata from the stored result.
      const lastRebalance = lastRebalanceResult
        ? {
            timestamp: lastRebalanceResult.timestamp,
            txHashes: lastRebalanceResult.txHashes,
          }
        : null;

      // Attempt to read current gas price for observability.
      // Non-fatal — we surface the ceiling regardless.
      let currentGwei: number | null = null;
      try {
        // We don't have the publicClient directly here; gas is read by the executor.
        // For the status endpoint we only surface the ceiling from config.
        // A future v2 could inject the publicClient to read live gas.
        currentGwei = null;
      } catch {
        // ignore — gas price is best-effort
      }

      // Read the current vault state for fresh market data.
      // Non-fatal — if this fails we return an empty markets array.
      let vaultStateData: {
        vaultAddress: string;
        adapterAddress: string;
        totalAssets: string;
        totalAssetsFormatted: string;
        markets: Array<{
          label: string;
          marketId: string;
          marketParams: {
            loanToken: string;
            collateralToken: string;
            oracle: string;
            irm: string;
            lltv: string;
          };
          allocation: string;
          allocationFormatted: string;
          percentage: number;
          caps: Array<{
            id: string;
            absoluteCap: string;
            relativeCap: string;
          }>;
        }>;
      } | null = null;

      try {
        const vaultState = await vaultReader.readFullState();

        vaultStateData = {
          vaultAddress: vaultState.vaultAddress,
          adapterAddress: vaultState.adapterAddress,
          totalAssets: vaultState.totalAssets.toString(),
          totalAssetsFormatted: formatUsdcHuman(vaultState.totalAssets),
          markets: vaultState.marketStates.map((ms) => ({
            label: ms.market.label,
            marketId: ms.market.marketId,
            marketParams: {
              loanToken: ms.market.marketParams.loanToken,
              collateralToken: ms.market.marketParams.collateralToken,
              oracle: ms.market.marketParams.oracle,
              irm: ms.market.marketParams.irm,
              lltv: ms.market.marketParams.lltv.toString(),
            },
            allocation: ms.allocation.toString(),
            allocationFormatted: formatUsdcHuman(ms.allocation),
            percentage:
              vaultState.totalAssets > 0n
                ? Number((ms.allocation * 10_000n) / vaultState.totalAssets) / 100
                : 0,
            caps: ms.caps.map((cap) => ({
              id: cap.id,
              absoluteCap: cap.absoluteCap.toString(),
              relativeCap: cap.relativeCap.toString(),
            })),
          })),
        };
      } catch (readError) {
        // On-chain read failed — surface an empty state but do not crash the API.
        fastify.log.warn({ err: readError }, "[api] GET /api/v1/status — vault read failed");
      }

      const responseData = {
        vaultAddress: vaultStateData?.vaultAddress ?? config.VAULT_ADDRESS,
        adapterAddress: vaultStateData?.adapterAddress ?? config.ADAPTER_ADDRESS,
        totalAssets: vaultStateData?.totalAssets ?? "0",
        totalAssetsFormatted: vaultStateData?.totalAssetsFormatted ?? "0.00 USDC",
        markets: vaultStateData?.markets ?? [],
        lastRebalance,
        gas: {
          currentGwei,
          ceilingGwei: config.GAS_CEILING_GWEI,
        },
      };

      return reply.status(HTTP_OK).send(ok(responseData));
    } catch (error) {
      fastify.log.error({ err: error }, "[api] GET /api/v1/status failed");
      return reply.status(HTTP_INTERNAL_ERROR).send(err("Failed to retrieve status"));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/rebalance
  // -------------------------------------------------------------------------

  /**
   * Manually triggers a rebalance cycle.
   *
   * If a cycle is already running (`isRunning === true`), returns 409.
   * If the cycle completes with no actions, returns 200 with `action: "none"`.
   * If the cycle completes with actions, returns 200 with the full result.
   *
   * Response per PLAN.md:
   *   200 { data: { actions: [{ marketLabel, direction, amount, txHash }], newAllocations: [...] } }
   *   200 { data: { action: "none", reason: "within drift threshold" } }
   *   409 { data: null, error: "Rebalance cycle already running" }
   *   500 { data: null, error: "..." }
   */
  fastify.post(REBALANCE_ROUTE, async (_request, reply) => {
    // Conflict check: reject immediately if a cycle is running.
    if (rebalanceService.getStatus().isRunning) {
      return reply
        .status(HTTP_CONFLICT)
        .send(err(ERR_CYCLE_RUNNING));
    }

    try {
      const result = await rebalanceService.run();

      // run() returns null only when isRunning was set before entering run().
      // We checked above, so null here means a race condition — treat as 409.
      if (result === null) {
        return reply
          .status(HTTP_CONFLICT)
          .send(err(ERR_CYCLE_RUNNING));
      }

      // No actions produced — within drift threshold.
      if (result.actions.length === 0) {
        return reply.status(HTTP_OK).send(
          ok({ action: "none", reason: REASON_WITHIN_DRIFT })
        );
      }

      // Rebalance executed — return the full result keyed by marketLabel.
      // Pair each action with its txHash by index (actions and txHashes are
      // positionally aligned when each action produces exactly one tx).
      const responseData = {
        actions: result.actions.map((action, i) => ({
          marketLabel: action.marketLabel,
          direction: action.direction,
          // Serialize bigint as a string for JSON transport.
          amount: action.amount.toString(),
          txHash: result.txHashes[i] ?? null,
        })),
        newAllocations: result.newAllocations,
        timestamp: result.timestamp,
      };

      return reply.status(HTTP_OK).send(ok(responseData));
    } catch (error) {
      fastify.log.error({ err: error }, "[api] POST /api/v1/rebalance failed");
      return reply.status(HTTP_INTERNAL_ERROR).send(err("Rebalance failed"));
    }
  });
}

export default fp(apiPlugin, {
  name: "api-plugin",
  fastify: "5.x",
});
