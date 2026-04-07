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

import { encodeAbiParameters } from "viem";
import {
  BPS_DENOMINATOR,
  WAD,
  MARKET_PARAMS_ABI_COMPONENTS,
} from "../../config/constants.js";
import { projectSupplyAPY } from "./irm.js";
import type {
  MarketAllocationState,
  MarketData,
  MarketParams,
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

/** Minimum score value — markets scoring at or below this are ignored. */
const MIN_SCORE = 0;

// ---------------------------------------------------------------------------
// Internal helper: encode MarketParams into ABI-encoded call data
// ---------------------------------------------------------------------------

/**
 * ABI-encodes a MarketParams struct into the `bytes data` argument expected by
 * vault.allocate and vault.deallocate.
 *
 * Construction: encodeAbiParameters([{ type: "tuple", components: [...] }], [marketParams])
 * NEVER returns "0x" — every allocate/deallocate call must include a market target.
 */
function encodeMarketParams(marketParams: MarketParams): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS }],
    [marketParams]
  );
}

// ---------------------------------------------------------------------------
// Exported helper: computeScore
// ---------------------------------------------------------------------------

/**
 * Compute a risk-adjusted score for a single market.
 *
 * Formula (SPEC B1):
 *   score = projected_APY × liquidity_safety_factor × (1 - concentration_penalty)
 *
 * Where:
 *   projected_APY           = APY after simulating the proposed allocation delta
 *   liquidity_safety_factor = min(1, availableLiquidity / (minLiquidityMultiplier × allocation))
 *   concentration_penalty   = max(0, (allocation / marketTotalSupply) - concentrationThreshold)
 *
 * Returns 0 for markets that fail the liquidity floor (i.e. available
 * liquidity < minLiquidityMultiplier × allocation).
 *
 * @param marketState  Current on-chain market allocation state.
 * @param market       Market data for the underlying Morpho Blue market.
 * @param allocation   Proposed allocation (in asset native decimals).
 * @param config       Strategy configuration.
 */
export function computeScore(
  marketState: MarketAllocationState,
  market: MarketData,
  allocation: bigint,
  config: StrategyConfig
): number {
  const { minLiquidityMultiplier, maxMarketConcentrationPct } = config;

  // --- Projected APY ----------------------------------------------------------
  // supplyDelta = proposed allocation minus current allocation for this market
  const supplyDelta = allocation - marketState.allocation;
  const projectedAPY = projectSupplyAPY(
    market.irmParams,
    market.totalSupply,
    market.totalBorrow,
    supplyDelta
  );

  if (projectedAPY <= MIN_SCORE) return MIN_SCORE;

  // --- Liquidity safety factor ------------------------------------------------
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
 * Clamp each market's target allocation to the MOST RESTRICTIVE of its 3 caps.
 *
 * Per PLAN.md § Cap units:
 *   - absoluteCap: hard ceiling in asset native decimals.
 *   - relativeCap: soft ceiling as a fraction of totalAssets in WAD (1e18 = 100%).
 *     - relativeCap == WAD → no relative cap (skip this clamp for that id).
 *     - relativeCap == 0n  → market forbidden; clamp target to 0.
 *
 * For each market, we compute the minimum permitted amount across all 3 cap ids.
 * Excess is silently capped.
 *
 * @param allocations   Proposed allocation map (market index → amount).
 * @param marketStates  Market allocation states carrying cap information.
 * @param totalAssets   Total vault assets (used to enforce relative caps).
 * @returns             New allocation map with all caps enforced.
 */
export function enforceCapConstraints(
  allocations: Map<number, bigint>,
  marketStates: MarketAllocationState[],
  totalAssets: bigint
): Map<number, bigint> {
  const result = new Map<number, bigint>();

  for (let i = 0; i < marketStates.length; i++) {
    const marketState = marketStates[i];
    if (marketState === undefined) continue;

    const proposed = allocations.get(i) ?? 0n;
    let capped = proposed;

    // Iterate all 3 cap ids — the most restrictive wins.
    for (const { absoluteCap, relativeCap } of marketState.caps) {
      // --- Absolute cap ---
      if (absoluteCap > 0n && capped > absoluteCap) {
        capped = absoluteCap;
      }

      // --- Relative cap (WAD units, not basis points) ---
      // relativeCap == WAD → no relative cap sentinel → skip this clamp.
      // relativeCap == 0n  → market forbidden → clamp to 0.
      if (relativeCap === 0n) {
        // Market forbidden — defensively clamp to 0.
        // (The bot should have refused to start — vault.ts assertStartupInvariants
        //  throws on this condition — but we handle it defensively here too.)
        capped = 0n;
        break;
      } else if (relativeCap !== WAD && totalAssets > 0n) {
        // Compute the relative cap amount: totalAssets * relativeCap / WAD
        const relativeCapAmount = (totalAssets * relativeCap) / WAD;
        if (capped > relativeCapAmount) {
          capped = relativeCapAmount;
        }
      }
      // relativeCap == WAD → no clamp needed for this id.
    }

    result.set(i, capped);
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
 * @param current        Current allocation for a market.
 * @param target         Target allocation for a market.
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
 * Build a positional lookup table: market index → MarketData.
 *
 * ChainReader populates VaultState such that state.marketStates[i] corresponds
 * to state.marketData[i]. We preserve that positional mapping here.
 */
function buildMarketDataMap(
  marketStates: MarketAllocationState[],
  marketDataArray: MarketData[]
): Map<number, MarketData> {
  const map = new Map<number, MarketData>();
  for (let i = 0; i < marketStates.length; i++) {
    const data = marketDataArray[i];
    if (data !== undefined) {
      map.set(i, data);
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
 *   1. Score each market using projected post-rebalance APY, liquidity
 *      safety factor, and concentration penalty.
 *   2. Compute proportional target allocations from relative scores.
 *   3. Enforce cap constraints per-market using the most restrictive of the
 *      3 cap ids (absolute + WAD-based relative caps).
 *   4. Compute per-market deltas (target − current).
 *   5. Filter out markets whose |delta| is within the drift threshold.
 *      Exception: if relativeCap == 0 and market has allocation, always emit
 *      a deallocate action.
 *   6. Return deallocate actions first, then allocate actions.
 *
 * Returns an empty array when no market exceeds the drift threshold, or when
 * inputs are invalid.
 *
 * @param state   Complete vault snapshot from ChainReader.
 * @param config  Strategy configuration.
 */
export function computeRebalance(
  state: VaultState,
  config: StrategyConfig
): RebalanceAction[] {
  const { marketStates, marketData, totalAssets, adapterAddress } = state;

  if (marketStates.length === 0 || totalAssets === 0n) return [];

  // Build positional market index → MarketData lookup.
  const marketDataMap = buildMarketDataMap(marketStates, marketData);

  // -------------------------------------------------------------------------
  // Step 1: Score each market
  // -------------------------------------------------------------------------
  const scores = new Map<number, number>();

  for (let i = 0; i < marketStates.length; i++) {
    const marketState = marketStates[i];
    if (marketState === undefined) continue;

    const data = marketDataMap.get(i);
    if (data === undefined) {
      // No market data — score zero, market will not receive new allocation.
      scores.set(i, 0);
      continue;
    }

    // Use current allocation as the candidate allocation for scoring.
    const score = computeScore(marketState, data, marketState.allocation, config);
    scores.set(i, score);
  }

  // -------------------------------------------------------------------------
  // Step 2: Proportional target allocations
  // -------------------------------------------------------------------------
  const totalScore = Array.from(scores.values()).reduce((s, v) => s + v, 0);

  const rawTargets = new Map<number, bigint>();

  if (totalScore <= 0) {
    // All scores are zero — distribute equally among markets.
    const equalShare = totalAssets / BigInt(marketStates.length);
    for (let i = 0; i < marketStates.length; i++) {
      rawTargets.set(i, equalShare);
    }
  } else {
    for (let i = 0; i < marketStates.length; i++) {
      const score = scores.get(i) ?? 0;
      // target = totalAssets × (score / totalScore)
      // Scale score by 1e18 to retain precision in bigint integer division.
      const scoreScaled = BigInt(Math.round(score * 1e18));
      const totalScoreScaled = BigInt(Math.round(totalScore * 1e18));
      const target =
        totalScoreScaled > 0n
          ? (totalAssets * scoreScaled) / totalScoreScaled
          : 0n;
      rawTargets.set(i, target);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Enforce cap constraints (most restrictive of 3 cap ids, WAD math)
  // -------------------------------------------------------------------------
  const cappedTargets = enforceCapConstraints(rawTargets, marketStates, totalAssets);

  // -------------------------------------------------------------------------
  // Step 4 & 5: Compute deltas and filter by drift threshold
  // -------------------------------------------------------------------------
  const deallocateActions: RebalanceAction[] = [];
  const allocateActions: RebalanceAction[] = [];

  for (let i = 0; i < marketStates.length; i++) {
    const marketState = marketStates[i];
    if (marketState === undefined) continue;

    const current = marketState.allocation;
    const target = cappedTargets.get(i) ?? 0n;

    // Special case: relativeCap == 0 on any cap means market is forbidden.
    // If there is any existing allocation, emit a deallocate action regardless
    // of the drift threshold.
    const isForbidden = marketState.caps.some((cap) => cap.relativeCap === 0n);
    if (isForbidden && current > 0n) {
      const encodedData = encodeMarketParams(marketState.market.marketParams);
      deallocateActions.push({
        adapter: adapterAddress,
        marketLabel: marketState.market.label,
        direction: "deallocate",
        amount: current,
        data: encodedData,
      });
      continue;
    }

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

    const encodedData = encodeMarketParams(marketState.market.marketParams);

    if (current > target) {
      // Overweight — deallocate.
      const amount = current - target;
      deallocateActions.push({
        adapter: adapterAddress,
        marketLabel: marketState.market.label,
        direction: "deallocate",
        amount,
        data: encodedData,
      });
    } else {
      // Underweight — allocate.
      const amount = target - current;
      allocateActions.push({
        adapter: adapterAddress,
        marketLabel: marketState.market.label,
        direction: "allocate",
        amount,
        data: encodedData,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Deallocates must precede allocates (SPEC B2)
  // -------------------------------------------------------------------------
  return [...deallocateActions, ...allocateActions];
}
