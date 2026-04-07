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
// Market types
// ---------------------------------------------------------------------------

/**
 * On-chain Morpho Blue market params struct.
 * Used both as the market identifier and as the ABI-encoded call-data payload
 * for vault.allocate / vault.deallocate calls.
 *
 * Source: PLAN.md § Domain Types → MarketParams
 */
export interface MarketParams {
  /** ERC-20 loan token — must equal the vault's underlying asset */
  loanToken: Address;
  /** ERC-20 collateral token */
  collateralToken: Address;
  /** Morpho oracle address */
  oracle: Address;
  /** Interest Rate Model address (must be AdaptiveCurveIRM for V1 adapter) */
  irm: Address;
  /**
   * Loan-to-value threshold in WAD (1e18 = 100%).
   * Must be bigint — not number — to preserve uint256 precision.
   */
  lltv: bigint;
}

/**
 * A Morpho Blue market the operator has configured the bot to manage.
 * The market list is read from the MANAGED_MARKETS_PATH JSON file at startup;
 * there is no per-vault enumeration in Morpho Vault V2.
 *
 * Source: PLAN.md § Domain Types → ManagedMarket
 */
export interface ManagedMarket {
  /** Human-readable label for logs and Telegram alerts, e.g. "USDC/WETH 86%" */
  label: string;

  /** On-chain MarketParams struct — passed as ABI-encoded data in every allocate/deallocate call */
  marketParams: MarketParams;

  /**
   * Morpho Blue market id: keccak256(abi.encode(marketParams)).
   * Computed off-chain at startup from MarketParams.
   */
  marketId: Hash;

  /**
   * The 3 cap ids the MorphoMarketV1AdapterV2 exposes for this market via
   * `adapter.ids(marketParams)`.  All 3 must have absoluteCap > 0 on the vault
   * for vault.allocate to succeed.
   *
   * Derived cap-id preimages (see PLAN.md § Verified cap-id preimages):
   *   id[0]: keccak256(abi.encode("this", adapter))            — adapter-wide
   *   id[1]: keccak256(abi.encode("collateralToken", collateralToken)) — per collateral token
   *   id[2]: keccak256(abi.encode("this/marketParams", adapter, marketParams)) — market-specific
   *
   * Populated by VaultReader at startup (Group 8.2) by calling
   * adapter.ids(marketParams) and asserting the locally computed ids match.
   * Starts as an empty array until VaultReader fills it.
   */
  capIds: Hash[];
}

// ---------------------------------------------------------------------------
// Per-market on-chain snapshot
// ---------------------------------------------------------------------------

/**
 * Per-market on-chain allocation state read each rebalance cycle.
 *
 * Source: PLAN.md § Domain Types → MarketAllocationState
 *
 * Cap units note (see PLAN.md § Cap units):
 *   - absoluteCap: uint256 in the vault asset's native decimals (e.g. USDC: 6 dec)
 *   - relativeCap: uint256 in WAD (1e18 = 100%). NOT basis points.
 *     - relativeCap == WAD (1e18) means "no relative cap" — relies on absoluteCap only.
 *     - relativeCap == 0n means "allocation must be 0" — effectively forbids the market.
 *       The bot refuses to start if any managed market has relativeCap == 0 on any id.
 *   Both must remain bigint — do not cast relativeCap to Number (WAD values lose precision).
 */
export interface MarketAllocationState {
  /** The managed market this state refers to */
  market: ManagedMarket;

  /**
   * Current assets allocated to this market.
   * Source: vault.allocation(marketSpecificId) where
   * marketSpecificId = market.capIds[2] (the market-specific cap id).
   */
  allocation: bigint;

  /**
   * allocation / totalAssets — computed in ChainReader, not read on-chain.
   * Range: [0, 1].
   */
  allocationPercentage: number;

  /**
   * One cap entry per id in market.capIds (exactly 3 entries).
   * Every id is checked by vault.allocate — the most restrictive cap wins.
   *
   * Cap units (see PLAN.md § Cap units):
   *   - absoluteCap: uint256 in asset native decimals. Must be > 0 for allocate to succeed.
   *   - relativeCap: uint256 in WAD (1e18 = 100%), NOT basis points.
   *                  WAD sentinel = "no relative cap".  0n = "market forbidden".
   */
  caps: Array<{
    /** The cap id (keccak256 of the preimage) */
    id: Hash;
    /**
     * Hard ceiling in asset native decimals (e.g. USDC: 6 dec).
     * vault.allocate reverts with ZeroAbsoluteCap if this is 0.
     */
    absoluteCap: bigint;
    /**
     * Soft ceiling as a fraction of vault.totalAssets(), in WAD (1e18 = 100%).
     * WAD = no relative cap.  0n = market forbidden (bot refuses to start).
     * See PLAN.md § Verified cap-id preimages for the WAD vs BPS gotcha.
     */
    relativeCap: bigint;
  }>;
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
// Vault state (aggregate snapshot)
// ---------------------------------------------------------------------------

/**
 * Complete vault snapshot captured by ChainReader at the start of a
 * rebalance cycle.  All fields reflect a consistent on-chain state.
 *
 * marketStates[i] and marketData[i] are positionally paired — they refer to
 * the same managed market at every index.
 *
 * Source: PLAN.md § Domain Types → VaultState
 */
export interface VaultState {
  /** Vault contract address (from VAULT_ADDRESS env var) */
  vaultAddress: Address;

  /**
   * The single MorphoMarketV1AdapterV2 address (from ADAPTER_ADDRESS env var).
   * Every vault.allocate / vault.deallocate call uses this adapter — only the
   * ABI-encoded MarketParams in the `data` field varies per market.
   */
  adapterAddress: Address;

  /**
   * Total assets under management.
   * Source: vault.totalAssets().
   */
  totalAssets: bigint;

  /**
   * Per-market allocation state for every managed market.
   * Positionally paired with marketData[].
   */
  marketStates: MarketAllocationState[];

  /**
   * Morpho Blue market state + IRM data for every managed market.
   * Same length as marketStates — marketData[i] corresponds to marketStates[i].
   */
  marketData: MarketData[];
}

// ---------------------------------------------------------------------------
// Rebalance action
// ---------------------------------------------------------------------------

/**
 * A single vault.allocate or vault.deallocate call to be submitted by the
 * Executor.  Strategy produces an ordered list of these; Executor serialises
 * and submits them (deallocates first, then allocates).
 *
 * Source: PLAN.md § Domain Types → RebalanceAction
 */
export interface RebalanceAction {
  /**
   * Target adapter address — always the configured single ADAPTER_ADDRESS.
   * This field is constant for every action in a cycle; only `data` varies.
   */
  adapter: Address;

  /** Human-readable market label for logs and Telegram alerts (e.g. "USDC/WETH 86%") */
  marketLabel: string;

  /**
   * Direction of the capital flow:
   *   - `"deallocate"` — pull assets from the market back to the vault idle pool
   *   - `"allocate"`   — push assets from the vault idle pool into the market
   *
   * Deallocates must always be submitted before allocates.
   */
  direction: "allocate" | "deallocate";

  /**
   * Amount of underlying asset to move, in the asset's native decimals
   * (e.g., USDC: 6 decimals).  Must be bigint.
   */
  amount: bigint;

  /**
   * ABI-encoded MarketParams for the target Morpho Blue market.
   * Passed verbatim as the second argument to vault.allocate / vault.deallocate:
   *   vault.allocate(adapter, data, assets)    — 3 args, no bytes4 selector
   *   vault.deallocate(adapter, data, assets)  — 3 args, no bytes4 selector
   *
   * Construction: encodeAbiParameters([{ type: "tuple", components: [...] }], [marketParams])
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
   * Post-rebalance allocation percentages keyed by market label.
   * Computed from on-chain state after the transactions confirm (or simulated
   * in dry-run mode).
   */
  newAllocations: Array<{ marketLabel: string; percentage: number }>;

  /** ISO-8601 timestamp of when this rebalance cycle completed. */
  timestamp: string;
}
