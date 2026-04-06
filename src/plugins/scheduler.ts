/**
 * scheduler.ts — croner-based cron scheduler Fastify plugin.
 *
 * Registers a periodic job that calls rebalanceService.run() on the configured
 * CRON_SCHEDULE. A second call to run() while the previous one is still
 * executing is a no-op (the cycle lock inside RebalanceService handles it).
 *
 * This plugin owns only the scheduling concern. All business logic lives in
 * RebalanceService — this file does not inspect or transform the result.
 *
 * Architecture reference: PLAN.md — "Group 6 → scheduler.ts"
 */

import fp from "fastify-plugin";
import { Cron } from "croner";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { RebalanceService } from "../services/rebalance.service.js";
import type { Config } from "../config/env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Log message emitted at the start of each cron tick. */
const MSG_CRON_TICK = "cron tick — checking allocations" as const;

/** Log message emitted when the previous cycle is still running. */
const MSG_CRON_SKIPPED = "cron tick — skipped (previous cycle running)" as const;

/** Log prefix for all log lines emitted by this plugin. */
const LOG_PREFIX = "[scheduler]" as const;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options passed to the scheduler plugin.
 */
export interface SchedulerPluginOptions extends FastifyPluginOptions {
  rebalanceService: RebalanceService;
  config: Config;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Scheduler plugin — creates a croner job on plugin ready and stops it when
 * Fastify closes.
 *
 * Each tick:
 * 1. Log "cron tick — checking allocations" OR "cron tick — skipped (previous
 *    cycle running)" depending on the service lock state.
 * 2. Call `rebalanceService.run()`.
 *    The service's internal `isRunning` guard makes concurrent invocations
 *    safe — a new tick will simply no-op until the previous cycle finishes.
 * 3. Errors thrown by `run()` are caught and logged; they never crash the
 *    Fastify process.
 *
 * The plugin does NOT call `run()` at startup — the first execution happens on
 * the first cron tick. This avoids blocking server startup with an RPC call.
 */
async function schedulerPlugin(
  fastify: FastifyInstance,
  opts: SchedulerPluginOptions
): Promise<void> {
  const { rebalanceService, config } = opts;

  let job: Cron | null = null;

  // Start the cron job once Fastify has finished booting.
  fastify.addHook("onReady", async () => {
    fastify.log.info(
      `${LOG_PREFIX} starting cron job with schedule "${config.CRON_SCHEDULE}"`
    );

    job = new Cron(config.CRON_SCHEDULE, async () => {
      // Check lock state before delegating to run() so we can emit the
      // appropriate log message.
      if (rebalanceService.getStatus().isRunning) {
        fastify.log.info(`${LOG_PREFIX} ${MSG_CRON_SKIPPED}`);
        return;
      }

      fastify.log.info(`${LOG_PREFIX} ${MSG_CRON_TICK}`);

      try {
        await rebalanceService.run();
      } catch (error) {
        // Defensive catch: run() has its own error boundaries but we guard
        // here too to ensure a rogue exception never kills the process.
        fastify.log.error(
          { err: error },
          `${LOG_PREFIX} unexpected error during cron tick`
        );
      }
    });
  });

  // Stop the cron job when Fastify shuts down (SIGINT / SIGTERM).
  fastify.addHook("onClose", async () => {
    if (job) {
      fastify.log.info(`${LOG_PREFIX} stopping cron job`);
      job.stop();
      job = null;
    }
  });
}

export default fp(schedulerPlugin, {
  name: "scheduler-plugin",
  fastify: "5.x",
});
