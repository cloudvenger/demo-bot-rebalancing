/**
 * engine.ts — Orchestrates the pure rebalancing computation.
 *
 * This module is the single entry point that RebalanceService calls.  It
 * validates inputs and delegates to computeRebalance in strategy.ts.
 *
 * All functions are pure: no async, no RPC calls, no side effects.
 * Import restrictions: only types.ts and strategy.ts (which in turn imports
 * irm.ts and constants.ts).
 */

import { computeRebalance } from "./strategy.js";
import type { RebalanceAction, StrategyConfig, VaultState } from "./types.js";

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

/** Minimum number of managed markets required to attempt a rebalance. */
const MIN_MARKET_COUNT = 1;

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

/**
 * Compute the ordered set of rebalance actions for the current vault snapshot.
 *
 * Validates that:
 *   - totalAssets is non-zero
 *   - at least one managed market is present in marketStates
 *
 * Returns an empty array (never throws) when inputs are invalid or when no
 * rebalance is needed (all markets within drift threshold).
 *
 * Deallocate actions are guaranteed to precede allocate actions in the
 * returned array, matching the on-chain execution requirement (SPEC B2).
 *
 * @param state   Complete vault snapshot from ChainReader.
 * @param config  Strategy configuration derived from env vars.
 * @returns       Ordered RebalanceAction[]. Empty when no action is needed.
 */
export function computeRebalanceActions(
  state: VaultState,
  config: StrategyConfig
): RebalanceAction[] {
  // --- Input validation — return empty on invalid state, never throw ---
  if (state.totalAssets === 0n) {
    return [];
  }

  if (state.marketStates.length < MIN_MARKET_COUNT) {
    return [];
  }

  return computeRebalance(state, config);
}
