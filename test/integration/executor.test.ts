/**
 * Integration tests for src/core/chain/executor.ts
 *
 * Strategy: mock walletClient and publicClient at the viem boundary
 * (writeContract, getGasPrice, waitForTransactionReceipt). All Executor and
 * DryRunExecutor code paths execute without any network access.
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
const ADAPTER_A: Address = "0x2222222222222222222222222222222222222222";
const ADAPTER_B: Address = "0x3333333333333333333333333333333333333333";

const TX_HASH_1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;
const TX_HASH_2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hash;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeallocateAction(adapter: Address = ADAPTER_A, amount = 1_000_000n): RebalanceAction {
  return {
    adapter,
    direction: "deallocate",
    amount,
    data: "0x",
  };
}

function makeAllocateAction(adapter: Address = ADAPTER_B, amount = 1_000_000n): RebalanceAction {
  return {
    adapter,
    direction: "allocate",
    amount,
    data: "0x",
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

// ---------------------------------------------------------------------------
// 1. Gas ceiling check — exceeds ceiling
// ---------------------------------------------------------------------------

describe("Executor — gas ceiling exceeded", () => {
  it("returns a result with 'gas ceiling exceeded' reason when getGasPrice is above ceiling", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(100_000_000_000n); // 100 gwei
    const { publicClient, walletClient } = makeMockClients({ getGasPrice });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));
    const actions = [makeDeallocateAction()];

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect((result as { reason?: string }).reason).toBe("gas ceiling exceeded");
  });

  it("returns empty txHashes when gas ceiling is exceeded", async () => {
    const getGasPrice = vi.fn().mockResolvedValue(100_000_000_000n); // 100 gwei
    const { publicClient, walletClient } = makeMockClients({ getGasPrice });
    const executor = new Executor(walletClient, publicClient, makeConfig({ GAS_CEILING_GWEI: 50 }));
    const actions = [makeDeallocateAction()];

    const result = await executor.execute(actions, VAULT_ADDRESS);

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
    const getGasPrice = vi.fn().mockResolvedValue(10_000_000_000n); // 10 gwei, ceiling 50
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

  it("uses exact ceiling boundary — gas equal to ceiling does not skip (strictly greater than triggers skip)", async () => {
    // Gas ceiling of 10 gwei; getGasPrice returns exactly 10 gwei (10e9 wei).
    // The check is gasPrice > gasCeilingWei, so equal should proceed.
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
// 3. Deallocate action
// ---------------------------------------------------------------------------

describe("Executor — deallocate action", () => {
  it("calls writeContract with functionName 'deallocate' for a deallocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([makeDeallocateAction(ADAPTER_A)], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "deallocate" })
    );
  });

  it("calls writeContract with the vault address for a deallocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([makeDeallocateAction(ADAPTER_A)], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: VAULT_ADDRESS })
    );
  });

  it("calls writeContract with the adapter address in args for a deallocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());
    const action = makeDeallocateAction(ADAPTER_A, 500_000n);

    await executor.execute([action], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([ADAPTER_A]),
      })
    );
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
// 4. Allocate action
// ---------------------------------------------------------------------------

describe("Executor — allocate action", () => {
  it("calls writeContract with functionName 'allocate' for an allocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute([makeAllocateAction(ADAPTER_B)], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "allocate" })
    );
  });

  it("calls writeContract with the adapter address in args for an allocate action", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH_1);
    const { publicClient, walletClient } = makeMockClients({ writeContract });
    const executor = new Executor(walletClient, publicClient, makeConfig());
    const action = makeAllocateAction(ADAPTER_B, 750_000n);

    await executor.execute([action], VAULT_ADDRESS);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([ADAPTER_B]),
      })
    );
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
      [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)],
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
      [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)],
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
      [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)],
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
      [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)],
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
      .mockResolvedValueOnce(TX_HASH_1) // first action submitted
      .mockResolvedValueOnce(TX_HASH_2); // should never be reached
    const waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({ status: "reverted" }); // first tx reverts
    const { publicClient, walletClient } = makeMockClients({
      writeContract,
      waitForTransactionReceipt,
    });
    const executor = new Executor(walletClient, publicClient, makeConfig());

    await executor.execute(
      [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)],
      VAULT_ADDRESS
    );

    // Second writeContract must never be called after the first tx reverts
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
      [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)],
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
    const actions = [makeDeallocateAction(ADAPTER_A, 500_000n), makeAllocateAction(ADAPTER_B, 500_000n)];

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
      makeDeallocateAction(`0x${i.toString().padStart(40, "0")}` as Address)
    );

    const result = await executor.execute(actions, VAULT_ADDRESS);

    expect(result.txHashes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Executor DRY_RUN mode
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
    const actions = [makeDeallocateAction(ADAPTER_A), makeAllocateAction(ADAPTER_B)];

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
