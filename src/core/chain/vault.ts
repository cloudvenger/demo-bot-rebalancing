import type { Address, Hash } from "viem";
import {
  VAULT_V2_ABI,
  ADAPTER_ABI,
  CONTRACT_ADDRESSES,
} from "../../config/constants.js";
import type { AdapterState, AdapterType, VaultState } from "../rebalancer/types.js";
import type { BotPublicClient } from "./client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum attempts when an RPC call fails. */
const MAX_RETRIES = 3 as const;

/** Base delay in milliseconds for exponential backoff. */
const BASE_RETRY_DELAY_MS = 500 as const;

// ---------------------------------------------------------------------------
// Helpers
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
 * @param fn  Async function to execute.
 * @param label  Human-readable label used in error messages.
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

/**
 * Determines the adapter type by checking which known factory address is
 * returned as the adapter's factory (or by falling back to a heuristic).
 *
 * Strategy: attempt to read `factory()` on the adapter and compare to known
 * factory addresses.  If the call reverts or the address is unrecognised, fall
 * back to `"morpho-market-v1"` (the most common type).
 */
async function resolveAdapterType(
  publicClient: BotPublicClient,
  adapterAddress: Address
): Promise<AdapterType> {
  try {
    const factory = await publicClient.readContract({
      address: adapterAddress,
      abi: [
        {
          name: "factory",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "address" }],
        },
      ],
      functionName: "factory",
    });

    if (
      (factory as string).toLowerCase() ===
      CONTRACT_ADDRESSES.MorphoVaultV1AdapterFactory.toLowerCase()
    ) {
      return "morpho-vault-v1";
    }

    return "morpho-market-v1";
  } catch {
    // If the adapter does not expose `factory()` or the call reverts, default
    // to the market adapter type which is significantly more common.
    return "morpho-market-v1";
  }
}

// ---------------------------------------------------------------------------
// VaultReader
// ---------------------------------------------------------------------------

/**
 * Reads state from a Morpho Vault V2 contract.
 *
 * All read methods that touch the chain use multicall where possible to
 * guarantee that all values in a snapshot belong to the same block.
 *
 * Usage:
 * ```ts
 * const reader = new VaultReader(publicClient, vaultAddress);
 * const state  = await reader.readFullState();
 * ```
 */
export class VaultReader {
  private readonly publicClient: BotPublicClient;
  private readonly vaultAddress: Address;

  constructor(publicClient: BotPublicClient, vaultAddress: Address) {
    this.publicClient = publicClient;
    this.vaultAddress = vaultAddress;
  }

  // -------------------------------------------------------------------------
  // Public read methods
  // -------------------------------------------------------------------------

  /**
   * Reads the total assets currently under management in the vault.
   *
   * @returns Total assets as a bigint (vault's underlying asset native decimals).
   */
  async readTotalAssets(): Promise<bigint> {
    return withRetry(
      () =>
        this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_V2_ABI,
          functionName: "totalAssets",
        }),
      "VaultReader.readTotalAssets"
    );
  }

  /**
   * Reads the absolute and relative caps for a given risk ID.
   *
   * @param riskId  Bytes32 risk identifier (typically the adapter address or
   *                a market ID used as the cap key).
   */
  async readCaps(
    riskId: Hash
  ): Promise<{ absoluteCap: bigint; relativeCap: number }> {
    const result = await withRetry(
      () =>
        this.publicClient.readContract({
          address: this.vaultAddress,
          abi: VAULT_V2_ABI,
          functionName: "caps",
          args: [riskId],
        }),
      `VaultReader.readCaps(${riskId})`
    );

    const [absoluteCap, relativeCap] = result as [bigint, bigint];

    return {
      absoluteCap,
      // relativeCap is stored on-chain as a uint256 (basis points).
      relativeCap: Number(relativeCap),
    };
  }

  /**
   * Discovers all enabled adapters on the vault and reads their on-chain state
   * in batched multicall calls.
   *
   * Steps:
   * 1. Read `adaptersLength()` to know how many adapters exist.
   * 2. Multicall `adaptersAt(i)` for each index — single block snapshot.
   * 3. Multicall `realAssets()` across all adapters — same block snapshot.
   * 4. Resolve adapter types (heuristic — one extra call per adapter).
   * 5. Read caps per adapter.
   * 6. Compute `allocationPercentage` from totalAssets.
   *
   * @param totalAssets  Pre-fetched total assets (avoids a redundant call).
   *                     Pass `0n` to compute allocation percentages as 0.
   */
  async readAdapters(totalAssets: bigint): Promise<AdapterState[]> {
    return withRetry(async () => {
      // ------------------------------------------------------------------
      // Step 1: how many adapters?
      // ------------------------------------------------------------------
      const adaptersLength = await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: VAULT_V2_ABI,
        functionName: "adaptersLength",
      });

      const count = Number(adaptersLength);

      if (count === 0) {
        return [];
      }

      // ------------------------------------------------------------------
      // Step 2: enumerate adapter addresses via multicall
      // ------------------------------------------------------------------
      const adapterIndexCalls = Array.from({ length: count }, (_, i) => ({
        address: this.vaultAddress,
        abi: VAULT_V2_ABI,
        functionName: "adaptersAt" as const,
        args: [BigInt(i)] as const,
      }));

      const adapterAddressResults = await this.publicClient.multicall({
        contracts: adapterIndexCalls,
        allowFailure: false,
      });

      const adapterAddresses = adapterAddressResults as Address[];

      // ------------------------------------------------------------------
      // Step 3: read realAssets() for all adapters via multicall
      // ------------------------------------------------------------------
      const realAssetsCalls = adapterAddresses.map((addr) => ({
        address: addr,
        abi: ADAPTER_ABI,
        functionName: "realAssets" as const,
      }));

      const realAssetsResults = await this.publicClient.multicall({
        contracts: realAssetsCalls,
        allowFailure: false,
      });

      const realAssetsValues = realAssetsResults as bigint[];

      // ------------------------------------------------------------------
      // Step 4: resolve adapter types (sequential — one call per adapter)
      // ------------------------------------------------------------------
      const adapterTypes = await Promise.all(
        adapterAddresses.map((addr) => resolveAdapterType(this.publicClient, addr))
      );

      // ------------------------------------------------------------------
      // Step 5: read caps per adapter (adapter address used as risk ID)
      // ------------------------------------------------------------------
      const capsCalls = adapterAddresses.map((addr) => ({
        address: this.vaultAddress,
        abi: VAULT_V2_ABI,
        functionName: "caps" as const,
        args: [addr as Hash] as const,
      }));

      const capsResults = await this.publicClient.multicall({
        contracts: capsCalls,
        allowFailure: false,
      });

      // ------------------------------------------------------------------
      // Step 6: build AdapterState objects
      // ------------------------------------------------------------------
      return adapterAddresses.map((address, i) => {
        const realAssets = realAssetsValues[i];
        const [absoluteCap, relativeCap] = capsResults[i] as [bigint, bigint];

        const allocationPercentage =
          totalAssets > 0n
            ? Number(realAssets * 10_000n / totalAssets) / 10_000
            : 0;

        return {
          address,
          adapterType: adapterTypes[i],
          realAssets,
          allocationPercentage,
          absoluteCap,
          relativeCap: Number(relativeCap),
        } satisfies AdapterState;
      });
    }, "VaultReader.readAdapters");
  }

  /**
   * Reads the complete vault state in a single consistent snapshot.
   *
   * Calls `totalAssets()` first (single call), then multicalls everything else
   * to minimise block-boundary drift between reads.
   *
   * @returns VaultState — ready to be passed to the strategy engine.
   */
  async readFullState(): Promise<VaultState> {
    const totalAssets = await this.readTotalAssets();
    const adapters = await this.readAdapters(totalAssets);

    return {
      vaultAddress: this.vaultAddress,
      totalAssets,
      adapters,
      // markets is populated by MorphoReader — VaultReader owns only vault state.
      markets: [],
    };
  }
}
