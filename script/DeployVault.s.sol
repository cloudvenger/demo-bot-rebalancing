// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

// ---------------------------------------------------------------------------
// Minimal interfaces — only the functions we call
// ---------------------------------------------------------------------------

/// @notice Morpho Vault V2 market parameters struct
struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

/// @notice Minimal interface for the VaultV2Factory
/// @dev Verify the exact function signature against the deployed factory ABI
///      on Etherscan: https://etherscan.io/address/0xA1D94F746dEfa1928926b84fB2596c06926C0405
interface IVaultV2Factory {
    function createVault(
        address asset,
        address owner,
        string calldata name,
        string calldata symbol
    ) external returns (address vault);
}

/// @notice Minimal interface for the MorphoMarketV1AdapterV2Factory
/// @dev Verify the exact function signature against the deployed factory ABI
///      on Etherscan: https://etherscan.io/address/0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1
interface IAdapterFactory {
    function createAdapter(
        address vault,
        MarketParams calldata marketParams
    ) external returns (address adapter);
}

/// @notice Minimal interface for Vault V2 management functions
/// @dev Verify function signatures against the deployed vault implementation
interface IVaultV2 {
    function enableAdapter(address adapter) external;
    function setCap(bytes32 riskId, uint256 absoluteCap, uint256 relativeCap) external;
    function grantRole(bytes32 role, address account) external;
    function adaptersLength() external view returns (uint256);
    function adaptersAt(uint256 index) external view returns (address);
    function caps(bytes32 id) external view returns (uint256 absoluteCap, uint256 relativeCap);
}

/// @title DeployVault
/// @notice Deploys a Morpho Vault V2 with USDC, 3 market adapters, caps, and allocator role
/// @dev Run with: forge script script/DeployVault.s.sol --fork-url $RPC_URL --broadcast -vvvv
///
///      IMPORTANT: The interfaces above are best-effort approximations of the Morpho V2 contracts.
///      Before running on mainnet, verify the exact ABIs on Etherscan for:
///        - VaultV2Factory: 0xA1D94F746dEfa1928926b84fB2596c06926C0405
///        - MorphoMarketV1AdapterV2Factory: 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1
///        - The deployed Vault V2 implementation
contract DeployVault is Script {
    // -----------------------------------------------------------------------
    // Constants — Ethereum mainnet addresses
    // -----------------------------------------------------------------------

    address constant VAULT_V2_FACTORY = 0xA1D94F746dEfa1928926b84fB2596c06926C0405;
    address constant ADAPTER_FACTORY = 0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // Collateral tokens
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    // Adaptive Curve IRM — most common IRM on Morpho Blue
    // Verify this is correct for your target markets
    address constant IRM = 0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC;

    // Allocator role hash — verify against the vault implementation
    // This is a common pattern: keccak256("ALLOCATOR_ROLE")
    bytes32 constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");

    // -----------------------------------------------------------------------
    // Environment variables
    // -----------------------------------------------------------------------

    function run() external {
        // --- Read env vars -------------------------------------------------
        address owner = vm.envAddress("OWNER");
        address allocator = vm.envAddress("ALLOCATOR");
        uint256 absoluteCap = vm.envUint("ABSOLUTE_CAP");
        uint256 relativeCap = vm.envUint("RELATIVE_CAP");

        // Oracle addresses per market — must match existing Morpho Blue markets
        // These default to zero address as placeholders; set them in .env
        address oracleWeth = vm.envOr("ORACLE_WETH", address(0));
        address oracleWsteth = vm.envOr("ORACLE_WSTETH", address(0));
        address oracleWbtc = vm.envOr("ORACLE_WBTC", address(0));

        // LLTV per market (in WAD, e.g., 860000000000000000 = 86%)
        uint256 lltvWeth = vm.envOr("LLTV_WETH", uint256(860000000000000000));
        uint256 lltvWsteth = vm.envOr("LLTV_WSTETH", uint256(860000000000000000));
        uint256 lltvWbtc = vm.envOr("LLTV_WBTC", uint256(860000000000000000));

        require(oracleWeth != address(0), "ORACLE_WETH not set");
        require(oracleWsteth != address(0), "ORACLE_WSTETH not set");
        require(oracleWbtc != address(0), "ORACLE_WBTC not set");

        // --- Start broadcasting transactions -------------------------------
        vm.startBroadcast();

        // Step 1: Deploy Vault V2
        console.log("--- Step 1: Deploying Vault V2 ---");
        address vault = IVaultV2Factory(VAULT_V2_FACTORY).createVault(
            USDC,
            owner,
            "USDC Yield Vault",
            "yvUSDC"
        );
        console.log("Vault deployed at:", vault);

        // Step 2: Deploy 3 adapters
        console.log("--- Step 2: Deploying adapters ---");

        MarketParams memory paramsWeth = MarketParams({
            loanToken: USDC,
            collateralToken: WETH,
            oracle: oracleWeth,
            irm: IRM,
            lltv: lltvWeth
        });

        MarketParams memory paramsWsteth = MarketParams({
            loanToken: USDC,
            collateralToken: WSTETH,
            oracle: oracleWsteth,
            irm: IRM,
            lltv: lltvWsteth
        });

        MarketParams memory paramsWbtc = MarketParams({
            loanToken: USDC,
            collateralToken: WBTC,
            oracle: oracleWbtc,
            irm: IRM,
            lltv: lltvWbtc
        });

        address adapterWeth = IAdapterFactory(ADAPTER_FACTORY).createAdapter(vault, paramsWeth);
        console.log("Adapter USDC/WETH deployed at:", adapterWeth);

        address adapterWsteth = IAdapterFactory(ADAPTER_FACTORY).createAdapter(vault, paramsWsteth);
        console.log("Adapter USDC/wstETH deployed at:", adapterWsteth);

        address adapterWbtc = IAdapterFactory(ADAPTER_FACTORY).createAdapter(vault, paramsWbtc);
        console.log("Adapter USDC/WBTC deployed at:", adapterWbtc);

        // Step 3: Enable adapters on the vault
        console.log("--- Step 3: Enabling adapters ---");
        IVaultV2(vault).enableAdapter(adapterWeth);
        IVaultV2(vault).enableAdapter(adapterWsteth);
        IVaultV2(vault).enableAdapter(adapterWbtc);
        console.log("All 3 adapters enabled");

        // Step 4: Set caps for each adapter
        // NOTE: Risk ID computation may differ — verify against the vault implementation.
        // Common patterns: keccak256(abi.encode(adapterAddress)) or derived from MarketParams.
        console.log("--- Step 4: Setting caps ---");
        bytes32 riskIdWeth = keccak256(abi.encode(adapterWeth));
        bytes32 riskIdWsteth = keccak256(abi.encode(adapterWsteth));
        bytes32 riskIdWbtc = keccak256(abi.encode(adapterWbtc));

        IVaultV2(vault).setCap(riskIdWeth, absoluteCap, relativeCap);
        IVaultV2(vault).setCap(riskIdWsteth, absoluteCap, relativeCap);
        IVaultV2(vault).setCap(riskIdWbtc, absoluteCap, relativeCap);
        console.log("Caps set for all adapters");
        console.log("  Absolute cap:", absoluteCap);
        console.log("  Relative cap (bps):", relativeCap);

        // Step 5: Grant Allocator role to the bot wallet
        console.log("--- Step 5: Granting Allocator role ---");
        IVaultV2(vault).grantRole(ALLOCATOR_ROLE, allocator);
        console.log("Allocator role granted to:", allocator);

        vm.stopBroadcast();

        // --- Summary -------------------------------------------------------
        console.log("");
        console.log("========================================");
        console.log("  DEPLOYMENT SUMMARY");
        console.log("========================================");
        console.log("Vault:            ", vault);
        console.log("Adapter USDC/WETH:", adapterWeth);
        console.log("Adapter USDC/wstETH:", adapterWsteth);
        console.log("Adapter USDC/WBTC:", adapterWbtc);
        console.log("Owner:            ", owner);
        console.log("Allocator:        ", allocator);
        console.log("========================================");
    }
}
