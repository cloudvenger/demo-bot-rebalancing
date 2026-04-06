/**
 * Integration tests for src/plugins/api.ts — GET /api/v1/status and POST /api/v1/rebalance
 *
 * Strategy: create a real Fastify instance, register the API plugin with a
 * mock rebalanceService and a minimal Config stub, then use fastify.inject() to
 * exercise routes without binding to a real port.
 *
 * External dependencies mocked:
 *   - rebalanceService.getStatus() — controlled via vi.fn()
 *   - rebalanceService.run()       — controlled via vi.fn()
 *   - rebalanceService.isRunning   — read directly from the getStatus() return value
 *
 * No chain interaction is exercised here — that is covered by rebalance-service.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Address, Hash } from "viem";
import apiPlugin from "../../src/plugins/api.js";
import type { RebalanceService } from "../../src/services/rebalance.service.js";
import type { ServiceStatus } from "../../src/services/rebalance.service.js";
import type { RebalanceResult } from "../../src/core/rebalancer/types.js";
import type { Config } from "../../src/config/env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_A: Address = "0x2222222222222222222222222222222222222222";
const ADAPTER_B: Address = "0x3333333333333333333333333333333333333333";

const TX_HASH_1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const TX_HASH_2 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hash;

// ---------------------------------------------------------------------------
// Config stub
// ---------------------------------------------------------------------------

const STUB_CONFIG: Config = {
  RPC_URL: "https://mainnet.example.com",
  PRIVATE_KEY: "a".repeat(64),
  VAULT_ADDRESS,
  TELEGRAM_BOT_TOKEN: "bot:token",
  TELEGRAM_CHAT_ID: "123456",
  CRON_SCHEDULE: "*/5 * * * *",
  DRIFT_THRESHOLD_BPS: 500,
  GAS_CEILING_GWEI: 50,
  MIN_ETH_BALANCE: 0.05,
  PORT: 3000,
  DRY_RUN: false,
  MAX_MARKET_CONCENTRATION_PCT: 10,
  MIN_LIQUIDITY_MULTIPLIER: 2,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A RebalanceResult where two actions were taken and two txs were submitted. */
const RESULT_WITH_ACTIONS: RebalanceResult = {
  actions: [
    {
      adapter: ADAPTER_A,
      direction: "deallocate",
      amount: 500_000_000n,
      data: "0x",
    },
    {
      adapter: ADAPTER_B,
      direction: "allocate",
      amount: 500_000_000n,
      data: "0x",
    },
  ],
  txHashes: [TX_HASH_1, TX_HASH_2],
  newAllocations: [
    { adapter: ADAPTER_A, percentage: 0.3 },
    { adapter: ADAPTER_B, percentage: 0.7 },
  ],
  timestamp: "2024-01-15T12:00:00.000Z",
};

/** A no-op RebalanceResult (no actions, no txs). */
const RESULT_NO_OP: RebalanceResult = {
  actions: [],
  txHashes: [],
  newAllocations: [],
  timestamp: "2024-01-15T12:00:00.000Z",
};

/** A ServiceStatus with a prior rebalance result. */
function makeStatusWithResult(
  lastRebalanceResult: RebalanceResult | null,
  overrides: Partial<ServiceStatus> = {}
): ServiceStatus {
  return {
    lastCheckTimestamp: new Date("2024-01-15T11:55:00.000Z"),
    lastRebalanceTimestamp: lastRebalanceResult
      ? new Date("2024-01-15T11:50:00.000Z")
      : null,
    lastRebalanceResult,
    isRunning: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Fastify test app with the API plugin registered.
 * getStatus and run are individually controllable vi.fn() stubs.
 */
async function buildApp(
  getStatusImpl: () => ServiceStatus,
  runImpl: () => Promise<RebalanceResult | null>
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  const mockService = {
    getStatus: vi.fn().mockImplementation(getStatusImpl),
    run: vi.fn().mockImplementation(runImpl),
  } as unknown as RebalanceService;

  await fastify.register(apiPlugin, {
    rebalanceService: mockService,
    config: STUB_CONFIG,
  });

  return fastify;
}

// ---------------------------------------------------------------------------
// Tests — GET /api/v1/status
// ---------------------------------------------------------------------------

describe("GET /api/v1/status", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns 200", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });

    expect(response.statusCode).toBe(200);
  });

  it("returns { data: {...}, error: null } envelope shape", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body).toHaveProperty("data");
    expect(body.error).toBeNull();
  });

  it("returns vaultAddress matching config in the data object", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.vaultAddress).toBe(VAULT_ADDRESS);
  });

  it("returns isRunning false when no cycle is running", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.isRunning).toBe(false);
  });

  it("returns isRunning true when a cycle is currently running", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: true }),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.isRunning).toBe(true);
  });

  it("returns empty adapters array when no rebalance has occurred", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.adapters).toEqual([]);
  });

  it("returns adapters from the last rebalance result when one exists", async () => {
    app = await buildApp(
      () => makeStatusWithResult(RESULT_WITH_ACTIONS),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.adapters).toHaveLength(2);
    expect(body.data.adapters[0].address).toBe(ADAPTER_A);
    expect(body.data.adapters[1].address).toBe(ADAPTER_B);
  });

  it("returns lastRebalance as null when no rebalance has occurred", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.lastRebalance).toBeNull();
  });

  it("returns lastRebalance with timestamp and txHashes when a rebalance has occurred", async () => {
    app = await buildApp(
      () => makeStatusWithResult(RESULT_WITH_ACTIONS),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.lastRebalance).not.toBeNull();
    expect(body.data.lastRebalance.timestamp).toBe(RESULT_WITH_ACTIONS.timestamp);
    expect(body.data.lastRebalance.txHashes).toEqual([TX_HASH_1, TX_HASH_2]);
  });

  it("returns gas.ceilingGwei from config", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.gas.ceilingGwei).toBe(STUB_CONFIG.GAS_CEILING_GWEI);
  });

  it("returns lastCheck as an ISO string when lastCheckTimestamp is set", async () => {
    const checkDate = new Date("2024-01-15T11:55:00.000Z");
    app = await buildApp(
      () => ({
        lastCheckTimestamp: checkDate,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      }),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.lastCheck).toBe(checkDate.toISOString());
  });

  it("returns lastCheck as null when lastCheckTimestamp is null", async () => {
    app = await buildApp(
      () => ({
        lastCheckTimestamp: null,
        lastRebalanceTimestamp: null,
        lastRebalanceResult: null,
        isRunning: false,
      }),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.lastCheck).toBeNull();
  });

  it("returns 500 with error envelope when getStatus() throws", async () => {
    app = await buildApp(
      () => { throw new Error("DB exploded"); },
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(body.data).toBeNull();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("does not expose internal error message details in 500 response", async () => {
    app = await buildApp(
      () => { throw new Error("super secret RPC URL is https://secret-key@mainnet.infura.io"); },
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.error).not.toContain("secret-key");
  });
});

// ---------------------------------------------------------------------------
// Tests — POST /api/v1/rebalance
// ---------------------------------------------------------------------------

describe("POST /api/v1/rebalance", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 when no cycle is running and run() completes with actions", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });

    expect(response.statusCode).toBe(200);
  });

  it("calls rebalanceService.run() when no cycle is running", async () => {
    const runFn = vi.fn().mockResolvedValue(RESULT_WITH_ACTIONS);
    const fastify = Fastify({ logger: false });

    const mockService = {
      getStatus: vi.fn().mockReturnValue(makeStatusWithResult(null, { isRunning: false })),
      run: runFn,
    } as unknown as RebalanceService;

    await fastify.register(apiPlugin, {
      rebalanceService: mockService,
      config: STUB_CONFIG,
    });

    await fastify.inject({ method: "POST", url: "/api/v1/rebalance" });
    await fastify.close();

    expect(runFn).toHaveBeenCalledOnce();
  });

  it("returns { data: {...}, error: null } envelope when actions are taken", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.error).toBeNull();
    expect(body.data).not.toBeNull();
  });

  it("returns actions array with adapter, direction, and amount when actions are taken", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data.actions).toHaveLength(2);
    expect(body.data.actions[0].adapter).toBe(ADAPTER_A);
    expect(body.data.actions[0].direction).toBe("deallocate");
    // bigint is serialized as string
    expect(body.data.actions[0].amount).toBe("500000000");
  });

  it("serializes bigint amount as a string in the actions array", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    for (const action of body.data.actions) {
      expect(typeof action.amount).toBe("string");
    }
  });

  it("returns txHashes array in the response when actions are taken", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data.txHashes).toEqual([TX_HASH_1, TX_HASH_2]);
  });

  it("returns newAllocations in the response when actions are taken", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data.newAllocations).toHaveLength(2);
    expect(body.data.newAllocations[0].adapter).toBe(ADAPTER_A);
    expect(body.data.newAllocations[0].percentage).toBe(0.3);
  });

  it("returns 200 with action none and reason within drift threshold when no rebalance is needed", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.action).toBe("none");
    expect(body.data.reason).toBe("within drift threshold");
  });

  it("returns error null when no rebalance is needed", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.error).toBeNull();
  });

  it("returns 409 when a cycle is already running", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: true }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });

    expect(response.statusCode).toBe(409);
  });

  it("returns error message Rebalance cycle already running on 409", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: true }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.error).toBe("Rebalance cycle already running");
  });

  it("returns data null on 409 conflict", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: true }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data).toBeNull();
  });

  it("does not call run() when a cycle is already running", async () => {
    const runFn = vi.fn().mockResolvedValue(RESULT_WITH_ACTIONS);
    const fastify = Fastify({ logger: false });

    const mockService = {
      getStatus: vi.fn().mockReturnValue(makeStatusWithResult(null, { isRunning: true })),
      run: runFn,
    } as unknown as RebalanceService;

    await fastify.register(apiPlugin, {
      rebalanceService: mockService,
      config: STUB_CONFIG,
    });

    await fastify.inject({ method: "POST", url: "/api/v1/rebalance" });
    await fastify.close();

    expect(runFn).not.toHaveBeenCalled();
  });

  it("returns 409 when run() returns null (race condition)", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => null
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });

    expect(response.statusCode).toBe(409);
  });

  it("returns error message Rebalance cycle already running when run() returns null", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => null
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.error).toBe("Rebalance cycle already running");
  });

  it("returns 500 when run() throws an unexpected error", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => { throw new Error("RPC timed out"); }
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });

    expect(response.statusCode).toBe(500);
  });

  it("returns { data: null, error: string } envelope when run() throws", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => { throw new Error("RPC timed out"); }
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data).toBeNull();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("does not expose internal error details in 500 response", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => { throw new Error("PRIVATE_KEY=0xdeadbeef leaked"); }
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.error).not.toContain("PRIVATE_KEY");
    expect(body.error).not.toContain("deadbeef");
  });
});
