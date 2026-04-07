/**
 * Integration tests for src/services/rebalance.service.ts — RebalanceService
 *
 * Updated for V2 single-adapter model (Group 8.3):
 *   - VaultState uses marketStates (not adapters)
 *   - MarketAllocationState has caps array of length 3, relativeCap in WAD
 *   - MorphoReader.readMarketsForManagedMarkets (not readMarketsForAdapters)
 *   - VaultReader constructor takes 4 args
 *   - RebalanceResult.newAllocations uses { marketLabel, percentage }
 *   - RebalanceAction has marketLabel field
 *
 * Strategy: mock all four dependencies at the class/interface boundary.
 *   - VaultReader   → mock object with vi.fn() for readFullState + activeMarkets
 *   - MorphoReader  → mock object with vi.fn() for readMarketsForManagedMarkets
 *   - IExecutor     → mock object with vi.fn() for execute
 *   - Notifier      → mock object with vi.fn() for all notify methods
 *
 * Internal modules (engine.ts / strategy.ts / irm.ts) are NOT mocked.
 * computeRebalanceActions runs on the real mock data returned by the readers.
 *
 * Anvil-gating: tests requiring a real fork are gated on ANVIL_RPC_URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hash } from "viem";
import { RebalanceService } from "../../src/services/rebalance.service.js";
import type { VaultReader } from "../../src/core/chain/vault.js";
import type { MorphoReader } from "../../src/core/chain/morpho.js";
import type { IExecutor } from "../../src/core/chain/executor.js";
import type { Notifier } from "../../src/services/notifier.js";
import type {
  ManagedMarket,
  MarketAllocationState,
  IRMParams,
  MarketData,
  RebalanceAction,
  RebalanceResult,
  VaultState,
} from "../../src/core/rebalancer/types.js";
import { WAD } from "../../src/config/constants.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_ADDRESS: Address = "0x2222222222222222222222222222222222222222";

// Market IDs
const MARKET_ID_A = "0xaaaa000000000000000000000000000000000000000000000000000000000000" as Hash;
const MARKET_ID_B = "0xbbbb000000000000000000000000000000000000000000000000000000000000" as Hash;
const MARKET_ID_C = "0xcccc000000000000000000000000000000000000000000000000000000000000" as Hash;

// Cap IDs
const CAP_ID_0 = "0xd000000000000000000000000000000000000000000000000000000000000000" as Hash;
const CAP_ID_1 = "0xe000000000000000000000000000000000000000000000000000000000000000" as Hash;
const CAP_ID_2 = "0xf000000000000000000000000000000000000000000000000000000000000000" as Hash;

const TX_HASH_1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const TX_HASH_2 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hash;

// 1M USDC expressed in 6-decimal units
const TOTAL_ASSETS_1M = 1_000_000_000_000n;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IRM_PARAMS_STANDARD: IRMParams = {
  baseRate: 0n,
  slope1: 3_170_979_198n,
  slope2: 31_709_791_983n,
  optimalUtilization: 900_000_000_000_000_000n, // 90% in WAD
};

const IRM_PARAMS_HIGH_APY: IRMParams = {
  baseRate: 0n,
  slope1: 3_170_979_198n,
  slope2: 31_709_791_983n,
  optimalUtilization: 900_000_000_000_000_000n,
};

/** Build a ManagedMarket. */
function makeManagedMarket(label: string, marketId: Hash): ManagedMarket {
  return {
    label,
    marketId,
    marketParams: {
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
      oracle: "0x3333333333333333333333333333333333333333" as Address,
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address,
      lltv: 860_000_000_000_000_000n,
    },
    capIds: [CAP_ID_0, CAP_ID_1, CAP_ID_2],
  };
}

/** Build a MarketAllocationState with full WAD relative caps (no restriction). */
function makeMarketAllocationState(
  market: ManagedMarket,
  allocation: bigint,
  totalAssets: bigint
): MarketAllocationState {
  const allocationPercentage =
    totalAssets > 0n
      ? Number((allocation * 10_000n) / totalAssets) / 10_000
      : 0;
  return {
    market,
    allocation,
    allocationPercentage,
    caps: [
      { id: CAP_ID_0, absoluteCap: 1_000_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_1, absoluteCap: 1_000_000_000_000_000n, relativeCap: WAD },
      { id: CAP_ID_2, absoluteCap: 1_000_000_000_000_000n, relativeCap: WAD },
    ],
  };
}

/** Build a MarketData object. */
function makeMarketData(
  marketId: Hash,
  totalSupply: bigint,
  totalBorrow: bigint,
  irmParams: IRMParams = IRM_PARAMS_STANDARD
): MarketData {
  const availableLiquidity =
    totalSupply > totalBorrow ? totalSupply - totalBorrow : 0n;
  const utilization =
    totalSupply > 0n
      ? Number((totalBorrow * 1_000_000n) / totalSupply) / 1_000_000
      : 0;
  const SECONDS_PER_YEAR = 31_536_000n;
  const borrowRate = irmParams.slope1;
  const currentSupplyAPY =
    (Number(borrowRate * SECONDS_PER_YEAR) / Number(WAD)) * utilization;

  return {
    marketId,
    totalSupply,
    totalBorrow,
    availableLiquidity,
    utilization,
    currentSupplyAPY,
    irmParams,
  };
}

const MARKET_A = makeManagedMarket("USDC/WETH 86%", MARKET_ID_A);
const MARKET_B = makeManagedMarket("USDC/wstETH 86%", MARKET_ID_B);
const MARKET_C = makeManagedMarket("USDC/WBTC 86%", MARKET_ID_C);

/**
 * A VaultState that produces rebalance actions (imbalanced markets, different APYs).
 * Market A holds 90% of assets in a low-APY market; Market B holds 10% in high-APY market.
 */
function makeImbalancedVaultState(): VaultState {
  const assetsA = (TOTAL_ASSETS_1M * 9n) / 10n; // 900k USDC
  const assetsB = TOTAL_ASSETS_1M / 10n;          // 100k USDC

  return {
    vaultAddress: VAULT_ADDRESS,
    adapterAddress: ADAPTER_ADDRESS,
    totalAssets: TOTAL_ASSETS_1M,
    marketStates: [
      makeMarketAllocationState(MARKET_A, assetsA, TOTAL_ASSETS_1M),
      makeMarketAllocationState(MARKET_B, assetsB, TOTAL_ASSETS_1M),
    ],
    marketData: [],
  };
}

/** Market data for the imbalanced vault. */
function makeImbalancedMarkets(): MarketData[] {
  return [
    makeMarketData(
      MARKET_ID_A,
      100_000_000_000_000n, // 100M supply
      10_000_000_000_000n,  // 10% utilization → low APY
      IRM_PARAMS_STANDARD
    ),
    makeMarketData(
      MARKET_ID_B,
      5_000_000_000_000n, // 5M supply
      4_500_000_000_000n, // 90% utilization → high APY
      IRM_PARAMS_HIGH_APY
    ),
  ];
}

/**
 * A VaultState that produces NO rebalance actions.
 * Single market holds 100% of assets — target equals current, delta = 0.
 */
function makeBalancedVaultState(): VaultState {
  return {
    vaultAddress: VAULT_ADDRESS,
    adapterAddress: ADAPTER_ADDRESS,
    totalAssets: TOTAL_ASSETS_1M,
    marketStates: [
      makeMarketAllocationState(MARKET_C, TOTAL_ASSETS_1M, TOTAL_ASSETS_1M),
    ],
    marketData: [],
  };
}

/** Market data for the balanced vault. */
function makeBalancedMarkets(): MarketData[] {
  return [
    makeMarketData(
      MARKET_ID_C,
      10_000_000_000_000n,
      8_000_000_000_000n, // 80% utilization
      IRM_PARAMS_STANDARD
    ),
  ];
}

/** A realistic RebalanceResult using the new V2 shape. */
function makeSuccessResult(): RebalanceResult {
  return {
    actions: [
      {
        adapter: ADAPTER_ADDRESS,
        marketLabel: "USDC/WETH 86%",
        direction: "deallocate",
        amount: 300_000_000_000n,
        data: "0x1234abcd",
      },
      {
        adapter: ADAPTER_ADDRESS,
        marketLabel: "USDC/wstETH 86%",
        direction: "allocate",
        amount: 300_000_000_000n,
        data: "0x5678efgh" as `0x${string}`,
      },
    ],
    txHashes: [TX_HASH_1, TX_HASH_2],
    newAllocations: [
      { marketLabel: "USDC/WETH 86%", percentage: 90 },
      { marketLabel: "USDC/wstETH 86%", percentage: 10 },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeConfig(driftThresholdBps = 0) {
  return {
    VAULT_ADDRESS,
    DRIFT_THRESHOLD_BPS: driftThresholdBps,
    GAS_CEILING_GWEI: 100,
    DRY_RUN: false,
    MAX_MARKET_CONCENTRATION_PCT: 50,
    MIN_LIQUIDITY_MULTIPLIER: 1,
  };
}

function makeDeps() {
  const vaultReader = {
    readFullState: vi.fn(),
    activeMarkets: [MARKET_A, MARKET_B] as readonly ManagedMarket[],
  } as unknown as VaultReader;

  const morphoReader = {
    readMarketsForManagedMarkets: vi.fn(),
    readMarketData: vi.fn(),
    readIRMParams: vi.fn(),
  } as unknown as MorphoReader;

  const executor = {
    execute: vi.fn(),
  } as unknown as IExecutor;

  const notifier = {
    notifyRebalanceSuccess: vi.fn(),
    notifyRebalanceFailed: vi.fn(),
    notifyHealthIssue: vi.fn(),
  } as unknown as Notifier;

  return { vaultReader, morphoReader, executor, notifier };
}

// ---------------------------------------------------------------------------
// Helpers: build wired services
// ---------------------------------------------------------------------------

function buildServiceWithActions(deps = makeDeps()) {
  const { vaultReader, morphoReader, executor, notifier } = deps;
  const successResult = makeSuccessResult();

  vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
  vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
    makeImbalancedMarkets()
  );
  vi.mocked(executor.execute).mockResolvedValue(successResult);
  vi.mocked(notifier.notifyRebalanceSuccess).mockResolvedValue(undefined);
  vi.mocked(notifier.notifyRebalanceFailed).mockResolvedValue(undefined);
  vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

  const service = new RebalanceService(
    vaultReader,
    morphoReader,
    executor,
    notifier,
    makeConfig(0)
  );

  return { service, deps, successResult };
}

function buildServiceNoActions(deps = makeDeps()) {
  const { vaultReader, morphoReader, executor, notifier } = deps;

  // Point vaultReader.activeMarkets at balanced markets
  Object.defineProperty(vaultReader, "activeMarkets", {
    get: vi.fn().mockReturnValue([MARKET_C]),
    configurable: true,
  });

  vi.mocked(vaultReader.readFullState).mockResolvedValue(makeBalancedVaultState());
  vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
    makeBalancedMarkets()
  );
  vi.mocked(notifier.notifyRebalanceSuccess).mockResolvedValue(undefined);
  vi.mocked(notifier.notifyRebalanceFailed).mockResolvedValue(undefined);
  vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

  const service = new RebalanceService(
    vaultReader,
    morphoReader,
    executor,
    notifier,
    makeConfig(500)
  );

  return { service, deps };
}

// ===========================================================================
// Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Cycle lock
// ---------------------------------------------------------------------------

describe("RebalanceService — cycle lock", () => {
  it("isRunning starts as false before any run() call", () => {
    const { vaultReader, morphoReader, executor, notifier } = makeDeps();
    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    expect(service.isRunning).toBe(false);
  });

  it("returns null when run() is called while a previous cycle is still running", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    let resolveRead!: (v: VaultState) => void;
    const readPromise = new Promise<VaultState>((res) => {
      resolveRead = res;
    });

    vi.mocked(vaultReader.readFullState).mockReturnValue(readPromise);
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue([]);
    vi.mocked(executor.execute).mockResolvedValue(makeSuccessResult());
    vi.mocked(notifier.notifyRebalanceSuccess).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    const firstRun = service.run();
    const secondResult = await service.run();

    resolveRead(makeBalancedVaultState());
    await firstRun;

    expect(secondResult).toBeNull();
  });

  it("does not call vaultReader.readFullState when cycle lock is held", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    let resolveRead!: (v: VaultState) => void;
    const readPromise = new Promise<VaultState>((res) => {
      resolveRead = res;
    });

    vi.mocked(vaultReader.readFullState).mockReturnValue(readPromise);
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue([]);
    vi.mocked(executor.execute).mockResolvedValue(makeSuccessResult());
    vi.mocked(notifier.notifyRebalanceSuccess).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    const firstRun = service.run();
    await service.run();

    resolveRead(makeBalancedVaultState());
    await firstRun;

    expect(vi.mocked(vaultReader.readFullState)).toHaveBeenCalledTimes(1);
  });

  it("isRunning is false after run() completes successfully", async () => {
    const { service } = buildServiceWithActions();

    await service.run();

    expect(service.isRunning).toBe(false);
  });

  it("isRunning is false after run() encounters a vaultReader error", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockRejectedValue(new Error("RPC timeout"));
    vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    await service.run();

    expect(service.isRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Full successful cycle
// ---------------------------------------------------------------------------

describe("RebalanceService — full successful cycle", () => {
  it("calls vaultReader.readFullState() during run()", async () => {
    const { service, deps } = buildServiceWithActions();

    await service.run();

    // Service calls readFullState twice: once in READ phase, once in _readNewAllocations
    expect(vi.mocked(deps.vaultReader.readFullState)).toHaveBeenCalledTimes(2);
  });

  it("calls morphoReader.readMarketsForManagedMarkets() with active markets", async () => {
    const { service, deps } = buildServiceWithActions();

    await service.run();

    expect(
      vi.mocked(deps.morphoReader.readMarketsForManagedMarkets)
    ).toHaveBeenCalledTimes(1);
  });

  it("calls executor.execute() with the computed actions when actions are present", async () => {
    const { service, deps } = buildServiceWithActions();

    await service.run();

    expect(vi.mocked(deps.executor.execute)).toHaveBeenCalledTimes(1);
    const [actionsArg] = vi.mocked(deps.executor.execute).mock.calls[0];
    expect(Array.isArray(actionsArg)).toBe(true);
    expect((actionsArg as RebalanceAction[]).length).toBeGreaterThan(0);
  });

  it("calls notifier.notifyRebalanceSuccess() after a successful execution", async () => {
    const { service, deps } = buildServiceWithActions();

    await service.run();

    expect(
      vi.mocked(deps.notifier.notifyRebalanceSuccess)
    ).toHaveBeenCalledTimes(1);
  });

  it("returns a RebalanceResult with txHashes on a successful cycle", async () => {
    const { service, successResult } = buildServiceWithActions();

    const result = await service.run();

    expect(result).not.toBeNull();
    expect(result!.txHashes).toEqual(successResult.txHashes);
  });

  it("updates lastRebalanceTimestamp after a successful execution", async () => {
    const { service } = buildServiceWithActions();

    expect(service.lastRebalanceTimestamp).toBeNull();

    await service.run();

    expect(service.lastRebalanceTimestamp).toBeInstanceOf(Date);
  });

  it("updates lastRebalanceResult after a successful execution", async () => {
    const { service, successResult } = buildServiceWithActions();

    await service.run();

    expect(service.lastRebalanceResult).toEqual(successResult);
  });
});

// ---------------------------------------------------------------------------
// 3. No rebalance needed
// ---------------------------------------------------------------------------

describe("RebalanceService — no rebalance needed", () => {
  it("returns a RebalanceResult with empty actions when strategy produces no actions", async () => {
    const { service } = buildServiceNoActions();

    const result = await service.run();

    expect(result).not.toBeNull();
    expect(result!.actions).toEqual([]);
  });

  it("returns a RebalanceResult with empty txHashes when no actions needed", async () => {
    const { service } = buildServiceNoActions();

    const result = await service.run();

    expect(result!.txHashes).toEqual([]);
  });

  it("does NOT call executor.execute() when no actions are needed", async () => {
    const { service, deps } = buildServiceNoActions();

    await service.run();

    expect(vi.mocked(deps.executor.execute)).not.toHaveBeenCalled();
  });

  it("does NOT call notifier.notifyRebalanceSuccess() when no actions needed", async () => {
    const { service, deps } = buildServiceNoActions();

    await service.run();

    expect(vi.mocked(deps.notifier.notifyRebalanceSuccess)).not.toHaveBeenCalled();
  });

  it("does NOT call notifier.notifyRebalanceFailed() when no actions needed", async () => {
    const { service, deps } = buildServiceNoActions();

    await service.run();

    expect(vi.mocked(deps.notifier.notifyRebalanceFailed)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Error boundaries
// ---------------------------------------------------------------------------

describe("RebalanceService — error boundaries", () => {
  it("calls notifier.notifyHealthIssue('rpc_failure', ...) when vaultReader.readFullState throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockRejectedValue(
      new Error("RPC node unavailable")
    );
    vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    await service.run();

    expect(vi.mocked(notifier.notifyHealthIssue)).toHaveBeenCalledWith(
      "rpc_failure",
      expect.any(String)
    );
  });

  it("returns null when vaultReader.readFullState throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockRejectedValue(
      new Error("RPC node unavailable")
    );
    vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    const result = await service.run();

    expect(result).toBeNull();
  });

  it("does NOT call executor.execute() when vaultReader.readFullState throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockRejectedValue(
      new Error("RPC node unavailable")
    );
    vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    await service.run();

    expect(vi.mocked(executor.execute)).not.toHaveBeenCalled();
  });

  it("calls notifier.notifyRebalanceFailed() when executor.execute() throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockRejectedValue(new Error("transaction reverted"));
    vi.mocked(notifier.notifyRebalanceFailed).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig(0)
    );

    await service.run();

    expect(vi.mocked(notifier.notifyRebalanceFailed)).toHaveBeenCalledTimes(1);
  });

  it("returns null when executor.execute() throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockRejectedValue(new Error("transaction reverted"));
    vi.mocked(notifier.notifyRebalanceFailed).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig(0)
    );

    const result = await service.run();

    expect(result).toBeNull();
  });

  it("run() still returns the result when notifier.notifyRebalanceSuccess throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;
    const successResult = makeSuccessResult();

    vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockResolvedValue(successResult);
    vi.mocked(notifier.notifyRebalanceSuccess).mockRejectedValue(
      new Error("Telegram API down")
    );

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig(0)
    );

    const result = await service.run();

    expect(result).toEqual(successResult);
  });

  it("run() still returns null (not throw) when notifier.notifyHealthIssue throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockRejectedValue(
      new Error("RPC node unavailable")
    );
    vi.mocked(notifier.notifyHealthIssue).mockRejectedValue(
      new Error("Telegram network error")
    );

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    let result: RebalanceResult | null | "threw" = "threw";
    try {
      result = await service.run();
    } catch {
      result = "threw";
    }

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. State tracking
// ---------------------------------------------------------------------------

describe("RebalanceService — state tracking", () => {
  it("updates lastCheckTimestamp on every run() call", async () => {
    const { service } = buildServiceWithActions();

    expect(service.lastCheckTimestamp).toBeNull();

    await service.run();

    expect(service.lastCheckTimestamp).toBeInstanceOf(Date);
  });

  it("updates lastCheckTimestamp even when run() encounters a read error", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockRejectedValue(new Error("RPC down"));
    vi.mocked(notifier.notifyHealthIssue).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    await service.run();

    expect(service.lastCheckTimestamp).toBeInstanceOf(Date);
  });

  it("does NOT update lastRebalanceTimestamp when no actions are needed", async () => {
    const { service } = buildServiceNoActions();

    await service.run();

    expect(service.lastRebalanceTimestamp).toBeNull();
  });

  it("does NOT update lastRebalanceTimestamp when executor.execute() throws", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;

    vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockRejectedValue(new Error("revert"));
    vi.mocked(notifier.notifyRebalanceFailed).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig(0)
    );

    await service.run();

    expect(service.lastRebalanceTimestamp).toBeNull();
  });

  it("getStatus() returns all four fields correctly after a successful run", async () => {
    const { service, successResult } = buildServiceWithActions();

    await service.run();

    const status = service.getStatus();

    expect(status.isRunning).toBe(false);
    expect(status.lastCheckTimestamp).toBeInstanceOf(Date);
    expect(status.lastRebalanceTimestamp).toBeInstanceOf(Date);
    expect(status.lastRebalanceResult).toEqual(successResult);
  });

  it("getStatus() returns isRunning=false and null timestamps before any run", () => {
    const { vaultReader, morphoReader, executor, notifier } = makeDeps();
    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    const status = service.getStatus();

    expect(status.isRunning).toBe(false);
    expect(status.lastCheckTimestamp).toBeNull();
    expect(status.lastRebalanceTimestamp).toBeNull();
    expect(status.lastRebalanceResult).toBeNull();
  });

  it("getStatus() returns lastRebalanceResult=null after a no-op cycle", async () => {
    const { service } = buildServiceNoActions();

    await service.run();

    const status = service.getStatus();

    expect(status.lastRebalanceResult).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. New V2 shape — newAllocations uses marketLabel
// ---------------------------------------------------------------------------

describe("RebalanceService — V2 newAllocations shape", () => {
  it("lastRebalanceResult.newAllocations entries have marketLabel and percentage", async () => {
    const deps = makeDeps();
    const { vaultReader, morphoReader, executor, notifier } = deps;
    const successResult = makeSuccessResult();

    vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
    vi.mocked(morphoReader.readMarketsForManagedMarkets).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockResolvedValue(successResult);
    vi.mocked(notifier.notifyRebalanceSuccess).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig(0)
    );

    await service.run();

    const result = service.lastRebalanceResult;
    expect(result).not.toBeNull();

    for (const alloc of result!.newAllocations) {
      expect(typeof alloc.marketLabel).toBe("string");
      expect(typeof alloc.percentage).toBe("number");
    }
  });
});
