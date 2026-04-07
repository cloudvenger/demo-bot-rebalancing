/**
 * Unit tests for computeMarketCapIds — pure helper exported from vault.ts
 *
 * Task: qa-8.2
 *
 * These tests do NOT require Anvil or any network access.
 * computeMarketCapIds is a pure function: given (adapterAddress, marketParams)
 * it returns a deterministic [adapterId, collateralId, marketSpecificId] tuple.
 *
 * Each test independently verifies one property of the function.
 * Expected values are computed inline using viem primitives (keccak256 +
 * encodeAbiParameters) so there is no circular dependency on the source.
 *
 * Verified preimages (PLAN.md § Verified cap-id preimages):
 *   id[0]: keccak256(abi.encode("this", address(adapter)))
 *   id[1]: keccak256(abi.encode("collateralToken", marketParams.collateralToken))
 *   id[2]: keccak256(abi.encode("this/marketParams", address(adapter), marketParams))
 */

import { describe, it, expect } from "vitest";
import { keccak256, encodeAbiParameters, getAddress } from "viem";
import type { Address } from "viem";
import { computeMarketCapIds } from "../../src/core/chain/vault.js";
import { MARKET_PARAMS_ABI_COMPONENTS } from "../../src/config/constants.js";
import type { MarketParams } from "../../src/core/rebalancer/types.js";

// ---------------------------------------------------------------------------
// Fixtures
//
// All addresses must be EIP-55 checksum-valid — viem enforces this at runtime.
// We use getAddress() to compute the checksum of arbitrary 20-byte hex strings.
// ---------------------------------------------------------------------------

const ADAPTER_ADDRESS: Address = getAddress("0x1100000000000000000000000000000000000001");
const OTHER_ADAPTER_ADDRESS: Address = getAddress("0x2200000000000000000000000000000000000002");

/** AdaptiveCurveIRM mainnet address (used in all real USDC markets) */
const ADAPTIVE_CURVE_IRM: Address = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";

/** USDC mainnet — used as loanToken */
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

/** WETH mainnet — collateral for market A */
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/** wstETH mainnet — collateral for market B */
const WSTETH: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";

/** Morpho oracle address — placeholder, real value does not matter for encoding */
const ORACLE: Address = getAddress("0xdddddddddddddddddddddddddddddddddddddddd");

/** USDC/WETH 86% lltv in WAD */
const LLTV_86: bigint = 860_000_000_000_000_000n;

/** USDC/WETH 77.5% lltv in WAD — different lltv, same collateral as LLTV_86 */
const LLTV_77: bigint = 770_000_000_000_000_000n;

const MARKET_PARAMS_WETH: MarketParams = {
  loanToken: USDC,
  collateralToken: WETH,
  oracle: ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: LLTV_86,
};

const MARKET_PARAMS_WSTETH: MarketParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: LLTV_86,
};

/**
 * Same as MARKET_PARAMS_WETH but with a different lltv.
 * Shares collateralToken with MARKET_PARAMS_WETH.
 */
const MARKET_PARAMS_WETH_77: MarketParams = {
  loanToken: USDC,
  collateralToken: WETH,
  oracle: ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: LLTV_77,
};

// ---------------------------------------------------------------------------
// Reference computation helpers
// (independent from the source under test — no circular dependency)
// ---------------------------------------------------------------------------

function refAdapterId(adapter: Address): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "address" }],
      ["this", adapter]
    )
  );
}

function refCollateralId(collateralToken: Address): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "address" }],
      ["collateralToken", collateralToken]
    )
  );
}

function refMarketSpecificId(adapter: Address, mp: MarketParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "address" },
        { type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS },
      ],
      ["this/marketParams", adapter, mp]
    )
  );
}

// ---------------------------------------------------------------------------
// Tests: return type and structure
// ---------------------------------------------------------------------------

describe("computeMarketCapIds — return type and structure", () => {
  it("returns an array of exactly 3 elements", () => {
    const ids = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(ids).toHaveLength(3);
  });

  it("all 3 returned ids are hex strings starting with 0x", () => {
    const ids = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    for (const id of ids) {
      expect(id).toMatch(/^0x[0-9a-fA-F]{64}$/);
    }
  });

  it("all 3 returned ids are distinct from each other", () => {
    const [id0, id1, id2] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id0).not.toBe(id1);
    expect(id0).not.toBe(id2);
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Tests: id[0] — adapter-wide id
// ---------------------------------------------------------------------------

describe("computeMarketCapIds — id[0] adapter-wide id", () => {
  it("id[0] matches independently computed keccak256(abi.encode('this', adapter))", () => {
    const [id0] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const expected = refAdapterId(ADAPTER_ADDRESS);

    expect(id0).toBe(expected);
  });

  it("id[0] is the same regardless of which marketParams are supplied (adapter-wide)", () => {
    const [id0ForWeth] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [id0ForWsteth] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WSTETH);

    expect(id0ForWeth).toBe(id0ForWsteth);
  });

  it("id[0] differs when the adapter address differs (same marketParams)", () => {
    const [id0A] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [id0B] = computeMarketCapIds(OTHER_ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id0A).not.toBe(id0B);
  });

  it("id[0] is stable across two calls with identical inputs", () => {
    const [first] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [second] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Tests: id[1] — collateral-token id
// ---------------------------------------------------------------------------

describe("computeMarketCapIds — id[1] collateral-token id", () => {
  it("id[1] matches independently computed keccak256(abi.encode('collateralToken', collateralToken))", () => {
    const [, id1] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const expected = refCollateralId(MARKET_PARAMS_WETH.collateralToken);

    expect(id1).toBe(expected);
  });

  it("id[1] is the same for two markets that share the same collateralToken (different lltv)", () => {
    const [, id1For86] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, id1For77] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH_77);

    expect(id1For86).toBe(id1For77);
  });

  it("id[1] differs between two markets with different collateralTokens", () => {
    const [, id1Weth] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, id1Wsteth] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WSTETH);

    expect(id1Weth).not.toBe(id1Wsteth);
  });

  it("id[1] does not change when the adapter address changes (collateral-scoped, not adapter-scoped)", () => {
    const [, id1A] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, id1B] = computeMarketCapIds(OTHER_ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id1A).toBe(id1B);
  });

  it("id[1] is stable across two calls with identical inputs", () => {
    const [, first] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, second] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Tests: id[2] — market-specific id
// ---------------------------------------------------------------------------

describe("computeMarketCapIds — id[2] market-specific id", () => {
  it("id[2] matches independently computed keccak256(abi.encode('this/marketParams', adapter, marketParams))", () => {
    const [, , id2] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const expected = refMarketSpecificId(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id2).toBe(expected);
  });

  it("id[2] differs between two markets that differ only in lltv (same adapter, same collateral)", () => {
    const [, , id2For86] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, , id2For77] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH_77);

    expect(id2For86).not.toBe(id2For77);
  });

  it("id[2] differs between two markets with different collateralTokens", () => {
    const [, , id2Weth] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, , id2Wsteth] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WSTETH);

    expect(id2Weth).not.toBe(id2Wsteth);
  });

  it("id[2] differs when the adapter address changes (adapter is part of the preimage)", () => {
    const [, , id2A] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, , id2B] = computeMarketCapIds(OTHER_ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id2A).not.toBe(id2B);
  });

  it("id[2] is stable across two calls with identical inputs", () => {
    const [, , first] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, , second] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Tests: cross-id relationships
// ---------------------------------------------------------------------------

describe("computeMarketCapIds — cross-id relationships", () => {
  it("id[0] and id[1] for the same market are not equal (adapter-wide != collateral)", () => {
    const [id0, id1] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id0).not.toBe(id1);
  });

  it("id[1] (collateral) is identical for same-collateral markets regardless of adapter", () => {
    // id[1] depends only on collateralToken — not on adapter or other market params
    const [, id1AdapterA] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, id1AdapterB] = computeMarketCapIds(OTHER_ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id1AdapterA).toBe(id1AdapterB);
  });

  it("id[2] (market-specific) includes the adapter: same market but different adapter → different id[2]", () => {
    const [, , id2AdapterA] = computeMarketCapIds(ADAPTER_ADDRESS, MARKET_PARAMS_WETH);
    const [, , id2AdapterB] = computeMarketCapIds(OTHER_ADAPTER_ADDRESS, MARKET_PARAMS_WETH);

    expect(id2AdapterA).not.toBe(id2AdapterB);
  });
});
