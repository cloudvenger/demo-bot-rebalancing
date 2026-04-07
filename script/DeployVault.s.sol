// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/// @notice Morpho Blue market parameters struct.
///         Verified against morpho-org/vault-v2 and morpho-org/morpho-blue.
struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

// ---------------------------------------------------------------------------
// Minimal interfaces — verified against morpho-org/vault-v2 source (2026-04-07)
// ---------------------------------------------------------------------------

/// @notice Factory that deploys VaultV2 instances.
///         Verified signature: createVaultV2(address owner, address asset, bytes32 salt)
///         Source: VaultV2Factory.sol — no name/symbol at deploy time.
interface IVaultV2Factory {
    /// @notice Deploy a new VaultV2 with the given owner and underlying asset.
    /// @param owner  The initial owner of the vault (can setCurator, etc.)
    /// @param asset  The vault's underlying ERC-20 asset (e.g. USDC)
    /// @param salt   CREATE2 salt for deterministic addresses; pass bytes32(0) for a non-deterministic deploy
    /// @return vault The address of the newly deployed VaultV2
    function createVaultV2(
        address owner,
        address asset,
        bytes32 salt
    ) external returns (address vault);
}

/// @notice Factory that deploys MorphoMarketV1AdapterV2 instances.
///         Verified signature: createMorphoMarketV1AdapterV2(address parentVault)
///         One adapter per vault — no MarketParams at deploy time.
///         Source: MorphoMarketV1AdapterV2Factory.sol
interface IMorphoMarketV1AdapterV2Factory {
    /// @notice Deploy one adapter for the given vault.
    ///         The adapter wires Morpho Blue + AdaptiveCurveIRM as immutables from the factory.
    /// @param parentVault The VaultV2 address this adapter will serve
    /// @return adapter    The address of the newly deployed MorphoMarketV1AdapterV2
    function createMorphoMarketV1AdapterV2(
        address parentVault
    ) external returns (address adapter);
}

/// @notice Read-only calls on MorphoMarketV1AdapterV2 used for cap-id computation.
interface IMorphoMarketV1AdapterV2 {
    /// @notice Returns the 3 cap ids this adapter registers on the vault for a given market.
    ///         id[0] = keccak256(abi.encode("this", address(adapter)))                     — adapter-wide
    ///         id[1] = keccak256(abi.encode("collateralToken", marketParams.collateralToken)) — collateral-token
    ///         id[2] = keccak256(abi.encode("this/marketParams", adapter, marketParams))   — market-specific
    /// @param marketParams The Morpho Blue market parameters
    /// @return             The 3 cap ids (adapter-wide, collateral-token, market-specific)
    function ids(MarketParams calldata marketParams) external view returns (bytes32[] memory);
}

/// @notice Subset of VaultV2 functions used by this deployment script.
///         Verified against VaultV2.sol in morpho-org/vault-v2 (2026-04-07).
interface IVaultV2 {
    // --- Owner-only (NOT timelocked) ----------------------------------------

    /// @notice Set the curator address.  Owner-only. Not timelocked.
    /// @param newCurator The address to grant the curator role
    function setCurator(address newCurator) external;

    // --- Timelocked (submit-then-execute via multicall when timelock == 0) ---

    /// @notice Queue a timelocked call.  When timelock == 0 the call is immediately executable.
    ///         Callers must push abi.encodeCall(IVaultV2.submit, (innerCall)) followed immediately
    ///         by the inner call itself so that both execute in the same multicall transaction.
    /// @param data ABI-encoded inner function call to queue
    function submit(bytes calldata data) external;

    /// @notice Register an adapter on this vault. Timelocked.
    /// @param adapter The adapter address to enable
    function addAdapter(address adapter) external;

    /// @notice Raise (or set for the first time) the absolute cap for a given cap id. Timelocked.
    ///         Can only increase — to lower a cap the owner must go through the timelock.
    /// @param idData  The exact preimage bytes that hash to the target cap id (see PLAN.md § Verified cap-id preimages)
    /// @param newCap  The new absolute cap in the vault asset's native decimals (e.g. USDC: 6 decimals)
    function increaseAbsoluteCap(bytes calldata idData, uint256 newCap) external;

    /// @notice Raise (or set for the first time) the relative cap for a given cap id. Timelocked.
    ///         Relative cap is in WAD (1e18 = 100%).  WAD means "no relative cap".  0 forbids the market.
    /// @param idData  The exact preimage bytes that hash to the target cap id
    /// @param newCap  The new relative cap in WAD
    function increaseRelativeCap(bytes calldata idData, uint256 newCap) external;

    /// @notice Grant or revoke the allocator role for an account. Timelocked.
    /// @param account        The address to update
    /// @param newIsAllocator True to grant the allocator role; false to revoke
    function setIsAllocator(address account, bool newIsAllocator) external;

    /// @notice Execute multiple calls on the vault in a single transaction.
    ///         Used by this script to batch the entire curator setup atomically.
    /// @param data An array of ABI-encoded calls
    function multicall(bytes[] calldata data) external;

    // --- Read-only ----------------------------------------------------------

    /// @notice Return the number of adapters currently registered on this vault.
    /// @return The number of enabled adapters
    function adaptersLength() external view returns (uint256);

    /// @notice Return the adapter at the given index.
    /// @param index Zero-based index into the adapters set
    /// @return      The adapter address
    function adaptersAt(uint256 index) external view returns (address);

    /// @notice Return the absolute cap for the given cap id.
    /// @param id The cap id (keccak256 of the preimage)
    /// @return   Absolute cap in asset native decimals; 0 if not set
    function absoluteCap(bytes32 id) external view returns (uint256);

    /// @notice Return the relative cap for the given cap id.
    /// @param id The cap id (keccak256 of the preimage)
    /// @return   Relative cap in WAD; 0 if not set (0 forbids the market)
    function relativeCap(bytes32 id) external view returns (uint256);

    /// @notice Return whether an address holds the allocator role.
    /// @param account The address to query
    /// @return        True if the account is an allocator
    function isAllocator(address account) external view returns (bool);
}

// ---------------------------------------------------------------------------
// Custom errors — used instead of require(condition, "string")
// ---------------------------------------------------------------------------

/// @notice Reverts when a managed market's loanToken is not the expected asset.
error WrongLoanToken(uint256 marketIndex, address got, address expected);

/// @notice Reverts when a managed market's IRM is not the expected AdaptiveCurveIRM.
error WrongIRM(uint256 marketIndex, address got, address expected);

/// @notice Reverts when post-deployment verification fails.
error VerificationFailed(string reason);

// ---------------------------------------------------------------------------
// Deployment script
// ---------------------------------------------------------------------------

/// @title  DeployVault
/// @notice Deploys a Morpho Vault V2 (USDC) with one MorphoMarketV1AdapterV2,
///         configures curator, enables the adapter, sets 3 cap ids per managed
///         market, and grants the allocator role to the bot wallet — all in a
///         single broadcast batch via vault.multicall(...).
///
/// @dev    Run against a forked mainnet:
///             forge script script/DeployVault.s.sol \
///               --fork-url $RPC_URL \
///               --broadcast \
///               -vvvv
///
///         Required env vars:
///           OWNER                 — deployer / owner / curator (single EOA for the demo)
///           BOT_WALLET            — receives the allocator role
///           MANAGED_MARKETS_PATH  — path to the JSON config file
///
///         Optional env vars (all have safe defaults):
///           VAULT_SALT            — CREATE2 salt; default bytes32(0)
///           ABSOLUTE_CAP          — per-id absolute cap in USDC (6 dec); default 500_000e6
///           RELATIVE_CAP_WAD      — per-id relative cap in WAD; default 1e18 ("no relative cap")
///
///         Assumptions (valid for a fresh deploy):
///           - Curator timelock defaults to 0, so submit(...) + execute(...) can be
///             batched into a single multicall transaction.
///           - Deployer = owner = curator for the demo (least-privilege best practice:
///             give the bot wallet only the allocator role).
///
/// @dev    Security: ReentrancyGuard is not applied here because this is a Foundry
///         Script (not a deployed contract).  The script runs in vm.startBroadcast()
///         which is a forge-std call sequence, not an on-chain callback path.
contract DeployVault is Script {
    // -----------------------------------------------------------------------
    // Constants — Ethereum mainnet addresses
    // (verified against PLAN.md § Key Contract Addresses 2026-04-07)
    // -----------------------------------------------------------------------

    address constant VAULT_V2_FACTORY    = 0xA1D94F746dEfa1928926b84fB2596c06926C0405;
    address constant ADAPTER_FACTORY     = 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1;
    address constant USDC                = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ADAPTIVE_CURVE_IRM  = 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC;

    /// @notice WAD = 1e18.  Used as the "no relative cap" sentinel in VaultV2.
    ///         Setting relativeCap == WAD means the relative check is skipped;
    ///         setting relativeCap == 0 would forbid any allocation (do not do this).
    uint256 constant WAD = 1e18;

    // -----------------------------------------------------------------------
    // Internal state — populated in run(), consumed by _buildMarketCalls()
    // -----------------------------------------------------------------------

    uint256 private _absoluteCap;
    uint256 private _relativeCap;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// @dev Compute cap id from idData preimage.  id = keccak256(idData).
    function _capId(bytes memory idData) internal pure returns (bytes32) {
        return keccak256(idData);
    }

    /// @dev Build the 3 idData preimages for a given market + adapter combination.
    ///      Verified preimages from PLAN.md § Verified cap-id preimages:
    ///        id[0] preimage: abi.encode("this", adapter)
    ///        id[1] preimage: abi.encode("collateralToken", marketParams.collateralToken)
    ///        id[2] preimage: abi.encode("this/marketParams", adapter, marketParams)
    ///
    ///      CRITICAL: any deviation in the preimage results in a different keccak256 hash,
    ///      causing vault.allocate() to revert with ZeroAbsoluteCap at runtime.
    function _buildIdDatas(
        address adapter,
        MarketParams memory mp
    ) internal pure returns (bytes[3] memory idDatas) {
        idDatas[0] = abi.encode("this", adapter);
        idDatas[1] = abi.encode("collateralToken", mp.collateralToken);
        idDatas[2] = abi.encode("this/marketParams", adapter, mp);
    }

    /// @dev Push submit+execute pairs for increaseAbsoluteCap and increaseRelativeCap
    ///      for a single idData preimage into the calls array at position `cursor`.
    ///      Returns the updated cursor position.
    ///
    ///      Four entries are added per idData (submit+exec for abs cap, submit+exec for rel cap).
    function _pushCapCalls(
        bytes[] memory calls,
        uint256 cursor,
        bytes memory idData,
        uint256 absCap,
        uint256 relCap
    ) internal pure returns (uint256) {
        // increaseAbsoluteCap — submit then execute
        calls[cursor++] = abi.encodeCall(
            IVaultV2.submit,
            (abi.encodeCall(IVaultV2.increaseAbsoluteCap, (idData, absCap)))
        );
        calls[cursor++] = abi.encodeCall(IVaultV2.increaseAbsoluteCap, (idData, absCap));

        // increaseRelativeCap — submit then execute
        calls[cursor++] = abi.encodeCall(
            IVaultV2.submit,
            (abi.encodeCall(IVaultV2.increaseRelativeCap, (idData, relCap)))
        );
        calls[cursor++] = abi.encodeCall(IVaultV2.increaseRelativeCap, (idData, relCap));

        return cursor;
    }

    /// @dev Compute the total number of entries in the multicall array.
    ///      Layout:
    ///        2  — submit(addAdapter) + addAdapter
    ///        N * 3 ids * 4 (submit+exec per abs cap + submit+exec per rel cap) — caps
    ///        2  — submit(setIsAllocator) + setIsAllocator
    function _callsLength(uint256 numMarkets) internal pure returns (uint256) {
        return 2 + numMarkets * 3 * 4 + 2;
    }

    // -----------------------------------------------------------------------
    // JSON parsing helpers
    // -----------------------------------------------------------------------

    /// @dev Parse a single market entry from the JSON config.
    ///      Expected JSON shape per entry:
    ///        {
    ///          "label":           "USDC/WETH 86%",
    ///          "loanToken":       "0x...",
    ///          "collateralToken": "0x...",
    ///          "oracle":          "0x...",
    ///          "irm":             "0x...",
    ///          "lltv":            "860000000000000000"
    ///        }
    ///
    ///      vm.parseJsonAddress and vm.parseJsonUint use JSONPath syntax; index is 0-based.
    function _parseMarket(
        string memory json,
        uint256 index
    ) internal pure returns (string memory label, MarketParams memory mp) {
        string memory base = string.concat("[", vm.toString(index), "]");

        label = vm.parseJsonString(json, string.concat(base, ".label"));
        mp.loanToken       = vm.parseJsonAddress(json, string.concat(base, ".loanToken"));
        mp.collateralToken = vm.parseJsonAddress(json, string.concat(base, ".collateralToken"));
        mp.oracle          = vm.parseJsonAddress(json, string.concat(base, ".oracle"));
        mp.irm             = vm.parseJsonAddress(json, string.concat(base, ".irm"));
        mp.lltv            = vm.parseJsonUint(json,    string.concat(base, ".lltv"));
    }

    // -----------------------------------------------------------------------
    // Human-readable formatting helpers (for console output only)
    // -----------------------------------------------------------------------

    /// @dev Format a uint256 USDC amount (6 decimals) as "X.Y USDC".
    function _fmtUsdc(uint256 amount) internal pure returns (string memory) {
        uint256 whole   = amount / 1e6;
        uint256 frac    = amount % 1e6;
        // Show 2 decimal places
        uint256 frac2   = frac / 10000;
        return string.concat(vm.toString(whole), ".", frac2 < 10 ? "0" : "", vm.toString(frac2), " USDC");
    }

    /// @dev Format a WAD-denominated relative cap as a percentage string.
    ///      WAD (1e18) → "100% (WAD — no relative cap)"
    ///      5e17       → "50%"
    ///      0          → "0% (FORBIDDEN — relativeCap must never be 0)"
    function _fmtRelCap(uint256 relCap) internal pure returns (string memory) {
        if (relCap == WAD) {
            return "100% (WAD - no relative cap)";
        }
        if (relCap == 0) {
            return "0% (FORBIDDEN - relativeCap is 0, market would be blocked)";
        }
        // Compute percentage with 2 decimal places: pct = relCap * 10000 / WAD
        uint256 pct100 = relCap * 10000 / WAD;  // e.g. 5e17 -> 5000
        uint256 whole  = pct100 / 100;
        uint256 frac   = pct100 % 100;
        return string.concat(
            vm.toString(whole), ".",
            frac < 10 ? "0" : "", vm.toString(frac), "%"
        );
    }

    // -----------------------------------------------------------------------
    // Main entry point
    // -----------------------------------------------------------------------

    /// @notice Deploy the vault, adapter, and run the full curator setup.
    function run() external {
        // -------------------------------------------------------------------
        // Read env vars
        // -------------------------------------------------------------------
        address deployer = vm.envAddress("OWNER");
        address botWallet = vm.envAddress("BOT_WALLET");
        string memory marketsPath = vm.envString("MANAGED_MARKETS_PATH");
        bytes32 salt = vm.envOr("VAULT_SALT", bytes32(0));
        _absoluteCap = vm.envOr("ABSOLUTE_CAP", uint256(500_000e6));   // default: 500k USDC
        _relativeCap = vm.envOr("RELATIVE_CAP_WAD", WAD);              // default: WAD = no relative cap

        // Safety guard: refuse to continue with relativeCap == 0 because that
        // would forbid all markets.  The bot refuses to start against such a vault
        // (SPEC Story A2), so the script should never deploy one.
        require(
            _relativeCap != 0,
            "DeployVault: RELATIVE_CAP_WAD is 0 - this would forbid all markets. "
            "Set to 1e18 (WAD) for 'no relative cap' or any value in (0, WAD]."
        );

        // -------------------------------------------------------------------
        // STEP A — Read and validate managed markets from JSON config
        // -------------------------------------------------------------------
        console.log("=== STEP A: Reading managed markets from:", marketsPath);

        string memory json = vm.readFile(marketsPath);

        // Count markets: the JSON must be a top-level array.
        // We probe sequentially until parseJsonAddress fails (reverts on out-of-bounds).
        // We use a try/catch-compatible approach: read length first via parseJsonUintArray on a
        // length field if present, otherwise fall back to a bounded loop.
        // Since vm.parseJson returns a dynamic array of the root, we use vm.parseJsonKeys.
        // Simpler: require the JSON to have a predictable length — read it via a single
        // vm.parseJsonUintArray on lltv values and take its length.
        uint256[] memory lltvs = vm.parseJsonUintArray(json, "[*].lltv");
        uint256 numMarkets = lltvs.length;
        require(numMarkets > 0, "DeployVault: no markets found in JSON config");

        // Allocate storage for market data
        MarketParams[] memory markets = new MarketParams[](numMarkets);
        string[] memory labels = new string[](numMarkets);

        for (uint256 i = 0; i < numMarkets; i++) {
            (string memory label, MarketParams memory mp) = _parseMarket(json, i);
            labels[i] = label;
            markets[i] = mp;

            // Validate: loanToken must be USDC
            if (mp.loanToken != USDC) {
                revert WrongLoanToken(i, mp.loanToken, USDC);
            }
            // Validate: IRM must be AdaptiveCurveIRM
            if (mp.irm != ADAPTIVE_CURVE_IRM) {
                revert WrongIRM(i, mp.irm, ADAPTIVE_CURVE_IRM);
            }

            console.log("  Market [", i, "]:", label);
            console.log("    loanToken:      ", mp.loanToken);
            console.log("    collateralToken:", mp.collateralToken);
            console.log("    oracle:         ", mp.oracle);
            console.log("    irm:            ", mp.irm);
            console.log("    lltv:           ", mp.lltv);
        }

        // -------------------------------------------------------------------
        // STEPS B–F — Deploy + configure on-chain
        // -------------------------------------------------------------------
        vm.startBroadcast(deployer);

        // STEP B — Deploy vault
        console.log("\n=== STEP B: Deploying VaultV2 ===");
        address vault = IVaultV2Factory(VAULT_V2_FACTORY).createVaultV2(deployer, USDC, salt);
        console.log("VaultV2 deployed at:", vault);

        // STEP C — Deploy single adapter
        console.log("\n=== STEP C: Deploying MorphoMarketV1AdapterV2 ===");
        address adapter = IMorphoMarketV1AdapterV2Factory(ADAPTER_FACTORY)
            .createMorphoMarketV1AdapterV2(vault);
        console.log("Adapter deployed at:", adapter);

        // STEP D — Set curator (owner-only, NOT timelocked — runs immediately outside multicall)
        console.log("\n=== STEP D: Setting curator ===");
        IVaultV2(vault).setCurator(deployer);
        console.log("Curator set to deployer:", deployer);

        // STEP E — Build multicall array
        // Layout: 2 (addAdapter) + numMarkets*3*4 (caps) + 2 (setIsAllocator)
        console.log("\n=== STEP E: Building multicall ===");
        uint256 totalCalls = _callsLength(numMarkets);
        bytes[] memory calls = new bytes[](totalCalls);
        uint256 cursor = 0;

        // 1. submit(addAdapter(adapter)) + addAdapter(adapter)
        calls[cursor++] = abi.encodeCall(
            IVaultV2.submit,
            (abi.encodeCall(IVaultV2.addAdapter, (adapter)))
        );
        calls[cursor++] = abi.encodeCall(IVaultV2.addAdapter, (adapter));

        // 2. For each managed market and each of the 3 cap ids:
        //    submit(increaseAbsoluteCap) + increaseAbsoluteCap
        //    submit(increaseRelativeCap) + increaseRelativeCap
        for (uint256 i = 0; i < numMarkets; i++) {
            bytes[3] memory idDatas = _buildIdDatas(adapter, markets[i]);
            for (uint256 j = 0; j < 3; j++) {
                cursor = _pushCapCalls(calls, cursor, idDatas[j], _absoluteCap, _relativeCap);
            }
        }

        // 3. submit(setIsAllocator(botWallet, true)) + setIsAllocator(botWallet, true)
        calls[cursor++] = abi.encodeCall(
            IVaultV2.submit,
            (abi.encodeCall(IVaultV2.setIsAllocator, (botWallet, true)))
        );
        calls[cursor++] = abi.encodeCall(IVaultV2.setIsAllocator, (botWallet, true));

        // Sanity: confirm we filled every slot
        assert(cursor == totalCalls);

        // STEP F — Execute all setup calls in a single transaction
        console.log("\n=== STEP F: Executing multicall ===");
        console.log("Total calls in multicall:", totalCalls);
        IVaultV2(vault).multicall(calls);
        console.log("Multicall succeeded.");

        vm.stopBroadcast();

        // -------------------------------------------------------------------
        // STEP G — Post-deployment verification (NOT in broadcast)
        // -------------------------------------------------------------------
        console.log("\n=== STEP G: Verifying deployment ===");

        if (IVaultV2(vault).adaptersLength() != 1) {
            revert VerificationFailed("adaptersLength != 1");
        }
        if (IVaultV2(vault).adaptersAt(0) != adapter) {
            revert VerificationFailed("adaptersAt(0) != adapter");
        }
        if (!IVaultV2(vault).isAllocator(botWallet)) {
            revert VerificationFailed("botWallet is not an allocator");
        }

        for (uint256 i = 0; i < numMarkets; i++) {
            bytes[3] memory idDatas = _buildIdDatas(adapter, markets[i]);
            for (uint256 j = 0; j < 3; j++) {
                bytes32 id = _capId(idDatas[j]);
                uint256 storedAbs = IVaultV2(vault).absoluteCap(id);
                uint256 storedRel = IVaultV2(vault).relativeCap(id);

                if (storedAbs != _absoluteCap) {
                    revert VerificationFailed(
                        string.concat("absoluteCap mismatch for market ", labels[i], " id[", vm.toString(j), "]")
                    );
                }
                if (storedRel != _relativeCap) {
                    revert VerificationFailed(
                        string.concat("relativeCap mismatch for market ", labels[i], " id[", vm.toString(j), "]")
                    );
                }
                if (storedRel == 0) {
                    revert VerificationFailed(
                        string.concat(
                            "relativeCap is 0 for market ", labels[i], " id[", vm.toString(j),
                            "] - this forbids all allocation to this market"
                        )
                    );
                }
            }
        }

        console.log("All verifications passed.");

        // -------------------------------------------------------------------
        // STEP H — Console summary
        // -------------------------------------------------------------------
        console.log("");
        console.log("==========================================================");
        console.log("  DEPLOYMENT SUMMARY");
        console.log("==========================================================");
        console.log("Vault:      ", vault);
        console.log("Adapter:    ", adapter);
        console.log("Deployer:   ", deployer);
        console.log("Bot wallet: ", botWallet);
        console.log(string.concat("Salt:       ", vm.toString(salt)));
        console.log("");
        console.log("Caps applied (same for all ids across all markets):");
        console.log("  Absolute cap:", _fmtUsdc(_absoluteCap));
        console.log("  Relative cap (raw WAD):", _relativeCap);
        console.log("  Relative cap (human):  ", _fmtRelCap(_relativeCap));
        console.log("");
        console.log("Per-market cap id summary:");

        for (uint256 i = 0; i < numMarkets; i++) {
            bytes[3] memory idDatas = _buildIdDatas(adapter, markets[i]);
            console.log("  Market:", labels[i]);

            string[3] memory idNames = ["adapter-wide", "collateral-token", "market-specific"];
            for (uint256 j = 0; j < 3; j++) {
                bytes32 id = _capId(idDatas[j]);
                console.log(string.concat("    id[", vm.toString(j), "] (", idNames[j], "):"));
                console.log(string.concat("      hash:        ", vm.toString(id)));
                console.log("      absoluteCap:", _fmtUsdc(IVaultV2(vault).absoluteCap(id)));
                console.log("      relativeCap:", _fmtRelCap(IVaultV2(vault).relativeCap(id)));
            }
        }

        console.log("");
        console.log("==========================================================");
        console.log("  MANAGED MARKETS JSON (copy into MANAGED_MARKETS_PATH)");
        console.log("==========================================================");
        console.log("[");
        for (uint256 i = 0; i < numMarkets; i++) {
            string memory comma = i < numMarkets - 1 ? "," : "";
            console.log("  {");
            console.log(string.concat("    \"label\":           \"", labels[i], "\","));
            console.log(string.concat("    \"loanToken\":       \"", vm.toString(markets[i].loanToken), "\","));
            console.log(string.concat("    \"collateralToken\": \"", vm.toString(markets[i].collateralToken), "\","));
            console.log(string.concat("    \"oracle\":          \"", vm.toString(markets[i].oracle), "\","));
            console.log(string.concat("    \"irm\":             \"", vm.toString(markets[i].irm), "\","));
            console.log(string.concat("    \"lltv\":            \"", vm.toString(markets[i].lltv), "\""));
            console.log(string.concat("  }", comma));
        }
        console.log("]");
        console.log("");
        console.log("Add to your .env:");
        console.log(string.concat("  VAULT_ADDRESS=", vm.toString(vault)));
        console.log(string.concat("  ADAPTER_ADDRESS=", vm.toString(adapter)));
        console.log("==========================================================");
    }
}
