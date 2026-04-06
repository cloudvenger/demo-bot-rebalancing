/**
 * strategy.ts — Pure scoring, delta computation, cap enforcement, and drift
 * detection for the Morpho V2 rebalancing bot.
 *
 * All functions are pure: no async, no RPC calls, no side effects.
 * Input: on-chain state objects already read by ChainReader.
 * Output: ordered RebalanceAction[].
 *
 * Import restrictions: only types.ts, constants.ts, and irm.ts.
 */

import type { Address } from "viem";
import { BPS_DENOMINATOR } from "../../config/constants.js";
import { projectSupplyAPY } from "./irm.js";
import type {
  AdapterState,
  MarketData,
  RebalanceAction,
  StrategyConfig,
  VaultState,
} from "./types.js";

// ---------------------------------------------------------------------------
// Named constants — no magic numbers
// ---------------------------------------------------------------------------

/** Maximum achievable liquidity safety factor (capped at 1). */
const MAX_LIQUIDITY_SAFETY_FACTOR = 1;

/** Floor for concentration penalty so it never goes below zero. */
const MIN_CONCENTRATION_PENALTY = 0;

/** Minimum score value — adapters scoring at or below this are ignored. */
const MIN_SCORE = 0;

// ---------------------------------------------------------------------------
// Exported helper: computeScore
// ---------------------------------------------------------------------------

/**
 * Compute a risk-adjusted score for a single adapter + market pair.
 *
 * Formula (SPEC B1):
 *   score = projected_APY × liquidity_safety_factor × (1 - concentration_penalty)
 *
 * Where:
 *   projected_APY           = APY after simulating the proposed allocation delta
 *   liquidity_safety_factor = min(1, availableLiquidity / (minLiquidityMultiplier × allocation))
 *   concentration_penalty   = max(0, (allocation / marketTotalSupply) - concentrationThreshold)
 *
 * Returns 0 for adapters that fail the liquidity floor (i.e. available
 * liquidity < minLiquidityMultiplier × allocation).
 *
 * @param adapter     Current on-chain adapter state.
 * @param market      Market data for the adapter's underlying market.
 * @param allocation  Proposed allocation (in asset native decimals).
 * @param config      Strategy configuration.
 */
export function computeScore(
  adapter: AdapterState,
  market: MarketData,
  allocation: bigint,
  config: StrategyConfig
): number {
  const { minLiquidityMultiplier, maxMarketConcentrationPct } = config;

  // --- Projected APY ----------------------------------------------------------
  // supplyDelta = proposed allocation minus current allocation for this adapter
  const supplyDelta = allocation - adapter.realAssets;
  const projectedAPY = projectSupplyAPY(
    market.irmParams,
    market.totalSupply,
    market.totalBorrow,
    supplyDelta
  );

  if (projectedAPY <= MIN_SCORE) return MIN_SCORE;

  // --- Liquidity safety factor ------------------------------------------------
  // liquidityFloor = minLiquidityMultiplier × allocation (in asset units)
  // We compare bigint values, then convert to Number for the final factor.
  const allocationNum = Number(allocation);
  const availableLiquidityNum = Number(market.availableLiquidity);

  let liquiditySafetyFactor: number;
  if (allocationNum === 0) {
    // Zero allocation — no liquidity risk.
    liquiditySafetyFactor = MAX_LIQUIDITY_SAFETY_FACTOR;
  } else {
    const liquidityFloor = minLiquidityMultiplier * allocationNum;
    liquiditySafetyFactor = Math.min(
      MAX_LIQUIDITY_SAFETY_FACTOR,
      availableLiquidityNum / liquidityFloor
    );
  }

  // --- Concentration penalty --------------------------------------------------
  // concentrationThreshold as a decimal (e.g. 10% → 0.10)
  const concentrationThreshold = maxMarketConcentrationPct / 100;
  const totalSupplyNum = Number(market.totalSupply);

  let rawConcentration = 0;
  if (totalSupplyNum > 0) {
    rawConcentration = allocationNum / totalSupplyNum;
  }

  const concentrationPenalty = Math.max(
    MIN_CONCENTRATION_PENALTY,
    rawConcentration - concentrationThreshold
  );

  return projectedAPY * liquiditySafetyFactor * (1 - concentrationPenalty);
}

// ---------------------------------------------------------------------------
// Exported helper: enforceCapConstraints
// ---------------------------------------------------------------------------

/**
 * Clamp each adapter's target allocation to its absolute and relative caps.
 * Excess is silently capped — callers are responsible for redistributing or
 * leaving it idle (outside scope of this helper).
 *
 * @param allocations   Proposed allocation map (adapter address → amount).
 * @param adapters      Adapter states carrying cap information.
 * @param totalAssets   Total vault assets (used to enforce relative caps).
 * @returns             New allocation map with all caps enforced.
 */
export function enforceCapConstraints(
  allocations: Map<Address, bigint>,
  adapters: AdapterState[],
  totalAssets: bigint
): Map<Address, bigint> {
  const result = new Map<Address, bigint>();

  for (const adapter of adapters) {
    const proposed = allocations.get(adapter.address) ?? 0n;

    // --- Absolute cap ---
    let capped = proposed;
    if (adapter.absoluteCap > 0n && capped > adapter.absoluteCap) {
      capped = adapter.absoluteCap;
    }

    // --- Relative cap ---
    // relativeCap is stored in basis points (e.g. 5000 = 50%).
    if (adapter.relativeCap > 0 && totalAssets > 0n) {
      const relativeCapAmount =
        (totalAssets * BigInt(adapter.relativeCap)) /
        BigInt(BPS_DENOMINATOR);
      if (capped > relativeCapAmount) {
        capped = relativeCapAmount;
      }
    }

    result.set(adapter.address, capped);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exported helper: isWithinDriftThreshold
// ---------------------------------------------------------------------------

/**
 * Return true when the absolute drift between current and target is below the
 * configured threshold (expressed in basis points of total assets).
 *
 * @param current        Current allocation for an adapter.
 * @param target         Target allocation for an adapter.
 * @param total          Total vault assets.
 * @param thresholdBps   Drift threshold in basis points.
 */
export function isWithinDriftThreshold(
  current: bigint,
  target: bigint,
  total: bigint,
  thresholdBps: number
): boolean {
  if (total === 0n) return true;

  const delta = current > target ? current - target : target - current;
  // delta / total compared against thresholdBps / BPS_DENOMINATOR
  // Rearranged: delta * BPS_DENOMINATOR <= total * thresholdBps
  return delta * BigInt(BPS_DENOMINATOR) <= total * BigInt(thresholdBps);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a positional lookup table: adapter address → MarketData.
 *
 * ChainReader populates VaultState such that state.adapters[i] corresponds to
 * state.markets[i].  We preserve that mapping here.
 */
function buildAdapterMarketMap(
  adapters: AdapterState[],
  markets: MarketData[]
): Map<Address, MarketData> {
  const map = new Map<Address, MarketData>();
  for (let i = 0; i < adapters.length; i++) {
    const market = markets[i];
    if (market !== undefined) {
      map.set(adapters[i].address, market);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main exported function: computeRebalance
// ---------------------------------------------------------------------------

/**
 * Compute the ordered list of rebalance actions for a given vault snapshot.
 *
 * Steps:
 *   1. Score each adapter using projected post-rebalance APY, liquidity
 *      safety factor, and concentration penalty.
 *   2. Compute proportional target allocations from relative scores.
 *   3. Enforce absolute and relative cap constraints (clamp, no redistribution).
 *   4. Compute per-adapter deltas (target − current).
 *   5. Filter out adapters whose |delta| is within the drift threshold.
 *   6. Return deallocate actions first, then allocate actions.
 *
 * Returns an empty array when no adapter exceeds the drift threshold, or when
 * inputs are invalid.
 *
 * @param state   Complete vault snapshot from ChainReader.
 * @param config  Strategy configuration.
 */
export function computeRebalance(
  state: VaultState,
  config: StrategyConfig
): RebalanceAction[] {
  const { adapters, markets, totalAssets } = state;

  if (adapters.length === 0 || totalAssets === 0n) return [];

  // Build positional adapter → market lookup.
  const adapterMarketMap = buildAdapterMarketMap(adapters, markets);

  // -------------------------------------------------------------------------
  // Step 1: Score each adapter
  // -------------------------------------------------------------------------
  const scores = new Map<Address, number>();

  for (const adapter of adapters) {
    const market = adapterMarketMap.get(adapter.address);
    if (market === undefined) {
      // No market data — score zero, adapter will not receive new allocation.
      scores.set(adapter.address, 0);
      continue;
    }

    // Use current allocation as the candidate allocation for scoring.
    const score = computeScore(adapter, market, adapter.realAssets, config);
    scores.set(adapter.address, score);
  }

  // -------------------------------------------------------------------------
  // Step 2: Proportional target allocations
  // -------------------------------------------------------------------------
  const totalScore = Array.from(scores.values()).reduce((s, v) => s + v, 0);

  const rawTargets = new Map<Address, bigint>();

  if (totalScore <= 0) {
    // All scores are zero — distribute equally among adapters that have caps.
    const equalShare = totalAssets / BigInt(adapters.length);
    for (const adapter of adapters) {
      rawTargets.set(adapter.address, equalShare);
    }
  } else {
    for (const adapter of adapters) {
      const score = scores.get(adapter.address) ?? 0;
      // target = totalAssets × (score / totalScore)
      // Scale score by 1e18 to retain precision in bigint integer division.
      const scoreScaled = BigInt(Math.round(score * 1e18));
      const totalScoreScaled = BigInt(Math.round(totalScore * 1e18));
      const target =
        totalScoreScaled > 0n
          ? (totalAssets * scoreScaled) / totalScoreScaled
          : 0n;
      rawTargets.set(adapter.address, target);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Enforce cap constraints
  // -------------------------------------------------------------------------
  const cappedTargets = enforceCapConstraints(rawTargets, adapters, totalAssets);

  // -------------------------------------------------------------------------
  // Step 4 & 5: Compute deltas and filter by drift threshold
  // -------------------------------------------------------------------------
  const deallocateActions: RebalanceAction[] = [];
  const allocateActions: RebalanceAction[] = [];

  for (const adapter of adapters) {
    const current = adapter.realAssets;
    const target = cappedTargets.get(adapter.address) ?? 0n;

    if (
      isWithinDriftThreshold(
        current,
        target,
        totalAssets,
        config.driftThresholdBps
      )
    ) {
      continue;
    }

    if (current > target) {
      // Overweight — deallocate.
      const amount = current - target;
      deallocateActions.push({
        adapter: adapter.address,
        direction: "deallocate",
        amount,
        data: "0x",
      });
    } else {
      // Underweight — allocate.
      const amount = target - current;
      allocateActions.push({
        adapter: adapter.address,
        direction: "allocate",
        amount,
        data: "0x",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Deallocates must precede allocates (SPEC B2)
  // -------------------------------------------------------------------------
  return [...deallocateActions, ...allocateActions];
}
