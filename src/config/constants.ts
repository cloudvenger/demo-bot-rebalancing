import { parseAbi } from "viem";
import type { AbiParameter } from "viem";

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

  /** Factory for MorphoMarketV1AdapterV2 (single adapter per vault) */
  MorphoMarketV1AdapterV2Factory: "0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1",

  /**
   * AdaptiveCurveIRM — the only IRM supported by MorphoMarketV1AdapterV2.
   * The adapter enforces that every routed market uses this IRM address.
   * Source: PLAN.md § Key Contract Addresses
   */
  AdaptiveCurveIRM: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",

  /** USD Coin (USDC) ERC-20 on mainnet */
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
} as const satisfies Record<string, `0x${string}`>;

// ---------------------------------------------------------------------------
// MarketParams ABI components
// ---------------------------------------------------------------------------

/**
 * ABI parameter components for the on-chain MarketParams struct.
 *
 * Used in three places:
 *   1. encodeAbiParameters([{ type: "tuple", components: ... }], [marketParams])
 *      — to compute marketId (keccak256 of encoded MarketParams)
 *   2. encodeAbiParameters for cap-id preimage #2 ("this/marketParams")
 *   3. As the argument type for adapter.ids(MarketParams) in ADAPTER_ABI
 *
 * Field order must match the on-chain Morpho Blue struct exactly:
 *   (loanToken, collateralToken, oracle, irm, lltv)
 *
 * Exported so VaultReader and any other module needing ABI encoding of
 * MarketParams can import a single authoritative definition.
 */
export const MARKET_PARAMS_ABI_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
] as const satisfies readonly AbiParameter[];

// ---------------------------------------------------------------------------
// Vault V2 ABI — verified against morpho-org/vault-v2 source (2026-04-07)
// ---------------------------------------------------------------------------

/**
 * Minimal Vault V2 ABI.
 *
 * All signatures are verified against the real on-chain contract.
 * Removed from previous version:
 *   - caps(bytes32) tuple — does NOT exist on the real contract (was wrong)
 *   - 4-arg allocate/deallocate — V2 uses 3 args, no bytes4 selector
 *
 * Functions included:
 *   Reads:
 *     totalAssets()               — total assets under management
 *     adaptersLength()            — count of enabled adapters (startup check)
 *     adaptersAt(uint256)         — adapter address at index (startup check)
 *     absoluteCap(bytes32)        — hard ceiling for a cap id (in asset decimals)
 *     relativeCap(bytes32)        — soft ceiling in WAD (1e18 = 100%, NOT basis pts)
 *     allocation(bytes32)         — current allocation accounted for a cap id
 *     isAllocator(address)        — whether an address holds the allocator role
 *   Writes:
 *     allocate(adapter, data, assets)    — push assets to adapter (3 args)
 *     deallocate(adapter, data, assets)  — pull assets from adapter (3 args)
 *     multicall(bytes[])                 — used by curator setup script
 */
export const VAULT_V2_ABI = parseAbi([
  // ---- Reads ---------------------------------------------------------------
  "function totalAssets() external view returns (uint256)",
  "function adaptersLength() external view returns (uint256)",
  "function adaptersAt(uint256 index) external view returns (address)",
  "function absoluteCap(bytes32 id) external view returns (uint256)",
  "function relativeCap(bytes32 id) external view returns (uint256)",
  "function allocation(bytes32 id) external view returns (uint256)",
  "function isAllocator(address account) external view returns (bool)",

  // ---- Writes --------------------------------------------------------------
  // NOTE: 3 args — no bytes4 selector. Verified against vault-v2 source.
  "function allocate(address adapter, bytes calldata data, uint256 assets) external",
  "function deallocate(address adapter, bytes calldata data, uint256 assets) external returns (bytes32[])",
  "function multicall(bytes[] calldata data) external returns (bytes[] memory)",
]);

// ---------------------------------------------------------------------------
// Adapter ABI — MorphoMarketV1AdapterV2 minimal interface
// ---------------------------------------------------------------------------

/**
 * Minimal MorphoMarketV1AdapterV2 ABI.
 *
 * Removed from previous version:
 *   - realAssets() — still exists on the real adapter but the bot must NOT use it.
 *     Per PLAN.md § MorphoMarketV1AdapterV2: "the bot reads vault.allocation(id)
 *     instead." Interface segregation: VaultReader reads vault state, not adapter
 *     convenience views.
 *
 * Functions included:
 *   ids(MarketParams)        — returns the 3 cap ids the vault checks during allocate
 *   allocation(MarketParams) — convenience view for vault.allocation(marketSpecificId)
 *   parentVault()            — used at startup to verify adapter belongs to configured vault
 *   adapterId()              — adapter-wide cap id (keccak256("this", adapter))
 *
 * Note on ids() return type: the real Solidity signature returns bytes32[] (dynamic
 * array of length 3), not bytes32[3] (fixed-size). viem requires the dynamic form.
 */
export const ADAPTER_ABI = [
  {
    name: "ids",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: MARKET_PARAMS_ABI_COMPONENTS,
      },
    ],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    name: "allocation",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "marketParams",
        type: "tuple",
        components: MARKET_PARAMS_ABI_COMPONENTS,
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "parentVault",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "adapterId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

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
// Morpho Blue IRM ABI — AdaptiveCurveIRM
// ---------------------------------------------------------------------------

/**
 * Minimal IRM ABI.
 *
 * The AdaptiveCurveIRM exposes borrowRateView for projected-rate simulation.
 * We read this once per cycle and compute projected APY off-chain in TypeScript.
 *
 * Functions included:
 *   borrowRateView(marketParams, market) — current borrow rate (WAD per second)
 */
export const IRM_ABI = parseAbi([
  // AdaptiveCurveIRM — used by all Morpho Blue markets managed by this bot
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

/**
 * WAD precision (1e18 = 100%).
 *
 * Used for:
 *   - relativeCap units on-chain (relativeCap == WAD means "no relative cap")
 *   - lltv values in MarketParams
 *   - IRM rate arithmetic
 *
 * IMPORTANT: relativeCap is stored in WAD, NOT in basis points. Do not cast
 * relativeCap to Number — WAD values are uint256 and would lose precision.
 * relativeCap == 0n means "market forbidden" (allocation must be 0).
 */
export const WAD: bigint = 1_000_000_000_000_000_000n;

/** Number of seconds in a year — used for APY annualisation */
export const SECONDS_PER_YEAR: bigint = 365n * 24n * 60n * 60n;

/** USDC decimal places */
export const USDC_DECIMALS = 6 as const;
