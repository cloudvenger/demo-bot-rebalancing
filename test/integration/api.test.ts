/**
 * Integration tests for src/plugins/api.ts — GET /api/v1/status and POST /api/v1/rebalance
 *
 * Updated for V2 single-adapter model (Group 8.3):
 *   - STUB_CONFIG now includes ADAPTER_ADDRESS and MANAGED_MARKETS_PATH (required fields)
 *   - GET /api/v1/status returns the new shape per PLAN.md:
 *     { vaultAddress, adapterAddress, totalAssets, markets[...], lastRebalance, gas }
 *     markets[] items have: label, marketId, marketParams, allocation, percentage, caps[3]
 *   - POST /api/v1/rebalance actions are keyed by marketLabel (not adapter address)
 *   - RebalanceResult.actions include marketLabel field
 *   - RebalanceResult.newAllocations is Array<{ marketLabel, percentage }>
 *
 * Strategy: create a real Fastify instance, register the API plugin with a
 * mock rebalanceService and a mocked VaultReader, then use fastify.inject().
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Address, Hash } from "viem";
import apiPlugin from "../../src/plugins/api.js";
import type { RebalanceService } from "../../src/services/rebalance.service.js";
import type { ServiceStatus } from "../../src/services/rebalance.service.js";
import type { RebalanceResult } from "../../src/core/rebalancer/types.js";
import type { VaultReader } from "../../src/core/chain/vault.js";
import type { Config } from "../../src/config/env.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_ADDRESS: Address = "0x2222222222222222222222222222222222222222";

const TX_HASH_1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const TX_HASH_2 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hash;

const CAP_ID_0 = "0xaaaa000000000000000000000000000000000000000000000000000000000000" as Hash;
const CAP_ID_1 = "0xbbbb000000000000000000000000000000000000000000000000000000000000" as Hash;
const CAP_ID_2 = "0xcccc000000000000000000000000000000000000000000000000000000000000" as Hash;
const MARKET_ID_A = "0xaaab000000000000000000000000000000000000000000000000000000000000" as Hash;

// ---------------------------------------------------------------------------
// Config stub — must include all required fields (including Group 8.1 additions)
// ---------------------------------------------------------------------------

const STUB_CONFIG: Config = {
  RPC_URL: "https://mainnet.example.com",
  PRIVATE_KEY: "a".repeat(64),
  VAULT_ADDRESS,
  ADAPTER_ADDRESS,
  MANAGED_MARKETS_PATH: "/tmp/managed-markets.json",
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

/**
 * A RebalanceResult using the new V2 shape:
 *   - actions include marketLabel
 *   - newAllocations use { marketLabel, percentage }
 */
const RESULT_WITH_ACTIONS: RebalanceResult = {
  actions: [
    {
      adapter: ADAPTER_ADDRESS,
      marketLabel: "USDC/WETH 86%",
      direction: "deallocate",
      amount: 500_000_000n,
      data: "0x1234abcd",
    },
    {
      adapter: ADAPTER_ADDRESS,
      marketLabel: "USDC/wstETH 86%",
      direction: "allocate",
      amount: 500_000_000n,
      data: "0x5678efgh" as `0x${string}`,
    },
  ],
  txHashes: [TX_HASH_1, TX_HASH_2],
  newAllocations: [
    { marketLabel: "USDC/WETH 86%", percentage: 35.0 },
    { marketLabel: "USDC/wstETH 86%", percentage: 45.0 },
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

/** Mock VaultState with the new V2 shape. */
const MOCK_VAULT_STATE = {
  vaultAddress: VAULT_ADDRESS,
  adapterAddress: ADAPTER_ADDRESS,
  totalAssets: 1_000_000_000_000n, // 1M USDC
  marketStates: [
    {
      market: {
        label: "USDC/WETH 86%",
        marketId: MARKET_ID_A,
        marketParams: {
          loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
          collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
          oracle: "0x3333333333333333333333333333333333333333" as Address,
          irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address,
          lltv: 860_000_000_000_000_000n,
        },
        capIds: [CAP_ID_0, CAP_ID_1, CAP_ID_2],
      },
      allocation: 400_000_000_000n, // 400k USDC
      allocationPercentage: 0.4,
      caps: [
        { id: CAP_ID_0, absoluteCap: 500_000_000_000n, relativeCap: 1_000_000_000_000_000_000n },
        { id: CAP_ID_1, absoluteCap: 800_000_000_000n, relativeCap: 800_000_000_000_000_000n },
        { id: CAP_ID_2, absoluteCap: 500_000_000_000n, relativeCap: 500_000_000_000_000_000n },
      ],
    },
  ],
  marketData: [],
};

/** Build a ServiceStatus. */
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
 * vaultReader.readFullState is mocked to return MOCK_VAULT_STATE by default.
 */
async function buildApp(
  getStatusImpl: () => ServiceStatus,
  runImpl: () => Promise<RebalanceResult | null>,
  vaultReadImpl?: () => Promise<typeof MOCK_VAULT_STATE>
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  const mockService = {
    getStatus: vi.fn().mockImplementation(getStatusImpl),
    run: vi.fn().mockImplementation(runImpl),
  } as unknown as RebalanceService;

  const mockVaultReader = {
    readFullState: vi.fn().mockImplementation(
      vaultReadImpl ?? (() => Promise.resolve(MOCK_VAULT_STATE))
    ),
    activeMarkets: MOCK_VAULT_STATE.marketStates.map((ms) => ms.market),
  } as unknown as VaultReader;

  await fastify.register(apiPlugin, {
    rebalanceService: mockService,
    vaultReader: mockVaultReader,
    config: STUB_CONFIG,
  });

  return fastify;
}

// ===========================================================================
// Tests — GET /api/v1/status
// ===========================================================================

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

  it("returns vaultAddress in the data object", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.vaultAddress).toBe(VAULT_ADDRESS);
  });

  it("returns adapterAddress in the data object", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.adapterAddress).toBe(ADAPTER_ADDRESS);
  });

  it("returns totalAssets as a string in the data object", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(typeof body.data.totalAssets).toBe("string");
    expect(body.data.totalAssets).toBe(MOCK_VAULT_STATE.totalAssets.toString());
  });

  it("returns markets array with at least one entry from vault state", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(Array.isArray(body.data.markets)).toBe(true);
    expect(body.data.markets.length).toBeGreaterThan(0);
  });

  it("returns market entry with label field", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.markets[0].label).toBe("USDC/WETH 86%");
  });

  it("returns market entry with marketId field", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.markets[0].marketId).toBe(MARKET_ID_A);
  });

  it("returns market entry with marketParams including loanToken and lltv", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    const mp = body.data.markets[0].marketParams;
    expect(typeof mp.loanToken).toBe("string");
    expect(typeof mp.lltv).toBe("string"); // bigint serialized as string
  });

  it("returns market entry with allocation as string", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(typeof body.data.markets[0].allocation).toBe("string");
    expect(body.data.markets[0].allocation).toBe(
      MOCK_VAULT_STATE.marketStates[0].allocation.toString()
    );
  });

  it("returns market entry with percentage as number", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(typeof body.data.markets[0].percentage).toBe("number");
  });

  it("returns market entry with caps array of length 3", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    const caps = body.data.markets[0].caps;
    expect(Array.isArray(caps)).toBe(true);
    expect(caps).toHaveLength(3);
  });

  it("returns caps entries with id, absoluteCap, relativeCap as strings", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    const cap = body.data.markets[0].caps[0];
    expect(typeof cap.id).toBe("string");
    expect(typeof cap.absoluteCap).toBe("string"); // bigint serialized as string
    expect(typeof cap.relativeCap).toBe("string"); // bigint serialized as string
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

  it("returns empty markets array when vaultReader.readFullState throws", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP,
      () => Promise.reject(new Error("RPC timeout"))
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    // On read failure, markets falls back to empty but the route still returns 200
    expect(response.statusCode).toBe(200);
    expect(body.data.markets).toEqual([]);
  });

  it("returns fallback vaultAddress from config when vaultReader fails", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null),
      async () => RESULT_NO_OP,
      () => Promise.reject(new Error("RPC timeout"))
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });
    const body = response.json();

    expect(body.data.vaultAddress).toBe(VAULT_ADDRESS);
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

// ===========================================================================
// Tests — POST /api/v1/rebalance
// ===========================================================================

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

    const mockVaultReader = {
      readFullState: vi.fn().mockResolvedValue(MOCK_VAULT_STATE),
      activeMarkets: [],
    } as unknown as VaultReader;

    await fastify.register(apiPlugin, {
      rebalanceService: mockService,
      vaultReader: mockVaultReader,
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

  it("returns actions array with marketLabel, direction, and amount when actions are taken", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data.actions).toHaveLength(2);
    // New shape: actions keyed by marketLabel, not adapter address
    expect(body.data.actions[0].marketLabel).toBe("USDC/WETH 86%");
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

  it("newAllocations array uses marketLabel (not adapter address) as the key", async () => {
    app = await buildApp(
      () => makeStatusWithResult(null, { isRunning: false }),
      async () => RESULT_WITH_ACTIONS
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/rebalance" });
    const body = response.json();

    expect(body.data.newAllocations).toHaveLength(2);
    expect(body.data.newAllocations[0].marketLabel).toBe("USDC/WETH 86%");
    expect(body.data.newAllocations[0].percentage).toBe(35.0);
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

  it("returns error message 'Rebalance cycle already running' on 409", async () => {
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

    const mockVaultReader = {
      readFullState: vi.fn().mockResolvedValue(MOCK_VAULT_STATE),
      activeMarkets: [],
    } as unknown as VaultReader;

    await fastify.register(apiPlugin, {
      rebalanceService: mockService,
      vaultReader: mockVaultReader,
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
  });
});
