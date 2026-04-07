/**
 * Integration tests for src/plugins/health.ts — GET /health
 *
 * Strategy: create a real Fastify instance, register the health plugin with a
 * mock rebalanceService and a minimal Config stub, then use fastify.inject() to
 * exercise routes without binding to a real port.
 *
 * External dependencies mocked:
 *   - rebalanceService.getStatus() — returns controlled ServiceStatus objects
 *   - process.uptime() is NOT mocked; we only assert the type/range of uptime
 *
 * No network, no DB, no cron — purely in-process route testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import healthPlugin from "../../src/plugins/health.js";
import type { RebalanceService } from "../../src/services/rebalance.service.js";
import type { ServiceStatus } from "../../src/services/rebalance.service.js";
import type { Config } from "../../src/config/env.js";

// ---------------------------------------------------------------------------
// Config stub — only CRON_SCHEDULE matters for the health plugin
// ---------------------------------------------------------------------------

const STUB_CONFIG: Config = {
  RPC_URL: "https://mainnet.example.com",
  PRIVATE_KEY: "a".repeat(64),
  VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
  ADAPTER_ADDRESS: "0x2222222222222222222222222222222222222222",
  MANAGED_MARKETS_PATH: "/tmp/managed-markets.json",
  TELEGRAM_BOT_TOKEN: "bot:token",
  TELEGRAM_CHAT_ID: "123456",
  CRON_SCHEDULE: "*/5 * * * *", // 5-minute interval → stale threshold = 10 min
  DRIFT_THRESHOLD_BPS: 500,
  GAS_CEILING_GWEI: 50,
  MIN_ETH_BALANCE: 0.05,
  PORT: 3000,
  DRY_RUN: false,
  MAX_MARKET_CONCENTRATION_PCT: 10,
  MIN_LIQUIDITY_MULTIPLIER: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock for RebalanceService with a controlled getStatus().
 */
function makeServiceMock(status: ServiceStatus): Pick<RebalanceService, "getStatus" | "run"> {
  return {
    getStatus: vi.fn().mockReturnValue(status),
    run: vi.fn(),
  } as unknown as Pick<RebalanceService, "getStatus" | "run">;
}

/**
 * Create a fresh Fastify instance with the health plugin registered.
 * Returns the instance ready for inject() calls.
 */
async function buildApp(status: ServiceStatus, configOverride?: Partial<Config>): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  const service = makeServiceMock(status);
  const cfg = { ...STUB_CONFIG, ...configOverride };

  await fastify.register(healthPlugin, {
    rebalanceService: service as unknown as RebalanceService,
    config: cfg,
  });

  return fastify;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  describe("when the bot has never run (lastCheckTimestamp is null)", () => {
    it("returns 200", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
    });

    it("returns status ok when lastCheck is null (bot just started)", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.status).toBe("ok");
    });

    it("returns lastCheck as null when no check has run", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.lastCheck).toBeNull();
    });

    it("returns lastRebalance as null when no rebalance has occurred", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.lastRebalance).toBeNull();
    });

    it("returns uptime as a non-negative number", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(typeof body.uptime).toBe("number");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("when the bot last checked recently (healthy)", () => {
    it("returns 200 when lastCheck is within the stale threshold", async () => {
      // lastCheck 1 minute ago; stale threshold for */5 cron = 10 minutes
      const recentDate = new Date(Date.now() - 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: recentDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
    });

    it("returns status ok when lastCheck is recent", async () => {
      const recentDate = new Date(Date.now() - 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: recentDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.status).toBe("ok");
    });

    it("returns lastCheck as a valid ISO string when lastCheckTimestamp is set", async () => {
      const checkDate = new Date("2024-01-15T12:00:00.000Z");
      const status: ServiceStatus = {
        lastCheckTimestamp: checkDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.lastCheck).toBe(checkDate.toISOString());
    });

    it("returns lastRebalance as an ISO string when lastRebalanceTimestamp is set", async () => {
      const recentDate = new Date(Date.now() - 60_000);
      const rebalanceDate = new Date("2024-01-15T11:30:00.000Z");
      const status: ServiceStatus = {
        lastCheckTimestamp: recentDate,
        lastRebalanceTimestamp: rebalanceDate,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.lastRebalance).toBe(rebalanceDate.toISOString());
    });

    it("returns uptime as an integer number of seconds", async () => {
      const recentDate = new Date(Date.now() - 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: recentDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(Number.isInteger(body.uptime)).toBe(true);
    });
  });

  describe("when the bot's last check is stale", () => {
    it("returns 503 when lastCheck is older than 2x the cron interval", async () => {
      // */5 cron = 5 min interval; stale threshold = 10 min; set 11 min ago
      const staleDate = new Date(Date.now() - 11 * 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: staleDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(503);
    });

    it("returns status degraded when lastCheck is stale", async () => {
      const staleDate = new Date(Date.now() - 11 * 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: staleDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.status).toBe("degraded");
    });

    it("includes lastCheck as an ISO string in the 503 response", async () => {
      const staleDate = new Date(Date.now() - 11 * 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: staleDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body.lastCheck).toBe(staleDate.toISOString());
    });

    it("returns 503 for an hourly cron when last check is older than 2 hours", async () => {
      // "0 */1 * * *" = every 1 hour; stale threshold = 2 hours; set 3 hours ago
      const staleDate = new Date(Date.now() - 3 * 60 * 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: staleDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status, { CRON_SCHEDULE: "0 */1 * * *" });

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(503);
    });

    it("returns 200 for an unknown cron expression (fallback 10 min interval) when check is 15 min ago", async () => {
      // Unrecognised cron → fallback 10 min → stale = 20 min; 15 min ago is NOT stale
      const date15MinAgo = new Date(Date.now() - 15 * 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: date15MinAgo,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status, { CRON_SCHEDULE: "0 0 * * 1" }); // weekly — unrecognised

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
    });

    it("returns 503 for an unknown cron expression when check is 25 min ago (exceeds 20 min stale)", async () => {
      // Unrecognised cron → fallback 10 min → stale = 20 min; 25 min ago IS stale
      const date25MinAgo = new Date(Date.now() - 25 * 60_000);
      const status: ServiceStatus = {
        lastCheckTimestamp: date25MinAgo,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status, { CRON_SCHEDULE: "0 0 * * 1" });

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(503);
    });
  });

  describe("response shape", () => {
    it("response body contains status, lastCheck, lastRebalance, and uptime fields", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });
      const body = response.json();

      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("lastCheck");
      expect(body).toHaveProperty("lastRebalance");
      expect(body).toHaveProperty("uptime");
    });

    it("returns Content-Type application/json", async () => {
      const status: ServiceStatus = {
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      };
      app = await buildApp(status);

      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.headers["content-type"]).toMatch(/application\/json/);
    });
  });
});
