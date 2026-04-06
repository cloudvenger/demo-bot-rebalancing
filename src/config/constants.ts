import { parseAbi } from "viem";

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

/** Ethereum mainnet chain ID */
export const CHAIN_ID = 1 as const;

// ---------------------------------------------------------------------------
// Contract addresses — Ethereum mainnet
// ---------------------------------------------------------------------------

export const CONTRACT_ADDRESSES = {
  /** Morpho Vault V2 factory */
  VaultV2Factory: "0xA1D94F746dEfa1928926b84fB2596c06926C0405",

  /** Factory for MorphoMarketV1AdapterV2 (market adapters) */
  MorphoMarketV1AdapterV2Factory: "0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1",

  /** Factory for MorphoVaultV1Adapter (vault adapters) */
  MorphoVaultV1AdapterFactory: "0xD1B8E2dee25c2b89DCD2f98448a7ce87d6F63394",

  /** Public Allocator V1 — permissionless rebalance helper */
  PublicAllocator: "0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D",

  /** USD Coin (USDC) ERC-20 on mainnet */
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
} as const satisfies Record<string, `0x${string}`>;

// ---------------------------------------------------------------------------
// Vault V2 ABI — minimal interface for bot operations
// ---------------------------------------------------------------------------

/**
 * Minimal Vault V2 ABI.
 *
 * Functions included:
 *   - totalAssets()           — total assets under management
 *   - allocate(...)           — push assets from idle pool to adapter
 *   - deallocate(...)         — pull assets from adapter to idle pool
 *   - adaptersAt(uint256)     — enumerate enabled adapters by index
 *   - adaptersLength()        — total number of enabled adapters
 *   - caps(bytes32)           — absolute + relative cap for a risk ID
 */
export const VAULT_V2_ABI = parseAbi([
  // ---- Reads ---------------------------------------------------------------
  "function totalAssets() external view returns (uint256)",
  "function adaptersAt(uint256 index) external view returns (address)",
  "function adaptersLength() external view returns (uint256)",
  "function caps(bytes32 id) external view returns (uint256 absoluteCap, uint256 relativeCap)",

  // ---- Writes --------------------------------------------------------------
  "function allocate(address adapter, bytes calldata data, uint256 assets, bytes4 selector) external",
  "function deallocate(address adapter, bytes calldata data, uint256 assets, bytes4 selector) external",
]);

// ---------------------------------------------------------------------------
// Adapter ABI — minimal interface shared by all adapter types
// ---------------------------------------------------------------------------

/**
 * Minimal adapter ABI.
 *
 * Functions included:
 *   - realAssets() — current assets supplied through this adapter
 */
export const ADAPTER_ABI = parseAbi([
  "function realAssets() external view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Morpho Blue ABI — minimal interface for market reads
// ---------------------------------------------------------------------------

/**
 * Morpho Blue market state struct returned by `market(Id)`.
 *
 * Solidity equivalent:
 * ```solidity
 * struct Market {
 *   uint128 totalSupplyAssets;
 *   uint128 totalSupplyShares;
 *   uint128 totalBorrowAssets;
 *   uint128 totalBorrowShares;
 *   uint128 lastUpdate;
 *   uint128 fee;
 * }
 * ```
 */
export const MORPHO_BLUE_ABI = parseAbi([
  // market(Id) — returns Market struct fields as a tuple
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",

  // idToMarketParams(Id) — look up MarketParams from a market ID
  "function idToMarketParams(bytes32 id) external view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
]);

// ---------------------------------------------------------------------------
// Morpho Blue IRM ABI — Linear IRM (AdaptiveCurveIRM or LinearKinkIRM)
// ---------------------------------------------------------------------------

/**
 * Minimal IRM ABI.
 *
 * The LinearKinkIRM (and compatible IRMs) expose individual rate parameter
 * getters.  We read these once per cycle and simulate projected APY off-chain.
 *
 * Functions included:
 *   - CURVE_STEEPNESS()       — steepness multiplier (AdaptiveCurveIRM)
 *   - borrowRateView(...)     — current borrow rate (WAD per second)
 */
export const IRM_ABI = parseAbi([
  // AdaptiveCurveIRM — used by most Morpho Blue markets
  "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) external view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// ERC-20 ABI — minimal interface for balance reads
// ---------------------------------------------------------------------------

/** Minimal ERC-20 ABI for balance and decimals reads. */
export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
]);

// ---------------------------------------------------------------------------
// Numeric constants
// ---------------------------------------------------------------------------

/** Basis points denominator (10 000 = 100%) */
export const BPS_DENOMINATOR = 10_000 as const;

/** WAD precision (1e18) — used by viem/Morpho rate arithmetic */
export const WAD: bigint = BigInt("1000000000000000000");

/** Number of seconds in a year — used for APY annualisation */
export const SECONDS_PER_YEAR: bigint = 365n * 24n * 60n * 60n;

/** USDC decimal places */
export const USDC_DECIMALS = 6 as const;
