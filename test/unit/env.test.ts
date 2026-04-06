/**
 * Tests for src/config/env.ts
 *
 * Strategy: env.ts parses process.env at module-load time via a top-level
 * `envSchema.parse(process.env)` call. To control env vars per test we must:
 *   1. Save and fully restore process.env around each test.
 *   2. Call `vi.resetModules()` before each dynamic import so Node re-executes
 *      the module and picks up the mutated process.env.
 *   3. Use dynamic `await import(...)` inside each test body — never a static
 *      top-level import of the module under test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ZodError } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum set of env vars that satisfies the schema. */
const REQUIRED_ENV: Record<string, string> = {
  RPC_URL: "https://mainnet.infura.io/v3/test",
  PRIVATE_KEY: "a".repeat(64),
  VAULT_ADDRESS: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
  TELEGRAM_BOT_TOKEN: "123456:ABC-test-token",
  TELEGRAM_CHAT_ID: "-100123456789",
};

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  // Snapshot the real process.env so we can restore it exactly after each test.
  savedEnv = { ...process.env };

  // Wipe every key so no ambient env vars leak into the module under test.
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  // Reset the module registry so the next `await import(...)` re-executes
  // env.ts with whatever process.env is set at that point.
  vi.resetModules();
});

afterEach(() => {
  // Restore the original process.env (delete additions, re-add originals).
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, savedEnv);

  vi.resetModules();
});

/**
 * Load env.ts fresh. The module will throw a ZodError at import time when the
 * schema fails, so we wrap the dynamic import in a try/catch.
 */
async function loadEnv() {
  return import("../../src/config/env");
}

// ---------------------------------------------------------------------------
// 1. Valid config — all required + optional env vars set
// ---------------------------------------------------------------------------

describe("valid config — all required + optional vars set", () => {
  it("parses successfully and returns an object", async () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      CRON_SCHEDULE: "0 * * * *",
      DRIFT_THRESHOLD_BPS: "200",
      GAS_CEILING_GWEI: "100",
      MIN_ETH_BALANCE: "0.1",
      PORT: "4000",
      DRY_RUN: "true",
      MAX_MARKET_CONCENTRATION_PCT: "20",
      MIN_LIQUIDITY_MULTIPLIER: "3",
    });

    const { config } = await loadEnv();

    expect(config).toBeDefined();
  });

  it("RPC_URL is a string equal to the provided value", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.RPC_URL).toBe("https://mainnet.infura.io/v3/test");
  });

  it("PRIVATE_KEY is a string equal to the provided value", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.PRIVATE_KEY).toBe("a".repeat(64));
  });

  it("VAULT_ADDRESS is a string equal to the provided value", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.VAULT_ADDRESS).toBe(
      "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"
    );
  });

  it("TELEGRAM_BOT_TOKEN is a string equal to the provided value", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.TELEGRAM_BOT_TOKEN).toBe("123456:ABC-test-token");
  });

  it("TELEGRAM_CHAT_ID is a string equal to the provided value", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.TELEGRAM_CHAT_ID).toBe("-100123456789");
  });

  it("DRIFT_THRESHOLD_BPS is coerced to a number", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRIFT_THRESHOLD_BPS: "200" });
    const { config } = await loadEnv();
    expect(typeof config.DRIFT_THRESHOLD_BPS).toBe("number");
    expect(config.DRIFT_THRESHOLD_BPS).toBe(200);
  });

  it("PORT is coerced to a number", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, PORT: "4000" });
    const { config } = await loadEnv();
    expect(typeof config.PORT).toBe("number");
    expect(config.PORT).toBe(4000);
  });

  it("DRY_RUN 'true' string is coerced to boolean true", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRY_RUN: "true" });
    const { config } = await loadEnv();
    expect(config.DRY_RUN).toBe(true);
  });

  it("GAS_CEILING_GWEI is coerced to a number", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, GAS_CEILING_GWEI: "100" });
    const { config } = await loadEnv();
    expect(config.GAS_CEILING_GWEI).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 2. Missing required vars — each required field independently absent
// ---------------------------------------------------------------------------

describe("missing required vars", () => {
  it("throws ZodError when RPC_URL is absent", async () => {
    const env = { ...REQUIRED_ENV };
    delete env.RPC_URL;
    Object.assign(process.env, env);

    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when PRIVATE_KEY is absent", async () => {
    const env = { ...REQUIRED_ENV };
    delete env.PRIVATE_KEY;
    Object.assign(process.env, env);

    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when VAULT_ADDRESS is absent", async () => {
    const env = { ...REQUIRED_ENV };
    delete env.VAULT_ADDRESS;
    Object.assign(process.env, env);

    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when TELEGRAM_BOT_TOKEN is absent", async () => {
    const env = { ...REQUIRED_ENV };
    delete env.TELEGRAM_BOT_TOKEN;
    Object.assign(process.env, env);

    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when TELEGRAM_CHAT_ID is absent", async () => {
    const env = { ...REQUIRED_ENV };
    delete env.TELEGRAM_CHAT_ID;
    Object.assign(process.env, env);

    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when no env vars are set at all", async () => {
    // process.env is already wiped by beforeEach — nothing to set.
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid types — DRIFT_THRESHOLD_BPS
// ---------------------------------------------------------------------------

describe("invalid DRIFT_THRESHOLD_BPS", () => {
  it("throws ZodError when DRIFT_THRESHOLD_BPS is a non-numeric string", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRIFT_THRESHOLD_BPS: "abc" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when DRIFT_THRESHOLD_BPS is 0 (below min of 1)", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRIFT_THRESHOLD_BPS: "0" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when DRIFT_THRESHOLD_BPS exceeds 10000", async () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      DRIFT_THRESHOLD_BPS: "10001",
    });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when DRIFT_THRESHOLD_BPS is a float string", async () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      DRIFT_THRESHOLD_BPS: "1.5",
    });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid types — PORT
// ---------------------------------------------------------------------------

describe("invalid PORT", () => {
  it("throws ZodError when PORT is a non-numeric string", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, PORT: "abc" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when PORT is '-1' (below min of 1)", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, PORT: "-1" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when PORT is '0' (below min of 1)", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, PORT: "0" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when PORT is '65536' (above max of 65535)", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, PORT: "65536" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 5. Invalid VAULT_ADDRESS format
// ---------------------------------------------------------------------------

describe("invalid VAULT_ADDRESS", () => {
  it("throws ZodError when VAULT_ADDRESS is not a hex address", async () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      VAULT_ADDRESS: "not-an-address",
    });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ZodError when VAULT_ADDRESS is too short", async () => {
    Object.assign(process.env, {
      ...REQUIRED_ENV,
      VAULT_ADDRESS: "0xAbCd",
    });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid RPC_URL
// ---------------------------------------------------------------------------

describe("invalid RPC_URL", () => {
  it("throws ZodError when RPC_URL is not a valid URL", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, RPC_URL: "not-a-url" });
    await expect(loadEnv()).rejects.toBeInstanceOf(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 7. Defaults applied — only required vars set
// ---------------------------------------------------------------------------

describe("defaults applied when only required vars are set", () => {
  it("CRON_SCHEDULE defaults to '*/5 * * * *'", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.CRON_SCHEDULE).toBe("*/5 * * * *");
  });

  it("DRIFT_THRESHOLD_BPS defaults to 500", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.DRIFT_THRESHOLD_BPS).toBe(500);
  });

  it("GAS_CEILING_GWEI defaults to 50", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.GAS_CEILING_GWEI).toBe(50);
  });

  it("MIN_ETH_BALANCE defaults to 0.05", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.MIN_ETH_BALANCE).toBe(0.05);
  });

  it("PORT defaults to 3000", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.PORT).toBe(3000);
  });

  it("DRY_RUN defaults to false", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.DRY_RUN).toBe(false);
  });

  it("MAX_MARKET_CONCENTRATION_PCT defaults to 10", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.MAX_MARKET_CONCENTRATION_PCT).toBe(10);
  });

  it("MIN_LIQUIDITY_MULTIPLIER defaults to 2", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config } = await loadEnv();
    expect(config.MIN_LIQUIDITY_MULTIPLIER).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Sensitive redaction — safeConfig()
// ---------------------------------------------------------------------------

describe("safeConfig() — sensitive field redaction", () => {
  it("returns '[REDACTED]' for PRIVATE_KEY", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.PRIVATE_KEY).toBe("[REDACTED]");
  });

  it("returns '[REDACTED]' for TELEGRAM_BOT_TOKEN", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.TELEGRAM_BOT_TOKEN).toBe("[REDACTED]");
  });

  it("redacts RPC_URL in safe config", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.RPC_URL).toBe("[REDACTED]");
  });

  it("preserves VAULT_ADDRESS in safe config", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.VAULT_ADDRESS).toBe(
      "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"
    );
  });

  it("preserves TELEGRAM_CHAT_ID in safe config", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.TELEGRAM_CHAT_ID).toBe("-100123456789");
  });

  it("preserves PORT default value in safe config", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.PORT).toBe(3000);
  });

  it("preserves DRY_RUN default value in safe config", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { safeConfig } = await loadEnv();
    const safe = safeConfig();
    expect(safe.DRY_RUN).toBe(false);
  });

  it("does not mutate the original config PRIVATE_KEY", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config, safeConfig } = await loadEnv();
    safeConfig(); // call safeConfig — should not mutate config
    expect(config.PRIVATE_KEY).toBe("a".repeat(64));
  });

  it("does not mutate the original config TELEGRAM_BOT_TOKEN", async () => {
    Object.assign(process.env, REQUIRED_ENV);
    const { config, safeConfig } = await loadEnv();
    safeConfig();
    expect(config.TELEGRAM_BOT_TOKEN).toBe("123456:ABC-test-token");
  });
});

// ---------------------------------------------------------------------------
// 9. DRY_RUN coercion
// ---------------------------------------------------------------------------

describe("DRY_RUN boolean coercion", () => {
  it("'true' string coerces to boolean true", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRY_RUN: "true" });
    const { config } = await loadEnv();
    expect(config.DRY_RUN).toBe(true);
  });

  it("'false' string coerces to boolean false", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRY_RUN: "false" });
    const { config } = await loadEnv();
    expect(config.DRY_RUN).toBe(false);
  });

  it("'1' string coerces to boolean true", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRY_RUN: "1" });
    const { config } = await loadEnv();
    expect(config.DRY_RUN).toBe(true);
  });

  it("'0' string coerces to boolean false", async () => {
    Object.assign(process.env, { ...REQUIRED_ENV, DRY_RUN: "0" });
    const { config } = await loadEnv();
    expect(config.DRY_RUN).toBe(false);
  });
});
