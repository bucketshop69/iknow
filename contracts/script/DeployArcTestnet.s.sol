// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IknowMarketFactory} from "../src/IknowMarketFactory.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

interface VmArc {
    function addr(uint256 privateKey) external returns (address);
    function createDir(string calldata path, bool recursive) external;
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function toString(address value) external returns (string memory);
    function toString(uint256 value) external returns (string memory);
    function writeFile(string calldata path, string calldata data) external;
}

/// @title DeployArcTestnet
/// @notice Deploys iknow core contracts against Arc Testnet's native USDC ERC-20 interface.
contract DeployArcTestnet {
    VmArc internal constant vm = VmArc(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    string internal constant ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
    string internal constant ARTIFACT_PATH = "deployments/arc-testnet.json";

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address resolver = vm.envOr("IKNOW_RESOLVER_ADDRESS", deployer);
        address protocolFeeRecipient = vm.envOr("IKNOW_PROTOCOL_FEE_RECIPIENT", deployer);
        address usdc = vm.envOr("ARC_TESTNET_USDC_ADDRESS", ARC_TESTNET_USDC);
        uint256 defaultChallengeWindow = vm.envOr("IKNOW_DEFAULT_CHALLENGE_WINDOW", uint256(1 hours));

        vm.startBroadcast(deployerPrivateKey);
        OutcomeToken outcomeToken = new OutcomeToken("urn:iknow:outcome-token/{id}");
        IknowMarketFactory factory =
            new IknowMarketFactory(IERC20(usdc), outcomeToken, resolver, protocolFeeRecipient, defaultChallengeWindow);
        outcomeToken.transferOwnership(address(factory));
        vm.stopBroadcast();

        _writeArtifact(deployer, resolver, protocolFeeRecipient, usdc, outcomeToken, factory, defaultChallengeWindow);
    }

    function _writeArtifact(
        address deployer,
        address resolver,
        address protocolFeeRecipient,
        address usdc,
        OutcomeToken outcomeToken,
        IknowMarketFactory factory,
        uint256 defaultChallengeWindow
    ) private {
        vm.createDir("deployments", true);
        vm.writeFile(
            ARTIFACT_PATH,
            _artifactJson(
                deployer,
                resolver,
                protocolFeeRecipient,
                usdc,
                address(outcomeToken),
                address(factory),
                defaultChallengeWindow
            )
        );
    }

    function _artifactJson(
        address deployer,
        address resolver,
        address protocolFeeRecipient,
        address usdc,
        address outcomeToken,
        address factory,
        uint256 defaultChallengeWindow
    ) private returns (string memory) {
        string memory json = "{\n";
        json = string.concat(json, '  "schemaVersion": 1,\n');
        json = string.concat(json, '  "generatedAtBlockTimestamp": ', vm.toString(block.timestamp), ",\n");
        json = string.concat(json, '  "chain": {\n');
        json = string.concat(json, '    "id": ', vm.toString(ARC_TESTNET_CHAIN_ID), ",\n");
        json = string.concat(json, '    "name": "Arc Testnet",\n');
        json = string.concat(json, '    "rpcUrl": "', ARC_TESTNET_RPC_URL, '"\n');
        json = string.concat(json, "  },\n");
        json = string.concat(json, '  "contracts": {\n');
        json = string.concat(json, '    "usdc": {\n');
        json = string.concat(json, '      "address": "', vm.toString(usdc), '",\n');
        json = string.concat(json, '      "decimals": 6\n');
        json = string.concat(json, "    },\n");
        json = string.concat(json, '    "outcomeToken": {\n');
        json = string.concat(json, '      "address": "', vm.toString(outcomeToken), '"\n');
        json = string.concat(json, "    },\n");
        json = string.concat(json, '    "iknowMarketFactory": {\n');
        json = string.concat(json, '      "address": "', vm.toString(factory), '",\n');
        json = string.concat(json, '      "defaultChallengeWindow": ', vm.toString(defaultChallengeWindow), ",\n");
        json = string.concat(json, '      "indexStartBlock": ', vm.toString(block.number), "\n");
        json = string.concat(json, "    }\n");
        json = string.concat(json, "  },\n");
        json = string.concat(json, '  "actors": {\n');
        json = string.concat(json, '    "deployer": "', vm.toString(deployer), '",\n');
        json = string.concat(json, '    "resolver": "', vm.toString(resolver), '",\n');
        json = string.concat(json, '    "protocolFeeRecipient": "', vm.toString(protocolFeeRecipient), '"\n');
        json = string.concat(json, "  },\n");
        json = string.concat(json, '  "markets": []\n');
        return string.concat(json, "}\n");
    }
}
