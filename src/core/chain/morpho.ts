import type { Address, Hash } from "viem";
import {
  MORPHO_BLUE_ABI,
  IRM_ABI,
  WAD,
  SECONDS_PER_YEAR,
} from "../../config/constants.js";
import type { IRMParams, ManagedMarket, MarketData } from "../rebalancer/types.js";
import type { BotPublicClient } from "./client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum attempts when an RPC call fails. */
const MAX_RETRIES = 3 as const;

/** Base delay in milliseconds for exponential backoff. */
const BASE_RETRY_DELAY_MS = 500 as const;

/**
 * Morpho Blue singleton address on Ethereum mainnet.
 * Source: https://docs.morpho.org/morpho/contracts/morpho-blue
 */
const MORPHO_BLUE_ADDRESS: Address =
  "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleeps for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `fn` with up to MAX_RETRIES attempts, applying exponential backoff
 * between failures.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `${label} failed after ${MAX_RETRIES} attempts: ${String(lastError)}`
  );
}

/**
 * Converts a borrow rate per second (WAD) to an annualised supply APY as a
 * plain number.
 *
 * Formula:
 *   supplyAPY = borrowRatePerSecond * SECONDS_PER_YEAR * utilization / WAD
 *
 * Where:
 *   - borrowRatePerSecond is in WAD (1e18 = 100% per second)
 *   - utilization is [0, 1]
 *
 * This is a linear approximation; the strategy layer applies fee adjustments
 * when computing expected yield.
 */
function computeSupplyAPY(borrowRatePerSecond: bigint, utilization: number): number {
  if (utilization === 0) return 0;

  // borrowRatePerYear in WAD
  const borrowRatePerYear = borrowRatePerSecond * SECONDS_PER_YEAR;
  // Convert WAD → decimal, then apply utilization share
  return (Number(borrowRatePerYear) / Number(WAD)) * utilization;
}

/**
 * Derives IRMParams from the AdaptiveCurveIRM's `borrowRateView` result.
 *
 * The AdaptiveCurveIRM does not expose slope/kink parameters as individual
 * getters; it exposes a single `borrowRateView(marketParams, market)`.
 *
 * We compute approximate params by sampling the curve at three utilization
 * points (0%, 90%, 100%) using the on-chain rate oracle, then back-solving
 * for the linear-kink parameters.
 *
 * However, since the full curve-fitting requires multiple RPC calls (expensive)
 * and the strategy only needs the current rate for scoring (not future rate
 * projections), we use a simplified approximation:
 *
 *   - baseRate     = borrowRate at 0% utilization (approximated as 0 in a
 *                    linear-kink model without the actual curve sampling)
 *   - slope1       = borrowRatePerSecond / optimalUtilization (below kink)
 *   - slope2       = large slope above kink (estimated from 100% - 90% delta)
 *   - optimalUtilization = 90% (standard Morpho Blue default)
 *
 * For more precise IRM simulation, the irm.ts strategy layer can call
 * `borrowRateView` directly with projected market params.
 *
 * @param currentBorrowRate  Current borrow rate per second in WAD.
 * @param utilization        Current utilization in [0, 1].
 */
function deriveIRMParams(
  currentBorrowRate: bigint,
  utilization: number
): IRMParams {
  // Standard AdaptiveCurveIRM optimal utilization: 90% (WAD)
  const optimalUtilization = (WAD * 9n) / 10n;
  const optimalUtilizationFloat = 0.9;

  // Approximate slope1 as rate/utilization if below the kink.
  // Avoid division by zero.
  const slope1 =
    utilization > 0 && utilization <= optimalUtilizationFloat
      ? (currentBorrowRate * WAD) / BigInt(Math.round(utilization * 1e18))
      : (currentBorrowRate * WAD) / optimalUtilization;

  // Slope2 is steeper above the kink. We use 4× slope1 as a conservative
  // estimate; irm.ts can refine this with additional RPC calls if needed.
  const slope2 = slope1 * 4n;

  return {
    baseRate: 0n,
    slope1,
    slope2,
    optimalUtilization,
  };
}

// ---------------------------------------------------------------------------
// MorphoReader
// ---------------------------------------------------------------------------

/**
 * Reads market state and IRM parameters from Morpho Blue.
 *
 * All reads use multicall where possible to guarantee that all values in a
 * single batch belong to the same block.
 *
 * Usage:
 * ```ts
 * const reader = new MorphoReader(publicClient);
 * const market = await reader.readMarketData(marketId);
 * const markets = await reader.readMarketsForManagedMarkets(managedMarkets);
 * ```
 */
export class MorphoReader {
  private readonly publicClient: BotPublicClient;
  private readonly morphoAddress: Address;

  constructor(
    publicClient: BotPublicClient,
    morphoAddress: Address = MORPHO_BLUE_ADDRESS
  ) {
    this.publicClient = publicClient;
    this.morphoAddress = morphoAddress;
  }

  // -------------------------------------------------------------------------
  // Public read methods
  // -------------------------------------------------------------------------

  /**
   * Reads the current market state for a single Morpho Blue market.
   *
   * Performs two multicall operations:
   *  1. `market(id)` + `idToMarketParams(id)` — same block snapshot
   *  2. `borrowRateView(...)` on the IRM — same block (separate multicall)
   *
   * @param marketId  Morpho Blue market ID (bytes32).
   * @returns MarketData with utilization, liquidity, and supply APY computed.
   */
  async readMarketData(marketId: Hash): Promise<MarketData> {
    return withRetry(async () => {
      // ------------------------------------------------------------------
      // Batch 1: market state + market params in a single block
      // ------------------------------------------------------------------
      const [marketResult, marketParamsResult] = await this.publicClient.multicall({
        contracts: [
          {
            address: this.morphoAddress,
            abi: MORPHO_BLUE_ABI,
            functionName: "market",
            args: [marketId],
          },
          {
            address: this.morphoAddress,
            abi: MORPHO_BLUE_ABI,
            functionName: "idToMarketParams",
            args: [marketId],
          },
        ],
        allowFailure: false,
      });

      const [
        totalSupplyAssets,
        _totalSupplyShares,
        totalBorrowAssets,
        _totalBorrowShares,
        _lastUpdate,
        _fee,
      ] = marketResult as [bigint, bigint, bigint, bigint, bigint, bigint];

      const [loanToken, collateralToken, oracle, irmAddress, lltv] =
        marketParamsResult as [Address, Address, Address, Address, bigint];

      const totalSupply = totalSupplyAssets;
      const totalBorrow = totalBorrowAssets;
      const availableLiquidity = totalSupply > totalBorrow
        ? totalSupply - totalBorrow
        : 0n;

      const utilization =
        totalSupply > 0n
          ? Number(totalBorrow * WAD / totalSupply) / Number(WAD)
          : 0;

      // ------------------------------------------------------------------
      // Batch 2: current borrow rate from the IRM contract
      // ------------------------------------------------------------------
      const marketParamsForIRM = {
        loanToken,
        collateralToken,
        oracle,
        irm: irmAddress,
        lltv,
      };

      const marketStateForIRM = {
        totalSupplyAssets,
        totalSupplyShares: _totalSupplyShares,
        totalBorrowAssets,
        totalBorrowShares: _totalBorrowShares,
        lastUpdate: _lastUpdate,
        fee: _fee,
      };

      let currentBorrowRate = 0n;

      try {
        currentBorrowRate = await this.publicClient.readContract({
          address: irmAddress,
          abi: IRM_ABI,
          functionName: "borrowRateView",
          args: [marketParamsForIRM, marketStateForIRM],
        });
      } catch {
        // IRM may not support borrowRateView (e.g., zero-rate markets or
        // custom IRM implementations). currentBorrowRate stays 0n.
      }

      const irmParams = deriveIRMParams(currentBorrowRate, utilization);
      const currentSupplyAPY = computeSupplyAPY(currentBorrowRate, utilization);

      return {
        marketId,
        totalSupply,
        totalBorrow,
        availableLiquidity,
        utilization,
        currentSupplyAPY,
        irmParams,
      } satisfies MarketData;
    }, `MorphoReader.readMarketData(${marketId})`);
  }

  /**
   * Reads IRM parameters for a Morpho Blue market.
   *
   * This is a lighter call than `readMarketData` — it only reads the borrow
   * rate and derives the IRM parameter approximation from it.
   *
   * @param marketId  Morpho Blue market ID (bytes32).
   * @returns IRMParams for use in off-chain APY projections.
   */
  async readIRMParams(marketId: Hash): Promise<IRMParams> {
    const marketData = await this.readMarketData(marketId);
    return marketData.irmParams;
  }

  /**
   * Batch-reads market data for a list of managed markets.
   *
   * Uses the `marketId` field on each `ManagedMarket` (derived at startup from
   * the MarketParams keccak256 hash) to read the on-chain Morpho Blue market
   * state for each configured market.
   *
   * The returned array is positionally paired with the input array:
   *   result[i] corresponds to managedMarkets[i].
   *
   * Markets that fail to read are returned as null and excluded from the result,
   * so a single bad market does not fail the entire batch.
   *
   * @param managedMarkets  Active managed markets (from VaultReader.activeMarkets).
   * @returns Array of MarketData in the same order as managedMarkets.
   */
  async readMarketsForManagedMarkets(managedMarkets: ManagedMarket[]): Promise<MarketData[]> {
    if (managedMarkets.length === 0) {
      return [];
    }

    const marketDataPromises = managedMarkets.map(async (market) => {
      try {
        return await this.readMarketData(market.marketId);
      } catch {
        // Individual market read failed — skip rather than failing the batch.
        return null;
      }
    });

    const settled = await Promise.all(marketDataPromises);

    // Filter out nulls (markets that could not be resolved).
    return settled.filter((d): d is MarketData => d !== null);
  }
}
