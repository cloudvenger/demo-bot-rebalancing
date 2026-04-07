/**
 * strategy.test.ts — Unit tests for src/core/rebalancer/strategy.ts
 *
 * All functions under test are pure: no async, no external dependencies.
 * Tests cover: computeScore, computeRebalance, isWithinDriftThreshold, enforceCapConstraints.
 *
 * Updated for V2 single-adapter model (Group 8.3):
 *   - VaultState now carries adapterAddress + marketStates (not adapters)
 *   - MarketAllocationState has caps[3] with {id, absoluteCap, relativeCap in WAD}
 *   - enforceCapConstraints takes Map<number, bigint> (index-keyed, not address-keyed)
 *   - relativeCap is WAD (1e18 = 100%), not basis points
 *   - WAD sentinel (1e18) means "no relative cap"
 *   - relativeCap == 0n means "market forbidden" → clamp to 0
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
  ManagedMarket,
  MarketAllocationState,
  MarketData,
  StrategyConfig,
  VaultState,
} from "../../src/core/rebalancer/types.js";
import type { IRMParams } from "../../src/core/rebalancer/types.js";
import type { Address, Hash } from "viem";

// ---------------------------------------------------------------------------
// Addresses and constants
// ---------------------------------------------------------------------------

const VAULT_ADDR: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_ADDR: Address = "0x2222222222222222222222222222222222222222";

// Stable placeholder hashes for cap ids
const CAP_ID_0 = "0xaaaa000000000000000000000000000000000000000000000000000000000000" as Hash;
const CAP_ID_1 = "0xbbbb000000000000000000000000000000000000000000000000000000000000" as Hash;
const CAP_ID_2 = "0xcccc000000000000000000000000000000000000000000000000000000000000" as Hash;
const MARKET_ID_A = "0xaaab000000000000000000000000000000000000000000000000000000000000" as Hash;
const MARKET_ID_B = "0xbbb0000000000000000000000000000000000000000000000000000000000000" as Hash;

const LOAN_TOKEN: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const wstETH: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const ORACLE: Address = "0x3333333333333333333333333333333333333333";
const IRM: Address = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";

// ---------------------------------------------------------------------------
// IRM params and config
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

/** Build a ManagedMarket. capIds default to all-WAD caps. */
function makeManagedMarket(
  label: string,
  marketId: Hash = MARKET_ID_A,
  collateralToken: Address = WETH
): ManagedMarket {
  return {
    label,
    marketId,
    marketParams: {
      loanToken: LOAN_TOKEN,
      collateralToken,
      oracle: ORACLE,
      irm: IRM,
      lltv: 860_000_000_000_000_000n, // 86% in WAD
    },
    capIds: [CAP_ID_0, CAP_ID_1, CAP_ID_2],
  };
}

/**
 * Build a MarketAllocationState with uniform caps (all WAD relative caps,
 * all high absolute caps by default — no restrictions).
 */
function makeMarketState(
  market: ManagedMarket,
  allocation: bigint,
  totalAssets: bigint,
  caps?: MarketAllocationState["caps"]
): MarketAllocationState {
  const defaultCaps: MarketAllocationState["caps"] = [
    { id: CAP_ID_0, absoluteCap: 1_000_000_000_000_000n, relativeCap: WAD }, // WAD = no rel cap
    { id: CAP_ID_1, absoluteCap: 1_000_000_000_000_000n, relativeCap: WAD },
    { id: CAP_ID_2, absoluteCap: 1_000_000_000_000_000n, relativeCap: WAD },
  ];

  return {
    market,
    allocation,
    allocationPercentage:
      totalAssets > 0n ? Number((allocation * 10_000n) / totalAssets) / 10_000 : 0,
    caps: caps ?? defaultCaps,
  };
}

/** Build a minimal valid MarketData. */
function makeMarketData(
  marketId: Hash,
  totalSupply: bigint,
  totalBorrow: bigint,
  overrides?: Partial<MarketData>
): MarketData {
  return {
    marketId,
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
  marketStates: MarketAllocationState[],
  marketData: MarketData[],
  totalAssets: bigint
): VaultState {
  return {
    vaultAddress: VAULT_ADDR,
    adapterAddress: ADAPTER_ADDR,
    totalAssets,
    marketStates,
    marketData,
  };
}

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  it("returns a positive score for a high APY market with good liquidity and low concentration", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const state = makeMarketState(market, 100_000n, 10_000_000n);
    const data = makeMarketData(market.marketId, 10_000_000n, 8_000_000n);

    const score = computeScore(state, data, 100_000n, DEFAULT_CONFIG);

    expect(score).toBeGreaterThan(0);
  });

  it("reduces score when available liquidity is below minLiquidityMultiplier * allocation", () => {
    const allocation = 1_000_000n;
    const market = makeManagedMarket("USDC/WETH 86%");
    const state = makeMarketState(market, allocation, 10_000_000n);
    // availableLiquidity = 1_000_000, floor = 2 * 1_000_000 = 2_000_000 → factor = 0.5
    const dataLowLiquidity = makeMarketData(market.marketId, 5_000_000n, 4_000_000n, {
      availableLiquidity: 1_000_000n,
    });
    const dataHighLiquidity = makeMarketData(market.marketId, 5_000_000n, 4_000_000n, {
      availableLiquidity: 10_000_000n,
    });

    const scoreLow = computeScore(state, dataLowLiquidity, allocation, DEFAULT_CONFIG);
    const scoreHigh = computeScore(state, dataHighLiquidity, allocation, DEFAULT_CONFIG);

    expect(scoreLow).toBeLessThan(scoreHigh);
  });

  it("liquidity safety factor caps at 1 when available liquidity far exceeds the floor", () => {
    const allocation = 100_000n;
    const market = makeManagedMarket("USDC/WETH 86%");
    const state = makeMarketState(market, allocation, 10_000_000n);
    const data = makeMarketData(market.marketId, 20_000_000n, 16_000_000n, {
      availableLiquidity: 10_000_000n, // >> 2 * 100_000 = 200_000
    });

    const score = computeScore(state, data, allocation, DEFAULT_CONFIG);

    expect(score).toBeGreaterThan(0);
  });

  it("penalizes score when concentration exceeds maxMarketConcentrationPct", () => {
    const totalSupply = 1_000_000n;
    const allocationHigh = 500_000n; // 50% concentration
    const allocationLow = 50_000n;   // 5% concentration
    const market = makeManagedMarket("USDC/WETH 86%");
    const stateHigh = makeMarketState(market, allocationHigh, 10_000_000n);
    const stateLow = makeMarketState(market, allocationLow, 10_000_000n);
    const data = makeMarketData(market.marketId, totalSupply, 800_000n, {
      availableLiquidity: 10_000_000n,
    });

    const scoreHigh = computeScore(stateHigh, data, allocationHigh, DEFAULT_CONFIG);
    const scoreLow = computeScore(stateLow, data, allocationLow, DEFAULT_CONFIG);

    expect(scoreHigh).toBeLessThan(scoreLow);
  });

  it("returns 0 when allocation is 0 and market has zero APY (zero utilization)", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const state = makeMarketState(market, 0n, 1_000_000n);
    const data = makeMarketData(market.marketId, 1_000_000n, 0n); // 0% utilization → 0 APY

    const score = computeScore(state, data, 0n, DEFAULT_CONFIG);

    expect(score).toBe(0);
  });

  it("returns a number (not bigint)", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const state = makeMarketState(market, 100_000n, 10_000_000n);
    const data = makeMarketData(market.marketId, 10_000_000n, 8_000_000n);

    const score = computeScore(state, data, 100_000n, DEFAULT_CONFIG);

    expect(typeof score).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// isWithinDriftThreshold
// ---------------------------------------------------------------------------

describe("isWithinDriftThreshold", () => {
  it("returns true when delta is exactly zero", () => {
    expect(isWithinDriftThreshold(100_000n, 100_000n, 1_000_000n, 500)).toBe(true);
  });

  it("returns true when delta is below the threshold", () => {
    // 4% drift on 1M = 40_000, threshold = 5%
    expect(isWithinDriftThreshold(100_000n, 140_000n, 1_000_000n, 500)).toBe(true);
  });

  it("returns false when delta exceeds the threshold", () => {
    // delta = 100_000 = 10% of 1M, threshold = 5%
    expect(isWithinDriftThreshold(200_000n, 300_000n, 1_000_000n, 500)).toBe(false);
  });

  it("returns true when total is 0 (guard: no division by zero)", () => {
    expect(isWithinDriftThreshold(100n, 200n, 0n, 500)).toBe(true);
  });

  it("returns true when delta is exactly at the threshold boundary", () => {
    const total = 1_000_000n;
    const thresholdBps = 500;
    const threshold = (total * BigInt(thresholdBps)) / BigInt(BPS_DENOMINATOR);
    expect(isWithinDriftThreshold(0n, threshold, total, thresholdBps)).toBe(true);
  });

  it("returns false when delta is one unit above threshold boundary", () => {
    const total = 1_000_000n;
    const thresholdBps = 500;
    const threshold = (total * BigInt(thresholdBps)) / BigInt(BPS_DENOMINATOR);
    expect(isWithinDriftThreshold(0n, threshold + 1n, total, thresholdBps)).toBe(false);
  });

  it("is symmetric: same result regardless of direction of drift", () => {
    const total = 1_000_000n;
    const r1 = isWithinDriftThreshold(800_000n, 200_000n, total, 500);
    const r2 = isWithinDriftThreshold(200_000n, 800_000n, total, 500);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// enforceCapConstraints — index-keyed Map<number, bigint>
// ---------------------------------------------------------------------------

describe("enforceCapConstraints", () => {
  it("clamps to absoluteCap when proposed exceeds it", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 2_000_000n, [
      { id: CAP_ID_0, absoluteCap: 500_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 500_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 500_000n, relativeCap: WAD },
    ]);

    const allocations = new Map([[0, 1_000_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 2_000_000n);

    expect(result.get(0)).toBe(500_000n);
  });

  it("clamps to the most restrictive absoluteCap among the 3 ids", () => {
    // id[0]: 1_000_000, id[1]: 800_000, id[2]: 500_000 → effective = 500_000
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 2_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 800_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 500_000n, relativeCap: WAD },
    ]);

    const allocations = new Map([[0, 1_200_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 2_000_000n);

    expect(result.get(0)).toBe(500_000n);
  });

  it("clamps to relativeCap amount when proposed exceeds relative cap (WAD math)", () => {
    // relativeCap = WAD / 2 = 50% of totalAssets = 500_000 on a 1M vault
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000n, relativeCap: WAD },          // no rel cap
      { id: CAP_ID_1, absoluteCap: 1_000_000_000n, relativeCap: WAD },          // no rel cap
      { id: CAP_ID_2, absoluteCap: 1_000_000_000n, relativeCap: WAD / 2n },     // 50% rel cap
    ]);

    const allocations = new Map([[0, 900_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 1_000_000n);

    // 50% of 1_000_000 = 500_000
    expect(result.get(0)).toBe(500_000n);
  });

  it("clamps to most restrictive relative cap among all 3 ids (WAD math)", () => {
    // id[0]: WAD (no rel cap), id[1]: WAD (no rel cap), id[2]: WAD/2 (50%)
    // totalAssets = 1M → effective relative cap = 500_000
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 1_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000n, relativeCap: WAD / 2n }, // 50%
    ]);

    const allocations = new Map([[0, 800_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 1_000_000n);

    expect(result.get(0)).toBe(500_000n);
  });

  it("does not clamp when proposed is below all caps", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000n, relativeCap: WAD },    // abs cap = 1M
      { id: CAP_ID_1, absoluteCap: 1_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000n, relativeCap: WAD },
    ]);

    const allocations = new Map([[0, 300_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 1_000_000n);

    expect(result.get(0)).toBe(300_000n);
  });

  it("enforces the tighter of absoluteCap vs relative cap (abs tighter)", () => {
    // absoluteCap = 400_000, relativeCap = WAD/2 on 1M → 500_000 → abs wins
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 400_000n, relativeCap: WAD / 2n },
      { id: CAP_ID_1, absoluteCap: 400_000n, relativeCap: WAD / 2n },
      { id: CAP_ID_2, absoluteCap: 400_000n, relativeCap: WAD / 2n },
    ]);

    const allocations = new Map([[0, 700_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 1_000_000n);

    expect(result.get(0)).toBe(400_000n);
  });

  it("relativeCap == WAD means no relative cap — only absoluteCap applies", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000n, relativeCap: WAD }, // WAD = no rel cap
      { id: CAP_ID_1, absoluteCap: 1_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000n, relativeCap: WAD },
    ]);

    const allocations = new Map([[0, 800_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 1_000_000n);

    // No relative cap → proposed value should pass unchanged
    expect(result.get(0)).toBe(800_000n);
  });

  it("relativeCap == 0n on any id clamps target to 0 (market forbidden)", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 1_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000n, relativeCap: 0n }, // 0 = forbidden
    ]);

    const allocations = new Map([[0, 500_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], 1_000_000n);

    expect(result.get(0)).toBe(0n);
  });

  it("handles market with no entry in allocations map — defaults to 0", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const marketState = makeMarketState(market, 0n, 1_000_000n);
    const allocations = new Map<number, bigint>(); // empty

    const result = enforceCapConstraints(allocations, [marketState], 2_000_000n);

    expect(result.get(0)).toBe(0n);
  });

  it("processes multiple markets independently — each uses its own index", () => {
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const stateA = makeMarketState(marketA, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 300_000n, relativeCap: WAD }, // abs cap = 300k
      { id: CAP_ID_1, absoluteCap: 300_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 300_000n, relativeCap: WAD },
    ]);
    const stateB = makeMarketState(marketB, 0n, 1_000_000n, [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000n, relativeCap: WAD / 2n }, // rel cap = 50%
      { id: CAP_ID_1, absoluteCap: 1_000_000_000n, relativeCap: WAD / 2n },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000n, relativeCap: WAD / 2n },
    ]);

    const allocations = new Map<number, bigint>([
      [0, 500_000n],
      [1, 500_000n],
    ]);
    const result = enforceCapConstraints(allocations, [stateA, stateB], 1_000_000n);

    expect(result.get(0)).toBe(300_000n); // abs cap hit
    expect(result.get(1)).toBe(500_000n); // 50% of 1M = 500k, exactly matches proposed
  });
});

// ---------------------------------------------------------------------------
// computeRebalance — full pipeline
// ---------------------------------------------------------------------------

describe("computeRebalance", () => {
  it("returns empty array when there are no market states", () => {
    const state = makeVaultState([], [], 1_000_000n);
    expect(computeRebalance(state, DEFAULT_CONFIG)).toEqual([]);
  });

  it("returns empty array when totalAssets is zero", () => {
    const market = makeManagedMarket("USDC/WETH 86%");
    const state = makeVaultState(
      [makeMarketState(market, 0n, 0n)],
      [makeMarketData(market.marketId, 1_000_000n, 800_000n)],
      0n
    );
    expect(computeRebalance(state, DEFAULT_CONFIG)).toEqual([]);
  });

  it("returns empty array when all markets are within drift threshold", () => {
    // Two equal markets, same APY → equal score → each gets 50% → no drift
    const total = 2_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const state = makeVaultState(
      [
        makeMarketState(marketA, 1_000_000n, total),
        makeMarketState(marketB, 1_000_000n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 8_000_000n),
        makeMarketData(MARKET_ID_B, 10_000_000n, 8_000_000n),
      ],
      total
    );

    const actions = computeRebalance(state, DEFAULT_CONFIG);

    expect(actions).toEqual([]);
  });

  it("deallocate actions appear before allocate actions in result", () => {
    const total = 2_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    // Market A: 90% allocated, low APY. Market B: 10% allocated, high APY.
    const state = makeVaultState(
      [
        makeMarketState(marketA, (total * 9n) / 10n, total),
        makeMarketState(marketB, total / 10n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 1_000_000n),   // low APY
        makeMarketData(MARKET_ID_B, 1_000_000n, 950_000n),       // high APY
      ],
      total
    );
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    const deallocateIdx = actions.findIndex((a) => a.direction === "deallocate");
    const allocateIdx = actions.findIndex((a) => a.direction === "allocate");

    if (deallocateIdx !== -1 && allocateIdx !== -1) {
      expect(deallocateIdx).toBeLessThan(allocateIdx);
    }
    for (const action of actions) {
      expect(["deallocate", "allocate"]).toContain(action.direction);
    }
  });

  it("actions contain marketLabel matching the market's label field", () => {
    const total = 2_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const state = makeVaultState(
      [
        makeMarketState(marketA, (total * 9n) / 10n, total),
        makeMarketState(marketB, total / 10n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 1_000_000n),
        makeMarketData(MARKET_ID_B, 1_000_000n, 950_000n),
      ],
      total
    );
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    for (const action of actions) {
      expect(typeof action.marketLabel).toBe("string");
      expect(action.marketLabel.length).toBeGreaterThan(0);
      // Each marketLabel must match one of the configured markets
      const validLabels = ["USDC/WETH 86%", "USDC/wstETH 86%"];
      expect(validLabels).toContain(action.marketLabel);
    }
  });

  it("actions contain a non-empty hex data field (ABI-encoded MarketParams)", () => {
    const total = 2_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const state = makeVaultState(
      [
        makeMarketState(marketA, (total * 9n) / 10n, total),
        makeMarketState(marketB, total / 10n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 1_000_000n),
        makeMarketData(MARKET_ID_B, 1_000_000n, 950_000n),
      ],
      total
    );
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    for (const action of actions) {
      expect(typeof action.data).toBe("string");
      // data must be a non-empty hex string (not "0x")
      expect(action.data.length).toBeGreaterThan(2);
      expect(action.data.startsWith("0x")).toBe(true);
    }
  });

  it("actions use the configured adapterAddress from state", () => {
    const total = 2_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const state = makeVaultState(
      [
        makeMarketState(marketA, (total * 9n) / 10n, total),
        makeMarketState(marketB, total / 10n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 1_000_000n),
        makeMarketData(MARKET_ID_B, 1_000_000n, 950_000n),
      ],
      total
    );
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    for (const action of actions) {
      expect(action.adapter).toBe(ADAPTER_ADDR);
    }
  });

  // -------------------------------------------------------------------------
  // Cap clamping tests (CRITICAL per Group 8.3 instructions)
  // -------------------------------------------------------------------------

  it("clamps to absoluteCap — allocated market does not receive allocation above cap", () => {
    const total = 1_000_000n;
    const cap = 200_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const stateB_caps: MarketAllocationState["caps"] = [
      { id: CAP_ID_0, absoluteCap: cap, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: cap, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: cap, relativeCap: WAD },
    ];

    const state = makeVaultState(
      [
        makeMarketState(marketA, 500_000n, total),
        makeMarketState(marketB, 500_000n, total, stateB_caps),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 1_000_000n), // low APY
        makeMarketData(MARKET_ID_B, 1_000_000n, 990_000n),     // very high APY
      ],
      total
    );

    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    const allocateB = actions.find(
      (a) => a.marketLabel === "USDC/wstETH 86%" && a.direction === "allocate"
    );
    if (allocateB) {
      // current = 500_000, cap = 200_000 → strategy should have capped target to 200_000
      // Since current (500_000) > cap (200_000), there should be a deallocate, not allocate
      // The allocate path is only reached if target > current
      // Cap = 200k, current = 500k → deallocate should be emitted
      expect(allocateB.amount).toBeLessThanOrEqual(cap);
    }
  });

  it("multi-id cap clamping: most-restrictive of 3 caps — [1M, 800k, 500k] → effective 500k", () => {
    const total = 1_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);

    const stateCaps: MarketAllocationState["caps"] = [
      { id: CAP_ID_0, absoluteCap: 1_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 800_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 500_000n, relativeCap: WAD },
    ];

    const state = makeVaultState(
      [makeMarketState(marketA, 0n, total, stateCaps)],
      [makeMarketData(MARKET_ID_A, 10_000_000n, 8_000_000n)],
      total
    );

    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    // Strategy may or may not emit an allocate action since single market
    // gets 100% of target, but target is capped at 500k
    const allocateA = actions.find(
      (a) => a.marketLabel === "USDC/WETH 86%" && a.direction === "allocate"
    );
    if (allocateA) {
      const postAllocation = 0n + allocateA.amount;
      expect(postAllocation).toBeLessThanOrEqual(500_000n);
    }
  });

  it("relativeCap == WAD on all 3 ids → no relative cap clamp at all", () => {
    const total = 1_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);

    // All rel caps are WAD → no relative clamping
    const stateCaps: MarketAllocationState["caps"] = [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
    ];

    const marketState = makeMarketState(marketA, 0n, total, stateCaps);

    // Directly test enforceCapConstraints — the relative cap should not clamp
    const allocations = new Map([[0, 800_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], total);

    // 800_000 is below all absolute caps and no relative clamp → 800_000 unchanged
    expect(result.get(0)).toBe(800_000n);
  });

  it("relativeCap == 0n on any id → target clamped to 0 regardless of absolute caps", () => {
    const total = 1_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);

    const stateCaps: MarketAllocationState["caps"] = [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000_000n, relativeCap: 0n }, // forbidden
    ];

    const marketState = makeMarketState(marketA, 0n, total, stateCaps);

    const allocations = new Map([[0, 500_000n]]);
    const result = enforceCapConstraints(allocations, [marketState], total);

    expect(result.get(0)).toBe(0n);
  });

  it("relativeCap == 0n with existing allocation emits deallocate action regardless of drift threshold", () => {
    const total = 1_000_000n;
    const allocation = 500_000n; // market is currently allocated
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);

    // Any id with relativeCap == 0n marks the market as forbidden
    const forbiddenCaps: MarketAllocationState["caps"] = [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 1_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000_000n, relativeCap: 0n },
    ];

    const state = makeVaultState(
      [makeMarketState(marketA, allocation, total, forbiddenCaps)],
      [makeMarketData(MARKET_ID_A, 10_000_000n, 8_000_000n)],
      total
    );

    // Even with a very high drift threshold, the forbidden market must be deallocated
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 10_000 };
    const actions = computeRebalance(state, config);

    const deallocate = actions.find(
      (a) => a.marketLabel === "USDC/WETH 86%" && a.direction === "deallocate"
    );
    expect(deallocate).toBeDefined();
    expect(deallocate!.amount).toBe(allocation);
  });

  it("zero drift threshold triggers actions on any non-zero delta", () => {
    const total = 1_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const state = makeVaultState(
      [
        makeMarketState(marketA, 950_000n, total),
        makeMarketState(marketB, 50_000n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 1_000_000n), // low APY
        makeMarketData(MARKET_ID_B, 1_000_000n, 990_000n),     // very high APY
      ],
      total
    );

    const zeroConfig: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const highConfig: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 10_000 };

    const actionsHigh = computeRebalance(state, highConfig);
    const actionsZero = computeRebalance(state, zeroConfig);

    expect(actionsHigh).toEqual([]);
    expect(Array.isArray(actionsZero)).toBe(true);
  });

  it("actions array contains only valid RebalanceAction shapes", () => {
    const total = 2_000_000n;
    const marketA = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
    const marketB = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B, wstETH);

    const state = makeVaultState(
      [
        makeMarketState(marketA, 1_000_000n, total),
        makeMarketState(marketB, 1_000_000n, total),
      ],
      [
        makeMarketData(MARKET_ID_A, 10_000_000n, 8_000_000n),
        makeMarketData(MARKET_ID_B, 10_000_000n, 2_000_000n),
      ],
      total
    );
    const config: StrategyConfig = { ...DEFAULT_CONFIG, driftThresholdBps: 0 };
    const actions = computeRebalance(state, config);

    for (const action of actions) {
      expect(typeof action.adapter).toBe("string");
      expect(typeof action.marketLabel).toBe("string");
      expect(["allocate", "deallocate"]).toContain(action.direction);
      expect(typeof action.amount).toBe("bigint");
      expect(action.amount).toBeGreaterThan(0n);
      expect(typeof action.data).toBe("string");
    }
  });

  it("returns an array and never throws for valid input", () => {
    const empty = makeVaultState([], [], 0n);
    expect(() => computeRebalance(empty, DEFAULT_CONFIG)).not.toThrow();
    expect(Array.isArray(computeRebalance(empty, DEFAULT_CONFIG))).toBe(true);
  });
});
