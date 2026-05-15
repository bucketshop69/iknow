// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {IknowMarket} from "../src/IknowMarket.sol";
import {IknowMarketFactory} from "../src/IknowMarketFactory.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function createDir(string calldata path, bool recursive) external;
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function toString(address value) external returns (string memory);
    function toString(bytes32 value) external returns (string memory);
    function toString(uint256 value) external returns (string memory);
    function writeFile(string calldata path, string calldata data) external;
}

/// @title DeployLocal
/// @notice Deploys and seeds the disposable Anvil stack used by the app MVP.
contract DeployLocal {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant DEFAULT_DEPLOYER_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant CREATOR_PK = 0x1c0de;
    uint256 internal constant TRADER_YES_PK = 0x2c0de;
    uint256 internal constant TRADER_NO_PK = 0x3c0de;
    uint256 internal constant LP_PK = 0x4c0de;
    uint256 internal constant RESOLVER_PK = 0x5c0de;
    uint256 internal constant PROTOCOL_PK = 0x6c0de;

    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant ACTOR_ETH_BALANCE = 100 ether;
    uint256 internal constant CREATOR_USDC_BALANCE = 100_000 * ONE_USDC;
    uint256 internal constant TRADER_USDC_BALANCE = 25_000 * ONE_USDC;
    uint256 internal constant LP_USDC_BALANCE = 100_000 * ONE_USDC;
    uint256 internal constant CREATION_BOND = 100 * ONE_USDC;
    uint256 internal constant INITIAL_LIQUIDITY = 1_000 * ONE_USDC;
    uint256 internal constant SAMPLE_BUY = 100 * ONE_USDC;
    string internal constant ARTIFACT_PATH = "deployments/local-anvil.json";

    struct Actors {
        address deployer;
        address creator;
        address traderYes;
        address traderNo;
        address liquidityProvider;
        address resolver;
        address protocol;
    }

    struct MarketSeed {
        string id;
        string question;
        string metadataURI;
        bytes32 specHash;
        uint256 closeTime;
        uint256 creationBond;
        uint256 initialLiquidity;
        address market;
    }

    struct Deployment {
        uint256 deployerPrivateKey;
        Actors actors;
        MockUSDC usdc;
        OutcomeToken outcomeToken;
        IknowMarketFactory factory;
        MarketSeed[3] markets;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("LOCAL_DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_PK);
        Deployment memory deployment;
        deployment.deployerPrivateKey = deployerPrivateKey;
        deployment.actors = _actors(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        deployment.usdc = new MockUSDC();
        deployment.outcomeToken = new OutcomeToken("urn:iknow:outcome-token/{id}");
        deployment.factory = new IknowMarketFactory(
            IERC20(address(deployment.usdc)),
            deployment.outcomeToken,
            deployment.actors.resolver,
            deployment.actors.protocol
        );
        deployment.outcomeToken.transferOwnership(address(deployment.factory));
        _fundActors(deployment);
        vm.stopBroadcast();

        vm.startBroadcast(CREATOR_PK);
        deployment.usdc.approve(address(deployment.factory), type(uint256).max);
        deployment.markets = _createMarkets(deployment.factory);
        vm.stopBroadcast();

        _seedDemoTrades(deployment);
        _writeArtifact(deployment);
    }

    function _actors(uint256 deployerPrivateKey) private returns (Actors memory actors) {
        actors.deployer = vm.addr(deployerPrivateKey);
        actors.creator = vm.addr(CREATOR_PK);
        actors.traderYes = vm.addr(TRADER_YES_PK);
        actors.traderNo = vm.addr(TRADER_NO_PK);
        actors.liquidityProvider = vm.addr(LP_PK);
        actors.resolver = vm.addr(RESOLVER_PK);
        actors.protocol = vm.addr(PROTOCOL_PK);
    }

    function _fundActors(Deployment memory deployment) private {
        payable(deployment.actors.creator).transfer(ACTOR_ETH_BALANCE);
        payable(deployment.actors.traderYes).transfer(ACTOR_ETH_BALANCE);
        payable(deployment.actors.traderNo).transfer(ACTOR_ETH_BALANCE);
        payable(deployment.actors.liquidityProvider).transfer(ACTOR_ETH_BALANCE);
        payable(deployment.actors.resolver).transfer(ACTOR_ETH_BALANCE);
        payable(deployment.actors.protocol).transfer(ACTOR_ETH_BALANCE);

        deployment.usdc.mint(deployment.actors.creator, CREATOR_USDC_BALANCE);
        deployment.usdc.mint(deployment.actors.traderYes, TRADER_USDC_BALANCE);
        deployment.usdc.mint(deployment.actors.traderNo, TRADER_USDC_BALANCE);
        deployment.usdc.mint(deployment.actors.liquidityProvider, LP_USDC_BALANCE);
    }

    function _createMarkets(IknowMarketFactory factory) private returns (MarketSeed[3] memory markets) {
        uint256 baseCloseTime = block.timestamp + 7 days;

        markets[0] = _createMarket(
            factory,
            "ship-mvp",
            "Will iknow ship a local trading MVP this month?",
            "urn:iknow:market:ship-mvp",
            baseCloseTime
        );
        markets[1] = _createMarket(
            factory,
            "arc-testnet-volume",
            "Will Arc testnet daily transaction volume exceed 100k next week?",
            "urn:iknow:market:arc-testnet-volume",
            baseCloseTime + 3 days
        );
        markets[2] = _createMarket(
            factory,
            "first-creator-fee",
            "Will the first demo market accrue creator fees before close?",
            "urn:iknow:market:first-creator-fee",
            baseCloseTime + 5 days
        );
    }

    function _createMarket(
        IknowMarketFactory factory,
        string memory id,
        string memory question,
        string memory metadataURI,
        uint256 closeTime
    ) private returns (MarketSeed memory seed) {
        seed.id = id;
        seed.question = question;
        seed.metadataURI = metadataURI;
        seed.specHash = keccak256(abi.encode(id, question, metadataURI, closeTime));
        seed.closeTime = closeTime;
        seed.creationBond = CREATION_BOND;
        seed.initialLiquidity = INITIAL_LIQUIDITY;
        seed.market = factory.createMarket(seed.specHash, metadataURI, closeTime, CREATION_BOND, INITIAL_LIQUIDITY);
    }

    function _seedDemoTrades(Deployment memory deployment) private {
        IknowMarket market = IknowMarket(deployment.markets[0].market);

        vm.startBroadcast(TRADER_YES_PK);
        deployment.usdc.approve(address(market), SAMPLE_BUY);
        market.buyYes(SAMPLE_BUY, 0);
        vm.stopBroadcast();

        vm.startBroadcast(TRADER_NO_PK);
        deployment.usdc.approve(address(market), SAMPLE_BUY);
        market.buyNo(SAMPLE_BUY, 0);
        vm.stopBroadcast();

        vm.startBroadcast(LP_PK);
        deployment.usdc.approve(address(market), INITIAL_LIQUIDITY / 2);
        market.addLiquidity(INITIAL_LIQUIDITY / 2, 0);
        vm.stopBroadcast();
    }

    function _writeArtifact(Deployment memory deployment) private {
        vm.createDir("deployments", true);
        vm.writeFile(ARTIFACT_PATH, _artifactJson(deployment));
    }

    function _artifactJson(Deployment memory deployment) private returns (string memory) {
        string memory json = "{\n";
        json = string.concat(json, '  "schemaVersion": 1,\n');
        json = string.concat(json, '  "generatedAtBlockTimestamp": ', vm.toString(block.timestamp), ",\n");
        json = string.concat(json, '  "chain": {\n');
        json = string.concat(json, '    "id": ', vm.toString(block.chainid), ",\n");
        json = string.concat(json, '    "name": "Anvil Local",\n');
        json = string.concat(json, '    "rpcUrl": "http://127.0.0.1:8545"\n');
        json = string.concat(json, "  },\n");
        json = string.concat(json, '  "contracts": ', _contractsJson(deployment), ",\n");
        json = string.concat(json, '  "actors": ', _actorsJson(deployment), ",\n");
        json = string.concat(json, '  "markets": [\n');
        json = string.concat(json, _marketJson(deployment.markets[0], deployment.outcomeToken, true));
        json = string.concat(json, _marketJson(deployment.markets[1], deployment.outcomeToken, true));
        json = string.concat(json, _marketJson(deployment.markets[2], deployment.outcomeToken, false));
        json = string.concat(json, "  ]\n");
        return string.concat(json, "}\n");
    }

    function _contractsJson(Deployment memory deployment) private returns (string memory) {
        string memory json = "{\n";
        json = string.concat(json, '    "mockUSDC": {\n');
        json = string.concat(json, '      "address": "', vm.toString(address(deployment.usdc)), '",\n');
        json = string.concat(json, '      "decimals": 6\n');
        json = string.concat(json, "    },\n");
        json = string.concat(json, '    "outcomeToken": {\n');
        json = string.concat(json, '      "address": "', vm.toString(address(deployment.outcomeToken)), '"\n');
        json = string.concat(json, "    },\n");
        json = string.concat(json, '    "iknowMarketFactory": {\n');
        json = string.concat(json, '      "address": "', vm.toString(address(deployment.factory)), '"\n');
        return string.concat(json, "    }\n  }");
    }

    function _actorsJson(Deployment memory deployment) private returns (string memory) {
        string memory json = "{\n";
        json = string.concat(json, _actorJson("deployer", deployment.actors.deployer, deployment.deployerPrivateKey, true));
        json = string.concat(json, _actorJson("creator", deployment.actors.creator, CREATOR_PK, true));
        json = string.concat(json, _actorJson("traderYes", deployment.actors.traderYes, TRADER_YES_PK, true));
        json = string.concat(json, _actorJson("traderNo", deployment.actors.traderNo, TRADER_NO_PK, true));
        json = string.concat(json, _actorJson("liquidityProvider", deployment.actors.liquidityProvider, LP_PK, true));
        json = string.concat(json, _actorJson("resolver", deployment.actors.resolver, RESOLVER_PK, true));
        json = string.concat(json, _actorJson("protocol", deployment.actors.protocol, PROTOCOL_PK, false));
        return string.concat(json, "  }");
    }

    function _actorJson(string memory name, address actor, uint256 privateKey, bool trailingComma)
        private
        returns (string memory)
    {
        string memory json = string.concat('    "', name, '": {\n');
        json = string.concat(json, '      "address": "', vm.toString(actor), '",\n');
        json = string.concat(json, '      "privateKey": "', _hexPrivateKey(privateKey), '"\n');
        return string.concat(json, "    }", trailingComma ? ",\n" : "\n");
    }

    function _marketJson(MarketSeed memory market, OutcomeToken outcomeToken, bool trailingComma)
        private
        returns (string memory)
    {
        uint256 yesTokenId = outcomeToken.tokenId(market.market, outcomeToken.OUTCOME_YES());
        uint256 noTokenId = outcomeToken.tokenId(market.market, outcomeToken.OUTCOME_NO());

        string memory json = "    {\n";
        json = string.concat(json, '      "id": "', market.id, '",\n');
        json = string.concat(json, '      "address": "', vm.toString(market.market), '",\n');
        json = string.concat(json, '      "question": "', market.question, '",\n');
        json = string.concat(json, '      "specHash": "', vm.toString(market.specHash), '",\n');
        json = string.concat(json, '      "metadataURI": "', market.metadataURI, '",\n');
        json = string.concat(json, '      "closeTime": ', vm.toString(market.closeTime), ",\n");
        json = string.concat(json, '      "creationBond": "', vm.toString(market.creationBond), '",\n');
        json = string.concat(json, '      "initialLiquidity": "', vm.toString(market.initialLiquidity), '",\n');
        json = string.concat(json, '      "yesTokenId": "', vm.toString(yesTokenId), '",\n');
        json = string.concat(json, '      "noTokenId": "', vm.toString(noTokenId), '"\n');
        return string.concat(json, "    }", trailingComma ? ",\n" : "\n");
    }

    function _hexPrivateKey(uint256 privateKey) private pure returns (string memory) {
        bytes memory symbols = "0123456789abcdef";
        bytes memory buffer = new bytes(66);
        buffer[0] = "0";
        buffer[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint256 value = (privateKey >> (8 * (31 - i))) & 0xff;
            buffer[2 + i * 2] = symbols[value >> 4];
            buffer[3 + i * 2] = symbols[value & 0x0f];
        }
        return string(buffer);
    }
}
