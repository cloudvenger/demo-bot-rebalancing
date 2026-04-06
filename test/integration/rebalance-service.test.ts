/**
 * Integration tests for src/services/rebalance.service.ts — RebalanceService
 *
 * Strategy: mock all four dependencies at the class/interface boundary.
 *   - VaultReader   → mock object with vi.fn() for readFullState
 *   - MorphoReader  → mock object with vi.fn() for readMarketsForAdapters
 *   - IExecutor     → mock object with vi.fn() for execute
 *   - Notifier      → mock object with vi.fn() for all notify methods
 *
 * Internal modules (engine.ts / strategy.ts / irm.ts) are NOT mocked.
 * computeRebalanceActions runs on the real mock data returned by the readers.
 *
 * Mock data uses a 1M USDC vault (1_000_000e6 = 1_000_000_000_000n) with
 * 2–3 adapters and market data that reliably triggers or suppresses rebalancing
 * depending on the scenario.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hash } from "viem";
import { RebalanceService } from "../../src/services/rebalance.service.js";
import type { VaultReader } from "../../src/core/chain/vault.js";
import type { MorphoReader } from "../../src/core/chain/morpho.js";
import type { IExecutor } from "../../src/core/chain/executor.js";
import type { Notifier } from "../../src/services/notifier.js";
import type {
  AdapterState,
  IRMParams,
  MarketData,
  RebalanceAction,
  RebalanceResult,
  VaultState,
} from "../../src/core/rebalancer/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_A: Address = "0x2222222222222222222222222222222222222222";
const ADAPTER_B: Address = "0x3333333333333333333333333333333333333333";
const ADAPTER_C: Address = "0x4444444444444444444444444444444444444444";

const TX_HASH_1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const TX_HASH_2 =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hash;

// 1M USDC expressed in 6-decimal units
const TOTAL_ASSETS_1M = 1_000_000_000_000n;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * IRM params for a mid-utilization market (~60% util, ~5% APY).
 * Used for markets where we want mild yield without triggering concentration
 * penalties.
 */
const IRM_PARAMS_STANDARD: IRMParams = {
  baseRate: 0n,
  slope1: 3_170_979_198n, // ~10% APY / year in WAD-per-second at kink
  slope2: 31_709_791_983n,
  optimalUtilization: 900_000_000_000_000_000n, // 90% in WAD
};

/**
 * IRM params for a high-APY market (~80% util, ~12% APY).
 */
const IRM_PARAMS_HIGH_APY: IRMParams = {
  baseRate: 0n,
  slope1: 3_170_979_198n,
  slope2: 31_709_791_983n,
  optimalUtilization: 900_000_000_000_000_000n,
};

/**
 * Build a standard AdapterState.
 */
function makeAdapterState(
  address: Address,
  realAssets: bigint,
  totalAssets: bigint,
  absoluteCap = 0n,
  relativeCap = 10_000
): AdapterState {
  const allocationPercentage =
    totalAssets > 0n
      ? Number((realAssets * 10_000n) / totalAssets) / 10_000
      : 0;
  return {
    address,
    adapterType: "morpho-market-v1",
    realAssets,
    allocationPercentage,
    absoluteCap,
    relativeCap,
  };
}

/**
 * Build a MarketData object.
 */
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
  // Approximate supply APY: borrowRate * SECONDS_PER_YEAR * utilization / WAD
  const SECONDS_PER_YEAR = 31_536_000n;
  const WAD = 1_000_000_000_000_000_000n;
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

/**
 * A VaultState that produces rebalance actions (imbalanced adapters, different
 * APYs).  Adapter A holds 90% of assets in a low-APY market; Adapter B holds
 * 10% in a high-APY market.  With driftThresholdBps=0 the strategy will
 * produce at least one action.
 */
function makeImbalancedVaultState(): VaultState {
  const assetsA = (TOTAL_ASSETS_1M * 9n) / 10n; // 900 000 USDC
  const assetsB = TOTAL_ASSETS_1M / 10n; // 100 000 USDC

  const adapterA = makeAdapterState(ADAPTER_A, assetsA, TOTAL_ASSETS_1M);
  const adapterB = makeAdapterState(ADAPTER_B, assetsB, TOTAL_ASSETS_1M);

  return {
    vaultAddress: VAULT_ADDRESS,
    totalAssets: TOTAL_ASSETS_1M,
    adapters: [adapterA, adapterB],
    markets: [],
  };
}

/**
 * Market data for the imbalanced vault state.
 * Market A: large, low utilization → low APY.
 * Market B: smaller, high utilization → higher APY.
 */
function makeImbalancedMarkets(): MarketData[] {
  const marketA = makeMarketData(
    "0xaaaa000000000000000000000000000000000000000000000000000000000000" as Hash,
    100_000_000_000_000n, // 100M USDC supply — A has tiny concentration
    10_000_000_000_000n,  // 10% utilization → very low APY
    IRM_PARAMS_STANDARD
  );
  const marketB = makeMarketData(
    "0xbbbb000000000000000000000000000000000000000000000000000000000000" as Hash,
    5_000_000_000_000n, // 5M USDC supply
    4_500_000_000_000n, // 90% utilization → high APY
    IRM_PARAMS_HIGH_APY
  );
  return [marketA, marketB];
}

/**
 * A VaultState that produces NO rebalance actions.
 * Single adapter holds 100% of assets — target equals current, delta = 0.
 */
function makeBalancedVaultState(): VaultState {
  const adapterA = makeAdapterState(
    ADAPTER_A,
    TOTAL_ASSETS_1M,
    TOTAL_ASSETS_1M
  );

  return {
    vaultAddress: VAULT_ADDRESS,
    totalAssets: TOTAL_ASSETS_1M,
    adapters: [adapterA],
    markets: [],
  };
}

/**
 * Market data for the balanced vault state.
 * Single market — the sole adapter holds all assets at target already.
 */
function makeBalancedMarkets(): MarketData[] {
  return [
    makeMarketData(
      "0xcccc000000000000000000000000000000000000000000000000000000000000" as Hash,
      10_000_000_000_000n,
      8_000_000_000_000n, // 80% utilization — decent APY, single adapter
      IRM_PARAMS_STANDARD
    ),
  ];
}

/**
 * A realistic RebalanceResult returned by a successful executor.execute() call.
 */
function makeSuccessResult(): RebalanceResult {
  return {
    actions: [
      {
        adapter: ADAPTER_A,
        direction: "deallocate",
        amount: 300_000_000_000n,
        data: "0x",
      },
      {
        adapter: ADAPTER_B,
        direction: "allocate",
        amount: 300_000_000_000n,
        data: "0x",
      },
    ],
    txHashes: [TX_HASH_1, TX_HASH_2],
    newAllocations: [
      { adapter: ADAPTER_A, percentage: 0.6 },
      { adapter: ADAPTER_B, percentage: 0.4 },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

/**
 * Minimal config satisfying the RebalanceService constructor requirements.
 * driftThresholdBps=0 ensures actions are generated for imbalanced state.
 */
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

/**
 * Create fresh vi.fn() mocks for all four dependencies.
 * Each call returns independent mocks so tests do not share state.
 */
function makeDeps() {
  const vaultReader = {
    readFullState: vi.fn(),
    readTotalAssets: vi.fn(),
    readAdapters: vi.fn(),
    readCaps: vi.fn(),
  } as unknown as VaultReader;

  const morphoReader = {
    readMarketsForAdapters: vi.fn(),
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
// Helper: build a RebalanceService wired for a successful cycle with actions
// ---------------------------------------------------------------------------

function buildServiceWithActions(deps = makeDeps()) {
  const { vaultReader, morphoReader, executor, notifier } = deps;
  const successResult = makeSuccessResult();

  vi.mocked(vaultReader.readFullState).mockResolvedValue(makeImbalancedVaultState());
  vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue(
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
    makeConfig(0) // driftThresholdBps=0 ensures actions are generated
  );

  return { service, deps, successResult };
}

// ---------------------------------------------------------------------------
// Helper: build a RebalanceService wired for a no-rebalance cycle
// ---------------------------------------------------------------------------

function buildServiceNoActions(deps = makeDeps()) {
  const { vaultReader, morphoReader, executor, notifier } = deps;

  vi.mocked(vaultReader.readFullState).mockResolvedValue(makeBalancedVaultState());
  vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue(
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
    makeConfig(500) // 5% threshold — single adapter at 100% → target=current → no action
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

    // Simulate a slow readFullState so the lock is held during the second call.
    let resolveRead!: (v: VaultState) => void;
    const readPromise = new Promise<VaultState>((res) => {
      resolveRead = res;
    });

    vi.mocked(vaultReader.readFullState).mockReturnValue(readPromise);
    vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue([]);
    vi.mocked(executor.execute).mockResolvedValue(makeSuccessResult());
    vi.mocked(notifier.notifyRebalanceSuccess).mockResolvedValue(undefined);

    const service = new RebalanceService(
      vaultReader,
      morphoReader,
      executor,
      notifier,
      makeConfig()
    );

    // Start the first run — it will hang waiting on readFullState.
    const firstRun = service.run();

    // While first run is in-flight, a second call should return null immediately.
    const secondResult = await service.run();

    // Resolve the first run so we can clean up.
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
    vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue([]);
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

    // Second call while first is running — must not trigger another readFullState.
    await service.run();

    resolveRead(makeBalancedVaultState());
    await firstRun;

    // readFullState called exactly once (by the first run, not the second).
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

    vi.mocked(vaultReader.readFullState).mockRejectedValue(
      new Error("RPC timeout")
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

    expect(
      vi.mocked(deps.vaultReader.readFullState)
    ).toHaveBeenCalledTimes(1);
  });

  it("calls morphoReader.readMarketsForAdapters() with adapters from vault state", async () => {
    const { service, deps } = buildServiceWithActions();
    const vaultState = makeImbalancedVaultState();
    vi.mocked(deps.vaultReader.readFullState).mockResolvedValue(vaultState);

    await service.run();

    expect(
      vi.mocked(deps.morphoReader.readMarketsForAdapters)
    ).toHaveBeenCalledWith(vaultState.adapters);
  });

  it("calls executor.execute() with the computed actions when actions are present", async () => {
    const { service, deps } = buildServiceWithActions();

    await service.run();

    expect(vi.mocked(deps.executor.execute)).toHaveBeenCalledTimes(1);
    // First arg should be an array of RebalanceAction objects
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

    vi.mocked(vaultReader.readFullState).mockResolvedValue(
      makeImbalancedVaultState()
    );
    vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockRejectedValue(
      new Error("transaction reverted")
    );
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

    vi.mocked(vaultReader.readFullState).mockResolvedValue(
      makeImbalancedVaultState()
    );
    vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue(
      makeImbalancedMarkets()
    );
    vi.mocked(executor.execute).mockRejectedValue(
      new Error("transaction reverted")
    );
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

    vi.mocked(vaultReader.readFullState).mockResolvedValue(
      makeImbalancedVaultState()
    );
    vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue(
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

    // Telegram failure must not crash run() — result is still returned.
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

    // Must not throw even though both vaultReader and notifier fail.
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

    vi.mocked(vaultReader.readFullState).mockRejectedValue(
      new Error("RPC down")
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

    // lastCheckTimestamp is set before the try block — it must be set even on error.
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

    vi.mocked(vaultReader.readFullState).mockResolvedValue(
      makeImbalancedVaultState()
    );
    vi.mocked(morphoReader.readMarketsForAdapters).mockResolvedValue(
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
