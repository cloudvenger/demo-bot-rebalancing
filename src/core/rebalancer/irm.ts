/**
 * irm.ts — Pure IRM (Interest Rate Model) simulation.
 *
 * All functions in this module are pure: no async, no RPC calls, no side
 * effects.  Input: IRM parameters and utilization values already read from
 * chain.  Output: computed rates and APY values.
 *
 * Import restrictions: only types.ts and constants.ts.
 */

import { WAD, SECONDS_PER_YEAR } from "../../config/constants.js";
import type { IRMParams } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a bigint to the range [min, max] inclusive.
 */
function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ---------------------------------------------------------------------------
// Exported pure functions
// ---------------------------------------------------------------------------

/**
 * Compute the borrow rate per second given IRM parameters and a utilization.
 *
 * Two-segment linear kink model:
 *   - utilization <= optimalUtilization:
 *       rate = baseRate + (utilization * slope1 / optimalUtilization)
 *   - utilization > optimalUtilization:
 *       rate = baseRate + slope1
 *             + ((utilization - optimalUtilization) * slope2
 *                / (WAD - optimalUtilization))
 *
 * @param params        IRM parameters read from chain (all in WAD per second).
 * @param utilization   Current utilization in WAD (1e18 = 100%).
 * @returns             Borrow rate per second in WAD.
 */
export function computeBorrowRate(
  params: IRMParams,
  utilization: bigint
): bigint {
  const { baseRate, slope1, slope2, optimalUtilization } = params;

  // Clamp utilization to [0, WAD] to guard against malformed chain data.
  const u = clampBigInt(utilization, 0n, WAD);

  if (u <= optimalUtilization) {
    // Below or at kink: linear interpolation on slope1.
    // Guard against division by zero when optimalUtilization is 0.
    const slopeComponent =
      optimalUtilization === 0n ? 0n : (u * slope1) / optimalUtilization;
    return baseRate + slopeComponent;
  }

  // Above kink: base + full slope1 + additional slope2 segment.
  const excessUtilization = u - optimalUtilization;
  const remainingRange = WAD - optimalUtilization;
  // Guard against division by zero when optimalUtilization == WAD.
  const slopeComponent2 =
    remainingRange === 0n ? 0n : (excessUtilization * slope2) / remainingRange;

  return baseRate + slope1 + slopeComponent2;
}

/**
 * Compute the annualised supply APY as a decimal number (0.05 = 5%).
 *
 * Steps:
 *   1. borrowRate = computeBorrowRate(params, utilization)
 *   2. supplyRate  = borrowRate * utilization / WAD  (WAD-scaled rate per sec)
 *   3. APY         = (1 + supplyRate / SECONDS_PER_YEAR) ^ SECONDS_PER_YEAR - 1
 *
 * Compound interest formula with per-second compounding matches on-chain
 * Morpho Blue accrual semantics.
 *
 * @param params        IRM parameters.
 * @param utilization   Utilization in WAD (1e18 = 100%).
 * @returns             Supply APY as a plain float (e.g. 0.05 for 5%).
 */
export function computeSupplyAPY(
  params: IRMParams,
  utilization: bigint
): number {
  const borrowRate = computeBorrowRate(params, utilization);

  // supplyRate (WAD per second) = borrowRate * utilization / WAD
  const supplyRateWad = (borrowRate * utilization) / WAD;

  // Convert to a plain float before raising to the power of SECONDS_PER_YEAR.
  // We use Number() here intentionally — the rate per second is tiny
  // (e.g. ~1e-9 for a 5% APY) so float64 precision is sufficient.
  const supplyRatePerSecond = Number(supplyRateWad) / 1e18;
  const secondsPerYear = Number(SECONDS_PER_YEAR);

  // Compound APY: (1 + r)^n - 1
  return Math.pow(1 + supplyRatePerSecond, secondsPerYear) - 1;
}

/**
 * Project the new utilization after changing the supplied amount by a delta.
 *
 * newSupply      = currentSupply + supplyDelta  (supplyDelta may be negative)
 * newUtilization = currentBorrow * WAD / newSupply
 *
 * Guard: if newSupply <= 0, returns WAD (100% utilization) to represent a
 * fully-borrowed-out market that should not receive additional allocations.
 *
 * @param currentSupply   Current total supply assets in the market (WAD units).
 * @param currentBorrow   Current total borrow assets in the market (WAD units).
 * @param supplyDelta     Change in supply (positive = add, negative = remove).
 * @returns               Projected utilization in WAD (1e18 = 100%).
 */
export function projectUtilization(
  currentSupply: bigint,
  currentBorrow: bigint,
  supplyDelta: bigint
): bigint {
  const newSupply = currentSupply + supplyDelta;

  if (newSupply <= 0n) {
    // Fully utilized or supply would go negative — treat as 100% utilization.
    return WAD;
  }

  // Clamp result to WAD so utilization never exceeds 100% in projections.
  const projected = (currentBorrow * WAD) / newSupply;
  return clampBigInt(projected, 0n, WAD);
}

/**
 * Project supply APY for a given candidate allocation delta.
 *
 * Convenience composition of projectUtilization + computeSupplyAPY.
 *
 * @param params          IRM parameters.
 * @param currentSupply   Current total supply assets.
 * @param currentBorrow   Current total borrow assets.
 * @param supplyDelta     Proposed change in supply (positive = allocate).
 * @returns               Projected supply APY as a plain float.
 */
export function projectSupplyAPY(
  params: IRMParams,
  currentSupply: bigint,
  currentBorrow: bigint,
  supplyDelta: bigint
): number {
  const utilization = projectUtilization(
    currentSupply,
    currentBorrow,
    supplyDelta
  );
  return computeSupplyAPY(params, utilization);
}
