/**
 * index.ts — Fastify entry point for the Morpho V2 Rebalancing Bot.
 *
 * Responsibilities:
 *   1. Parse and validate configuration from environment variables.
 *   2. Load and validate the managed-markets JSON file.
 *   3. Instantiate all concrete dependencies (viem clients, readers,
 *      executor, notifier, service) via constructor injection.
 *   4. Run startup invariants: adapter enabled, allocator role, cap-id
 *      preimage correctness, no relativeCap == 0.
 *   5. Create the Fastify instance with Pino logger.
 *   6. Register the health, api, and scheduler plugins.
 *   7. Start listening on the configured PORT.
 *   8. Handle SIGINT / SIGTERM for graceful shutdown.
 *
 * Architecture reference: PLAN.md — "Group 6 → src/index.ts"
 */

import Fastify from "fastify";
import { config, safeConfig } from "./config/env.js";
import { loadManagedMarkets } from "./config/managed-markets.js";
import { createClients } from "./core/chain/client.js";
import { VaultReader } from "./core/chain/vault.js";
import { MorphoReader } from "./core/chain/morpho.js";
import { Executor, DryRunExecutor } from "./core/chain/executor.js";
import type { IExecutor } from "./core/chain/executor.js";
import { Notifier } from "./services/notifier.js";
import { RebalanceService } from "./services/rebalance.service.js";
import healthPlugin from "./plugins/health.js";
import apiPlugin from "./plugins/api.js";
import schedulerPlugin from "./plugins/scheduler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Graceful shutdown timeout in milliseconds. */
const SHUTDOWN_TIMEOUT_MS = 10_000 as const;

/** Host to bind to — always `0.0.0.0` in production containers. */
const LISTEN_HOST = "0.0.0.0" as const;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Build and start the Fastify server with all plugins and dependencies.
 *
 * This function is called once at process start. All errors thrown here
 * are caught at the call site and trigger a process.exit(1).
 *
 * Startup sequence (per PLAN.md Group 8.3):
 *   1. env → load and validate config
 *   2. loadManagedMarkets(env.MANAGED_MARKETS_PATH)
 *   3. VaultReader(publicClient, vaultAddress, adapterAddress, managedMarkets)
 *   4. vaultReader.assertStartupInvariants(botWallet) — mutates capIds + throws on violations
 *   5. Start Fastify + register plugins
 */
async function start(): Promise<void> {
  // ---- 1. Create Fastify with Pino logger ---------------------------------
  const fastify = Fastify({ logger: true });

  // ---- 2. Load managed markets from JSON file -----------------------------
  // Must happen before VaultReader is constructed — the reader needs the
  // managed markets array to populate capIds at startup.
  fastify.log.info({ path: config.MANAGED_MARKETS_PATH }, "loading managed markets");
  const managedMarkets = loadManagedMarkets(config.MANAGED_MARKETS_PATH);
  fastify.log.info({ count: managedMarkets.length }, "managed markets loaded");

  // ---- 3. Instantiate dependencies ----------------------------------------

  // Chain clients (public + wallet) from viem.
  const clients = createClients(config);

  // Vault reader — 4-arg constructor: publicClient, vaultAddress, adapterAddress, managedMarkets.
  // assertStartupInvariants() will mutate managedMarkets[].capIds in-place.
  const vaultReader = new VaultReader(
    clients.publicClient,
    config.VAULT_ADDRESS as `0x${string}`,
    config.ADAPTER_ADDRESS as `0x${string}`,
    managedMarkets
  );

  // ---- 4. Run startup invariants -------------------------------------------
  // Derives and verifies cap ids for each managed market, asserts adapter is
  // enabled, checks allocator role, refuses to start on relativeCap == 0.
  const botWallet = clients.walletClient.account.address;
  fastify.log.info({ botWallet }, "running startup invariants");
  await vaultReader.assertStartupInvariants(botWallet);
  fastify.log.info(
    { marketCount: vaultReader.activeMarkets.length },
    "startup invariants passed"
  );

  // Morpho reader — reads Morpho Blue market state and IRM params.
  const morphoReader = new MorphoReader(clients.publicClient);

  // Executor — live or dry-run, depending on DRY_RUN env var.
  const executor: IExecutor = config.DRY_RUN
    ? new DryRunExecutor()
    : new Executor(clients.walletClient, clients.publicClient, config);

  // Notifier — sends Telegram alerts (fire-and-forget).
  const notifier = new Notifier(config);

  // RebalanceService — orchestrates the full read → compute → execute → notify cycle.
  const rebalanceService = new RebalanceService(
    vaultReader,
    morphoReader,
    executor,
    notifier,
    config
  );

  // ---- 5. Register plugins -------------------------------------------------

  // Health plugin: GET /health
  await fastify.register(healthPlugin, { rebalanceService, config });

  // API plugin: GET /api/v1/status + POST /api/v1/rebalance
  // Passes vaultReader so the status endpoint can read live vault state.
  await fastify.register(apiPlugin, { rebalanceService, vaultReader, config });

  // Scheduler plugin: croner job that calls rebalanceService.run() on schedule
  await fastify.register(schedulerPlugin, { rebalanceService, config });

  // ---- 6. Start listening --------------------------------------------------
  const address = await fastify.listen({
    port: config.PORT,
    host: LISTEN_HOST,
  });

  fastify.log.info({ config: safeConfig() }, `bot started — listening on ${address}`);

  // ---- 7. Graceful shutdown on SIGINT / SIGTERM ----------------------------
  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info(`received ${signal} — shutting down`);

    const shutdownTimer = setTimeout(() => {
      fastify.log.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Clear the timer ref so it doesn't keep the process alive if everything
    // closes cleanly before the timeout fires.
    shutdownTimer.unref();

    try {
      // fastify.close() triggers the onClose hook which stops the cron job.
      await fastify.close();
      fastify.log.info("server closed cleanly");
    } catch (error) {
      fastify.log.error({ err: error }, "error during graceful shutdown");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

start().catch((error: unknown) => {
  // Use console.error here because the Fastify logger may not be initialised
  // if startup fails before the server is created.
  // Sanitise the message to prevent leaking RPC URLs (which embed provider API keys)
  // or private-key fragments that viem may include in malformed-key error messages.
  const rawMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = rawMessage
    .replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")
    .replace(/0x[0-9a-fA-F]{20,}/g, "[HEX_REDACTED]");
  // eslint-disable-next-line no-console
  console.error("[bot] Fatal error during startup:", safeMessage);
  process.exit(1);
});
