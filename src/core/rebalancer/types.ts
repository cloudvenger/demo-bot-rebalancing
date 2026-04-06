import type { Address, Hash, Hex } from "viem";

// ---------------------------------------------------------------------------
// IRM (Interest Rate Model) parameters
// ---------------------------------------------------------------------------

/**
 * Parameters read from a Morpho Blue IRM contract once per rebalance cycle.
 * Used by the strategy to simulate projected post-rebalance APY off-chain.
 *
 * All rate values are in WAD per second (1e18 = 100% per second) as returned
 * by AdaptiveCurveIRM / LinearKinkIRM on-chain.
 */
export interface IRMParams {
  /** Base borrow rate at 0% utilization (WAD per second) */
  baseRate: bigint;

  /**
   * Rate slope below the optimal utilization kink point (WAD per second per
   * unit of utilization).
   */
  slope1: bigint;

  /**
   * Rate slope above the optimal utilization kink point (WAD per second per
   * unit of utilization).  Much steeper than slope1.
   */
  slope2: bigint;

  /**
   * Utilization rate at the kink point (WAD — 1e18 = 100%).
   * Also referred to as the "target utilization" or "optimal utilization".
   */
  optimalUtilization: bigint;
}

// ---------------------------------------------------------------------------
// Adapter state
// ---------------------------------------------------------------------------

/** Discriminated type tag for the two supported adapter types. */
export type AdapterType = "morpho-market-v1" | "morpho-vault-v1";

/**
 * Current on-chain state for a single vault adapter.
 * Populated by ChainReader.readVaultState().
 */
export interface AdapterState {
  /** Adapter contract address */
  address: Address;

  /** Adapter type, derived from the adapter factory that deployed it */
  adapterType: AdapterType;

  /**
   * Current assets held through this adapter, as reported by
   * `adapter.realAssets()`.  Denominated in the vault's underlying asset
   * (USDC, 6 decimals).
   */
  realAssets: bigint;

  /**
   * `realAssets / totalAssets` — computed by ChainReader, not read on-chain.
   * Range: [0, 1].
   */
  allocationPercentage: number;

  /**
   * Maximum absolute asset amount allowed in this adapter.
   * Source: `vault.caps(riskId).absoluteCap`.
   * Denominated in the vault's underlying asset.
   */
  absoluteCap: bigint;

  /**
   * Maximum allocation as a fraction of vault total assets, expressed in
   * basis points (e.g., 5000 = 50%).
   * Source: `vault.caps(riskId).relativeCap`.
   */
  relativeCap: number;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

/**
 * Current on-chain market state for a Morpho Blue market, enriched with a
 * derived supply APY.
 * Populated by ChainReader.readMarketData().
 */
export interface MarketData {
  /** Morpho Blue market identifier (keccak256 hash of MarketParams) */
  marketId: Hash;

  /**
   * Total assets supplied to the market.
   * Source: `morpho.market(id).totalSupplyAssets`.
   */
  totalSupply: bigint;

  /**
   * Total assets borrowed from the market.
   * Source: `morpho.market(id).totalBorrowAssets`.
   */
  totalBorrow: bigint;

  /**
   * Assets available to withdraw: `totalSupply - totalBorrow`.
   * Derived in ChainReader, not read on-chain.
   */
  availableLiquidity: bigint;

  /**
   * Current borrow utilization: `totalBorrow / totalSupply`.
   * Range: [0, 1].  0 when totalSupply is 0.
   */
  utilization: number;

  /**
   * Current annualised supply APY, derived from IRM parameters and current
   * utilization.  Range: [0, ∞).
   */
  currentSupplyAPY: number;

  /** IRM parameters read from the market's IRM contract this cycle. */
  irmParams: IRMParams;
}

// ---------------------------------------------------------------------------
// Rebalance action
// ---------------------------------------------------------------------------

/**
 * A single on-chain operation to be submitted by the Executor.
 * Strategy produces a list of these; Executor serialises and submits them.
 */
export interface RebalanceAction {
  /** Target adapter address */
  adapter: Address;

  /**
   * Direction of the capital flow:
   *   - `"deallocate"` — pull assets from adapter back to the vault idle pool
   *   - `"allocate"`   — push assets from the vault idle pool into the adapter
   *
   * Deallocates must always be submitted before allocates.
   */
  direction: "allocate" | "deallocate";

  /**
   * Amount of underlying asset to move, in the asset's native decimals
   * (e.g., USDC: 6 decimals).
   */
  amount: bigint;

  /**
   * ABI-encoded call data passed to the vault's allocate/deallocate function:
   *   - Market adapters: ABI-encoded MarketParams struct
   *   - Vault adapters:  `"0x"` (empty bytes)
   */
  data: Hex;
}

// ---------------------------------------------------------------------------
// Strategy configuration
// ---------------------------------------------------------------------------

/**
 * Runtime-configurable parameters that govern the rebalancing strategy.
 * Derived from validated env vars at startup.
 */
export interface StrategyConfig {
  /**
   * Minimum allocation drift in basis points before a rebalance is triggered.
   * Default: 500 (5%).  Source: `DRIFT_THRESHOLD_BPS`.
   */
  driftThresholdBps: number;

  /**
   * Maximum gas price in gwei.  Transactions are skipped when the network
   * gas price exceeds this value.  Source: `GAS_CEILING_GWEI`.
   */
  gasCeilingGwei: number;

  /**
   * Maximum allocation to any single market as a percentage of that market's
   * total supply.  Limits rate impact.  Default: 10.
   * Source: `MAX_MARKET_CONCENTRATION_PCT`.
   */
  maxMarketConcentrationPct: number;

  /**
   * Minimum required available market liquidity as a multiple of the bot's
   * potential allocation to that market.  Default: 2.
   * Source: `MIN_LIQUIDITY_MULTIPLIER`.
   */
  minLiquidityMultiplier: number;

  /**
   * When true, strategy actions are logged but no transactions are submitted.
   * Source: `DRY_RUN`.
   */
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Vault state (aggregate snapshot)
// ---------------------------------------------------------------------------

/**
 * Complete vault snapshot captured by ChainReader at the start of a
 * rebalance cycle.  All fields reflect a consistent on-chain state.
 */
export interface VaultState {
  /** Vault contract address */
  vaultAddress: Address;

  /**
   * Total assets under management.
   * Source: `vault.totalAssets()`.
   */
  totalAssets: bigint;

  /** Current state for every enabled adapter on the vault. */
  adapters: AdapterState[];

  /** Market data for every market underlying the enabled adapters. */
  markets: MarketData[];
}

// ---------------------------------------------------------------------------
// Rebalance result
// ---------------------------------------------------------------------------

/**
 * Result returned by the Executor after a completed rebalance cycle.
 * Stored in-memory by RebalanceService and exposed via the API.
 */
export interface RebalanceResult {
  /** Ordered list of on-chain actions that were computed (and executed, unless dry-run). */
  actions: RebalanceAction[];

  /**
   * Transaction hashes for submitted transactions.
   * Empty array when `dryRun` is true or when no actions were needed.
   */
  txHashes: Hash[];

  /**
   * Post-rebalance allocation percentages per adapter.
   * Computed from on-chain state after the transactions confirm.
   */
  newAllocations: Array<{ adapter: Address; percentage: number }>;

  /** ISO-8601 timestamp of when this rebalance cycle completed. */
  timestamp: string;
}
