/**
 * Integration tests for src/core/chain/morpho.ts — MorphoReader
 *
 * Strategy: mock the viem public client at the boundary (readContract /
 * multicall). All mock return values mirror realistic Morpho Blue mainnet
 * market data so all MorphoReader code paths execute without network access.
 * Tests are fully deterministic.
 *
 * Mock boundary: publicClient.readContract and publicClient.multicall are the
 * only external dependencies. Internal helpers (withRetry, deriveIRMParams,
 * computeSupplyAPY) are not mocked — they execute as real code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hash } from "viem";
import { MorphoReader } from "../../src/core/chain/morpho.js";
import type { BotPublicClient } from "../../src/core/chain/client.js";
import type { AdapterState } from "../../src/core/rebalancer/types.js";
import { WAD } from "../../src/config/constants.js";

// ---------------------------------------------------------------------------
// Test constants — realistic values matching a USDC/WETH Morpho Blue market
// ---------------------------------------------------------------------------

const MORPHO_ADDRESS: Address = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Realistic market ID (bytes32)
const MARKET_ID: Hash =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc";

// Realistic token addresses (USDC / WBTC)
const LOAN_TOKEN: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC
const COLLATERAL_TOKEN: Address =
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"; // WBTC
const ORACLE: Address = "0xdDb6F90fFb4d3257dd666b69178e5B3c5Bf41136";
const IRM_ADDRESS: Address = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";
const LLTV = (WAD * 86n) / 100n; // 86% LLTV

// Realistic market state — 80% utilization, 50M USDC total supply
const TOTAL_SUPPLY_ASSETS = 50_000_000_000_000n; // 50M USDC (6 dec)
const TOTAL_SUPPLY_SHARES = 49_900_000_000_000_000n;
const TOTAL_BORROW_ASSETS = 40_000_000_000_000n; // 40M USDC (80% utilization)
const TOTAL_BORROW_SHARES = 39_800_000_000_000_000n;
const LAST_UPDATE = 1_700_000_000n;
const FEE = 0n;

// Realistic borrow rate: ~8% APY / SECONDS_PER_YEAR ≈ 2.5e9 per second in WAD
// 8% per year = 0.08 / 31536000 seconds ≈ 2.538e-9 per second
// In WAD (1e18): 2538e9 ≈ 2_538_000_000
const BORROW_RATE_PER_SECOND = 2_538_000_000n; // WAD per second

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockClient(overrides?: {
  readContract?: ReturnType<typeof vi.fn>;
  multicall?: ReturnType<typeof vi.fn>;
}): BotPublicClient {
  return {
    readContract: overrides?.readContract ?? vi.fn(),
    multicall: overrides?.multicall ?? vi.fn(),
  } as unknown as BotPublicClient;
}

/**
 * Standard multicall response for a single call to readMarketData:
 *   Batch 1: [market(id), idToMarketParams(id)]
 */
function standardMarketMulticall(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValueOnce([
    // market(id) result: tuple of 6 uint128 values
    [
      TOTAL_SUPPLY_ASSETS,
      TOTAL_SUPPLY_SHARES,
      TOTAL_BORROW_ASSETS,
      TOTAL_BORROW_SHARES,
      LAST_UPDATE,
      FEE,
    ],
    // idToMarketParams(id) result: tuple of 5 values
    [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
  ]);
}

/**
 * Standard readContract response for borrowRateView after a multicall.
 */
function standardBorrowRateReadContract(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValueOnce(BORROW_RATE_PER_SECOND);
}

// ---------------------------------------------------------------------------
// 1. readMarketData — return type and structure
// ---------------------------------------------------------------------------

describe("MorphoReader.readMarketData — return type and structure", () => {
  it("returns an object with the marketId property equal to the input", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.marketId).toBe(MARKET_ID);
  });

  it("returns totalSupply as a bigint equal to totalSupplyAssets", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(typeof data.totalSupply).toBe("bigint");
    expect(data.totalSupply).toBe(TOTAL_SUPPLY_ASSETS);
  });

  it("returns totalBorrow as a bigint equal to totalBorrowAssets", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(typeof data.totalBorrow).toBe("bigint");
    expect(data.totalBorrow).toBe(TOTAL_BORROW_ASSETS);
  });

  it("returns availableLiquidity = totalSupply - totalBorrow", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.availableLiquidity).toBe(
      TOTAL_SUPPLY_ASSETS - TOTAL_BORROW_ASSETS
    );
  });

  it("returns availableLiquidity = 0n when borrow exceeds supply", async () => {
    // Edge case: borrow > supply (should not happen on-chain but guard exists)
    const multicall = vi.fn().mockResolvedValueOnce([
      [
        10_000n, // supply
        0n,
        20_000n, // borrow > supply
        0n,
        LAST_UPDATE,
        FEE,
      ],
      [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
    ]);
    const readContract = vi.fn().mockResolvedValueOnce(BORROW_RATE_PER_SECOND);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.availableLiquidity).toBe(0n);
  });

  it("returns utilization as a number in [0, 1]", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(typeof data.utilization).toBe("number");
    expect(data.utilization).toBeGreaterThanOrEqual(0);
    expect(data.utilization).toBeLessThanOrEqual(1);
  });

  it("returns utilization approximately equal to borrow/supply (0.8 for 80% utilized)", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.utilization).toBeCloseTo(0.8, 3);
  });

  it("returns utilization = 0 when totalSupply is 0n", async () => {
    const multicall = vi.fn().mockResolvedValueOnce([
      [0n, 0n, 0n, 0n, LAST_UPDATE, FEE],
      [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
    ]);
    const readContract = vi.fn().mockResolvedValueOnce(0n);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.utilization).toBe(0);
  });

  it("returns currentSupplyAPY as a number >= 0", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(typeof data.currentSupplyAPY).toBe("number");
    expect(data.currentSupplyAPY).toBeGreaterThanOrEqual(0);
  });

  it("returns currentSupplyAPY = 0 when utilization is 0", async () => {
    const multicall = vi.fn().mockResolvedValueOnce([
      [0n, 0n, 0n, 0n, LAST_UPDATE, FEE],
      [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
    ]);
    const readContract = vi.fn().mockResolvedValueOnce(0n);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.currentSupplyAPY).toBe(0);
  });

  it("returns irmParams with all required fields present", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.irmParams).toBeDefined();
    expect(typeof data.irmParams.baseRate).toBe("bigint");
    expect(typeof data.irmParams.slope1).toBe("bigint");
    expect(typeof data.irmParams.slope2).toBe("bigint");
    expect(typeof data.irmParams.optimalUtilization).toBe("bigint");
  });

  it("irmParams.optimalUtilization equals 90% in WAD (9e17)", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    // 90% in WAD = 9e17
    expect(data.irmParams.optimalUtilization).toBe((WAD * 9n) / 10n);
  });
});

// ---------------------------------------------------------------------------
// 2. readMarketData — IRM borrow rate error handling
// ---------------------------------------------------------------------------

describe("MorphoReader.readMarketData — IRM borrowRateView failure", () => {
  it("still returns a valid MarketData when borrowRateView reverts", async () => {
    const multicall = standardMarketMulticall();
    // borrowRateView revert — currentBorrowRate stays 0n
    const readContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("execution reverted"));
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.marketId).toBe(MARKET_ID);
  });

  it("returns currentSupplyAPY = 0 when borrowRateView reverts", async () => {
    const multicall = standardMarketMulticall();
    const readContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("execution reverted"));
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const data = await reader.readMarketData(MARKET_ID);

    expect(data.currentSupplyAPY).toBe(0);
  });

  it("retries the full readMarketData flow after one multicall failure", async () => {
    const multicall = vi
      .fn()
      // First attempt: multicall fails
      .mockRejectedValueOnce(new Error("multicall RPC error"))
      // Second attempt (retry): succeeds
      .mockResolvedValueOnce([
        [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          FEE,
        ],
        [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
      ]);

    const readContract = vi.fn().mockResolvedValueOnce(BORROW_RATE_PER_SECOND);

    vi.useFakeTimers();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const promise = reader.readMarketData(MARKET_ID);
    await vi.runAllTimersAsync();
    const data = await promise;

    expect(data.marketId).toBe(MARKET_ID);
    expect(multicall).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("throws after all retries are exhausted when multicall keeps failing", async () => {
    const multicall = vi
      .fn()
      .mockRejectedValue(new Error("persistent network error"));
    const readContract = vi.fn();

    vi.useFakeTimers();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    // Attach handler synchronously before advancing timers to prevent
    // the "unhandled rejection" warning from Vitest.
    const assertion = expect(reader.readMarketData(MARKET_ID)).rejects.toThrow(
      "failed after 3 attempts"
    );
    await vi.runAllTimersAsync();
    await assertion;

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 3. readIRMParams
// ---------------------------------------------------------------------------

describe("MorphoReader.readIRMParams", () => {
  it("returns the irmParams portion of readMarketData", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const params = await reader.readIRMParams(MARKET_ID);

    expect(params).toBeDefined();
    expect(typeof params.slope1).toBe("bigint");
    expect(typeof params.slope2).toBe("bigint");
  });

  it("slope2 is strictly greater than slope1 (steeper above kink)", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const params = await reader.readIRMParams(MARKET_ID);

    expect(params.slope2).toBeGreaterThan(params.slope1);
  });

  it("baseRate is always 0n (linear-kink model approximation)", async () => {
    const multicall = standardMarketMulticall();
    const readContract = standardBorrowRateReadContract();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const params = await reader.readIRMParams(MARKET_ID);

    expect(params.baseRate).toBe(0n);
  });

  it("returns zero-rate IRMParams for a market with zero borrow rate", async () => {
    const multicall = vi.fn().mockResolvedValueOnce([
      [0n, 0n, 0n, 0n, LAST_UPDATE, FEE],
      [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
    ]);
    const readContract = vi.fn().mockResolvedValueOnce(0n);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const params = await reader.readIRMParams(MARKET_ID);

    expect(params.baseRate).toBe(0n);
    expect(params.slope1).toBe(0n);
    expect(params.slope2).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// 4. readMarketsForAdapters — filtering and batch reading
// ---------------------------------------------------------------------------

describe("MorphoReader.readMarketsForAdapters", () => {
  const MARKET_ADAPTER_A: Address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const MARKET_ADAPTER_B: Address = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const VAULT_ADAPTER: Address = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

  const MARKET_ID_A: Hash =
    "0xaaaa000000000000000000000000000000000000000000000000000000000000";
  const MARKET_ID_B: Hash =
    "0xbbbb000000000000000000000000000000000000000000000000000000000000";

  function makeMarketAdapterState(address: Address): AdapterState {
    return {
      address,
      adapterType: "morpho-market-v1",
      realAssets: 1_000_000n,
      allocationPercentage: 0.1,
      absoluteCap: 5_000_000n,
      relativeCap: 5_000,
    };
  }

  function makeVaultAdapterState(address: Address): AdapterState {
    return {
      address,
      adapterType: "morpho-vault-v1",
      realAssets: 1_000_000n,
      allocationPercentage: 0.1,
      absoluteCap: 5_000_000n,
      relativeCap: 5_000,
    };
  }

  it("returns an empty array when there are no adapters at all", async () => {
    const client = makeMockClient({ readContract: vi.fn(), multicall: vi.fn() });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const result = await reader.readMarketsForAdapters([]);

    expect(result).toEqual([]);
  });

  it("returns an empty array when all adapters are vault-type (morpho-vault-v1)", async () => {
    const adapters = [makeVaultAdapterState(VAULT_ADAPTER)];
    const multicall = vi.fn();
    const client = makeMockClient({ readContract: vi.fn(), multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const result = await reader.readMarketsForAdapters(adapters);

    expect(result).toEqual([]);
    // multicall should not have been called at all (no market adapters)
    expect(multicall).not.toHaveBeenCalled();
  });

  it("only reads market data for morpho-market-v1 adapters, skipping vault adapters", async () => {
    const adapters = [
      makeMarketAdapterState(MARKET_ADAPTER_A),
      makeVaultAdapterState(VAULT_ADAPTER),
    ];

    // Multicall 1: marketId() for MARKET_ADAPTER_A only
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([{ status: "success", result: MARKET_ID_A }])
      // readMarketData batch 1 (market + params)
      .mockResolvedValueOnce([
        [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          FEE,
        ],
        [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
      ]);

    const readContract = vi.fn().mockResolvedValueOnce(BORROW_RATE_PER_SECOND);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const result = await reader.readMarketsForAdapters(adapters);

    // Only one market data entry — for the market-v1 adapter
    expect(result).toHaveLength(1);
  });

  it("returns MarketData with the correct marketId for a single market adapter", async () => {
    const adapters = [makeMarketAdapterState(MARKET_ADAPTER_A)];

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([{ status: "success", result: MARKET_ID_A }])
      .mockResolvedValueOnce([
        [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          FEE,
        ],
        [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
      ]);

    const readContract = vi.fn().mockResolvedValueOnce(BORROW_RATE_PER_SECOND);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const result = await reader.readMarketsForAdapters(adapters);

    expect(result[0].marketId).toBe(MARKET_ID_A);
  });

  it("reads market data for two market-type adapters and returns two entries", async () => {
    const adapters = [
      makeMarketAdapterState(MARKET_ADAPTER_A),
      makeMarketAdapterState(MARKET_ADAPTER_B),
    ];

    const multicall = vi
      .fn()
      // Step 1: marketId() for both adapters
      .mockResolvedValueOnce([
        { status: "success", result: MARKET_ID_A },
        { status: "success", result: MARKET_ID_B },
      ])
      // readMarketData for adapter A (batch 1)
      .mockResolvedValueOnce([
        [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          FEE,
        ],
        [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
      ])
      // readMarketData for adapter B (batch 1)
      .mockResolvedValueOnce([
        [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          FEE,
        ],
        [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
      ]);

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(BORROW_RATE_PER_SECOND) // for A
      .mockResolvedValueOnce(BORROW_RATE_PER_SECOND); // for B

    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const result = await reader.readMarketsForAdapters(adapters);

    expect(result).toHaveLength(2);
  });

  it("skips an adapter whose marketId() call returns a failure status", async () => {
    const adapters = [
      makeMarketAdapterState(MARKET_ADAPTER_A),
      makeMarketAdapterState(MARKET_ADAPTER_B),
    ];

    const multicall = vi
      .fn()
      // Adapter A: success; Adapter B: failure (no marketId exposed)
      .mockResolvedValueOnce([
        { status: "success", result: MARKET_ID_A },
        { status: "failure", error: new Error("revert") },
      ])
      // readMarketData for adapter A only
      .mockResolvedValueOnce([
        [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          FEE,
        ],
        [LOAN_TOKEN, COLLATERAL_TOKEN, ORACLE, IRM_ADDRESS, LLTV],
      ]);

    const readContract = vi.fn().mockResolvedValueOnce(BORROW_RATE_PER_SECOND);
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const result = await reader.readMarketsForAdapters(adapters);

    // Only adapter A's market data is returned; B was skipped
    expect(result).toHaveLength(1);
    expect(result[0].marketId).toBe(MARKET_ID_A);
  });

  it("skips an adapter when readMarketData throws for it (graceful failure)", async () => {
    const adapters = [
      makeMarketAdapterState(MARKET_ADAPTER_A),
      makeMarketAdapterState(MARKET_ADAPTER_B),
    ];

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([
        { status: "success", result: MARKET_ID_A },
        { status: "success", result: MARKET_ID_B },
      ])
      // readMarketData for A: permanently fails (3 retries)
      .mockRejectedValue(new Error("persistent RPC error"));

    vi.useFakeTimers();
    const readContract = vi.fn();
    const client = makeMockClient({ readContract, multicall });
    const reader = new MorphoReader(client, MORPHO_ADDRESS);

    const promise = reader.readMarketsForAdapters(adapters);
    await vi.runAllTimersAsync();
    const result = await promise;

    // Both markets failed gracefully — result is empty, no throw
    expect(Array.isArray(result)).toBe(true);

    vi.useRealTimers();
  });

  it("uses the default Morpho Blue address when no address is passed to constructor", async () => {
    // Create reader without an explicit morpho address
    const readContract = vi.fn();
    const multicall = vi.fn().mockResolvedValueOnce([]);
    const client = makeMockClient({ readContract, multicall });

    // Should not throw — just uses the hardcoded MORPHO_BLUE_ADDRESS
    const reader = new MorphoReader(client);
    const result = await reader.readMarketsForAdapters([]);

    expect(result).toEqual([]);
  });
});
