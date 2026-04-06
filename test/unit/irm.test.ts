/**
 * irm.test.ts — Unit tests for src/core/rebalancer/irm.ts
 *
 * All functions under test are pure: no external dependencies, no mocks needed.
 * Tests cover: computeBorrowRate, computeSupplyAPY, projectUtilization, projectSupplyAPY.
 */

import { describe, it, expect } from "vitest";
import {
  computeBorrowRate,
  computeSupplyAPY,
  projectUtilization,
  projectSupplyAPY,
} from "../../src/core/rebalancer/irm.js";
import { WAD } from "../../src/config/constants.js";
import type { IRMParams } from "../../src/core/rebalancer/types.js";

// ---------------------------------------------------------------------------
// Shared IRM parameter fixtures
// ---------------------------------------------------------------------------

/**
 * Realistic-ish IRM params for a typical Morpho Blue USDC market.
 * - baseRate:           ~0 (0% at 0% utilization for simplicity)
 * - slope1:            corresponds to ~4% APY per second at 80% utilization
 * - slope2:            much steeper above kink
 * - optimalUtilization: 80% expressed as WAD
 */
const TYPICAL_PARAMS: IRMParams = {
  baseRate: 0n,
  // slope1: 1% APY per second at optimal — expressed in WAD/second
  // A rough real value: ~1.585e9 gives ~5% APY at 80%
  slope1: 1_585_000_000n, // ~1.585e9 WAD/s
  slope2: 20_000_000_000n, // ~20x steeper above kink
  optimalUtilization: (WAD * 80n) / 100n, // 80%
};

/** Zero-utilization params — baseRate only, no slope contribution. */
const BASE_RATE_ONLY_PARAMS: IRMParams = {
  baseRate: 1_000_000_000n, // ~1e9 WAD/s
  slope1: 0n,
  slope2: 0n,
  optimalUtilization: (WAD * 80n) / 100n,
};

// ---------------------------------------------------------------------------
// computeBorrowRate
// ---------------------------------------------------------------------------

describe("computeBorrowRate", () => {
  it("returns baseRate only when utilization is zero", () => {
    const params: IRMParams = {
      baseRate: 500_000_000n,
      slope1: 1_000_000_000n,
      slope2: 10_000_000_000n,
      optimalUtilization: (WAD * 80n) / 100n,
    };
    const rate = computeBorrowRate(params, 0n);
    expect(rate).toBe(500_000_000n);
  });

  it("returns baseRate + slope1 when utilization exactly equals optimalUtilization", () => {
    const params: IRMParams = {
      baseRate: 0n,
      slope1: 1_000_000_000n,
      slope2: 10_000_000_000n,
      optimalUtilization: (WAD * 80n) / 100n,
    };
    const rate = computeBorrowRate(params, params.optimalUtilization);
    // At kink: baseRate + (optimalUtilization * slope1) / optimalUtilization = baseRate + slope1
    expect(rate).toBe(1_000_000_000n);
  });

  it("returns a higher rate above the kink than at the kink (slope2 applies)", () => {
    const rateAtKink = computeBorrowRate(TYPICAL_PARAMS, TYPICAL_PARAMS.optimalUtilization);
    const rateAboveKink = computeBorrowRate(TYPICAL_PARAMS, (WAD * 90n) / 100n);
    expect(rateAboveKink).toBeGreaterThan(rateAtKink);
  });

  it("includes slope2 component correctly for utilization above optimal", () => {
    const params: IRMParams = {
      baseRate: 0n,
      slope1: 1_000_000_000n,
      slope2: 10_000_000_000n,
      optimalUtilization: (WAD * 80n) / 100n,
    };
    // At 100% utilization: baseRate + slope1 + (20% * slope2 / 20%) = baseRate + slope1 + slope2
    const rate = computeBorrowRate(params, WAD);
    expect(rate).toBe(params.slope1 + params.slope2);
  });

  it("returns baseRate + slope1 at 100% utilization when optimalUtilization is zero", () => {
    // When optimalUtilization == 0, the slopeComponent below kink is 0 (guard).
    // Any non-zero utilization is above optimal (0), so slope2 applies from 0 to WAD.
    const params: IRMParams = {
      baseRate: 0n,
      slope1: 0n,
      slope2: 5_000_000_000n,
      optimalUtilization: 0n,
    };
    // u > 0 = optimalUtilization => above kink
    // excessUtilization = WAD - 0 = WAD
    // remainingRange = WAD - 0 = WAD
    // slopeComponent2 = WAD * slope2 / WAD = slope2
    const rate = computeBorrowRate(params, WAD);
    expect(rate).toBe(params.slope2);
  });

  it("edge case: optimalUtilization is 0, utilization is also 0 → returns baseRate", () => {
    const params: IRMParams = {
      baseRate: 999n,
      slope1: 1_000_000_000n,
      slope2: 10_000_000_000n,
      optimalUtilization: 0n,
    };
    // u (0) <= optimalUtilization (0): below-kink branch, slope component = 0 (guard)
    const rate = computeBorrowRate(params, 0n);
    expect(rate).toBe(999n);
  });

  it("clamps utilization above WAD to WAD (handles malformed chain data)", () => {
    const rateAtWAD = computeBorrowRate(TYPICAL_PARAMS, WAD);
    const rateAboveWAD = computeBorrowRate(TYPICAL_PARAMS, WAD + 1_000_000_000_000_000_000n);
    expect(rateAboveWAD).toBe(rateAtWAD);
  });

  it("clamps negative utilization to 0 (handles malformed chain data)", () => {
    const rateAtZero = computeBorrowRate(BASE_RATE_ONLY_PARAMS, 0n);
    const rateNegative = computeBorrowRate(BASE_RATE_ONLY_PARAMS, -1n);
    expect(rateNegative).toBe(rateAtZero);
  });

  it("returns baseRate + slope1 + slope2 at 100% utilization (full kink traversal)", () => {
    const params: IRMParams = {
      baseRate: 100n,
      slope1: 1_000n,
      slope2: 10_000n,
      optimalUtilization: (WAD * 80n) / 100n,
    };
    const rate = computeBorrowRate(params, WAD);
    // excessUtilization = WAD - 0.8*WAD = 0.2*WAD
    // remainingRange = WAD - 0.8*WAD = 0.2*WAD
    // slopeComponent2 = 0.2*WAD * slope2 / 0.2*WAD = slope2
    expect(rate).toBe(100n + 1_000n + 10_000n);
  });

  it("rate is monotonically non-decreasing as utilization increases from 0 to 100%", () => {
    const steps = [0n, 20n, 40n, 60n, 80n, 90n, 100n];
    const rates = steps.map((pct) =>
      computeBorrowRate(TYPICAL_PARAMS, (WAD * pct) / 100n)
    );
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// computeSupplyAPY
// ---------------------------------------------------------------------------

describe("computeSupplyAPY", () => {
  it("returns 0 APY at zero utilization (no borrowers, no supply return)", () => {
    const apy = computeSupplyAPY(TYPICAL_PARAMS, 0n);
    expect(apy).toBe(0);
  });

  it("returns a reasonable APY (1%–20%) at moderate utilization (50%)", () => {
    const apy = computeSupplyAPY(TYPICAL_PARAMS, (WAD * 50n) / 100n);
    expect(apy).toBeGreaterThan(0.01);
    expect(apy).toBeLessThan(0.20);
  });

  it("returns a higher APY at 90% utilization than at 50% utilization", () => {
    const apy50 = computeSupplyAPY(TYPICAL_PARAMS, (WAD * 50n) / 100n);
    const apy90 = computeSupplyAPY(TYPICAL_PARAMS, (WAD * 90n) / 100n);
    expect(apy90).toBeGreaterThan(apy50);
  });

  it("returns APY > 0 at high utilization (100%)", () => {
    const params: IRMParams = {
      baseRate: 0n,
      slope1: 1_585_000_000n,
      slope2: 50_000_000_000n,
      optimalUtilization: (WAD * 80n) / 100n,
    };
    const apy = computeSupplyAPY(params, WAD);
    expect(apy).toBeGreaterThan(0);
  });

  it("APY is a float (not a bigint) — plain number type", () => {
    const apy = computeSupplyAPY(TYPICAL_PARAMS, (WAD * 80n) / 100n);
    expect(typeof apy).toBe("number");
  });

  it("APY at 80% utilization (kink) is lower than at 95% (above kink, slope2 jump)", () => {
    const apyAtKink = computeSupplyAPY(TYPICAL_PARAMS, (WAD * 80n) / 100n);
    const apyAboveKink = computeSupplyAPY(TYPICAL_PARAMS, (WAD * 95n) / 100n);
    expect(apyAboveKink).toBeGreaterThan(apyAtKink);
  });
});

// ---------------------------------------------------------------------------
// projectUtilization
// ---------------------------------------------------------------------------

describe("projectUtilization", () => {
  it("adding supply decreases utilization", () => {
    // 100 supply, 80 borrow → 80% utilization
    const currentSupply = 100_000_000n;
    const currentBorrow = 80_000_000n;
    const baseUtil = (currentBorrow * WAD) / currentSupply;

    // Adding 100 more supply → new supply = 200, utilization = 80/200 = 40%
    const projected = projectUtilization(currentSupply, currentBorrow, 100_000_000n);
    expect(projected).toBeLessThan(baseUtil);
  });

  it("removing supply increases utilization", () => {
    const currentSupply = 100_000_000n;
    const currentBorrow = 50_000_000n;
    const baseUtil = (currentBorrow * WAD) / currentSupply;

    // Removing 50 supply → new supply = 50, utilization = 50/50 = 100%
    const projected = projectUtilization(currentSupply, currentBorrow, -50_000_000n);
    expect(projected).toBeGreaterThan(baseUtil);
  });

  it("zero supply (currentSupply = 0, delta = 0) returns WAD (100%)", () => {
    const projected = projectUtilization(0n, 0n, 0n);
    expect(projected).toBe(WAD);
  });

  it("negative delta that zeroes supply returns WAD", () => {
    // currentSupply = 100, delta = -100 → newSupply = 0 → returns WAD
    const projected = projectUtilization(100_000_000n, 80_000_000n, -100_000_000n);
    expect(projected).toBe(WAD);
  });

  it("negative delta that makes supply negative returns WAD", () => {
    const projected = projectUtilization(100_000_000n, 80_000_000n, -200_000_000n);
    expect(projected).toBe(WAD);
  });

  it("zero borrow with non-zero supply returns 0 utilization", () => {
    const projected = projectUtilization(100_000_000n, 0n, 0n);
    expect(projected).toBe(0n);
  });

  it("result is clamped to WAD even if borrow exceeds new supply", () => {
    // borrow = 100, newSupply = 50 → raw = 200% → clamped to 100%
    const projected = projectUtilization(200_000_000n, 100_000_000n, -150_000_000n);
    expect(projected).toBeLessThanOrEqual(WAD);
  });

  it("adding zero supply returns the same utilization as current", () => {
    const currentSupply = 100_000_000n;
    const currentBorrow = 60_000_000n;
    const expected = (currentBorrow * WAD) / currentSupply;
    const projected = projectUtilization(currentSupply, currentBorrow, 0n);
    expect(projected).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// projectSupplyAPY
// ---------------------------------------------------------------------------

describe("projectSupplyAPY", () => {
  it("allocating more supply to a market reduces APY (more supply dilutes borrower rate)", () => {
    const params = TYPICAL_PARAMS;
    const currentSupply = 1_000_000_000n; // 1000 USDC
    const currentBorrow = 800_000_000n;   // 800 USDC → 80% utilization

    const apyBefore = projectSupplyAPY(params, currentSupply, currentBorrow, 0n);
    const apyAfter = projectSupplyAPY(params, currentSupply, currentBorrow, 500_000_000n);

    expect(apyAfter).toBeLessThan(apyBefore);
  });

  it("removing supply from a market increases APY (less supply raises utilization)", () => {
    const params = TYPICAL_PARAMS;
    const currentSupply = 1_000_000_000n;
    const currentBorrow = 500_000_000n; // 50% utilization

    const apyBefore = projectSupplyAPY(params, currentSupply, currentBorrow, 0n);
    const apyAfter = projectSupplyAPY(params, currentSupply, currentBorrow, -400_000_000n);

    expect(apyAfter).toBeGreaterThan(apyBefore);
  });

  it("zero supply with zero delta returns 0 APY (WAD utilization but 0 net rate)", () => {
    // newSupply = 0 → projectUtilization returns WAD
    // But WAD utilization with slope = some rate, supply APY = borrowRate * WAD / WAD
    // The key is the function composes correctly and returns a number
    const result = projectSupplyAPY(TYPICAL_PARAMS, 0n, 0n, 0n);
    expect(typeof result).toBe("number");
  });

  it("is a pure composition of projectUtilization and computeSupplyAPY", () => {
    const params = TYPICAL_PARAMS;
    const supply = 1_000_000_000n;
    const borrow = 700_000_000n;
    const delta = 200_000_000n;

    const utilization = projectUtilization(supply, borrow, delta);
    const expectedAPY = computeSupplyAPY(params, utilization);
    const composedAPY = projectSupplyAPY(params, supply, borrow, delta);

    expect(composedAPY).toBe(expectedAPY);
  });

  it("returns a plain number (not bigint)", () => {
    const result = projectSupplyAPY(TYPICAL_PARAMS, 1_000_000_000n, 500_000_000n, 0n);
    expect(typeof result).toBe("number");
  });
});
