/**
 * Integration tests for src/core/chain/vault.ts — VaultReader (V2 single-adapter API)
 *
 * Task: qa-8.2
 *
 * Two test suites:
 *
 * Suite 1 — mocked-client tests (no Anvil needed, run by default):
 *   VaultReader is exercised against a mock of publicClient.readContract /
 *   publicClient.multicall.  All code paths are exercised deterministically.
 *
 * Suite 2 — Anvil fork tests (gated by ANVIL_RPC_URL env var):
 *   Full end-to-end verification against a vault + adapter deployed by
 *   script/DeployVault.s.sol on an Anvil mainnet fork.  These tests are
 *   skipped in CI unless ANVIL_RPC_URL is set.
 *
 * Mock boundary: publicClient.readContract and publicClient.multicall are the
 * only mocked callsites.  Internal VaultReader helpers are never mocked.
 */

import { describe, it, expect, vi } from "vitest";
import { keccak256, encodeAbiParameters, createPublicClient, http, getAddress } from "viem";
import { mainnet } from "viem/chains";
import type { Address, Hash } from "viem";
import {
  VaultReader,
  computeMarketCapIds,
  StartupValidationError,
} from "../../src/core/chain/vault.js";
import {
  MARKET_PARAMS_ABI_COMPONENTS,
  VAULT_V2_ABI,
  ADAPTER_ABI,
  WAD,
} from "../../src/config/constants.js";
import type { ManagedMarket, MarketParams } from "../../src/core/rebalancer/types.js";
import type { BotPublicClient } from "../../src/core/chain/client.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_ADDRESS: Address = "0x2222222222222222222222222222222222222222";
const BOT_WALLET: Address = "0x3333333333333333333333333333333333333333";

/** AdaptiveCurveIRM — must appear in every managed-market's irm field */
const ADAPTIVE_CURVE_IRM: Address = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WSTETH: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const ORACLE: Address = getAddress("0xdddddddddddddddddddddddddddddddddddddddd");

const MARKET_PARAMS_WETH: MarketParams = {
  loanToken: USDC,
  collateralToken: WETH,
  oracle: ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: 860_000_000_000_000_000n,
};

const MARKET_PARAMS_WSTETH: MarketParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: 860_000_000_000_000_000n,
};

/** Compute the on-chain ids we expect adapter.ids() to return */
const CAP_IDS_WETH = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
const CAP_IDS_WSTETH = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WSTETH);

/** 10 000 USDC (6 decimal places) */
const TOTAL_ASSETS_10K = 10_000_000_000n;

/** absoluteCap = 5 000 USDC */
const ABS_CAP = 5_000_000_000n;

/** relativeCap = WAD (1e18 = "no relative cap") */
const REL_CAP = WAD;

// ---------------------------------------------------------------------------
// Managed market factory helpers
// ---------------------------------------------------------------------------

function makeManagedMarket(
  label: string,
  marketParams: MarketParams,
  capIds: [Hash, Hash, Hash]
): ManagedMarket {
  return {
    label,
    marketParams,
    marketId: keccak256(
      encodeAbiParameters(
        [{ type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS }],
        [marketParams]
      )
    ) as Hash,
    capIds,
  };
}

const MARKET_WETH = makeManagedMarket(
  "USDC/WETH 86%",
  MARKET_PARAMS_WETH,
  CAP_IDS_WETH
);

const MARKET_WSTETH = makeManagedMarket(
  "USDC/wstETH 86%",
  MARKET_PARAMS_WSTETH,
  CAP_IDS_WSTETH
);

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function makeMockClient(overrides?: {
  readContract?: ReturnType<typeof vi.fn>;
  multicall?: ReturnType<typeof vi.fn>;
}): BotPublicClient {
  return {
    readContract: overrides?.readContract ?? vi.fn(),
    multicall: overrides?.multicall ?? vi.fn(),
  } as unknown as BotPublicClient;
}

/**
 * Builds readContract and multicall mocks for a healthy 1-market startup
 * scenario where all invariants pass:
 *   - vault has 1 adapter (ADAPTER_ADDRESS)
 *   - adapter.parentVault() == VAULT_ADDRESS
 *   - vault.isAllocator(BOT_WALLET) == true
 *   - adapter.ids(MARKET_PARAMS_WETH) returns CAP_IDS_WETH
 *   - all relativeCaps == WAD (non-zero)
 *   - all absoluteCaps == ABS_CAP (non-zero)
 */
function makeHealthyStartupMocks(
  managedMarkets: ManagedMarket[] = [MARKET_WETH]
) {
  const readContract = vi
    .fn()
    // Step 1: adaptersLength()
    .mockResolvedValueOnce(1n)
    // Step 2: adapter.parentVault()
    .mockResolvedValueOnce(VAULT_ADDRESS)
    // Step 3: vault.isAllocator(BOT_WALLET)
    .mockResolvedValueOnce(true);

  // adapter.ids() for each market (via multicall in _assertAdapterEnabled is
  // a readContract call, but adapter.ids per market is also readContract)
  for (const market of managedMarkets) {
    const ids = computeMarketCapIds(ADAPTER_ADDRESS, market.marketParams);
    readContract.mockResolvedValueOnce(ids);
  }

  // multicall: adaptersAt(0) → returns ADAPTER_ADDRESS
  const multicall = vi
    .fn()
    .mockResolvedValueOnce([ADAPTER_ADDRESS]);

  // For each managed market: relativeCap×3 + absoluteCap×3
  for (const _ of managedMarkets) {
    multicall.mockResolvedValueOnce([
      REL_CAP, REL_CAP, REL_CAP,
      ABS_CAP, ABS_CAP, ABS_CAP,
    ]);
  }

  return { readContract, multicall };
}

// ---------------------------------------------------------------------------
// Suite 1 — Mocked client tests (run without Anvil)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1a. assertStartupInvariants — happy path
// ---------------------------------------------------------------------------

describe("VaultReader.assertStartupInvariants — happy path (mocked client)", () => {
  it("resolves without throwing when all invariants pass (1 managed market)", async () => {
    const { readContract, multicall } = makeHealthyStartupMocks([MARKET_WETH]);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).resolves.toBeUndefined();
  });

  it("populates market.capIds in-place with on-chain values after startup", async () => {
    const { readContract, multicall } = makeHealthyStartupMocks([MARKET_WETH]);
    const client = makeMockClient({ readContract, multicall });
    const market = { ...MARKET_WETH, capIds: [] as Hash[] };
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [market]
    );

    await reader.assertStartupInvariants(BOT_WALLET);

    expect(market.capIds).toHaveLength(3);
  });

  it("activeMarkets contains the market after successful startup validation", async () => {
    const { readContract, multicall } = makeHealthyStartupMocks([MARKET_WETH]);
    const client = makeMockClient({ readContract, multicall });
    const market = { ...MARKET_WETH, capIds: [] as Hash[] };
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [market]
    );

    await reader.assertStartupInvariants(BOT_WALLET);

    expect(reader.activeMarkets).toHaveLength(1);
  });

  it("resolves when 2 managed markets both pass all checks", async () => {
    const { readContract, multicall } = makeHealthyStartupMocks([
      MARKET_WETH,
      MARKET_WSTETH,
    ]);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [
        { ...MARKET_WETH, capIds: [] },
        { ...MARKET_WSTETH, capIds: [] },
      ]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 1b. assertStartupInvariants — adapter not enabled
// ---------------------------------------------------------------------------

describe("VaultReader.assertStartupInvariants — adapter not enabled", () => {
  it("throws StartupValidationError when vault has no enabled adapters", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(0n); // adaptersLength = 0
    const client = makeMockClient({ readContract });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  it("error message names the adapter when it is not found in the vault's adapter list", async () => {
    const DIFFERENT_ADAPTER: Address = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";
    const readContract = vi.fn().mockResolvedValueOnce(1n); // adaptersLength = 1
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([DIFFERENT_ADAPTER]); // adaptersAt(0) returns something else

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      ADAPTER_ADDRESS
    );
  });

  it("throws StartupValidationError (not a generic Error) when adapter is missing", async () => {
    const DIFFERENT_ADAPTER: Address = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";
    const readContract = vi.fn().mockResolvedValueOnce(1n);
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([DIFFERENT_ADAPTER]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: unknown;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(StartupValidationError);
  });
});

// ---------------------------------------------------------------------------
// 1c. assertStartupInvariants — adapter.parentVault() mismatch
// ---------------------------------------------------------------------------

describe("VaultReader.assertStartupInvariants — parentVault mismatch", () => {
  it("throws StartupValidationError when adapter.parentVault() returns a different address", async () => {
    const WRONG_VAULT: Address = "0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe";
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n) // adaptersLength
      .mockResolvedValueOnce(WRONG_VAULT); // parentVault() → wrong address
    const multicall = vi.fn().mockResolvedValueOnce([ADAPTER_ADDRESS]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  it("error message mentions both the actual parentVault and the configured VAULT_ADDRESS", async () => {
    const WRONG_VAULT: Address = "0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe";
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(WRONG_VAULT);
    const multicall = vi.fn().mockResolvedValueOnce([ADAPTER_ADDRESS]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError?.message).toContain(WRONG_VAULT);
    expect(thrownError?.message).toContain(VAULT_ADDRESS);
  });
});

// ---------------------------------------------------------------------------
// 1d. assertStartupInvariants — botWallet is not an allocator
// ---------------------------------------------------------------------------

describe("VaultReader.assertStartupInvariants — botWallet not an allocator", () => {
  it("throws StartupValidationError when vault.isAllocator(botWallet) returns false", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n) // adaptersLength
      .mockResolvedValueOnce(VAULT_ADDRESS) // parentVault()
      .mockResolvedValueOnce(false); // isAllocator → false
    const multicall = vi.fn().mockResolvedValueOnce([ADAPTER_ADDRESS]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  it("error message names the bot wallet address", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(VAULT_ADDRESS)
      .mockResolvedValueOnce(false);
    const multicall = vi.fn().mockResolvedValueOnce([ADAPTER_ADDRESS]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError?.message).toContain(BOT_WALLET);
  });

  it("error message mentions 'allocator' to help the operator understand the fix", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(VAULT_ADDRESS)
      .mockResolvedValueOnce(false);
    const multicall = vi.fn().mockResolvedValueOnce([ADAPTER_ADDRESS]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError?.message).toContain("allocator");
  });
});

// ---------------------------------------------------------------------------
// 1e. assertStartupInvariants — relativeCap == 0 (forbidden market)
// ---------------------------------------------------------------------------

describe("VaultReader.assertStartupInvariants — relativeCap == 0 triggers refuse-to-start", () => {
  /**
   * Builds mocks for the standard startup sequence but sets relativeCap[k] = 0n
   * for one of the 3 ids of the first managed market.
   */
  function makeZeroRelCapMocks(zeroIndex: 0 | 1 | 2) {
    const relativeCaps: [bigint, bigint, bigint] = [REL_CAP, REL_CAP, REL_CAP];
    relativeCaps[zeroIndex] = 0n;

    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n) // adaptersLength
      .mockResolvedValueOnce(VAULT_ADDRESS) // parentVault()
      .mockResolvedValueOnce(true) // isAllocator
      .mockResolvedValueOnce(CAP_IDS_WETH); // adapter.ids(MARKET_PARAMS_WETH)

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_ADDRESS]) // adaptersAt(0)
      .mockResolvedValueOnce([
        relativeCaps[0], relativeCaps[1], relativeCaps[2],
        ABS_CAP, ABS_CAP, ABS_CAP,
      ]);

    return { readContract, multicall };
  }

  it("throws StartupValidationError when relativeCap[0] (adapter-wide) == 0n", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(0);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  it("throws StartupValidationError when relativeCap[1] (collateral) == 0n", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(1);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  it("throws StartupValidationError when relativeCap[2] (market-specific) == 0n", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(2);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  it("error message contains the SPEC Story A2 'Refusing to start' prefix", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(0);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError?.message).toContain("Refusing to start");
  });

  it("error message names the offending market label", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(0);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError?.message).toContain(MARKET_WETH.label);
  });

  it("error message names the offending cap id", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(0);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    // The offending id is CAP_IDS_WETH[0] (adapter-wide)
    expect(thrownError?.message).toContain(CAP_IDS_WETH[0]);
  });

  it("error message advises setting relativeCap to WAD (1e18)", async () => {
    const { readContract, multicall } = makeZeroRelCapMocks(0);
    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    let thrownError: Error | undefined;
    try {
      await reader.assertStartupInvariants(BOT_WALLET);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError?.message).toContain("WAD");
  });
});

// ---------------------------------------------------------------------------
// 1f. assertStartupInvariants — absoluteCap == 0 (excluded, not fatal)
// ---------------------------------------------------------------------------

describe("VaultReader.assertStartupInvariants — absoluteCap == 0 excludes market silently", () => {
  it("does not throw when absoluteCap[0] == 0n on a managed market", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(VAULT_ADDRESS)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(CAP_IDS_WETH);
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_ADDRESS])
      .mockResolvedValueOnce([
        REL_CAP, REL_CAP, REL_CAP,
        0n, ABS_CAP, ABS_CAP, // absoluteCap[0] == 0n
      ]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await expect(reader.assertStartupInvariants(BOT_WALLET)).resolves.toBeUndefined();
  });

  it("market with absoluteCap == 0 is excluded from activeMarkets", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(VAULT_ADDRESS)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(CAP_IDS_WETH);
    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_ADDRESS])
      .mockResolvedValueOnce([
        REL_CAP, REL_CAP, REL_CAP,
        0n, ABS_CAP, ABS_CAP,
      ]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [{ ...MARKET_WETH, capIds: [] }]
    );

    await reader.assertStartupInvariants(BOT_WALLET);

    expect(reader.activeMarkets).toHaveLength(0);
  });

  it("when 2 markets are provided and only one has absoluteCap==0, the other remains active", async () => {
    // Market WETH has absoluteCap[0] == 0 → excluded
    // Market WSTETH has all caps OK → included
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1n) // adaptersLength
      .mockResolvedValueOnce(VAULT_ADDRESS) // parentVault
      .mockResolvedValueOnce(true) // isAllocator
      .mockResolvedValueOnce(CAP_IDS_WETH) // adapter.ids(WETH)
      .mockResolvedValueOnce(CAP_IDS_WSTETH); // adapter.ids(WSTETH)

    const multicall = vi
      .fn()
      .mockResolvedValueOnce([ADAPTER_ADDRESS]) // adaptersAt(0)
      // caps for WETH: absoluteCap[0] == 0 → excluded
      .mockResolvedValueOnce([
        REL_CAP, REL_CAP, REL_CAP,
        0n, ABS_CAP, ABS_CAP,
      ])
      // caps for WSTETH: all good
      .mockResolvedValueOnce([
        REL_CAP, REL_CAP, REL_CAP,
        ABS_CAP, ABS_CAP, ABS_CAP,
      ]);

    const client = makeMockClient({ readContract, multicall });
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      [
        { ...MARKET_WETH, capIds: [] },
        { ...MARKET_WSTETH, capIds: [] },
      ]
    );

    await reader.assertStartupInvariants(BOT_WALLET);

    expect(reader.activeMarkets).toHaveLength(1);
    expect(reader.activeMarkets[0].label).toBe(MARKET_WSTETH.label);
  });
});

// ---------------------------------------------------------------------------
// 1g. readFullState — mocked client
// ---------------------------------------------------------------------------

describe("VaultReader.readFullState — mocked client", () => {
  /** Builds a reader that has already passed assertStartupInvariants with 1 active market */
  async function makeReaderAfterStartup(markets: ManagedMarket[] = [MARKET_WETH]) {
    const { readContract, multicall } = makeHealthyStartupMocks(markets);
    const client = makeMockClient({ readContract, multicall });
    const managedMarkets = markets.map((m) => ({ ...m, capIds: [] as Hash[] }));
    const reader = new VaultReader(
      client,
      VAULT_ADDRESS,
      ADAPTER_ADDRESS,
      managedMarkets
    );
    await reader.assertStartupInvariants(BOT_WALLET);
    return { reader, client };
  }

  it("returns vaultAddress equal to the configured address", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    // Wire readFullState multicall: totalAssets + 7 per-market results
    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n, // allocation
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    expect(state.vaultAddress).toBe(VAULT_ADDRESS);
  });

  it("returns adapterAddress equal to the configured adapter", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    expect(state.adapterAddress).toBe(ADAPTER_ADDRESS);
  });

  it("returns totalAssets as a bigint", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    expect(typeof state.totalAssets).toBe("bigint");
    expect(state.totalAssets).toBe(TOTAL_ASSETS_10K);
  });

  it("marketStates length matches the number of active managed markets", async () => {
    const { reader, client } = await makeReaderAfterStartup([MARKET_WETH]);

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    expect(state.marketStates).toHaveLength(1);
  });

  it("each marketState.allocation is a bigint", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      expect(typeof ms.allocation).toBe("bigint");
    }
  });

  it("each marketState.caps has exactly 3 entries", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      expect(ms.caps).toHaveLength(3);
    }
  });

  it("each cap entry has bigint absoluteCap and bigint relativeCap", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      for (const cap of ms.caps) {
        expect(typeof cap.absoluteCap).toBe("bigint");
        expect(typeof cap.relativeCap).toBe("bigint");
      }
    }
  });

  it("allocationPercentage is 0 when totalAssets is 0n", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      0n, // totalAssets = 0
      0n, // allocation = 0
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      expect(ms.allocationPercentage).toBe(0);
    }
  });

  it("allocationPercentage values sum to <= 1.0 across all market states", async () => {
    const { reader, client } = await makeReaderAfterStartup([
      MARKET_WETH,
      MARKET_WSTETH,
    ]);

    // Two markets: 4000 USDC and 3000 USDC allocated, total 10000
    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      4_000_000_000n, // WETH allocation
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
      3_000_000_000n, // WSTETH allocation
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    const sum = state.marketStates.reduce(
      (acc, ms) => acc + ms.allocationPercentage,
      0
    );

    expect(sum).toBeLessThanOrEqual(1.0 + 1e-9); // allow floating-point epsilon
  });

  it("marketData is an empty array (populated by MorphoReader, not VaultReader)", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    (client.multicall as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      TOTAL_ASSETS_10K,
      500_000_000n,
      ABS_CAP, ABS_CAP, ABS_CAP,
      REL_CAP, REL_CAP, REL_CAP,
    ]);

    const state = await reader.readFullState();

    expect(state.marketData).toEqual([]);
  });

  it("readFullState retries and resolves after one multicall failure", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    vi.useFakeTimers();
    const multicall = client.multicall as ReturnType<typeof vi.fn>;
    multicall
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce([
        TOTAL_ASSETS_10K,
        500_000_000n,
        ABS_CAP, ABS_CAP, ABS_CAP,
        REL_CAP, REL_CAP, REL_CAP,
      ]);

    const promise = reader.readFullState();
    await vi.runAllTimersAsync();
    const state = await promise;

    expect(state.totalAssets).toBe(TOTAL_ASSETS_10K);
    vi.useRealTimers();
  });

  it("readFullState throws after all retries are exhausted", async () => {
    const { reader, client } = await makeReaderAfterStartup();

    vi.useFakeTimers();
    const multicall = client.multicall as ReturnType<typeof vi.fn>;
    multicall.mockRejectedValue(new Error("persistent RPC error"));

    const assertion = expect(reader.readFullState()).rejects.toThrow(
      "VaultReader.readFullState failed after 3 attempts"
    );
    await vi.runAllTimersAsync();
    await assertion;

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Anvil fork tests (skipped unless ANVIL_RPC_URL is set)
//
// These tests require:
//   - ANVIL_RPC_URL: RPC URL for an Anvil fork of Ethereum mainnet
//   - VAULT_ADDRESS env var: address of a VaultV2 deployed by script/DeployVault.s.sol
//   - ADAPTER_ADDRESS env var: address of the MorphoMarketV1AdapterV2 deployed alongside the vault
//   - BOT_WALLET env var: address that has been granted the allocator role on the vault
//   - MANAGED_MARKETS_PATH env var: path to a managed-markets.json consistent with the fork deployment
//
// When running locally: set these env vars and run:
//   ANVIL_RPC_URL=http://127.0.0.1:8545 bunx vitest run test/integration/vault.test.ts
// ---------------------------------------------------------------------------

const FORK = process.env["ANVIL_RPC_URL"];
const FORK_VAULT = (process.env["VAULT_ADDRESS"] ?? VAULT_ADDRESS) as Address;
const FORK_ADAPTER = (process.env["ADAPTER_ADDRESS"] ?? ADAPTER_ADDRESS) as Address;
const FORK_BOT_WALLET = (process.env["BOT_WALLET"] ?? BOT_WALLET) as Address;

describe.skipIf(!FORK)("VaultReader against Anvil fork", () => {
  // -------------------------------------------------------------------------
  // Helpers: build a real viem public client from ANVIL_RPC_URL
  // -------------------------------------------------------------------------

  function buildForkClient(): BotPublicClient {
    return createPublicClient({
      chain: mainnet,
      transport: http(FORK!),
    }) as unknown as BotPublicClient;
  }

  /**
   * Loads the managed markets from MANAGED_MARKETS_PATH (JSON file) or falls
   * back to the two USDC markets defined in this test file for convenience.
   *
   * In practice, the QA runner should point MANAGED_MARKETS_PATH to the same
   * file that script/DeployVault.s.sol logged after deployment.
   */
  function loadForkManagedMarkets(): ManagedMarket[] {
    const path = process.env["MANAGED_MARKETS_PATH"];
    if (path) {
      // Dynamic require — works in Node/Bun at runtime; not available at compile time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const raw = require("fs").readFileSync(path, "utf8");
      // Shape matches script/DeployVault.s.sol and its STEP H logged output:
      // a top-level array with fields at the root (no { markets: [...] } wrapper,
      // no nested marketParams object). lltv is stored as a decimal string so
      // the JSON stays strictly valid.
      const parsed: Array<{
        label: string;
        loanToken: `0x${string}`;
        collateralToken: `0x${string}`;
        oracle: `0x${string}`;
        irm: `0x${string}`;
        lltv: string;
      }> = JSON.parse(raw);
      return parsed.map((m) => {
        const marketParams: MarketParams = {
          loanToken: m.loanToken,
          collateralToken: m.collateralToken,
          oracle: m.oracle,
          irm: m.irm,
          lltv: BigInt(m.lltv),
        };
        return {
          label: m.label,
          marketParams,
          marketId: keccak256(
            encodeAbiParameters(
              [{ type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS }],
              [marketParams]
            )
          ) as Hash,
          capIds: [],
        };
      });
    }

    // Default: use the two USDC markets from this file's fixtures.
    return [
      { ...MARKET_WETH, capIds: [] },
      { ...MARKET_WSTETH, capIds: [] },
    ];
  }

  // -------------------------------------------------------------------------
  // 2a. assertStartupInvariants — happy path on a freshly deployed vault
  // -------------------------------------------------------------------------

  it("assertStartupInvariants does not throw on a fresh vault with correct config", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);

    await expect(reader.assertStartupInvariants(FORK_BOT_WALLET)).resolves.toBeUndefined();
  });

  it("activeMarkets is non-empty after successful startup on the fork", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);

    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    expect(reader.activeMarkets.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 2b. assertStartupInvariants — wrong adapter triggers StartupValidationError
  // -------------------------------------------------------------------------

  it("throws StartupValidationError when ADAPTER_ADDRESS is not enabled on the fork vault", async () => {
    const client = buildForkClient();
    const WRONG_ADAPTER: Address = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, WRONG_ADAPTER, markets);

    await expect(reader.assertStartupInvariants(FORK_BOT_WALLET)).rejects.toThrow(
      StartupValidationError
    );
  });

  // -------------------------------------------------------------------------
  // 2c. assertStartupInvariants — botWallet is not an allocator
  // -------------------------------------------------------------------------

  it("throws StartupValidationError when bot wallet is not an allocator on the fork vault", async () => {
    const NOT_ALLOCATOR: Address = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);

    await expect(reader.assertStartupInvariants(NOT_ALLOCATOR)).rejects.toThrow(
      StartupValidationError
    );
  });

  // -------------------------------------------------------------------------
  // 2d. assertStartupInvariants — relativeCap == 0 refuses to start
  //
  // This test cannot be run without deploying a vault where a relativeCap is
  // deliberately set to 0, which requires a separate Foundry setup step.
  // The test is left as a comment describing the expected behavior verified
  // by the mocked-client tests (suite 1e above).
  //
  // Expected behavior (verified in suite 1e):
  //   - Given: adapter is enabled, bot is allocator, but vault.relativeCap(id) == 0n
  //     for any managed market's cap id
  //   - Expected: assertStartupInvariants throws StartupValidationError with message
  //     containing "Refusing to start: market <label> has relativeCap == 0 on cap id <id>..."
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 2e. readFullState — allocations and caps are populated
  // -------------------------------------------------------------------------

  it("readFullState returns vaultAddress matching the fork deployment", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    expect(state.vaultAddress.toLowerCase()).toBe(FORK_VAULT.toLowerCase());
  });

  it("readFullState returns adapterAddress matching the fork deployment", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    expect(state.adapterAddress.toLowerCase()).toBe(FORK_ADAPTER.toLowerCase());
  });

  it("readFullState returns totalAssets as a bigint", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    expect(typeof state.totalAssets).toBe("bigint");
  });

  it("readFullState returns marketStates with length matching active managed markets", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    expect(state.marketStates.length).toBe(reader.activeMarkets.length);
  });

  it("each marketState.allocation is a bigint", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      expect(typeof ms.allocation).toBe("bigint");
    }
  });

  it("each marketState has exactly 3 cap entries", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      expect(ms.caps).toHaveLength(3);
    }
  });

  it("each cap entry has bigint absoluteCap and bigint relativeCap", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    for (const ms of state.marketStates) {
      for (const cap of ms.caps) {
        expect(typeof cap.absoluteCap).toBe("bigint");
        expect(typeof cap.relativeCap).toBe("bigint");
      }
    }
  });

  it("allocationPercentage values across all marketStates sum to <= 1.0", async () => {
    const client = buildForkClient();
    const markets = loadForkManagedMarkets();
    const reader = new VaultReader(client, FORK_VAULT, FORK_ADAPTER, markets);
    await reader.assertStartupInvariants(FORK_BOT_WALLET);

    const state = await reader.readFullState();

    const sum = state.marketStates.reduce(
      (acc, ms) => acc + ms.allocationPercentage,
      0
    );

    // Allow for floating-point rounding
    expect(sum).toBeLessThanOrEqual(1.0 + 1e-6);
  });
});
