/**
 * health.ts — GET /health Fastify plugin.
 *
 * Returns a live status snapshot from RebalanceService without making any
 * on-chain calls. Response time must stay < 50 ms — all reads are in-memory.
 *
 * Architecture reference: PLAN.md — "API Contract → GET /health"
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { RebalanceService } from "../services/rebalance.service.js";
import type { Config } from "../config/env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Route path for the health endpoint. */
const HEALTH_ROUTE = "/health" as const;

/** HTTP status code returned when the bot is healthy. */
const HTTP_OK = 200 as const;

/**
 * HTTP status code returned when the bot is degraded (last check too stale).
 */
const HTTP_DEGRADED = 503 as const;

/** Status string for a healthy bot. */
const STATUS_OK = "ok" as const;

/** Status string for a degraded bot. */
const STATUS_DEGRADED = "degraded" as const;

/**
 * Factor applied to the cron interval to determine when a bot is considered
 * stale. If the last check is older than `STALE_FACTOR × cronIntervalMs`, we
 * return 503.
 */
const STALE_FACTOR = 2 as const;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options passed to the health plugin via fastify decoration or direct
 * injection.
 */
export interface HealthPluginOptions extends FastifyPluginOptions {
  rebalanceService: RebalanceService;
  config: Config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a cron expression to derive an approximate interval in milliseconds.
 *
 * This supports only the simple `*\/N * * * *` (every-N-minutes) pattern that
 * the default `CRON_SCHEDULE` follows. For any other expression the function
 * returns a safe default of 10 minutes so the stale check still works.
 *
 * @param cronSchedule  Validated cron expression from config.
 * @returns Interval in milliseconds.
 */
function parseCronIntervalMs(cronSchedule: string): number {
  const FALLBACK_INTERVAL_MS = 10 * 60 * 1_000; // 10 minutes
  const MINUTE_MS = 60_000;

  // Match patterns like "*/5 * * * *" (every N minutes).
  const everyNMinutes = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(cronSchedule);
  if (everyNMinutes) {
    const n = parseInt(everyNMinutes[1], 10);
    if (n > 0) {
      return n * MINUTE_MS;
    }
  }

  // Match "0 */N * * *" (every N hours).
  const everyNHours = /^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/.exec(cronSchedule);
  if (everyNHours) {
    const n = parseInt(everyNHours[1], 10);
    if (n > 0) {
      return n * 60 * MINUTE_MS;
    }
  }

  return FALLBACK_INTERVAL_MS;
}

/**
 * Compute how long the process has been running in seconds.
 *
 * `process.uptime()` is always available in Node.js / Bun environments and
 * returns a high-resolution float. We return a truncated integer for a clean
 * JSON representation.
 */
function uptimeSeconds(): number {
  return Math.floor(process.uptime());
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Health plugin — registers `GET /health`.
 *
 * Decorated values expected on fastify:
 *   - `fastify.rebalanceService`  — instance of RebalanceService
 *   - `fastify.botConfig`         — validated Config object
 *
 * Response shape (200):
 * ```json
 * { "status": "ok", "lastCheck": "...", "lastRebalance": "...", "uptime": 86400 }
 * ```
 *
 * Response shape (503):
 * ```json
 * { "status": "degraded", "lastCheck": null, "lastRebalance": null, "uptime": 86400 }
 * ```
 */
async function healthPlugin(
  fastify: FastifyInstance,
  opts: HealthPluginOptions
): Promise<void> {
  const { rebalanceService, config } = opts;

  const cronIntervalMs = parseCronIntervalMs(config.CRON_SCHEDULE);
  const staleThresholdMs = STALE_FACTOR * cronIntervalMs;

  fastify.get(HEALTH_ROUTE, async (_request, reply) => {
    const status = rebalanceService.getStatus();

    const lastCheck = status.lastCheckTimestamp
      ? status.lastCheckTimestamp.toISOString()
      : null;

    const lastRebalance = status.lastRebalanceTimestamp
      ? status.lastRebalanceTimestamp.toISOString()
      : null;

    const uptime = uptimeSeconds();

    // Determine degraded state: lastCheck is older than STALE_FACTOR × interval.
    // A null lastCheck (bot just started, never ran) is not considered degraded —
    // give the bot one full interval to perform its first check.
    const isStale =
      status.lastCheckTimestamp !== null &&
      Date.now() - status.lastCheckTimestamp.getTime() > staleThresholdMs;

    const body = {
      status: isStale ? STATUS_DEGRADED : STATUS_OK,
      lastCheck,
      lastRebalance,
      uptime,
    };

    return reply.status(isStale ? HTTP_DEGRADED : HTTP_OK).send(body);
  });
}

export default fp(healthPlugin, {
  name: "health-plugin",
  fastify: "5.x",
});
