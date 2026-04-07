/**
 * Tests for src/config/managed-markets.ts
 *
 * Strategy: loadManagedMarkets() is a pure synchronous function that reads a
 * JSON file from disk, validates it with zod, and returns a ManagedMarket[].
 *
 * We use Node's tmp dir + writeFileSync to create on-the-fly fixture files so
 * no permanent fixture files are committed.  Each test creates its own temp
 * file via a unique name derived from `Date.now() + Math.random()` to avoid
 * any inter-test collision even if tests run in parallel.
 *
 * External dependency mocked: the file system is real (no mock) — we write
 * real temp files and clean them up in afterEach.  This is the correct choice
 * because the function under test does real IO and we want to exercise the full
 * read-parse-validate-transform pipeline without mocking the module itself.
 *
 * marketId independence: the expected marketId is recomputed in each test using
 * the same viem primitives (encodeAbiParameters + keccak256) the source
 * uses — this validates both the function's output AND the derivation formula.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, keccak256 } from "viem";
import { loadManagedMarkets } from "../../src/config/managed-markets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Files created during a test — cleaned up in afterEach. */
const createdFiles: string[] = [];

/**
 * Writes JSON content to a unique temp file and registers it for cleanup.
 * Returns the absolute path.
 */
function writeTempJson(content: unknown): string {
  const path = join(
    tmpdir(),
    `managed-markets-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`
  );
  writeFileSync(path, JSON.stringify(content), "utf-8");
  createdFiles.push(path);
  return path;
}

/**
 * Writes a raw string (not necessarily valid JSON) to a temp file.
 */
function writeTempRaw(content: string): string {
  const path = join(
    tmpdir(),
    `managed-markets-raw-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`
  );
  writeFileSync(path, content, "utf-8");
  createdFiles.push(path);
  return path;
}

afterEach(() => {
  for (const f of createdFiles) {
    if (existsSync(f)) {
      unlinkSync(f);
    }
  }
  createdFiles.length = 0;
});

// ---------------------------------------------------------------------------
// ABI components used to independently recompute marketId in tests
// ---------------------------------------------------------------------------

const MARKET_PARAMS_ABI_COMPONENTS = [
  { name: "loanToken", type: "address" },
  { name: "collateralToken", type: "address" },
  { name: "oracle", type: "address" },
  { name: "irm", type: "address" },
  { name: "lltv", type: "uint256" },
] as const;

function computeMarketId(params: {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
}): `0x${string}` {
  const encoded = encodeAbiParameters(
    [{ type: "tuple", components: MARKET_PARAMS_ABI_COMPONENTS }],
    [params]
  );
  return keccak256(encoded);
}

// ---------------------------------------------------------------------------
// Reusable fixture data
// ---------------------------------------------------------------------------

const MARKET_A = {
  label: "USDC/WETH 86%",
  marketParams: {
    loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    oracle: "0x0000000000000000000000000000000000000001",
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    lltv: "860000000000000000",
  },
};

const MARKET_B = {
  label: "USDC/wstETH 77%",
  marketParams: {
    loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    collateralToken: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    oracle: "0x0000000000000000000000000000000000000002",
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    lltv: "770000000000000000",
  },
};

const MARKET_C = {
  label: "USDC/cbBTC 80%",
  marketParams: {
    loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    oracle: "0x0000000000000000000000000000000000000003",
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
    lltv: "800000000000000000",
  },
};

// ---------------------------------------------------------------------------
// 1. Valid JSON — single market
// ---------------------------------------------------------------------------

describe("valid JSON — single market", () => {
  it("returns an array of length 1", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result).toHaveLength(1);
  });

  it("returned element has label matching the input", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result[0].label).toBe("USDC/WETH 86%");
  });

  it("returned element has marketParams.loanToken matching the input", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result[0].marketParams.loanToken).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    );
  });

  it("returned element has marketParams.collateralToken matching the input", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result[0].marketParams.collateralToken).toBe(
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    );
  });

  it("returned element has lltv as a bigint", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(typeof result[0].marketParams.lltv).toBe("bigint");
  });

  it("returned element has lltv equal to 860000000000000000n", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result[0].marketParams.lltv).toBe(860000000000000000n);
  });

  it("returned element has a non-zero marketId (non-empty hex string)", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result[0].marketId).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("returned element has marketId equal to the independently computed keccak256(encodeAbiParameters(marketParams))", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);

    const expected = computeMarketId({
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      oracle: "0x0000000000000000000000000000000000000001",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 860000000000000000n,
    });

    expect(result[0].marketId).toBe(expected);
  });

  it("returned element has capIds initialized to an empty array", () => {
    const path = writeTempJson({ markets: [MARKET_A] });
    const result = loadManagedMarkets(path);
    expect(result[0].capIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Valid JSON — three markets
// ---------------------------------------------------------------------------

describe("valid JSON — three markets", () => {
  it("returns an array of length 3", () => {
    const path = writeTempJson({ markets: [MARKET_A, MARKET_B, MARKET_C] });
    const result = loadManagedMarkets(path);
    expect(result).toHaveLength(3);
  });

  it("first element has marketId equal to the independently computed hash for MARKET_A", () => {
    const path = writeTempJson({ markets: [MARKET_A, MARKET_B, MARKET_C] });
    const result = loadManagedMarkets(path);

    const expected = computeMarketId({
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      oracle: "0x0000000000000000000000000000000000000001",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 860000000000000000n,
    });

    expect(result[0].marketId).toBe(expected);
  });

  it("second element has marketId equal to the independently computed hash for MARKET_B", () => {
    const path = writeTempJson({ markets: [MARKET_A, MARKET_B, MARKET_C] });
    const result = loadManagedMarkets(path);

    const expected = computeMarketId({
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      collateralToken: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      oracle: "0x0000000000000000000000000000000000000002",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 770000000000000000n,
    });

    expect(result[1].marketId).toBe(expected);
  });

  it("third element has marketId equal to the independently computed hash for MARKET_C", () => {
    const path = writeTempJson({ markets: [MARKET_A, MARKET_B, MARKET_C] });
    const result = loadManagedMarkets(path);

    const expected = computeMarketId({
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      oracle: "0x0000000000000000000000000000000000000003",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 800000000000000000n,
    });

    expect(result[2].marketId).toBe(expected);
  });

  it("all three elements have capIds as empty arrays", () => {
    const path = writeTempJson({ markets: [MARKET_A, MARKET_B, MARKET_C] });
    const result = loadManagedMarkets(path);
    for (const market of result) {
      expect(market.capIds).toEqual([]);
    }
  });

  it("three markets produce three distinct marketIds", () => {
    const path = writeTempJson({ markets: [MARKET_A, MARKET_B, MARKET_C] });
    const result = loadManagedMarkets(path);
    const ids = result.map((m) => m.marketId);
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing top-level "markets" key
// ---------------------------------------------------------------------------

describe("missing top-level 'markets' key", () => {
  it("throws an Error when the JSON object has no 'markets' key", () => {
    const path = writeTempJson({ something_else: [] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("the thrown error message mentions the file path", () => {
    const path = writeTempJson({ something_else: [] });
    expect(() => loadManagedMarkets(path)).toThrow(path);
  });

  it("throws when markets is an empty array (min 1 entry required)", () => {
    const path = writeTempJson({ markets: [] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Missing required fields in a market entry
// ---------------------------------------------------------------------------

describe("missing 'label' in a market entry", () => {
  it("throws an Error when a market entry has no 'label' field", () => {
    const entry = {
      marketParams: MARKET_A.marketParams,
      // label is intentionally omitted
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("the thrown error message mentions 'label'", () => {
    const entry = {
      marketParams: MARKET_A.marketParams,
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow(/label/);
  });

  it("throws when label is an empty string", () => {
    const entry = { ...MARKET_A, label: "" };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Missing marketParams.collateralToken
// ---------------------------------------------------------------------------

describe("missing marketParams.collateralToken", () => {
  it("throws an Error when collateralToken is absent", () => {
    const { collateralToken: _omit, ...paramsWithout } = MARKET_A.marketParams;
    const entry = { label: MARKET_A.label, marketParams: paramsWithout };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("the thrown error message mentions 'collateralToken'", () => {
    const { collateralToken: _omit, ...paramsWithout } = MARKET_A.marketParams;
    const entry = { label: MARKET_A.label, marketParams: paramsWithout };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow(/collateralToken/);
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid address format — marketParams.loanToken
// ---------------------------------------------------------------------------

describe("invalid marketParams.loanToken", () => {
  it("throws an Error when loanToken is not a 0x address", () => {
    const entry = {
      ...MARKET_A,
      marketParams: { ...MARKET_A.marketParams, loanToken: "not-an-address" },
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("throws an Error when loanToken is a plain hex string without 0x prefix", () => {
    const entry = {
      ...MARKET_A,
      marketParams: {
        ...MARKET_A.marketParams,
        loanToken: "A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("throws an Error when loanToken is too short", () => {
    const entry = {
      ...MARKET_A,
      marketParams: { ...MARKET_A.marketParams, loanToken: "0xA0b86991" },
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. Invalid lltv — non-numeric string
// ---------------------------------------------------------------------------

describe("invalid marketParams.lltv", () => {
  it("throws an Error when lltv is a non-numeric string", () => {
    const entry = {
      ...MARKET_A,
      marketParams: { ...MARKET_A.marketParams, lltv: "not-a-number" },
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("throws an Error when lltv is a decimal float string (not an integer string)", () => {
    const entry = {
      ...MARKET_A,
      marketParams: { ...MARKET_A.marketParams, lltv: "0.86" },
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("throws an Error when lltv is a number (not a string — JSON schema requires string)", () => {
    const entry = {
      ...MARKET_A,
      marketParams: { ...MARKET_A.marketParams, lltv: 860000000000000000 },
    };
    const path = writeTempJson({ markets: [entry] });
    expect(() => loadManagedMarkets(path)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. File not found
// ---------------------------------------------------------------------------

describe("file not found", () => {
  it("throws an Error when the path does not exist", () => {
    const nonExistentPath = join(
      tmpdir(),
      `does-not-exist-${Date.now()}.json`
    );
    expect(() => loadManagedMarkets(nonExistentPath)).toThrow();
  });

  it("the thrown error message mentions the file path", () => {
    const nonExistentPath = join(
      tmpdir(),
      `does-not-exist-${Date.now()}.json`
    );
    expect(() => loadManagedMarkets(nonExistentPath)).toThrow(nonExistentPath);
  });

  it("the thrown error is not a ZodError (it is an IO/file-not-found error)", () => {
    const nonExistentPath = join(
      tmpdir(),
      `does-not-exist-${Date.now()}.json`
    );
    let caught: unknown;
    try {
      loadManagedMarkets(nonExistentPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // ZodError has an `issues` array — a file-not-found error must not have that
    expect((caught as Error & { issues?: unknown }).issues).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Non-JSON file content
// ---------------------------------------------------------------------------

describe("non-JSON file content", () => {
  it("throws an Error when the file contains plain text garbage", () => {
    const path = writeTempRaw("this is not json at all !!!");
    expect(() => loadManagedMarkets(path)).toThrow();
  });

  it("the thrown error for non-JSON content mentions the file path", () => {
    const path = writeTempRaw("{ broken json {{");
    expect(() => loadManagedMarkets(path)).toThrow(path);
  });

  it("throws an Error when the file is empty", () => {
    const path = writeTempRaw("");
    expect(() => loadManagedMarkets(path)).toThrow();
  });
});
