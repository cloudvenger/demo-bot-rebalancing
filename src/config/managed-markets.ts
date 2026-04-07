import { readFileSync } from "node:fs";
import { encodeAbiParameters, keccak256 } from "viem";
import { z } from "zod";
import type { ManagedMarket } from "../core/rebalancer/types";

// ---------------------------------------------------------------------------
// Zod helpers
// ---------------------------------------------------------------------------

/** Validates a 0x-prefixed 20-byte Ethereum address. */
const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, {
    message: "must be a 0x-prefixed 20-byte hex address",
  });

/**
 * lltv is stored in the JSON as a decimal string (e.g. "860000000000000000")
 * representing a WAD fraction.  We parse it to bigint here.
 */
const lltvSchema = z
  .string()
  .regex(/^\d+$/, { message: "lltv must be a decimal integer string" })
  .transform((v) => BigInt(v));

// ---------------------------------------------------------------------------
// MarketParams schema
// ---------------------------------------------------------------------------

const marketParamsSchema = z.object({
  /** ERC-20 loan token — must match the vault's underlying asset */
  loanToken: addressSchema,
  /** ERC-20 collateral token */
  collateralToken: addressSchema,
  /** Morpho oracle address */
  oracle: addressSchema,
  /** Interest Rate Model address (must be AdaptiveCurveIRM in V1 adapter) */
  irm: addressSchema,
  /**
   * Loan-to-value threshold in WAD (1e18 = 100%).
   * Stored in JSON as a decimal integer string to avoid JS number precision
   * issues with uint256 values.
   */
  lltv: lltvSchema,
});

// ---------------------------------------------------------------------------
// Top-level file schema
// ---------------------------------------------------------------------------

const managedMarketEntrySchema = z.object({
  /** Human-readable label used in logs and Telegram alerts, e.g. "USDC/WETH 86%" */
  label: z.string().min(1, { message: "label must not be empty" }),
  marketParams: marketParamsSchema,
});

const managedMarketsFileSchema = z.object({
  markets: z
    .array(managedMarketEntrySchema)
    .min(1, { message: "markets array must contain at least one entry" }),
});

// ---------------------------------------------------------------------------
// MarketParams ABI components (used to derive marketId)
// ---------------------------------------------------------------------------

/**
 * ABI parameter definitions matching the on-chain MarketParams struct.
 * Used by viem's encodeAbiParameters + keccak256 to reproduce the same
 * market id the Morpho Blue contracts compute.
 *
 * Field order must match the on-chain struct exactly:
 * (loanToken, collateralToken, oracle, irm, lltv)
 */
const MARKET_PARAMS_ABI_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
] as const;

// ---------------------------------------------------------------------------
// marketId derivation
// ---------------------------------------------------------------------------

/**
 * Derives the Morpho Blue market id from MarketParams.
 * On-chain: `Id marketId = Id.wrap(keccak256(abi.encode(marketParams)))`
 *
 * The capIds are intentionally left empty here — VaultReader fills them at
 * startup (Group 8.2) once it has the adapter address.
 */
function deriveMarketId(params: {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}): `0x${string}` {
  const encoded = encodeAbiParameters(
    [{ type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS }],
    [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
    ],
  );
  return keccak256(encoded);
}

// ---------------------------------------------------------------------------
// Public loader
// ---------------------------------------------------------------------------

/**
 * Reads the managed-markets JSON file at `path`, validates it with zod, and
 * returns a `ManagedMarket[]` with `marketId` pre-computed.
 *
 * `capIds` is left as an empty array — Group 8.2 (VaultReader) fills it at
 * startup by calling `adapter.ids(marketParams)` for each market.
 *
 * Throws a descriptive error (naming the offending field) on any validation
 * failure so the bot refuses to start with a bad config.
 *
 * @param path - Absolute or cwd-relative path to the JSON file referenced by
 *               the `MANAGED_MARKETS_PATH` env var.
 */
export function loadManagedMarkets(path: string): ManagedMarket[] {
  let raw: unknown;

  try {
    const content = readFileSync(path, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read managed markets file at "${path}": ${message}`,
    );
  }

  const result = managedMarketsFileSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid managed markets config at "${path}":\n${issues}`,
    );
  }

  return result.data.markets.map((entry) => {
    const { loanToken, collateralToken, oracle, irm, lltv } = entry.marketParams;

    // Addresses are validated as strings by zod; cast to the viem Address type.
    const marketParams = {
      loanToken: loanToken as `0x${string}`,
      collateralToken: collateralToken as `0x${string}`,
      oracle: oracle as `0x${string}`,
      irm: irm as `0x${string}`,
      lltv,
    };

    const marketId = deriveMarketId(marketParams);

    return {
      label: entry.label,
      marketParams,
      marketId,
      // capIds are filled by VaultReader at startup (Group 8.2).
      capIds: [] as `0x${string}`[],
    } satisfies ManagedMarket;
  });
}
