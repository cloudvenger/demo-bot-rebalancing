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
import type { RebalanceService } from "../services/rebalance.service.js";
import type { Config } from "../config/env.js";

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

/** Divisor to convert raw USDC units to a human-readable decimal number */
const USDC_DIVISOR = 10 ** USDC_DECIMALS;

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
  config: Config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a raw bigint asset amount (USDC 6 decimals) as a human-readable
 * string, e.g. `"1000000000000"` → `"1,000,000.00 USDC"`.
 *
 * @param rawAmount  Asset amount in the vault's underlying denomination.
 * @returns Human-readable string.
 */
function formatUsdcHuman(rawAmount: bigint): string {
  const whole = rawAmount / BigInt(USDC_DIVISOR);
  const fraction = rawAmount % BigInt(USDC_DIVISOR);
  const fractionStr = fraction.toString().padStart(USDC_DECIMALS, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fractionStr} USDC`;
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
  const { rebalanceService, config } = opts;

  // -------------------------------------------------------------------------
  // GET /api/v1/status
  // -------------------------------------------------------------------------

  /**
   * Returns the current vault allocation state and last-rebalance metadata.
   *
   * All data comes from the in-memory snapshot cached by RebalanceService —
   * no on-chain calls are made during this handler.
   *
   * Response: 200 { data: { ... }, error: null }
   *           500 { data: null, error: "..." }
   */
  fastify.get(STATUS_ROUTE, async (_request, reply) => {
    try {
      const status = rebalanceService.getStatus();

      const lastRebalanceResult = status.lastRebalanceResult;

      // Build last-rebalance metadata from the stored result.
      const lastRebalance = lastRebalanceResult
        ? {
            timestamp: lastRebalanceResult.timestamp,
            txHashes: lastRebalanceResult.txHashes,
          }
        : null;

      // We don't cache VaultState separately in this implementation — the
      // status snapshot from RebalanceService contains all we need for the
      // API response. A future v2 could expose the full adapter list from
      // cached VaultState.
      //
      // For now we surface what is available from getStatus() and annotate
      // clearly where richer data would come from.

      const responseData = {
        vaultAddress: config.VAULT_ADDRESS,
        // lastRebalanceResult contains the actions taken during the last cycle.
        adapters: lastRebalanceResult
          ? lastRebalanceResult.newAllocations.map((alloc) => ({
              address: alloc.adapter,
              percentage: alloc.percentage,
            }))
          : [],
        lastRebalance,
        // Gas info — ceiling comes from config; current price is not cached
        // here (that would require an on-chain call). We surface the ceiling
        // for observability and omit the live price to keep < 50ms response.
        gas: {
          ceilingGwei: config.GAS_CEILING_GWEI,
        },
        isRunning: status.isRunning,
        lastCheck: status.lastCheckTimestamp
          ? status.lastCheckTimestamp.toISOString()
          : null,
      };

      return reply.status(HTTP_OK).send(ok(responseData));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      // Never expose internal error details to the client.
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
   * Response: 200 { data: { actions[], txHashes[], newAllocations[] }, error: null }
   *           200 { data: { action: "none", reason: "within drift threshold" }, error: null }
   *           409 { data: null, error: "Rebalance cycle already running" }
   *           500 { data: null, error: "..." }
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

      // Rebalance executed — return the full result.
      const responseData = {
        actions: result.actions.map((action) => ({
          adapter: action.adapter,
          direction: action.direction,
          // Serialize bigint as a string for JSON transport.
          amount: action.amount.toString(),
        })),
        txHashes: result.txHashes,
        newAllocations: result.newAllocations,
        timestamp: result.timestamp,
      };

      return reply.status(HTTP_OK).send(ok(responseData));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      fastify.log.error({ err: error }, "[api] POST /api/v1/rebalance failed");
      return reply.status(HTTP_INTERNAL_ERROR).send(err("Rebalance failed"));
    }
  });
}

export default fp(apiPlugin, {
  name: "api-plugin",
  fastify: "5.x",
});
