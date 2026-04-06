/**
 * Unit tests for src/services/notifier.ts — Notifier class
 *
 * Strategy: mock global `fetch` using vi.stubGlobal so no real network calls
 * are made. Each test restores or resets the stub as needed to remain
 * fully independent.
 *
 * Mock boundary: global `fetch` is the only external dependency. The Notifier
 * class itself is never mocked — all its code runs.
 *
 * Cooldown tests use vi.setSystemTime() to control Date.now() deterministically
 * without real timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Address } from "viem";
import { Notifier } from "../../src/services/notifier.js";
import type { RebalanceResult, RebalanceAction } from "../../src/core/rebalancer/types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_A: Address = "0x2222222222222222222222222222222222222222";

const TX_HASH_1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const BOT_TOKEN = "test-bot-token-1234";
const CHAT_ID = "987654321";

const EXPECTED_TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

function makeConfig() {
  return {
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_CHAT_ID: CHAT_ID,
  };
}

function makeSuccessResult(overrides?: Partial<RebalanceResult>): RebalanceResult {
  return {
    actions: [
      {
        adapter: ADAPTER_A,
        direction: "allocate",
        amount: 1_000_500_000n, // 1000.50 USDC
        data: "0x",
      },
    ],
    txHashes: [TX_HASH_1],
    newAllocations: [{ adapter: ADAPTER_A, percentage: 100 }],
    timestamp: "2026-04-06T12:00:00.000Z",
    ...overrides,
  };
}

function makeDeallocateAction(): RebalanceAction {
  return {
    adapter: ADAPTER_A,
    direction: "deallocate",
    amount: 500_000_000n, // 500 USDC
    data: "0x",
  };
}

function makeOkFetchResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as Response;
}

function makeErrorFetchResponse(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => ({ ok: false }),
  } as Response;
}

// ---------------------------------------------------------------------------
// 1. notifyRebalanceSuccess — Telegram URL and message content
// ---------------------------------------------------------------------------

describe("Notifier.notifyRebalanceSuccess", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("calls fetch with the correct Telegram sendMessage URL", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(EXPECTED_TELEGRAM_URL);
  });

  it("sends a POST request to the Telegram API", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    expect((options as RequestInit).method).toBe("POST");
  });

  it("includes the vault address in the message body", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain(VAULT_ADDRESS);
  });

  it("includes a tx hash in the message body", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain(TX_HASH_1);
  });

  it("includes the adapter address in the message body for actions", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain(ADAPTER_A);
  });

  it("sends with the configured chat_id", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.chat_id).toBe(CHAT_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. notifyRebalanceFailed — error message and vault address
// ---------------------------------------------------------------------------

describe("Notifier.notifyRebalanceFailed", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("includes the vault address in the failure message", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceFailed(new Error("revert"), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain(VAULT_ADDRESS);
  });

  it("includes the error message text in the failure alert", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceFailed(new Error("execution reverted"), VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("execution reverted");
  });

  it("includes the failing adapter address when a failedAction is provided", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceFailed(
      new Error("revert"),
      VAULT_ADDRESS,
      makeDeallocateAction()
    );

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain(ADAPTER_A);
  });

  it("calls fetch once for a failure alert", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceFailed(new Error("revert"), VAULT_ADDRESS);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 3. notifyHealthIssue — alert type titles and details
// ---------------------------------------------------------------------------

describe("Notifier.notifyHealthIssue", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("includes 'RPC Failure' title in message for rpc_failure alert type", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyHealthIssue("rpc_failure", "Connection refused");

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("RPC Failure");
  });

  it("includes 'Missed Heartbeat' title in message for missed_heartbeat alert type", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyHealthIssue("missed_heartbeat", "No cycle ran in 30 minutes");

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("Missed Heartbeat");
  });

  it("includes 'Low Wallet Balance' title in message for low_balance alert type", async () => {
    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyHealthIssue("low_balance", "Balance is 0.001 ETH");

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("Low Wallet Balance");
  });

  it("includes the details string in the health issue message", async () => {
    const notifier = new Notifier(makeConfig(), 0);
    const details = "RPC endpoint returned 503";

    await notifier.notifyHealthIssue("rpc_failure", details);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain(details);
  });
});

// ---------------------------------------------------------------------------
// 4. Cooldown — same alert type within 15min does not call fetch again
// ---------------------------------------------------------------------------

describe("Notifier — cooldown suppression", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not call fetch a second time for the same alert type within cooldown window", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const cooldownMs = 15 * 60 * 1000;
    const notifier = new Notifier(makeConfig(), cooldownMs);

    // First send — should go through
    await notifier.notifyHealthIssue("rpc_failure", "first");
    // Advance time by 1 minute — still within cooldown
    vi.setSystemTime(now + 60_000);

    // Second send — should be suppressed
    await notifier.notifyHealthIssue("rpc_failure", "second");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("the suppressed second alert does not cause any error or throw", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 15 * 60 * 1000);
    await notifier.notifyHealthIssue("low_balance", "first");

    vi.setSystemTime(now + 30_000);

    await expect(
      notifier.notifyHealthIssue("low_balance", "second")
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Cooldown — same alert type after cooldown expires calls fetch again
// ---------------------------------------------------------------------------

describe("Notifier — cooldown expiry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("calls fetch again for the same alert type after cooldown has expired", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const cooldownMs = 15 * 60 * 1000;
    const notifier = new Notifier(makeConfig(), cooldownMs);

    // First send
    await notifier.notifyHealthIssue("missed_heartbeat", "first");
    // Advance time past cooldown
    vi.setSystemTime(now + cooldownMs + 1);

    // Second send — cooldown expired, should go through
    await notifier.notifyHealthIssue("missed_heartbeat", "second");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("second send after cooldown uses the correct Telegram URL", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const cooldownMs = 60_000; // 1 minute for this test
    const notifier = new Notifier(makeConfig(), cooldownMs);

    await notifier.notifyHealthIssue("rpc_failure", "first");
    vi.setSystemTime(now + cooldownMs + 1);
    await notifier.notifyHealthIssue("rpc_failure", "second");

    expect(fetchSpy.mock.calls[1][0]).toBe(EXPECTED_TELEGRAM_URL);
  });
});

// ---------------------------------------------------------------------------
// 6. Cooldown — different alert types are independent
// ---------------------------------------------------------------------------

describe("Notifier — cooldown per alert type independence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not suppress a different alert type when one type is in cooldown", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 15 * 60 * 1000);

    // Send rpc_failure — starts cooldown for rpc_failure
    await notifier.notifyHealthIssue("rpc_failure", "rpc error");
    // Send missed_heartbeat — different type, should not be suppressed
    await notifier.notifyHealthIssue("missed_heartbeat", "heartbeat missed");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rpc_failure and rebalance_failed cooldowns are tracked separately", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const cooldownMs = 15 * 60 * 1000;
    const notifier = new Notifier(makeConfig(), cooldownMs);

    // Trigger rebalance_failed cooldown
    await notifier.notifyRebalanceFailed(new Error("err"), VAULT_ADDRESS);
    // rpc_failure should still go through
    await notifier.notifyHealthIssue("rpc_failure", "rpc down");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Telegram API failure — fetch rejects → notifier does NOT throw
// ---------------------------------------------------------------------------

describe("Notifier — Telegram fetch rejection isolation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not throw when fetch rejects with a network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await expect(
      notifier.notifyHealthIssue("rpc_failure", "network down")
    ).resolves.toBeUndefined();
  });

  it("does not throw when fetch rejects during notifyRebalanceSuccess", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("DNS lookup failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await expect(
      notifier.notifyRebalanceSuccess(makeSuccessResult(), VAULT_ADDRESS)
    ).resolves.toBeUndefined();
  });

  it("does not throw when fetch rejects during notifyRebalanceFailed", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await expect(
      notifier.notifyRebalanceFailed(new Error("revert"), VAULT_ADDRESS)
    ).resolves.toBeUndefined();
  });

  it("does not reset cooldown after a failed fetch (failed sends do not count toward cooldown)", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // First call fails, second call succeeds
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const cooldownMs = 15 * 60 * 1000;
    const notifier = new Notifier(makeConfig(), cooldownMs);

    // Failed send — lastSentAt should NOT be set
    await notifier.notifyHealthIssue("rpc_failure", "first attempt");

    // Advance time — still within what would be cooldown IF it had been set
    vi.setSystemTime(now + 60_000);

    // Should still go through because the failed send didn't start the cooldown
    await notifier.notifyHealthIssue("rpc_failure", "second attempt");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Telegram API returns non-2xx — notifier does NOT throw
// ---------------------------------------------------------------------------

describe("Notifier — Telegram non-2xx response", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not throw when Telegram API returns 500", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeErrorFetchResponse(500));
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await expect(
      notifier.notifyHealthIssue("low_balance", "balance low")
    ).resolves.toBeUndefined();
  });

  it("does not throw when Telegram API returns 429 (rate limit)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeErrorFetchResponse(429));
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await expect(
      notifier.notifyRebalanceFailed(new Error("revert"), VAULT_ADDRESS)
    ).resolves.toBeUndefined();
  });

  it("does not update lastSentAt after a non-2xx response (cooldown not started)", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    // First call returns 500, second returns 200
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(makeErrorFetchResponse(500))
      .mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const cooldownMs = 15 * 60 * 1000;
    const notifier = new Notifier(makeConfig(), cooldownMs);

    // First attempt — 500 response, cooldown should NOT be started
    await notifier.notifyHealthIssue("rpc_failure", "first");

    // Advance 1 minute — within what would be cooldown if first had succeeded
    vi.setSystemTime(now + 60_000);

    // Second attempt — should go through since first failed
    await notifier.notifyHealthIssue("rpc_failure", "second");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Message formatting — USDC amounts
// ---------------------------------------------------------------------------

describe("Notifier — USDC amount formatting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("formats 1,000,500,000 raw units as '1000.50' USDC in the success message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);
    const result = makeSuccessResult({
      actions: [
        {
          adapter: ADAPTER_A,
          direction: "allocate",
          amount: 1_000_500_000n, // 1000.50 USDC (6 decimals)
          data: "0x",
        },
      ],
    });

    await notifier.notifyRebalanceSuccess(result, VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    // 1_000_500_000 / 1e6 = 1000.50 → formatted as "1000.50"
    expect(body.text).toContain("1000.50");
  });

  it("formats 500,000,000 raw units as '500.00' USDC in the failed action message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyRebalanceFailed(
      new Error("revert"),
      VAULT_ADDRESS,
      {
        adapter: ADAPTER_A,
        direction: "deallocate",
        amount: 500_000_000n, // 500.00 USDC
        data: "0x",
      }
    );

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("500.00");
  });

  it("formats 1,000,000 raw units as '1.00' USDC (minimum readable amount)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);
    const result = makeSuccessResult({
      actions: [
        {
          adapter: ADAPTER_A,
          direction: "allocate",
          amount: 1_000_000n, // 1.00 USDC
          data: "0x",
        },
      ],
    });

    await notifier.notifyRebalanceSuccess(result, VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("1.00");
  });
});

// ---------------------------------------------------------------------------
// 10. Error message sanitization — RPC URLs stripped
// ---------------------------------------------------------------------------

describe("Notifier — error message sanitization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("strips HTTP RPC URLs from the error message in notifyRebalanceFailed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);
    const errorWithUrl = new Error(
      "Request to https://eth-mainnet.alchemyapi.io/v2/secret-api-key failed with status 429"
    );

    await notifier.notifyRebalanceFailed(errorWithUrl, VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).not.toContain("https://eth-mainnet.alchemyapi.io");
    expect(body.text).not.toContain("secret-api-key");
  });

  it("replaces RPC URL with [URL_REDACTED] placeholder", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);
    const errorWithUrl = new Error("Failed: https://rpc.example.com/v1/key123");

    await notifier.notifyRebalanceFailed(errorWithUrl, VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("[URL_REDACTED]");
  });

  it("strips long hex strings that could be private key material from the error message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);
    // A 64-character hex string — could be a private key fragment
    const longHex = "0x" + "a".repeat(64);
    const errorWithHex = new Error(`Signing error with key ${longHex}`);

    await notifier.notifyRebalanceFailed(errorWithHex, VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).not.toContain(longHex);
  });

  it("replaces long hex strings with [HEX_REDACTED] placeholder", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);
    const longHex = "0x" + "b".repeat(64);
    const errorWithHex = new Error(`Error with data ${longHex}`);

    await notifier.notifyRebalanceFailed(errorWithHex, VAULT_ADDRESS);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).toContain("[HEX_REDACTED]");
  });

  it("sanitizes the details string in notifyHealthIssue — strips RPC URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(makeOkFetchResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const notifier = new Notifier(makeConfig(), 0);

    await notifier.notifyHealthIssue(
      "rpc_failure",
      "Connection to https://mainnet.infura.io/v3/project-id timed out"
    );

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.text).not.toContain("https://mainnet.infura.io");
    expect(body.text).toContain("[URL_REDACTED]");
  });
});
