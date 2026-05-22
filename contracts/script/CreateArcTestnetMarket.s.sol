// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "../src/interfaces/IERC20.sol";

interface VmCreateMarket {
    function addr(uint256 privateKey) external returns (address);
    function createDir(string calldata path, bool recursive) external;
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function toString(address value) external returns (string memory);
    function toString(bytes32 value) external returns (string memory);
    function toString(uint256 value) external returns (string memory);
    function writeFile(string calldata path, string calldata data) external;
}

interface IknowMarketFactoryLike {
    function createMarket(
        bytes32 specHash,
        string calldata metadataURI,
        uint256 closeTime,
        uint256 creationBond,
        uint256 initialLiquidity
    ) external returns (address marketAddr);
}

interface IknowMarketLike {
    function buyYes(uint256 usdcIn, uint256 minYesOut) external returns (uint256 yesOut);
    function reserves() external view returns (uint256 yes, uint256 no);
    function yesTokenId() external view returns (uint256);
    function noTokenId() external view returns (uint256);
}

/// @title CreateArcTestnetMarket
/// @notice Creates a small Arc testnet market and optionally buys YES for a smoke test.
contract CreateArcTestnetMarket {
    VmCreateMarket internal constant vm = VmCreateMarket(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address creator = vm.addr(privateKey);
        address factory = vm.envAddress("IKNOW_FACTORY_ADDRESS");
        address usdc = vm.envAddress("IKNOW_USDC_ADDRESS");

        string memory marketId = vm.envOr("IKNOW_MARKET_ID", "arc-smoke-test");
        string memory question = vm.envOr("IKNOW_MARKET_QUESTION", "Will this Arc testnet smoke market resolve YES?");
        string memory metadataURI = vm.envOr("IKNOW_MARKET_METADATA_URI", "urn:iknow:market:arc-smoke-test");
        string memory resolutionSource =
            vm.envOr("IKNOW_MARKET_RESOLUTION_SOURCE", "Manual smoke-test source controlled by the iknow demo resolver.");
        string memory invalidCondition =
            vm.envOr("IKNOW_MARKET_INVALID_CONDITION", "Resolve INVALID only if the test market was created with malformed metadata.");
        uint256 closeTime = vm.envOr("IKNOW_MARKET_CLOSE_TIME", block.timestamp + 10 minutes);
        uint256 creationBond = vm.envOr("IKNOW_CREATION_BOND", 5_000_000);
        uint256 initialLiquidity = vm.envOr("IKNOW_INITIAL_LIQUIDITY", 10_000_000);
        uint256 smokeBuy = vm.envOr("IKNOW_SMOKE_BUY_USDC", 1_000_000);

        bytes32 specHash =
            keccak256(abi.encode(marketId, question, metadataURI, resolutionSource, invalidCondition, closeTime));

        vm.startBroadcast(privateKey);
        IERC20(usdc).approve(factory, creationBond + initialLiquidity);
        address market = IknowMarketFactoryLike(factory).createMarket(
            specHash, metadataURI, closeTime, creationBond, initialLiquidity
        );
        if (smokeBuy != 0) {
            IERC20(usdc).approve(market, smokeBuy);
            IknowMarketLike(market).buyYes(smokeBuy, 0);
        }
        vm.stopBroadcast();

        (uint256 yesReserve, uint256 noReserve) = IknowMarketLike(market).reserves();
        _writeArtifact(creator, factory, usdc, market, specHash, closeTime, yesReserve, noReserve);
    }

    function _writeArtifact(
        address creator,
        address factory,
        address usdc,
        address market,
        bytes32 specHash,
        uint256 closeTime,
        uint256 yesReserve,
        uint256 noReserve
    ) private {
        vm.createDir("deployments", true);
        vm.writeFile(
            "deployments/arc-testnet-market-latest.json",
            _artifactJson(creator, factory, usdc, market, specHash, closeTime, yesReserve, noReserve)
        );
    }

    function _artifactJson(
        address creator,
        address factory,
        address usdc,
        address market,
        bytes32 specHash,
        uint256 closeTime,
        uint256 yesReserve,
        uint256 noReserve
    ) private returns (string memory) {
        string memory json = "{\n";
        json = string.concat(json, '  "schemaVersion": 1,\n');
        json = string.concat(json, '  "creator": "', vm.toString(creator), '",\n');
        json = string.concat(json, '  "factory": "', vm.toString(factory), '",\n');
        json = string.concat(json, '  "usdc": "', vm.toString(usdc), '",\n');
        json = string.concat(json, '  "market": "', vm.toString(market), '",\n');
        json = string.concat(json, '  "specHash": "', vm.toString(specHash), '",\n');
        json = string.concat(json, '  "closeTime": ', vm.toString(closeTime), ",\n");
        json = string.concat(json, '  "yesReserve": "', vm.toString(yesReserve), '",\n');
        json = string.concat(json, '  "noReserve": "', vm.toString(noReserve), '"\n');
        return string.concat(json, "}\n");
    }
}
