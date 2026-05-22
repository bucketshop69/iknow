// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IknowTestBase} from "./IknowTestBase.sol";
import {IknowMarket} from "../src/IknowMarket.sol";
import {IknowMarketFactory} from "../src/IknowMarketFactory.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract IknowMarketResolutionEdgeTest is IknowTestBase {
    OutcomeToken private outcomeToken;
    IknowMarketFactory private factory;
    IknowMarket private market;

    uint256 private closeTime;

    function setUp() public override {
        super.setUp();

        outcomeToken = new OutcomeToken("ipfs://iknow/{id}.json");
        factory = new IknowMarketFactory(IERC20(address(usdc)), outcomeToken, resolver, treasury, 1 hours);
        outcomeToken.transferOwnership(address(factory));

        closeTime = block.timestamp + 7 days;
        _approveUSDC(creator, address(factory), DEFAULT_CREATION_BOND + DEFAULT_INITIAL_LIQUIDITY);

        vm.prank(creator);
        address marketAddr = factory.createMarket(
            keccak256("iknow resolution edge market"),
            "ipfs://market-metadata",
            closeTime,
            DEFAULT_CREATION_BOND,
            DEFAULT_INITIAL_LIQUIDITY
        );
        market = IknowMarket(marketAddr);

        _approveActor(trader);
        _approveActor(lp);
        _approveActor(stranger);
    }

    function testCannotTradeAfterClose() public {
        vm.prank(trader);
        uint256 yesBought = market.buyYes(DEFAULT_TRADE_AMOUNT, 0);
        require(yesBought > 0, "expected YES buy");

        vm.warp(closeTime);
        vm.prank(resolver);
        market.close();

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidState.selector);
        market.buyNo(DEFAULT_TRADE_AMOUNT, 0);

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidState.selector);
        market.sellYes(yesBought / 2, 0);

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidState.selector);
        market.split(ONE_USDC);

        vm.prank(lp);
        vm.expectRevert(IknowMarket.InvalidState.selector);
        market.addLiquidity(ONE_USDC, 0);
    }

    function testResolverCannotCloseBeforeCloseTime() public {
        vm.prank(resolver);
        vm.expectRevert(IknowMarket.TooEarly.selector);
        market.close();
    }

    function testCannotRedeemBeforeFinalization() public {
        vm.prank(trader);
        market.buyYes(DEFAULT_TRADE_AMOUNT, 0);

        _propose(IknowMarket.Outcome.Yes);

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidState.selector);
        market.redeem();
    }

    function testCannotFinalizeBeforeChallengeWindow() public {
        _propose(IknowMarket.Outcome.Yes);

        vm.expectRevert(IknowMarket.TooEarly.selector);
        market.finalizeResolution();
    }

    function testCannotDoubleRedeem() public {
        vm.prank(trader);
        uint256 yesBought = market.buyYes(DEFAULT_TRADE_AMOUNT, 0);

        _resolve(IknowMarket.Outcome.Yes);

        uint256 balanceBefore = usdc.balanceOf(trader);
        vm.prank(trader);
        uint256 redeemed = market.redeem();

        require(redeemed == yesBought, "first redeem mismatch");
        require(usdc.balanceOf(trader) == balanceBefore + yesBought, "first redeem transfer mismatch");

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidAmount.selector);
        market.redeem();
    }

    function testInvalidResolutionOnlyUnwindsMatchedCompleteSets() public {
        vm.prank(trader);
        market.split(100 * ONE_USDC);

        vm.prank(trader);
        uint256 extraYes = market.buyYes(50 * ONE_USDC, 0);

        uint256 yesBefore = outcomeToken.balanceOf(trader, market.yesTokenId());
        uint256 noBefore = outcomeToken.balanceOf(trader, market.noTokenId());
        require(yesBefore == noBefore + extraYes, "expected unmatched YES");

        _resolve(IknowMarket.Outcome.Invalid);

        uint256 balanceBefore = usdc.balanceOf(trader);
        vm.prank(trader);
        uint256 redeemed = market.redeem();

        require(redeemed == noBefore, "invalid should redeem only matched sets");
        require(usdc.balanceOf(trader) == balanceBefore + noBefore, "invalid redeem transfer mismatch");
        require(outcomeToken.balanceOf(trader, market.yesTokenId()) == extraYes, "unmatched YES should remain");
        require(outcomeToken.balanceOf(trader, market.noTokenId()) == 0, "matched NO should burn");
    }

    function testInvalidResolutionRejectsUnmatchedOnlyPosition() public {
        vm.prank(trader);
        market.buyYes(DEFAULT_TRADE_AMOUNT, 0);

        _resolve(IknowMarket.Outcome.Invalid);

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidAmount.selector);
        market.redeem();
    }

    function testInvalidResolutionForfeitsUnclaimedCreatorFeesToLpBucket() public {
        vm.prank(trader);
        market.buyYes(DEFAULT_TRADE_AMOUNT, 0);

        uint256 creatorFee = market.creatorFeePool();
        uint256 lpFeeBefore = market.lpFeePool();
        uint256 protocolFeeBefore = market.protocolFeePool();
        require(creatorFee > 0, "expected creator fee");

        _resolve(IknowMarket.Outcome.Invalid);

        require(market.creatorFeePool() == 0, "creator fee should be forfeited");
        require(market.lpFeePool() == lpFeeBefore + creatorFee, "creator fee should move to LPs");
        require(
            market.protocolFeePool() == protocolFeeBefore + DEFAULT_CREATION_BOND,
            "slashed bond should move to protocol"
        );
        require(market.creationBond() == 0, "creation bond should be slashed");

        vm.prank(creator);
        vm.expectRevert(IknowMarket.InvalidOutcome.selector);
        market.claimCreatorFees(creator, creatorFee);

        vm.prank(creator);
        vm.expectRevert(IknowMarket.InvalidOutcome.selector);
        market.claimCreationBond(creator);
    }

    function testLosingNoTokensCannotRedeemAfterYesResolution() public {
        vm.prank(trader);
        uint256 noBought = market.buyNo(DEFAULT_TRADE_AMOUNT, 0);
        require(noBought > 0, "expected NO buy");

        _resolve(IknowMarket.Outcome.Yes);

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidAmount.selector);
        market.redeem();
    }

    function testLosingYesTokensCannotRedeemAfterNoResolution() public {
        vm.prank(trader);
        uint256 yesBought = market.buyYes(DEFAULT_TRADE_AMOUNT, 0);
        require(yesBought > 0, "expected YES buy");

        _resolve(IknowMarket.Outcome.No);

        vm.prank(trader);
        vm.expectRevert(IknowMarket.InvalidAmount.selector);
        market.redeem();
    }

    function _propose(IknowMarket.Outcome outcome) private {
        vm.warp(closeTime);
        vm.prank(resolver);
        market.proposeResolution(outcome, "ipfs://evidence");
    }

    function _resolve(IknowMarket.Outcome outcome) private {
        _propose(outcome);
        vm.warp(market.finalizeAfter());
        market.finalizeResolution();
    }

    function _approveActor(address actor) private {
        _approveUSDCMax(actor, address(market));
        vm.prank(actor);
        outcomeToken.setApprovalForAll(address(market), true);
    }
}
