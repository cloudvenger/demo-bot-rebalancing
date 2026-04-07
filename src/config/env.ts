import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a string to a number, then validate it with the given zod schema.
 * Enables writing e.g. `coerceNumber(z.number().positive())`.
 */
const coerceNumber = (schema: z.ZodNumber) =>
  z.string().transform((v) => Number(v)).pipe(schema);

/**
 * Coerce a string "true"/"false" / "1"/"0" to a boolean.
 */
const coerceBoolean = z
  .string()
  .transform((v) => v === "true" || v === "1")
  .pipe(z.boolean());

// ---------------------------------------------------------------------------
// Environment variable schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // ---- Required -----------------------------------------------------------

  /** Ethereum JSON-RPC endpoint URL */
  RPC_URL: z.string().url({ message: "RPC_URL must be a valid URL" }),

  /**
   * Operator private key (hex, with or without 0x prefix).
   * Never logged — redacted in safeConfig().
   */
  PRIVATE_KEY: z
    .string()
    .min(64, { message: "PRIVATE_KEY must be at least 64 hex characters" }),

  /** Vault V2 contract address to manage */
  VAULT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, { message: "VAULT_ADDRESS must be a valid checksummed Ethereum address" }),

  /**
   * The single MorphoMarketV1AdapterV2 deployed for the configured vault.
   * All vault.allocate / vault.deallocate calls use this adapter address;
   * only the ABI-encoded MarketParams in `data` varies per market.
   */
  ADAPTER_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, { message: "ADAPTER_ADDRESS must be a valid checksummed Ethereum address" }),

  /**
   * Absolute path (or path relative to cwd) to a JSON file listing the
   * Morpho Blue markets the bot should manage.
   * Shape: { markets: [{ label, marketParams: { loanToken, collateralToken, oracle, irm, lltv } }, ...] }
   * Validated at startup by loadManagedMarkets() in src/config/managed-markets.ts.
   */
  MANAGED_MARKETS_PATH: z
    .string()
    .min(1, { message: "MANAGED_MARKETS_PATH must not be empty" }),

  /**
   * Telegram Bot API token.
   * Never logged — redacted in safeConfig().
   */
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1, { message: "TELEGRAM_BOT_TOKEN must not be empty" }),

  /** Telegram chat ID to send alerts to */
  TELEGRAM_CHAT_ID: z
    .string()
    .min(1, { message: "TELEGRAM_CHAT_ID must not be empty" }),

  // ---- Optional with defaults --------------------------------------------

  /** Cron expression for the rebalance schedule */
  CRON_SCHEDULE: z.string().default("*/5 * * * *"),

  /**
   * Minimum drift in basis points before a rebalance is triggered.
   * Default: 500 (5%).
   */
  DRIFT_THRESHOLD_BPS: coerceNumber(z.number().int().min(1).max(10_000))
    .default("500"),

  /**
   * Maximum gas price in gwei. Transactions are skipped when the network gas
   * price exceeds this ceiling.
   * Default: 50 gwei.
   */
  GAS_CEILING_GWEI: coerceNumber(z.number().positive())
    .default("50"),

  /**
   * Minimum wallet ETH balance required before submitting transactions.
   * Default: 0.05 ETH.
   */
  MIN_ETH_BALANCE: coerceNumber(z.number().positive())
    .default("0.05"),

  /** Fastify HTTP server port */
  PORT: coerceNumber(z.number().int().min(1).max(65535))
    .default("3000"),

  /**
   * When true, the bot logs proposed actions without submitting transactions.
   * Default: false.
   */
  DRY_RUN: coerceBoolean.default("false"),

  /**
   * Maximum allocation to any single market expressed as a percentage of that
   * market's total supply. Limits rate impact.
   * Default: 10 (%).
   */
  MAX_MARKET_CONCENTRATION_PCT: coerceNumber(z.number().positive().max(100))
    .default("10"),

  /**
   * Minimum required available market liquidity expressed as a multiple of the
   * bot's potential allocation to that market.
   * Default: 2.
   */
  MIN_LIQUIDITY_MULTIPLIER: coerceNumber(z.number().positive())
    .default("2"),
});

// ---------------------------------------------------------------------------
// Parsed config export
// ---------------------------------------------------------------------------

/**
 * Validated, type-safe configuration object.
 * Throws a descriptive ZodError at module-load time if any required env var
 * is missing or invalid, preventing the bot from starting with bad config.
 */
export const config = envSchema.parse(process.env);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Inferred TypeScript type for the validated config object. */
export type Config = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Safe config for logging (sensitive fields redacted)
// ---------------------------------------------------------------------------

const REDACTED = "[REDACTED]" as const;

/**
 * Fields that must never appear in logs, even at debug level.
 *
 * RPC_URL is included because provider URLs (Infura, Alchemy, etc.) embed the
 * API key as a path segment (e.g. /v3/YOUR_KEY), so logging the raw URL leaks
 * the key to log aggregation systems.
 */
const SENSITIVE_FIELDS = ["PRIVATE_KEY", "TELEGRAM_BOT_TOKEN", "RPC_URL"] as const satisfies ReadonlyArray<keyof Config>;

type SensitiveField = (typeof SENSITIVE_FIELDS)[number];
type SafeConfig = Omit<Config, SensitiveField> & Record<SensitiveField, typeof REDACTED>;

/**
 * Returns a copy of the config with all sensitive fields replaced by
 * `"[REDACTED]"`. Use this when logging config at startup.
 *
 * @example
 * logger.info({ config: safeConfig() }, "Bot starting with config");
 */
export function safeConfig(): SafeConfig {
  const safe = { ...config } as SafeConfig;

  for (const field of SENSITIVE_FIELDS) {
    (safe as Record<string, unknown>)[field] = REDACTED;
  }

  return safe;
}

