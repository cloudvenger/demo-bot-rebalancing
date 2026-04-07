import type { Address, Hash } from "viem";
import { encodeAbiParameters, keccak256 } from "viem";
import {
  VAULT_V2_ABI,
  ADAPTER_ABI,
  MARKET_PARAMS_ABI_COMPONENTS,
  WAD,
} from "../../config/constants.js";
import type {
  ManagedMarket,
  MarketAllocationState,
  MarketParams,
  VaultState,
} from "../rebalancer/types.js";
import type { BotPublicClient } from "./client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum attempts when an RPC call fails. */
const MAX_RETRIES = 3 as const;

/** Base delay in milliseconds for exponential backoff. */
const BASE_RETRY_DELAY_MS = 500 as const;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown by assertStartupInvariants() when a critical on-chain invariant is
 * violated at startup.  The bot must not proceed when this is thrown.
 */
export class StartupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupValidationError";
  }
}

// ---------------------------------------------------------------------------
// Helpers — retry / sleep
// ---------------------------------------------------------------------------

/**
 * Sleeps for `ms` milliseconds.
 * Used by the retry loop — production code only; removed by the test harness.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `fn` with up to MAX_RETRIES attempts, applying exponential backoff
 * between failures.
 *
 * @param fn    Async function to execute.
 * @param label Human-readable label used in error messages.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `${label} failed after ${MAX_RETRIES} attempts: ${String(lastError)}`
  );
}

// ---------------------------------------------------------------------------
// Cap-id preimage computation
// ---------------------------------------------------------------------------

/**
 * Computes the 3 cap ids that MorphoMarketV1AdapterV2 derives for a given
 * (adapter, marketParams) pair.
 *
 * These ids are the keccak256 hashes of exact ABI-encoded preimages.  Any
 * deviation from the preimage the contract uses will produce a different hash
 * and cause vault.allocate to revert with ZeroAbsoluteCap.
 *
 * Verified preimages (PLAN.md § Verified cap-id preimages):
 *   id[0]: keccak256(abi.encode("this", address(adapter)))
 *   id[1]: keccak256(abi.encode("collateralToken", marketParams.collateralToken))
 *   id[2]: keccak256(abi.encode("this/marketParams", address(adapter), marketParams))
 *
 * @param adapterAddress  The MorphoMarketV1AdapterV2 contract address.
 * @param marketParams    The on-chain MarketParams struct for the target market.
 * @returns Tuple [adapterId, collateralId, marketSpecificId].
 */
export function computeMarketCapIds(
  adapterAddress: Address,
  marketParams: MarketParams
): [Hash, Hash, Hash] {
  // id[0]: adapter-wide — applies to every market the adapter routes to
  const adapterId = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "address" }],
      ["this", adapterAddress]
    )
  );

  // id[1]: collateral-token — applies to every market sharing the same collateral
  const collateralId = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "address" }],
      ["collateralToken", marketParams.collateralToken]
    )
  );

  // id[2]: market-specific — applies to exactly one Morpho Blue market
  const marketSpecificId = keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "address" },
        { type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS },
      ],
      ["this/marketParams", adapterAddress, marketParams]
    )
  );

  return [adapterId, collateralId, marketSpecificId];
}

// ---------------------------------------------------------------------------
// VaultReader
// ---------------------------------------------------------------------------

/**
 * Reads state from a Morpho Vault V2 contract.
 *
 * Responsibilities:
 *   - At startup: assert all on-chain invariants (adapter enabled, allocator
 *     role, cap-id preimage correctness, relativeCap != 0 for managed markets).
 *   - Each cycle: multicall a consistent snapshot of totalAssets + per-market
 *     allocation + all 3 cap values per market.
 *
 * Does NOT read Morpho Blue market state or IRM params — that is MorphoReader's
 * responsibility (interface segregation per CLAUDE.md SOLID principles).
 *
 * VaultState.marketData is returned as an empty array; it is populated by
 * MorphoReader before the state is passed to the strategy engine.
 *
 * Usage:
 * ```ts
 * const reader = new VaultReader(publicClient, vaultAddress, adapterAddress, managedMarkets);
 * await reader.assertStartupInvariants(botWallet);
 * const state = await reader.readFullState();
 * ```
 */
export class VaultReader {
  private readonly publicClient: BotPublicClient;
  private readonly vaultAddress: Address;
  private readonly adapterAddress: Address;

  /**
   * The working set of managed markets, filtered at startup.  Markets with
   * absoluteCap == 0 on any of their 3 ids are excluded from this array after
   * assertStartupInvariants() runs.  readFullState() only reads these markets.
   */
  private activeManagedMarkets: ManagedMarket[];

  /**
   * @param publicClient    viem public client (mainnet, with retry transport).
   * @param vaultAddress    Vault V2 contract address (from VAULT_ADDRESS env var).
   * @param adapterAddress  Single MorphoMarketV1AdapterV2 address (from ADAPTER_ADDRESS).
   * @param managedMarkets  Markets loaded from MANAGED_MARKETS_PATH JSON file.
   *                        capIds arrays will be mutated in-place during
   *                        assertStartupInvariants().
   */
  constructor(
    publicClient: BotPublicClient,
    vaultAddress: Address,
    adapterAddress: Address,
    managedMarkets: ManagedMarket[]
  ) {
    this.publicClient = publicClient;
    this.vaultAddress = vaultAddress;
    this.adapterAddress = adapterAddress;
    // Start with all markets; assertStartupInvariants filters inactive ones.
    this.activeManagedMarkets = managedMarkets;
  }

  // -------------------------------------------------------------------------
  // Startup invariants
  // -------------------------------------------------------------------------

  /**
   * Validates all on-chain invariants required for safe bot operation.
   * Must be called once at startup, before the first rebalance cycle.
   *
   * Steps (in order):
   *   1. Assert ADAPTER_ADDRESS is listed in vault.adaptersAt(0..n).
   *   2. Assert adapter.parentVault() == vaultAddress.
   *   3. Assert vault.isAllocator(botWallet) == true.
   *   4. For each managed market: compute 3 cap ids locally and assert they
   *      match adapter.ids(marketParams) exactly (preimage correctness check).
   *      Mutates market.capIds in-place with the on-chain values.
   *   5. For each managed market: refuse to start if any relativeCap == 0n.
   *   6. Markets with absoluteCap == 0 on any id are logged and excluded from
   *      the active market set (not a fatal error — just not allocatable).
   *
   * @param botWallet  The bot wallet address (used to check the allocator role).
   * @throws {StartupValidationError} on any failed invariant.
   */
  async assertStartupInvariants(botWallet: Address): Promise<void> {
    // ---- Step 1: verify adapter is enabled on the vault --------------------
    await this._assertAdapterEnabled();

    // ---- Step 2: verify adapter.parentVault() == vaultAddress -------------
    await this._assertAdapterParentVault();

    // ---- Step 3: verify botWallet has the allocator role -------------------
    await this._assertAllocatorRole(botWallet);

    // ---- Steps 4, 5, 6: per-market validation ------------------------------
    const activeMarkets: ManagedMarket[] = [];

    for (const market of this.activeManagedMarkets) {
      const excluded = await this._validateMarketAndPopulateCapIds(market);
      if (!excluded) {
        activeMarkets.push(market);
      }
    }

    // Replace the full market list with only the allocatable subset.
    this.activeManagedMarkets = activeMarkets;
  }

  // -------------------------------------------------------------------------
  // Full state read (called each cycle)
  // -------------------------------------------------------------------------

  /**
   * Reads the complete vault state in a single consistent multicall snapshot.
   *
   * Multicall structure:
   *   - vault.totalAssets()
   *   - For each active market:
   *       vault.allocation(marketSpecificId)   (id[2])
   *       vault.absoluteCap(id[0..2]) × 3
   *       vault.relativeCap(id[0..2]) × 3
   *   Total calls: 1 + (N × 7)
   *
   * All reads use allowFailure: false so any single RPC error fails the entire
   * snapshot (partial state is worse than no state for a rebalancing bot).
   *
   * @returns VaultState with marketData: [] — MorphoReader fills that field.
   */
  async readFullState(): Promise<VaultState> {
    return withRetry(async () => {
      const markets = this.activeManagedMarkets;

      // ---- Build multicall contracts list ----------------------------------
      type ContractCall = {
        address: Address;
        abi: typeof VAULT_V2_ABI;
        functionName: string;
        args?: readonly unknown[];
      };

      const calls: ContractCall[] = [];

      // [0]: totalAssets
      calls.push({
        address: this.vaultAddress,
        abi: VAULT_V2_ABI,
        functionName: "totalAssets",
      });

      // [1 + i*7 + 0]: allocation(marketSpecificId)
      // [1 + i*7 + 1]: absoluteCap(id[0])
      // [1 + i*7 + 2]: absoluteCap(id[1])
      // [1 + i*7 + 3]: absoluteCap(id[2])
      // [1 + i*7 + 4]: relativeCap(id[0])
      // [1 + i*7 + 5]: relativeCap(id[1])
      // [1 + i*7 + 6]: relativeCap(id[2])
      for (const market of markets) {
        const [id0, id1, id2] = market.capIds as [Hash, Hash, Hash];

        calls.push({
          address: this.vaultAddress,
          abi: VAULT_V2_ABI,
          functionName: "allocation",
          args: [id2] as const,
        });

        for (const id of [id0, id1, id2]) {
          calls.push({
            address: this.vaultAddress,
            abi: VAULT_V2_ABI,
            functionName: "absoluteCap",
            args: [id] as const,
          });
        }

        for (const id of [id0, id1, id2]) {
          calls.push({
            address: this.vaultAddress,
            abi: VAULT_V2_ABI,
            functionName: "relativeCap",
            args: [id] as const,
          });
        }
      }

      // ---- Execute multicall -----------------------------------------------
      const results = await this.publicClient.multicall({
        contracts: calls as Parameters<typeof this.publicClient.multicall>[0]["contracts"],
        allowFailure: false,
      });

      // ---- Parse results ---------------------------------------------------
      const totalAssets = results[0] as bigint;

      const marketStates: MarketAllocationState[] = markets.map((market, i) => {
        const base = 1 + i * 7;

        const allocation = results[base] as bigint;
        const absId0 = results[base + 1] as bigint;
        const absId1 = results[base + 2] as bigint;
        const absId2 = results[base + 3] as bigint;
        const relId0 = results[base + 4] as bigint;
        const relId1 = results[base + 5] as bigint;
        const relId2 = results[base + 6] as bigint;

        const [id0, id1, id2] = market.capIds as [Hash, Hash, Hash];

        const allocationPercentage =
          totalAssets > 0n
            ? Number((allocation * 10_000n) / totalAssets) / 10_000
            : 0;

        return {
          market,
          allocation,
          allocationPercentage,
          caps: [
            { id: id0, absoluteCap: absId0, relativeCap: relId0 },
            { id: id1, absoluteCap: absId1, relativeCap: relId1 },
            { id: id2, absoluteCap: absId2, relativeCap: relId2 },
          ],
        } satisfies MarketAllocationState;
      });

      return {
        vaultAddress: this.vaultAddress,
        adapterAddress: this.adapterAddress,
        totalAssets,
        marketStates,
        // marketData is populated by MorphoReader — VaultReader does not own it.
        marketData: [],
      } satisfies VaultState;
    }, "VaultReader.readFullState");
  }

  // -------------------------------------------------------------------------
  // Private startup helpers
  // -------------------------------------------------------------------------

  /**
   * Enumerates vault.adaptersAt(0..adaptersLength()) and asserts the configured
   * adapterAddress is present.
   */
  private async _assertAdapterEnabled(): Promise<void> {
    const adaptersLength = await withRetry(
      () =>
        this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_V2_ABI,
          functionName: "adaptersLength",
        }),
      "VaultReader._assertAdapterEnabled: adaptersLength"
    );

    const count = Number(adaptersLength);

    if (count === 0) {
      throw new StartupValidationError(
        `Refusing to start: vault ${this.vaultAddress} has no enabled adapters. ` +
          `Expected adapter ${this.adapterAddress} to be present.`
      );
    }

    // Multicall adaptersAt(0..n-1) for a consistent snapshot.
    const indexCalls = Array.from({ length: count }, (_, i) => ({
      address: this.vaultAddress,
      abi: VAULT_V2_ABI,
      functionName: "adaptersAt" as const,
      args: [BigInt(i)] as const,
    }));

    const adapterAddresses = (await this.publicClient.multicall({
      contracts: indexCalls,
      allowFailure: false,
    })) as Address[];

    const normalizedTarget = this.adapterAddress.toLowerCase();
    const found = adapterAddresses.some(
      (addr) => addr.toLowerCase() === normalizedTarget
    );

    if (!found) {
      throw new StartupValidationError(
        `Refusing to start: configured ADAPTER_ADDRESS ${this.adapterAddress} ` +
          `is not enabled on vault ${this.vaultAddress}. ` +
          `Enabled adapters: [${adapterAddresses.join(", ")}].`
      );
    }
  }

  /**
   * Reads adapter.parentVault() and asserts it equals the configured vaultAddress.
   */
  private async _assertAdapterParentVault(): Promise<void> {
    const parentVault = await withRetry(
      () =>
        this.publicClient.readContract({
          address: this.adapterAddress,
          abi: ADAPTER_ABI,
          functionName: "parentVault",
        }),
      "VaultReader._assertAdapterParentVault"
    );

    if ((parentVault as string).toLowerCase() !== this.vaultAddress.toLowerCase()) {
      throw new StartupValidationError(
        `Refusing to start: adapter ${this.adapterAddress} has parentVault = ` +
          `${parentVault}, but configured VAULT_ADDRESS is ${this.vaultAddress}. ` +
          `The adapter does not belong to the configured vault.`
      );
    }
  }

  /**
   * Reads vault.isAllocator(botWallet) and asserts it is true.
   */
  private async _assertAllocatorRole(botWallet: Address): Promise<void> {
    const isAllocator = await withRetry(
      () =>
        this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_V2_ABI,
          functionName: "isAllocator",
          args: [botWallet],
        }),
      "VaultReader._assertAllocatorRole"
    );

    if (!isAllocator) {
      throw new StartupValidationError(
        `Refusing to start: bot wallet ${botWallet} does not have the allocator ` +
          `role on vault ${this.vaultAddress}. ` +
          `The curator must call vault.setIsAllocator(botWallet, true) before ` +
          `the bot can submit transactions.`
      );
    }
  }

  /**
   * For a single managed market:
   *   1. Computes the 3 cap ids locally and reads adapter.ids(marketParams).
   *   2. Asserts locally computed ids match on-chain ids exactly.
   *   3. Mutates market.capIds in-place with the verified on-chain ids.
   *   4. Reads relativeCap for all 3 ids and refuses to start if any == 0n.
   *   5. Reads absoluteCap for all 3 ids; if any == 0n, logs and returns true
   *      (excluded from active markets).
   *
   * @returns true if the market should be excluded from the rebalance loop,
   *          false if it is allocatable.
   */
  private async _validateMarketAndPopulateCapIds(
    market: ManagedMarket
  ): Promise<boolean> {
    const { label, marketParams } = market;

    // ---- Step 4a: compute ids locally --------------------------------------
    const [localId0, localId1, localId2] = computeMarketCapIds(
      this.adapterAddress,
      marketParams
    );

    // ---- Step 4b: read adapter.ids(marketParams) ----------------------------
    const onChainIds = await withRetry(
      () =>
        this.publicClient.readContract({
          address: this.adapterAddress,
          abi: ADAPTER_ABI,
          functionName: "ids",
          args: [marketParams],
        }),
      `VaultReader._validateMarketAndPopulateCapIds: adapter.ids(${label})`
    );

    const [onChainId0, onChainId1, onChainId2] = onChainIds as [Hash, Hash, Hash];

    // ---- Step 4c: assert preimage correctness -------------------------------
    if (localId0 !== onChainId0) {
      throw new StartupValidationError(
        `Refusing to start: cap id[0] (adapter-wide) mismatch for market "${label}". ` +
          `Locally computed: ${localId0}, on-chain from adapter.ids(): ${onChainId0}. ` +
          `ABI encoding for "this/adapter" preimage is incorrect — ` +
          `fix computeMarketCapIds() before proceeding.`
      );
    }

    if (localId1 !== onChainId1) {
      throw new StartupValidationError(
        `Refusing to start: cap id[1] (collateral-token) mismatch for market "${label}". ` +
          `Locally computed: ${localId1}, on-chain from adapter.ids(): ${onChainId1}. ` +
          `ABI encoding for "collateralToken" preimage is incorrect — ` +
          `fix computeMarketCapIds() before proceeding.`
      );
    }

    if (localId2 !== onChainId2) {
      throw new StartupValidationError(
        `Refusing to start: cap id[2] (market-specific) mismatch for market "${label}". ` +
          `Locally computed: ${localId2}, on-chain from adapter.ids(): ${onChainId2}. ` +
          `ABI encoding for "this/marketParams" preimage is incorrect — ` +
          `fix computeMarketCapIds() before proceeding.`
      );
    }

    // ---- Step 4d: populate capIds in-place (source of truth = on-chain) ----
    market.capIds = [onChainId0, onChainId1, onChainId2];

    // ---- Steps 5 & 6: read relativeCap and absoluteCap for all 3 ids --------
    const capReads = await withRetry(
      () =>
        this.publicClient.multicall({
          contracts: [
            {
              address: this.vaultAddress,
              abi: VAULT_V2_ABI,
              functionName: "relativeCap" as const,
              args: [onChainId0] as const,
            },
            {
              address: this.vaultAddress,
              abi: VAULT_V2_ABI,
              functionName: "relativeCap" as const,
              args: [onChainId1] as const,
            },
            {
              address: this.vaultAddress,
              abi: VAULT_V2_ABI,
              functionName: "relativeCap" as const,
              args: [onChainId2] as const,
            },
            {
              address: this.vaultAddress,
              abi: VAULT_V2_ABI,
              functionName: "absoluteCap" as const,
              args: [onChainId0] as const,
            },
            {
              address: this.vaultAddress,
              abi: VAULT_V2_ABI,
              functionName: "absoluteCap" as const,
              args: [onChainId1] as const,
            },
            {
              address: this.vaultAddress,
              abi: VAULT_V2_ABI,
              functionName: "absoluteCap" as const,
              args: [onChainId2] as const,
            },
          ],
          allowFailure: false,
        }),
      `VaultReader._validateMarketAndPopulateCapIds: caps(${label})`
    );

    const [rel0, rel1, rel2, abs0, abs1, abs2] = capReads as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];

    const capIds: [Hash, Hash, Hash] = [onChainId0, onChainId1, onChainId2];
    const relativeCaps: [bigint, bigint, bigint] = [rel0, rel1, rel2];
    const absoluteCaps: [bigint, bigint, bigint] = [abs0, abs1, abs2];

    // ---- Step 5: refuse to start if any relativeCap == 0n ------------------
    // relativeCap == 0 means "allocation must be 0", effectively forbidding
    // the market. The intended "no relative cap" sentinel is WAD (1e18).
    for (let k = 0; k < 3; k++) {
      if (relativeCaps[k] === 0n) {
        throw new StartupValidationError(
          `Refusing to start: market ${label} has relativeCap == 0 on cap id ${capIds[k]}. ` +
            `This forbids any allocation to this market. ` +
            `If you meant 'no relative cap', set relativeCap to WAD (1e18). ` +
            `If you meant to forbid this market, remove it from MANAGED_MARKETS.`
        );
      }
    }

    // ---- Step 6: exclude markets where ANY absoluteCap == 0n ---------------
    // absoluteCap == 0 means vault.allocate will revert with ZeroAbsoluteCap.
    // This is logged as informational (not an error — operator just hasn't set
    // the cap yet) and the market is excluded from the active set.
    for (let k = 0; k < 3; k++) {
      if (absoluteCaps[k] === 0n) {
        // Using console.warn here intentionally — this is a startup diagnostic,
        // not a structured log. Callers (e.g. RebalanceService) will wrap this
        // in structured Pino logging once a logger is available.
        console.warn(
          `[VaultReader] ignored: no absolute cap configured on cap id ${capIds[k]} ` +
            `for market "${label}". ` +
            `This market will be excluded from the rebalance loop until a curator ` +
            `calls vault.increaseAbsoluteCap(idData, cap) for this id.`
        );
        return true; // excluded
      }
    }

    // Market passed all checks — include in the active set.
    return false;
  }

  // -------------------------------------------------------------------------
  // Accessor
  // -------------------------------------------------------------------------

  /**
   * Returns the list of markets that passed startup validation and are eligible
   * for allocation reads and rebalancing.
   *
   * Available after assertStartupInvariants() completes.
   */
  get activeMarkets(): readonly ManagedMarket[] {
    return this.activeManagedMarkets;
  }
}
