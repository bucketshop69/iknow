// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IknowTestBase} from "./IknowTestBase.sol";
import {IknowMarket} from "../src/IknowMarket.sol";
import {IknowMarketFactory} from "../src/IknowMarketFactory.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract IknowMarketFactoryTest is IknowTestBase {
    OutcomeToken private outcomeToken;
    IknowMarketFactory private factory;

    function setUp() public override {
        super.setUp();
        outcomeToken = new OutcomeToken("ipfs://iknow/{id}.json");
        factory = new IknowMarketFactory(IERC20(address(usdc)), outcomeToken, resolver);
        outcomeToken.transferOwnership(address(factory));
    }

    function testCreateMarketDeploysSeededMarket() public {
        uint256 closeTime = block.timestamp + 7 days;
        uint256 creatorBalanceBefore = usdc.balanceOf(creator);

        _approveUSDC(creator, address(factory), DEFAULT_CREATION_BOND + DEFAULT_INITIAL_LIQUIDITY);

        vm.prank(creator);
        address marketAddr = factory.createMarket(
            keccak256("Will Arsenal win the league?"),
            "ipfs://market-metadata",
            closeTime,
            DEFAULT_CREATION_BOND,
            DEFAULT_INITIAL_LIQUIDITY
        );

        IknowMarket market = IknowMarket(marketAddr);
        (uint256 yesReserve, uint256 noReserve) = market.reserves();

        require(factory.marketCount() == 1, "market count mismatch");
        require(factory.isMarket(marketAddr), "market not registered");
        require(outcomeToken.isMinter(marketAddr), "market not authorized");
        require(market.creator() == creator, "creator mismatch");
        require(market.resolver() == resolver, "resolver mismatch");
        require(market.closeTime() == closeTime, "close time mismatch");
        require(market.lpShares(creator) == DEFAULT_INITIAL_LIQUIDITY, "creator LP shares mismatch");
        require(yesReserve == DEFAULT_INITIAL_LIQUIDITY, "YES reserve mismatch");
        require(noReserve == DEFAULT_INITIAL_LIQUIDITY, "NO reserve mismatch");
        require(usdc.balanceOf(marketAddr) == DEFAULT_CREATION_BOND + DEFAULT_INITIAL_LIQUIDITY, "market USDC mismatch");
        require(
            usdc.balanceOf(creator) == creatorBalanceBefore - DEFAULT_CREATION_BOND - DEFAULT_INITIAL_LIQUIDITY,
            "creator USDC mismatch"
        );
    }

    function testCreateMarketRejectsPastCloseTime() public {
        _approveUSDC(creator, address(factory), DEFAULT_INITIAL_LIQUIDITY);

        vm.prank(creator);
        vm.expectRevert(IknowMarketFactory.InvalidCloseTime.selector);
        factory.createMarket(
            keccak256("past market"),
            "ipfs://market-metadata",
            block.timestamp,
            0,
            DEFAULT_INITIAL_LIQUIDITY
        );
    }

    function testCreateMarketRejectsZeroInitialLiquidity() public {
        vm.prank(creator);
        vm.expectRevert(IknowMarketFactory.InvalidAmount.selector);
        factory.createMarket(keccak256("empty market"), "ipfs://market-metadata", block.timestamp + 1 days, 0, 0);
    }

    function testFactoryMarketFullLifecycleHonorsChallengeWindow() public {
        uint256 closeTime = block.timestamp + 7 days;
        _approveUSDC(creator, address(factory), DEFAULT_CREATION_BOND + DEFAULT_INITIAL_LIQUIDITY);

        vm.prank(creator);
        address marketAddr = factory.createMarket(
            keccak256("Will iknow ship a working MVP?"),
            "ipfs://market-metadata",
            closeTime,
            DEFAULT_CREATION_BOND,
            DEFAULT_INITIAL_LIQUIDITY
        );

        IknowMarket market = IknowMarket(marketAddr);
        _approveUSDC(trader, marketAddr, DEFAULT_TRADE_AMOUNT);

        vm.prank(trader);
        uint256 yesBought = market.buyYes(DEFAULT_TRADE_AMOUNT, 0);

        vm.warp(closeTime);
        vm.prank(resolver);
        market.proposeResolution(IknowMarket.Outcome.Yes, "ipfs://evidence");

        vm.expectRevert(IknowMarket.TooEarly.selector);
        market.finalizeResolution();

        vm.warp(market.finalizeAfter());
        market.finalizeResolution();

        uint256 traderBalanceBefore = usdc.balanceOf(trader);

        vm.prank(trader);
        uint256 redeemed = market.redeem();

        require(redeemed == yesBought, "redeem amount mismatch");
        require(usdc.balanceOf(trader) == traderBalanceBefore + yesBought, "redeem balance mismatch");
        require(uint256(market.state()) == uint256(IknowMarket.State.Resolved), "market not resolved");
    }
}
