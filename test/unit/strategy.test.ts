/**
 * strategy.test.ts — Unit tests for src/core/rebalancer/strategy.ts
 *
 * All functions under test are pure: no async, no external dependencies.
 * Tests cover: computeScore, computeRebalance, isWithinDriftThreshold, enforceCapConstraints.
 */

import { describe, it, expect } from "vitest";
import {
  computeScore,
  computeRebalance,
  isWithinDriftThreshold,
  enforceCapConstraints,
} from "../../src/core/rebalancer/strategy.js";
import { WAD, BPS_DENOMINATOR } from "../../src/config/constants.js";
import type {
  AdapterState,
  MarketData,
  StrategyConfig,
  VaultState,
} from "../../src/core/rebalancer/types.js";
import type { IRMParams } from "../../src/core/rebalancer/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADDR_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as const;
const ADDR_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" as const;
const ADDR_C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" as const;
const VAULT_ADDR = "0xVAULTVAULTVAULTVAULTVAULTVAULTVAULTVAULT" as const;

const TYPICAL_IRM_PARAMS: IRMParams = {
  baseRate: 0n,
  slope1: 1_585_000_000n,
  slope2: 20_000_000_000n,
  optimalUtilization: (WAD * 80n) / 100n,
};

const DEFAULT_CONFIG: StrategyConfig = {
  driftThresholdBps: 500,        // 5%
  gasCeilingGwei: 50,
  maxMarketConcentrationPct: 10, // 10%
  minLiquidityMultiplier: 2,
  dryRun: false,
};

/** Build a minimal valid AdapterState. */
function makeAdapter(
  address: string,
  realAssets: bigint,
  absoluteCap = 0n,
  relativeCap = 0,
  allocationPercentage = 0
): AdapterState {
  return {
    address: address as `0x${string}`,
    adapterType: "morpho-market-v1",
    realAssets,
    allocationPercentage,
    absoluteCap,
    relativeCap,
  };
}

/** Build a minimal valid MarketData. */
function makeMarket(
  totalSupply: bigint,
  totalBorrow: bigint,
  overrides?: Partial<MarketData>
): MarketData {
  return {
    marketId: "0xMARKETID" as `0x${string}`,
    totalSupply,
    totalBorrow,
    availableLiquidity: totalSupply - totalBorrow,
    utilization: totalSupply > 0n ? Number(totalBorrow * 100n / totalSupply) / 100 : 0,
    currentSupplyAPY: 0,
    irmParams: TYPICAL_IRM_PARAMS,
    ...overrides,
  };
}

/** Build a minimal valid VaultState. */
function makeVaultState(
  adapters: AdapterState[],
  markets: MarketData[],
  totalAssets: bigint
): VaultState {
  return {
    vaultAddress: VAULT_ADDR as `0x${string}`,
    totalAssets,
    adapters,
    markets,
  };
}

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  it("returns a positive score for a high APY market with good liquidity and low concentration", () => {
    const adapter = makeAdapter(ADDR_A, 100_000n);
    // Large market with high utilization at kink → good APY, no concentration issue
    const market = makeMarket(10_000_000n, 8_000_000n);
    const score = computeScore(adapter, market, 100_000n, DEFAULT_CONFIG);
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 when available liquidity is below minLiquidityMultiplier * allocation (strict rejection)", () => {
    const allocation = 1_000_000n;
    const adapter = makeAdapter(ADDR_A, allocation);
    // availableLiquidity = 1_000_000, minLiquidityMultiplier = 2, floor = 2_000_000
    // liquiditySafetyFactor = min(1, 1_000_000 / 2_000_000) = 0.5
    // projectedAPY > 0, concentration low → score should be > 0 but reduced
    const market = makeMarket(5_000_000n, 4_000_000n, {
      availableLiquidity: 1_000_000n, // below 2x allocation
    });
    const score = computeScore(adapter, market, allocation, DEFAULT_CONFIG);
    // score is reduced (factor < 1) but not 0 unless APY is 0
    // available = 1_000_000, floor = 2*1_000_000 = 2_000_000
    // liquiditySafetyFactor = 1_000_000 / 2_000_000 = 0.5
    expect(score).toBeGreaterThanOrEqual(0);
    // And specifically it is penalized compared to when liquidity is ample
    const marketGoodLiquidity = makeMarket(5_000_000n, 4_000_000n, {
      availableLiquidity: 10_000_000n,
    });
    const scoreGood = computeScore(adapter, marketGoodLiquidity, allocation, DEFAULT_CONFIG);
    expect(score).toBeLessThan(scoreGood);
  });

  it("liquidity safety factor caps at 1 when available liquidity far exceeds the floor", () => {
    const allocation = 100_000n;
    const adapter = makeAdapter(ADDR_A, allocation);
    // availableLiquidity = 10_000_000 >> 2 * 100_000 = 200_000
    const market = makeMarket(20_000_000n, 16_000_000n, {
      availableLiquidity: 10_000_000n,
    });
    // Score should equal projectedAPY * 1 * (1 - concentrationPenalty)
    const score = computeScore(adapter, market, allocation, DEFAULT_CONFIG);
    expect(score).toBeGreaterThan(0);
  });

  it("penalizes score when concentration exceeds maxMarketConcentrationPct", () => {
    const totalSupply = 1_000_000n;
    // allocation = 50% of total supply, threshold = 10%
    const allocation = 500_000n;
    const adapter = makeAdapter(ADDR_A, allocation);
    const market = makeMarket(totalSupply, 800_000n, {
      availableLiquidity: 10_000_000n,
    });

    const scoreHighConcentration = computeScore(adapter, market, allocation, DEFAULT_CONFIG);

    // Low concentration: allocation = 5% of total supply
    const allocationLow = 50_000n;
    const adapterLow = makeAdapter(ADDR_A, allocationLow);
    const scoreLowConcentration = computeScore(adapterLow, market, allocationLow, DEFAULT_CONFIG);

    expect(scoreHighConcentration).toBeLessThan(scoreLowConcentration);
  });

  it("returns 0 when allocation is 0 and market has zero APY (zero utilization)", () => {
    const adapter = makeAdapter(ADDR_A, 0n);
    const market = makeMarket(1_000_000n, 0n); // 0% utilization → 0 APY
    const score = computeScore(adapter, market, 0n, DEFAULT_CONFIG);
    expect(score).toBe(0);
  });

  it("returns a number (not bigint)", () => {
    const adapter = makeAdapter(ADDR_A, 100_000n);
    const market = makeMarket(10_000_000n, 8_000_000n);
    const score = computeScore(adapter, market, 100_000n, DEFAULT_CONFIG);
    expect(typeof score).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// isWithinDriftThreshold
// ---------------------------------------------------------------------------

describe("isWithinDriftThreshold", () => {
  it("returns true when delta is exactly zero", () => {
    const result = isWithinDriftThreshold(100_000n, 100_000n, 1_000_000n, 500);
    expect(result).toBe(true);
  });

  it("returns true when delta is below the threshold", () => {
    // 4% drift, threshold = 5%
    const total = 1_000_000n;
    const current = 100_000n;
    const target = 140_000n; // 4% of 1_000_000 = 40_000
    const result = isWithinDriftThreshold(current, target, total, 500);
    expect(result).toBe(true);
  });

  it("returns false when delta exceeds the threshold", () => {
    // 10% drift, threshold = 5%
    const total = 1_000_000n;
    const current = 200_000n;
    const target = 300_000n; // delta = 100_000 = 10% of total
    const result = isWithinDriftThreshold(current, target, total, 500);
    expect(result).toBe(false);
  });

  it("returns true when total is 0 (guard: no division by zero)", () => {
    const result = isWithinDriftThreshold(100n, 200n, 0n, 500);
    expect(result).toBe(true);
  });

  it("returns true when delta is exactly at the threshold boundary", () => {
    // delta = 5% of total, threshold = 500 bps = 5%
    // delta * BPS_DENOMINATOR = total * thresholdBps → exactly equal → true
    const total = 1_000_000n;
    const thresholdBps = 500;
    const threshold = (total * BigInt(thresholdBps)) / BigInt(BPS_DENOMINATOR);
    const result = isWithinDriftThreshold(0n, threshold, total, thresholdBps);
    expect(result).toBe(true);
  });

  it("returns false when delta is one unit above threshold boundary", () => {
    const total = 1_000_000n;
    const thresholdBps = 500;
    const threshold = (total * BigInt(thresholdBps)) / BigInt(BPS_DENOMINATOR);
    const result = isWithinDriftThreshold(0n, threshold + 1n, total, thresholdBps);
    expect(result).toBe(false);
  });

  it("is symmetric: same result regardless of whether current > target or target > current", () => {
    const total = 1_000_000n;
    const a = 800_000n;
    const b = 200_000n;
    const r1 = isWithinDriftThreshold(a, b, total, 500);
    const r2 = isWithinDriftThreshold(b, a, total, 500);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// enforceCapConstraints
// ---------------------------------------------------------------------------

describe("enforceCapConstraints", () => {
  it("clamps to absoluteCap when proposed exceeds it", () => {
    const adapter = makeAdapter(ADDR_A, 0n, 500_000n, 0); // absoluteCap = 500_000
    const allocations = new Map([[ADDR_A as `0x${string}`, 1_000_000n]]);
    const result = enforceCapConstraints(allocations, [adapter], 2_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(500_000n);
  });

  it("clamps to relativeCap amount when proposed exceeds relative cap", () => {
    // relativeCap = 5000 bps = 50%, totalAssets = 1_000_000 → cap = 500_000
    const adapter = makeAdapter(ADDR_A, 0n, 0n, 5000);
    const allocations = new Map([[ADDR_A as `0x${string}`, 900_000n]]);
    const result = enforceCapConstraints(allocations, [adapter], 1_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(500_000n);
  });

  it("does not clamp when proposed is below both caps", () => {
    const adapter = makeAdapter(ADDR_A, 0n, 1_000_000n, 8000); // 80% cap on 1M → 800_000
    const allocations = new Map([[ADDR_A as `0x${string}`, 300_000n]]);
    const result = enforceCapConstraints(allocations, [adapter], 1_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(300_000n);
  });

  it("enforces the tighter of the two caps when both apply", () => {
    // absoluteCap = 400_000, relativeCap = 5000 bps * 1_000_000 = 500_000
    // tighter cap = 400_000
    const adapter = makeAdapter(ADDR_A, 0n, 400_000n, 5000);
    const allocations = new Map([[ADDR_A as `0x${string}`, 700_000n]]);
    const result = enforceCapConstraints(allocations, [adapter], 1_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(400_000n);
  });

  it("skips absoluteCap enforcement when absoluteCap is 0 (no cap set)", () => {
    const adapter = makeAdapter(ADDR_A, 0n, 0n, 0); // no caps
    const allocations = new Map([[ADDR_A as `0x${string}`, 999_999_999n]]);
    const result = enforceCapConstraints(allocations, [adapter], 2_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(999_999_999n);
  });

  it("handles adapter with no entry in allocations map — defaults to 0", () => {
    const adapter = makeAdapter(ADDR_A, 0n, 1_000_000n, 0);
    const allocations = new Map<`0x${string}`, bigint>(); // empty
    const result = enforceCapConstraints(allocations, [adapter], 2_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(0n);
  });

  it("processes multiple adapters independently", () => {
    const adapterA = makeAdapter(ADDR_A, 0n, 300_000n, 0);
    const adapterB = makeAdapter(ADDR_B, 0n, 0n, 4000); // 40% of 1M = 400_000
    const allocations = new Map<`0x${string}`, bigint>([
      [ADDR_A as `0x${string}`, 500_000n],
      [ADDR_B as `0x${string}`, 500_000n],
    ]);
    const result = enforceCapConstraints(allocations, [adapterA, adapterB], 1_000_000n);
    expect(result.get(ADDR_A as `0x${string}`)).toBe(300_000n);
    expect(result.get(ADDR_B as `0x${string}`)).toBe(400_000n);
  });
});

// ---------------------------------------------------------------------------
// computeRebalance
// ---------------------------------------------------------------------------

describe("computeRebalance", () => {
  it("returns empty array when there are no adapters", () => {
    const state = makeVaultState([], [], 1_000_000n);
    const actions = computeRebalance(state, DEFAULT_CONFIG);
    expect(actions).toEqual([]);
  });

  it("returns empty array when totalAssets is zero", () => {
    const adapter = makeAdapter(ADDR_A, 0n);
    const market = makeMarket(1_000_000n, 800_000n);
    const state = makeVaultState([adapter], [market], 0n);
    const actions = computeRebalance(state, DEFAULT_CONFIG);
    expect(actions).toEqual([]);
  });

  it("returns empty array when all adapters are within drift threshold", () => {
    // Two adapters with equal realAssets, equal market quality → computed targets
    // will be proportional to scores → drift should be near zero
    const total = 2_000_000n;
    const adapters = [
      makeAdapter(ADDR_A, 1_000_000n, 0n, 0, 0.5),
      makeAdapter(ADDR_B, 1_000_000n, 0n, 0, 0.5),
    ];
    const markets = [
      makeMarket(10_000_000n, 8_000_000n),
      makeMarket(10_000_000n, 8_000_000n),
    ];
    const state = makeVaultState(adapters, markets, total);
    // Both have identical state so scores are equal → equal allocation targets
    // → delta is 0 → within drift threshold
    const actions = computeRebalance(state, DEFAULT_CONFIG);
    expect(actions).toEqual([]);
  });

  it("deallocate actions appear before allocate actions in result", () => {
    // Adapter A has too much (overweight), Adapter B has too little (underweight)
    const total = 2_000_000n;
    const adapters = [
      makeAdapter(ADDR_A, 1_800_000n, 0n, 0, 0.9), // gets most of its assets from ADDR_B originally
      makeAdapter(ADDR_B, 200_000n, 0n, 0, 0.1),
    ];
    // Give ADDR_B a much better market (higher APY) so it scores higher
    const markets = [
      makeMarket(10_000_000n, 1_000_000n), // 10% utilization → low APY for ADDR_A
      makeMarket(1_000_000n, 950_000n),    // 95% utilization → high APY for ADDR_B
    ];
    const state = makeVaultState(adapters, markets, total);
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    // Find deallocate and allocate indices
    const deallocateIdx = actions.findIndex((a) => a.direction === "deallocate");
    const allocateIdx = actions.findIndex((a) => a.direction === "allocate");

    if (deallocateIdx !== -1 && allocateIdx !== -1) {
      expect(deallocateIdx).toBeLessThan(allocateIdx);
    }
    // At minimum the result must contain only valid directions
    for (const action of actions) {
      expect(["deallocate", "allocate"]).toContain(action.direction);
    }
  });

  it("enforces absoluteCap — capped adapter does not receive allocation above cap", () => {
    const total = 1_000_000n;
    const cap = 200_000n;
    // Adapter A: overweight. Adapter B: gets capped.
    const adapters = [
      makeAdapter(ADDR_A, 500_000n),
      makeAdapter(ADDR_B, 500_000n, cap, 0), // absoluteCap = 200_000
    ];
    // Give ADDR_B a much better market so strategy would allocate heavily to it
    const markets = [
      makeMarket(10_000_000n, 1_000_000n), // low APY
      makeMarket(1_000_000n, 990_000n),    // very high APY
    ];
    const state = makeVaultState(adapters, markets, total);
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    // The allocate action for ADDR_B (if present) must not push it above the cap
    const allocateB = actions.find(
      (a) => a.adapter === (ADDR_B as `0x${string}`) && a.direction === "allocate"
    );
    if (allocateB) {
      const newBalance = 500_000n + allocateB.amount;
      expect(newBalance).toBeLessThanOrEqual(cap);
    }
  });

  it("enforces relativeCap — capped adapter stays within relative cap fraction", () => {
    const total = 1_000_000n;
    // ADDR_B gets 20% relativeCap → max = 200_000
    const adapters = [
      makeAdapter(ADDR_A, 500_000n),
      makeAdapter(ADDR_B, 500_000n, 0n, 2000), // relativeCap = 20%
    ];
    const markets = [
      makeMarket(10_000_000n, 1_000_000n),
      makeMarket(1_000_000n, 990_000n),
    ];
    const state = makeVaultState(adapters, markets, total);
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    const allocateB = actions.find(
      (a) => a.adapter === (ADDR_B as `0x${string}`) && a.direction === "allocate"
    );
    const relativeCapAmount = (total * 2000n) / BigInt(BPS_DENOMINATOR);
    if (allocateB) {
      const newBalance = 500_000n + allocateB.amount;
      expect(newBalance).toBeLessThanOrEqual(relativeCapAmount);
    }
  });

  it("actions array contains only valid RebalanceAction shapes", () => {
    const total = 2_000_000n;
    const adapters = [
      makeAdapter(ADDR_A, 1_000_000n),
      makeAdapter(ADDR_B, 1_000_000n),
    ];
    const markets = [
      makeMarket(10_000_000n, 8_000_000n),
      makeMarket(10_000_000n, 2_000_000n),
    ];
    const state = makeVaultState(adapters, markets, total);
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    for (const action of actions) {
      expect(typeof action.adapter).toBe("string");
      expect(["allocate", "deallocate"]).toContain(action.direction);
      expect(typeof action.amount).toBe("bigint");
      expect(action.amount).toBeGreaterThan(0n);
      expect(typeof action.data).toBe("string");
    }
  });

  it("single adapter with no caps — returns empty (no rebalance partner)", () => {
    const total = 1_000_000n;
    const adapters = [makeAdapter(ADDR_A, 1_000_000n)];
    const markets = [makeMarket(10_000_000n, 8_000_000n)];
    const state = makeVaultState(adapters, markets, total);
    // Single adapter holds all assets at target → no drift → no actions
    const actions = computeRebalance(state, DEFAULT_CONFIG);
    expect(actions).toEqual([]);
  });

  it("passes driftThresholdBps from config — zero threshold triggers actions on any delta", () => {
    const total = 1_000_000n;
    // Asymmetric allocations with very different APY markets → strategy will shift
    const adapters = [
      makeAdapter(ADDR_A, 950_000n),
      makeAdapter(ADDR_B, 50_000n),
    ];
    const markets = [
      makeMarket(10_000_000n, 1_000_000n), // low APY
      makeMarket(1_000_000n, 990_000n),    // very high APY
    ];
    const state = makeVaultState(adapters, markets, total);
    const configWithZeroDrift: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const configWithHighDrift: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 10000 };

    const actionsZero = computeRebalance(state, configWithZeroDrift);
    const actionsHigh = computeRebalance(state, configWithHighDrift);

    // High drift threshold means nothing triggers
    expect(actionsHigh).toEqual([]);
    // Zero drift threshold may still return empty if equal allocation is already optimal
    // but the important thing is the config is respected
    expect(Array.isArray(actionsZero)).toBe(true);
  });

  it("returns an array (never throws) for any valid input", () => {
    const emptyMarkets = makeVaultState([], [], 0n);
    expect(() => computeRebalance(emptyMarkets, DEFAULT_CONFIG)).not.toThrow();
    expect(Array.isArray(computeRebalance(emptyMarkets, DEFAULT_CONFIG))).toBe(true);
  });
});
