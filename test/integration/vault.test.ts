/**
 * Integration tests for src/core/chain/vault.ts — VaultReader
 *
 * Strategy: mock the viem public client at the boundary (readContract /
 * multicall). The mock returns realistic mainnet-like data so all VaultReader
 * code paths execute without any network access. Tests are fully deterministic.
 *
 * Mock boundary: publicClient.readContract and publicClient.multicall are the
 * only external dependencies. We never mock internal VaultReader helpers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hash } from "viem";
import { VaultReader } from "../../src/core/chain/vault.js";
import type { BotPublicClient } from "../../src/core/chain/client.js";
import { CONTRACT_ADDRESSES } from "../../src/config/constants.js";

// ---------------------------------------------------------------------------
// Test addresses — realistic-looking but not real mainnet contracts
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_A: Address = "0x2222222222222222222222222222222222222222";
const ADAPTER_B: Address = "0x3333333333333333333333333333333333333333";
const ADAPTER_VAULT_TYPE: Address =
  "0x4444444444444444444444444444444444444444";

// A realistic USDC total assets value (10 000 USDC in 6-decimal units)
const TOTAL_ASSETS_10K = 10_000_000_000n; // 10 000 USDC

// ---------------------------------------------------------------------------
// Mock factory — builds a minimal BotPublicClient mock
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

// ---------------------------------------------------------------------------
// 1. readTotalAssets
// ---------------------------------------------------------------------------

describe("VaultReader.readTotalAssets", () => {
  it("returns a bigint when readContract resolves successfully", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(TOTAL_ASSETS_10K);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const result = await reader.readTotalAssets();

    expect(typeof result).toBe("bigint");
  });

  it("returns the exact value returned by readContract", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(TOTAL_ASSETS_10K);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const result = await reader.readTotalAssets();

    expect(result).toBe(TOTAL_ASSETS_10K);
  });

  it("calls readContract with the vault address and totalAssets function", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(TOTAL_ASSETS_10K);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    await reader.readTotalAssets();

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: VAULT_ADDRESS,
        functionName: "totalAssets",
      })
    );
  });

  it("retries after one failure and returns value on second attempt", async () => {
    const readContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce(TOTAL_ASSETS_10K);
    const client = makeMockClient({ readContract });

    // Patch sleep to avoid actual delays in the test
    vi.useFakeTimers();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const promise = reader.readTotalAssets();
    // Advance timers past the first retry delay (500ms)
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(TOTAL_ASSETS_10K);
    expect(readContract).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("throws after all retries are exhausted", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("persistent RPC error"));
    const client = makeMockClient({ readContract });

    vi.useFakeTimers();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    // Attach the rejection handler synchronously before advancing timers
    // to prevent the "unhandled rejection" warning from Vitest.
    const assertion = expect(reader.readTotalAssets()).rejects.toThrow(
      "VaultReader.readTotalAssets failed after 3 attempts"
    );
    await vi.runAllTimersAsync();
    await assertion;

    vi.useRealTimers();
  });

  it("returns 0n correctly (zero-asset vault)", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(0n);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const result = await reader.readTotalAssets();

    expect(result).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// 2. readAdapters
// ---------------------------------------------------------------------------

describe("VaultReader.readAdapters", () => {
  /**
   * Builds a mock client wired up for a 2-adapter vault scenario:
   *   - ADAPTER_A: morpho-market-v1, 6 000 USDC realAssets
   *   - ADAPTER_B: morpho-market-v1, 4 000 USDC realAssets
   * Both have absolute cap 5 000 USDC and relative cap 5 000 bps (50%).
   */
  function makeStandardMulticallClient(): BotPublicClient {
    // realAssets per adapter
    const realAssetsA = 6_000_000_000n; // 6 000 USDC
    const realAssetsB = 4_000_000_000n; // 4 000 USDC

    // caps per adapter [absoluteCap, relativeCap]
    const capsA: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const capsB: [bigint, bigint] = [5_000_000_000n, 5_000n];

    const multicall = vi
      .fn()
      // First multicall: adaptersAt(0), adaptersAt(1)
      .mockResolvedValueOnce([ADAPTER_A, ADAPTER_B])
      // Second multicall: realAssets() for A and B
      .mockResolvedValueOnce([realAssetsA, realAssetsB])
      // Third multicall: caps for A and B
      .mockResolvedValueOnce([capsA, capsB]);

    // readContract is used for adaptersLength() and for factory() type resolution.
    const readContract = vi
      .fn()
      // adaptersLength()
      .mockResolvedValueOnce(2n)
      // factory() for ADAPTER_A — return market factory (market-v1 type)
      .mockResolvedValueOnce(CONTRACT_ADDRESSES.MorphoMarketV1AdapterV2Factory)
      // factory() for ADAPTER_B — return unknown address (falls back to market-v1)
      .mockResolvedValueOnce("0x9999999999999999999999999999999999999999");

    return makeMockClient({ readContract, multicall });
  }

  it("returns an array of AdapterState objects", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(Array.isArray(adapters)).toBe(true);
  });

  it("returns one entry per adapter reported by adaptersLength", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(adapters).toHaveLength(2);
  });

  it("each AdapterState has the correct address", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(adapters[0].address).toBe(ADAPTER_A);
    expect(adapters[1].address).toBe(ADAPTER_B);
  });

  it("each AdapterState has realAssets as a bigint", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(typeof adapters[0].realAssets).toBe("bigint");
    expect(typeof adapters[1].realAssets).toBe("bigint");
  });

  it("allocation percentages sum to 1.0 when realAssets equals totalAssets", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    const sum = adapters.reduce((acc, a) => acc + a.allocationPercentage, 0);
    // Allow floating-point rounding: sum must be within 0.01 of 1.0
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it("allocationPercentage for adapter A is ~0.6 (6000/10000)", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(adapters[0].allocationPercentage).toBeCloseTo(0.6, 4);
  });

  it("allocationPercentage for adapter B is ~0.4 (4000/10000)", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(adapters[1].allocationPercentage).toBeCloseTo(0.4, 4);
  });

  it("allocationPercentage is 0 when totalAssets is 0n", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(0n);

    for (const adapter of adapters) {
      expect(adapter.allocationPercentage).toBe(0);
    }
  });

  it("absoluteCap is a bigint", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(typeof adapters[0].absoluteCap).toBe("bigint");
  });

  it("relativeCap is a number", async () => {
    const client = makeStandardMulticallClient();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(typeof adapters[0].relativeCap).toBe("number");
  });

  it("adapterType is 'morpho-vault-v1' when factory matches VaultV1AdapterFactory", async () => {
    const realAssetsA = 10_000_000_000n;
    const capsA: [bigint, bigint] = [10_000_000_000n, 10_000n];

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_VAULT_TYPE])
      .mockResolvedValueOnce([realAssetsA])
      .mockResolvedValueOnce([capsA]);

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n) // adaptersLength
      // factory() returns the vault-v1 factory
      .mockResolvedValueOnce(CONTRACT_ADDRESSES.MorphoVaultV1AdapterFactory);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(realAssetsA);

    expect(adapters[0].adapterType).toBe("morpho-vault-v1");
  });

  it("adapterType is 'morpho-market-v1' when factory() call reverts", async () => {
    const realAssetsA = 6_000_000_000n;
    const capsA: [bigint, bigint] = [5_000_000_000n, 5_000n];

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_A])
      .mockResolvedValueOnce([realAssetsA])
      .mockResolvedValueOnce([capsA]);

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n) // adaptersLength
      .mockRejectedValueOnce(new Error("execution reverted")); // factory() reverts

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(adapters[0].adapterType).toBe("morpho-market-v1");
  });

  it("returns an empty array when adaptersLength is 0", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(0n); // adaptersLength = 0
    const multicall = vi.fn();
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const adapters = await reader.readAdapters(TOTAL_ASSETS_10K);

    expect(adapters).toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });

  it("retries the full readAdapters flow after one multicall failure", async () => {
    const realAssetsA = 6_000_000_000n;
    const realAssetsB = 4_000_000_000n;
    const capsA: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const capsB: [bigint, bigint] = [5_000_000_000n, 5_000n];

    const multicall = vi
      .fn()
      // First overall attempt: fail immediately on the first multicall
      .mockRejectedValueOnce(new Error("multicall timeout"))
      // Second attempt (retry): all three multicalls succeed
      .mockResolvedValueOnce([ADAPTER_A, ADAPTER_B])
      .mockResolvedValueOnce([realAssetsA, realAssetsB])
      .mockResolvedValueOnce([capsA, capsB]);

    const readContract = vi
      .fn()
      // First attempt reads adaptersLength before multicall
      .mockResolvedValueOnce(2n)
      // Retry: adaptersLength again
      .mockResolvedValueOnce(2n)
      // factory() for ADAPTER_A on retry
      .mockResolvedValueOnce(CONTRACT_ADDRESSES.MorphoMarketV1AdapterV2Factory)
      // factory() for ADAPTER_B on retry
      .mockResolvedValueOnce("0x9999999999999999999999999999999999999999");

    vi.useFakeTimers();
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const promise = reader.readAdapters(TOTAL_ASSETS_10K);
    await vi.runAllTimersAsync();
    const adapters = await promise;

    expect(adapters).toHaveLength(2);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 3. readFullState
// ---------------------------------------------------------------------------

describe("VaultReader.readFullState", () => {
  it("returns a VaultState with the vault address", async () => {
    const realAssetsA = 10_000_000_000n;
    const capsA: [bigint, bigint] = [10_000_000_000n, 10_000n];

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(realAssetsA) // totalAssets
      .mockResolvedValueOnce(1n)          // adaptersLength
      .mockResolvedValueOnce(CONTRACT_ADDRESSES.MorphoMarketV1AdapterV2Factory); // factory()

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_A])
      .mockResolvedValueOnce([realAssetsA])
      .mockResolvedValueOnce([capsA]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const state = await reader.readFullState();

    expect(state.vaultAddress).toBe(VAULT_ADDRESS);
  });

  it("returns totalAssets as a bigint equal to readTotalAssets result", async () => {
    const realAssetsA = 10_000_000_000n;
    const capsA: [bigint, bigint] = [10_000_000_000n, 10_000n];

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(realAssetsA)
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(CONTRACT_ADDRESSES.MorphoMarketV1AdapterV2Factory);

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_A])
      .mockResolvedValueOnce([realAssetsA])
      .mockResolvedValueOnce([capsA]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const state = await reader.readFullState();

    expect(state.totalAssets).toBe(realAssetsA);
  });

  it("returns adapters array with the correct length", async () => {
    const realAssetsA = 6_000_000_000n;
    const realAssetsB = 4_000_000_000n;
    const capsA: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const capsB: [bigint, bigint] = [5_000_000_000n, 5_000n];

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(TOTAL_ASSETS_10K) // totalAssets
      .mockResolvedValueOnce(2n)               // adaptersLength
      .mockResolvedValueOnce(CONTRACT_ADDRESSES.MorphoMarketV1AdapterV2Factory)
      .mockResolvedValueOnce("0x9999999999999999999999999999999999999999");

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_A, ADAPTER_B])
      .mockResolvedValueOnce([realAssetsA, realAssetsB])
      .mockResolvedValueOnce([capsA, capsB]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const state = await reader.readFullState();

    expect(state.adapters).toHaveLength(2);
  });

  it("returns an empty markets array (markets populated by MorphoReader)", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(0n) // totalAssets
      .mockResolvedValueOnce(0n); // adaptersLength

    const client = makeMockClient({ readContract, multicall: vi.fn() });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const state = await reader.readFullState();

    expect(state.markets).toEqual([]);
  });

  it("state.adapters is an empty array when vault has no adapters", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(TOTAL_ASSETS_10K) // totalAssets
      .mockResolvedValueOnce(0n);              // adaptersLength

    const client = makeMockClient({ readContract, multicall: vi.fn() });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const state = await reader.readFullState();

    expect(state.adapters).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. readCaps
// ---------------------------------------------------------------------------

describe("VaultReader.readCaps", () => {
  const RISK_ID: Hash = ADAPTER_A as unknown as Hash;

  it("returns absoluteCap as a bigint", async () => {
    const rawResult: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const readContract = vi.fn().mockResolvedValueOnce(rawResult);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const caps = await reader.readCaps(RISK_ID);

    expect(typeof caps.absoluteCap).toBe("bigint");
  });

  it("returns relativeCap as a number", async () => {
    const rawResult: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const readContract = vi.fn().mockResolvedValueOnce(rawResult);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const caps = await reader.readCaps(RISK_ID);

    expect(typeof caps.relativeCap).toBe("number");
  });

  it("returns the correct absoluteCap value", async () => {
    const rawResult: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const readContract = vi.fn().mockResolvedValueOnce(rawResult);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const caps = await reader.readCaps(RISK_ID);

    expect(caps.absoluteCap).toBe(5_000_000_000n);
  });

  it("converts on-chain relativeCap bigint to a JavaScript number", async () => {
    const rawResult: [bigint, bigint] = [5_000_000_000n, 5_000n];
    const readContract = vi.fn().mockResolvedValueOnce(rawResult);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const caps = await reader.readCaps(RISK_ID);

    expect(caps.relativeCap).toBe(5_000);
  });

  it("returns absoluteCap=0n and relativeCap=0 for an uncapped adapter", async () => {
    const rawResult: [bigint, bigint] = [0n, 0n];
    const readContract = vi.fn().mockResolvedValueOnce(rawResult);
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(client, VAULT_ADDRESS);

    const caps = await reader.readCaps(RISK_ID);

    expect(caps.absoluteCap).toBe(0n);
    expect(caps.relativeCap).toBe(0);
  });

  it("throws after all retries when readContract keeps failing", async () => {
    const readContract = vi
      .fn()
      .mockRejectedValue(new Error("network error"));
    const client = makeMockClient({ readContract });

    vi.useFakeTimers();
    const reader = new VaultReader(client, VAULT_ADDRESS);

    // Attach handler synchronously before advancing timers to prevent
    // the "unhandled rejection" warning from Vitest.
    const assertion = expect(reader.readCaps(RISK_ID)).rejects.toThrow(
      "failed after 3 attempts"
    );
    await vi.runAllTimersAsync();
    await assertion;

    vi.useRealTimers();
  });
});
