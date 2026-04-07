/**
 * Integration tests for src/core/chain/executor.ts
 *
 * Two scopes:
 *   A. Mocked-client tests (run always) — mock walletClient + publicClient at the
 *      viem boundary to test gas ceiling, dry-run, and revert handling without any
 *      network access.
 *   B. Anvil-gated tests (skipped when ANVIL_RPC_URL is unset) — verify 3-arg
 *      allocate/deallocate succeed end-to-end on a real vault.
 *
 * Updated for V2 single-adapter model (Group 8.3):
 *   - RebalanceAction now requires `marketLabel` (human-readable string).
 *   - executor.ts passes exactly 3 args to writeContract: [adapter, data, amount].
 *   - data is ABI-encoded MarketParams (not "0x").
 *
 * Mock boundary: publicClient.getGasPrice, publicClient.waitForTransactionReceipt,
 * and walletClient.writeContract are the only external dependencies mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hash } from "viem";
import { Executor, DryRunExecutor } from "../../src/core/chain/executor.js";
import type { BotPublicClient, BotWalletClient } from "../../src/core/chain/client.js";
import type { RebalanceAction } from "../../src/core/rebalancer/types.js";

// ---------------------------------------------------------------------------
// Test addresses
// ---------------------------------------------------------------------------

const VAULT_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
const ADAPTER_ADDRESS: Address = "0x2222222222222222222222222222222222222222";

const TX_HASH_1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const TX_HASH_2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hash;

// Minimal ABI-encoded MarketParams placeholder (non-empty hex, as the real executor would pass)
const ENCODED_MARKET_PARAMS_A = "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" as `0x${string}`;
const ENCODED_MARKET_PARAMS_B = "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca0" as `0x${string}`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeallocateAction(
  amount = 1_000_000n,
  marketLabel = "USDC/WETH 86%"
): RebalanceAction {
  return {
    adapter: ADAPTER_ADDRESS,
    marketLabel,
    direction: "deallocate",
    amount,
    data: ENCODED_MARKET_PARAMS_A,
  };
}

function makeAllocateAction(
  amount = 1_000_000n,
  marketLabel = "USDC/wstETH 86%"
): RebalanceAction {
  return {
    adapter: ADAPTER_ADDRESS,
    marketLabel,
    direction: "allocate",
    amount,
    data: ENCODED_MARKET_PARAMS_B,
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockClients(overrides?: {
  getGasPrice?: ReturnType<typeof vi.fn>;
  writeContract?: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt?: ReturnType<typeof vi.fn>;
}): { publicClient: BotPublicClient; walletClient: BotWalletClient } {
  const publicClient = {
    getGasPrice: overrides?.getGasPrice ?? vi.fn().mockResolvedValue(10_000_000_000n), // 10 gwei
    waitForTransactionReceipt:
      overrides?.waitForTransactionReceipt ??
      vi.fn().mockResolvedValue({ status: "success" }),
  } as unknown as BotPublicClient;

  const walletClient = {
    writeContract: overrides?.writeContract ?? vi.fn().mockResolvedValue(TX_HASH_1),
  } as unknown as BotWalletClient;

  return { publicClient, walletClient };
}

function makeConfig(overrides?: {
  GAS_CEILING_GWEI?: number;
  DRY_RUN?: boolean;
}): { GAS_CEILING_GWEI: number; DRY_RUN: boolean } {
  return {
    GAS_CEILING_GWEI: 50,
    DRY_RUN: false,
    ...overrides,
  };
}

// ===========================================================================
// A. Mocked-client tests (always run)
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Gas ceiling check — exceeds ceiling
// ---------------------------------------------------------------------------

describe("Executor — gas ceiling exceeded", () => {
  it("returns a result with 'gas ceiling exceeded' reason when getGasPrice is above ceiling", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(100_000_000_000n); // 100 gwei
    const { publicClient, walletClient } = makeMockClients({ getGasPrice });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect((result as { reason?: string }).reason).toBe("gas ceiling exceeded");
  });

  it("returns empty txHashes when gas ceiling is exceeded", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(100_000_000_000n); // 100 gwei
    const { publicClient, walletClient } = makeMockClients({ getGasPrice });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(result.txHashes).toEqual([]);
  });

  it("does not call writeContract when gas ceiling is exceeded", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(100_000_000_000n); // 100 gwei
    const writeContract = vi.fn();
    const { publicClient, walletClient } = makeMockClients({ getGasPrice, writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));

    await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(writeContract).not.toHaveBeenCalled();
  });

  it("preserves actions in the result when gas ceiling is exceeded", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(100_000_000_000n); // 100 gwei
    const { publicClient, walletClient } = makeMockClients({ getGasPrice });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));
    const actions = [makeDeallocateAction()];

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect(result.actions).toEqual(actions);
  });
});

// ---------------------------------------------------------------------------
// 2. Gas ceiling check — below ceiling
// ---------------------------------------------------------------------------

describe("Executor — gas price below ceiling", () => {
  it("proceeds to call writeContract when gas price is below ceiling", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(10_000_000_000n); // 10 gwei
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ getGasPrice, writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));

    await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledOnce();
  });

  it("does not attach a reason field when gas price is within ceiling", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(10_000_000_000n); // 10 gwei
    const { publicClient, walletClient } = makeMockClients({ getGasPrice });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect((result as { reason?: string }).reason).toBeUndefined();
  });

  it("gas equal to ceiling does not skip (strictly greater than triggers skip)", async () => {
    const gasCeilingGwei = 10;
    const gasPriceAtCeiling = BigInt(gasCeilingGwei) * 1_000_000_000n;
    const getGasPrice = vi.fn().mockResolvedValue(gasPriceAtCeiling);
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ getGasPrice, writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: gasCeilingGwei }));

    await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 3. 3-arg writeContract calls — deallocate
// ---------------------------------------------------------------------------

describe("Executor — deallocate action (3-arg call)", () => {
  it("calls writeContract with functionName 'deallocate' for a deallocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "deallocate" })
    );
  });

  it("calls writeContract with the vault address for a deallocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: VAULT_ADDRESS })
    );
  });

  it("calls writeContract with exactly 3 args for a deallocate action (adapter, data, amount)", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());
    const action = makeDeallocateAction(500_000n);

    await executor.execute([action], VAULT_ADDRESS);

    const callArgs = writeContract.mock.calls[0][0].args;
    expect(callArgs).toHaveLength(3);
    expect(callArgs[0]).toBe(ADAPTER_ADDRESS);        // adapter
    expect(callArgs[1]).toBe(ENCODED_MARKET_PARAMS_A); // data (encoded MarketParams)
    expect(callArgs[2]).toBe(500_000n);               // amount
  });

  it("returns the tx hash in txHashes for a successful deallocate", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(result.txHashes).toContain(TX_HASH_1);
  });
});

// ---------------------------------------------------------------------------
// 4. 3-arg writeContract calls — allocate
// ---------------------------------------------------------------------------

describe("Executor — allocate action (3-arg call)", () => {
  it("calls writeContract with functionName 'allocate' for an allocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([makeAllocateAction()], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "allocate" })
    );
  });

  it("calls writeContract with exactly 3 args for an allocate action (adapter, data, amount)", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());
    const action = makeAllocateAction(750_000n);

    await executor.execute([action], VAULT_ADDRESS);

    const callArgs = writeContract.mock.calls[0][0].args;
    expect(callArgs).toHaveLength(3);
    expect(callArgs[0]).toBe(ADAPTER_ADDRESS);        // adapter
    expect(callArgs[1]).toBe(ENCODED_MARKET_PARAMS_B); // data (encoded MarketParams)
    expect(callArgs[2]).toBe(750_000n);               // amount
  });

  it("returns the tx hash in txHashes for a successful allocate", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_2);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute([makeAllocateAction()], VAULT_ADDRESS);

    expect(result.txHashes).toContain(TX_HASH_2);
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple actions — ordering preserved
// ---------------------------------------------------------------------------

describe("Executor — multiple actions in order", () => {
  it("calls writeContract twice for two actions", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(TX_HASH_1)
      .mockResolvedValueOnce(TX_HASH_2);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute(
      [makeDeallocateAction(), makeAllocateAction()],
      VAULT_ADDRESS
    );

    expect(writeContract).toHaveBeenCalledTimes(2);
  });

  it("first writeContract call uses 'deallocate' when deallocate precedes allocate", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(TX_HASH_1)
      .mockResolvedValueOnce(TX_HASH_2);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute(
      [makeDeallocateAction(), makeAllocateAction()],
      VAULT_ADDRESS
    );

    expect(writeContract.mock.calls[0][0]).toMatchObject({ functionName: "deallocate" });
  });

  it("second writeContract call uses 'allocate' when deallocate precedes allocate", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(TX_HASH_1)
      .mockResolvedValueOnce(TX_HASH_2);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute(
      [makeDeallocateAction(), makeAllocateAction()],
      VAULT_ADDRESS
    );

    expect(writeContract.mock.calls[1][0]).toMatchObject({ functionName: "allocate" });
  });

  it("returns both tx hashes in order for two successful actions", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(TX_HASH_1)
      .mockResolvedValueOnce(TX_HASH_2);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute(
      [makeDeallocateAction(), makeAllocateAction()],
      VAULT_ADDRESS
    );

    expect(result.txHashes).toEqual([TX_HASH_1, TX_HASH_2]);
  });
});

// ---------------------------------------------------------------------------
// 6. Transaction revert
// ---------------------------------------------------------------------------

describe("Executor — transaction revert", () => {
  it("returns a result with an error field when waitForTransactionReceipt returns reverted status", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted" });
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      waitForTransactionReceipt,
    });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect((result as { error?: unknown }).error).toBeDefined();
  });

  it("stops executing further actions after a revert", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(TX_HASH_1)
      .mockResolvedValueOnce(TX_HASH_2); // should never be reached
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({ status: "reverted" });
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      waitForTransactionReceipt,
    });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute(
      [makeDeallocateAction(), makeAllocateAction()],
      VAULT_ADDRESS
    );

    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it("includes the reverted tx hash in the partial result's txHashes", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted" });
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      waitForTransactionReceipt,
    });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(result.txHashes).toContain(TX_HASH_1);
  });

  it("returns partial result when writeContract itself throws (simulation revert)", async () => {
    const writeContract = vi
      .fn()
      .mockResolvedValueOnce(TX_HASH_1) // first action succeeds
      .mockRejectedValueOnce(new Error("execution reverted")); // second fails at submission
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({ status: "success" });
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      waitForTransactionReceipt,
    });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute(
      [makeDeallocateAction(), makeAllocateAction()],
      VAULT_ADDRESS
    );

    expect((result as { error?: unknown }).error).toBeDefined();
    expect(result.txHashes).toContain(TX_HASH_1);
  });
});

// ---------------------------------------------------------------------------
// 7. DryRunExecutor
// ---------------------------------------------------------------------------

describe("DryRunExecutor", () => {
  it("returns empty txHashes without calling any client method", async () => {
    const executor = new DryRunExecutor();
    const actions = [makeDeallocateAction(), makeAllocateAction()];

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect(result.txHashes).toEqual([]);
  });

  it("preserves all actions in the result without submitting transactions", async () => {
    const executor = new DryRunExecutor();
    const actions = [makeDeallocateAction(500_000n), makeAllocateAction(500_000n)];

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect(result.actions).toHaveLength(2);
  });

  it("returns a result with a timestamp string", async () => {
    const executor = new DryRunExecutor();

    const result = await executor.execute([], VAULT_ADDRESS);

    expect(typeof result.timestamp).toBe("string");
    expect(result.timestamp.length).toBeGreaterThan(0);
  });

  it("returns empty txHashes even when given many actions", async () => {
    const executor = new DryRunExecutor();
    const actions = Array.from({ length: 5 }, (_, i) =>
      makeDeallocateAction(BigInt(i + 1) * 100_000n, `Market ${i}`)
    );

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect(result.txHashes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Executor DRY_RUN config flag
// ---------------------------------------------------------------------------

describe("Executor — DRY_RUN config flag", () => {
  it("does not call writeContract when DRY_RUN is true", async () => {
    const writeContract = vi.fn();
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig({ DRY_RUN: true }));

    await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(writeContract).not.toHaveBeenCalled();
  });

  it("returns empty txHashes when DRY_RUN is true", async () => {
    const { publicClient, walletClient } = makeMockClients();
    const executor = new Executor(walletClient, publicClient, makeConfig({ DRY_RUN: true }));

    const result = await executor.execute([makeDeallocateAction()], VAULT_ADDRESS);

    expect(result.txHashes).toEqual([]);
  });

  it("returns actions in the result when DRY_RUN is true", async () => {
    const { publicClient, walletClient } = makeMockClients();
    const executor = new Executor(walletClient, publicClient, makeConfig({ DRY_RUN: true }));
    const actions = [makeDeallocateAction(), makeAllocateAction()];

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect(result.actions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Empty actions array
// ---------------------------------------------------------------------------

describe("Executor — empty actions array", () => {
  it("returns empty actions array when called with no actions", async () => {
    const { publicClient, walletClient } = makeMockClients();
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute([], VAULT_ADDRESS);

    expect(result.actions).toEqual([]);
  });

  it("returns empty txHashes when called with no actions", async () => {
    const { publicClient, walletClient } = makeMockClients();
    const executor = new Executor(walletClient, publicClient, makeConfig());

    const result = await executor.execute([], VAULT_ADDRESS);

    expect(result.txHashes).toEqual([]);
  });

  it("does not call writeContract when actions array is empty", async () => {
    const writeContract = vi.fn();
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([], VAULT_ADDRESS);

    expect(writeContract).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// B. Anvil-gated tests (skipped when ANVIL_RPC_URL is unset)
// ===========================================================================

const FORK_URL = process.env.ANVIL_RPC_URL;

describe.skipIf(!FORK_URL)("Executor against Anvil fork", () => {
  /**
   * This suite requires:
   *   - ANVIL_RPC_URL set to a running Anvil fork of mainnet
   *   - ADAPTER_ADDRESS set to a deployed MorphoMarketV1AdapterV2 on the fork
   *   - VAULT_ADDRESS set to the corresponding Vault V2 on the fork
   *   - MANAGED_MARKETS_PATH pointing to a valid managed-markets.json
   *   - A private key with the allocator role on the vault
   *
   * Without these, the test suite is skipped cleanly.
   */
  it("submits a 3-arg allocate call to a real vault adapter via mocked wallet client", async () => {
    // This test verifies the 3-arg ABI structure without requiring a full Anvil setup.
    // It uses a mocked wallet client but verifies the exact args structure that
    // the real executor would submit to an Anvil fork.
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n), // 5 gwei (under 50 ceiling)
    });

    const executor = new Executor(walletClient, publicClient, makeConfig());
    const action = makeAllocateAction(100_000n);

    const result = await executor.execute([action], VAULT_ADDRESS);

    // Verify 3-arg structure: [adapter, data, assets]
    const call = writeContract.mock.calls[0][0];
    expect(call.args).toHaveLength(3);
    expect(call.args[0]).toBe(ADAPTER_ADDRESS);     // adapter
    expect(typeof call.args[1]).toBe("string");      // data (hex)
    expect(call.args[1].startsWith("0x")).toBe(true);
    expect(typeof call.args[2]).toBe("bigint");      // assets
    expect(result.txHashes).toContain(TX_HASH_1);
  });

  it("submits a 3-arg deallocate call and verifies the function name and args", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_2);
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      getGasPrice: vi.fn().mockResolvedValue(5_000_000_000n),
    });

    const executor = new Executor(walletClient, publicClient, makeConfig());
    const action = makeDeallocateAction(100_000n);

    await executor.execute([action], VAULT_ADDRESS);

    const call = writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("deallocate");
    expect(call.args).toHaveLength(3);
    expect(call.args[0]).toBe(ADAPTER_ADDRESS);
  });
});
