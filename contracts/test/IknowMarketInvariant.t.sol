// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IknowTestBase} from "./IknowTestBase.sol";
import {IknowMarket} from "../src/IknowMarket.sol";
import {IknowMarketFactory} from "../src/IknowMarketFactory.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Bounded fuzz coverage for open-market accounting and pool reserve invariants.
contract IknowMarketInvariantTest is IknowTestBase {
    uint256 private constant DEFAULT_TOTAL_FEE_BPS = 30;
    uint256 private constant DEFAULT_LP_FEE_BPS = 20;
    uint256 private constant DEFAULT_CREATOR_FEE_BPS = 5;
    uint256 private constant DEFAULT_PROTOCOL_FEE_BPS = 5;

    OutcomeToken private outcomeToken;
    IknowMarketFactory private factory;
    IknowMarket private market;

    uint256 private closeTime;

    function setUp() public override {
        super.setUp();

        outcomeToken = new OutcomeToken("ipfs://iknow/{id}.json");
        factory = new IknowMarketFactory(IERC20(address(usdc)), outcomeToken, resolver, treasury, 1 hours);
        outcomeToken.transferOwnership(address(factory));
        require(
            DEFAULT_LP_FEE_BPS + DEFAULT_CREATOR_FEE_BPS + DEFAULT_PROTOCOL_FEE_BPS == DEFAULT_TOTAL_FEE_BPS,
            "fee split mismatch"
        );

        closeTime = block.timestamp + 30 days;
        _approveUSDC(creator, address(factory), DEFAULT_CREATION_BOND + DEFAULT_INITIAL_LIQUIDITY);

        vm.prank(creator);
        address marketAddr = factory.createMarket(
            keccak256("iknow bounded invariant market"),
            "ipfs://market-metadata",
            closeTime,
            DEFAULT_CREATION_BOND,
            DEFAULT_INITIAL_LIQUIDITY
        );
        market = IknowMarket(marketAddr);
        require(market.feeBps() == DEFAULT_TOTAL_FEE_BPS, "market total fee mismatch");

        _approveActor(trader);
        _approveActor(lp);
        _approveActor(stranger);

        _assertAccounting();
        _assertReservesMatchBalances();
    }

    function testFuzzOpenMarketBoundedActionSequence(uint8[32] memory actions, uint96[32] memory amounts) public {
        for (uint256 i = 0; i < actions.length; i++) {
            address actor = _actor(amounts[i]);
            uint256 action = uint256(actions[i]) % 8;
            uint256 amountSeed = uint256(amounts[i]);

            if (action == 0) {
                _split(actor, amountSeed);
            } else if (action == 1) {
                _merge(actor, amountSeed);
            } else if (action == 2) {
                _buyYes(actor, amountSeed);
            } else if (action == 3) {
                _buyNo(actor, amountSeed);
            } else if (action == 4) {
                _sellYes(actor, amountSeed);
            } else if (action == 5) {
                _sellNo(actor, amountSeed);
            } else if (action == 6) {
                _addLiquidity(actor, amountSeed);
            } else {
                _removeLiquidity(actor, amountSeed);
            }

            _assertAccounting();
            _assertReservesMatchBalances();
        }
    }

    function _split(address actor, uint256 seed) private {
        uint256 amount = _boundedSpend(actor, seed, 1, 500 * ONE_USDC);
        if (amount == 0) return;

        vm.prank(actor);
        market.split(amount);
    }

    function _merge(address actor, uint256 seed) private {
        uint256 yesBal = outcomeToken.balanceOf(actor, market.yesTokenId());
        uint256 noBal = outcomeToken.balanceOf(actor, market.noTokenId());
        uint256 maxAmount = _min(_min(yesBal, noBal), market.collateralBalance());
        if (maxAmount == 0) return;

        uint256 amount = _bound(seed, 1, _min(maxAmount, 500 * ONE_USDC));
        vm.prank(actor);
        market.merge(amount);
    }

    function _buyYes(address actor, uint256 seed) private {
        uint256 amount = _boundedSpend(actor, seed, 1, 300 * ONE_USDC);
        if (amount == 0 || market.yesReserve() == 0 || market.noReserve() == 0) return;

        vm.prank(actor);
        market.buyYes(amount, 0);
    }

    function _buyNo(address actor, uint256 seed) private {
        uint256 amount = _boundedSpend(actor, seed, 1, 300 * ONE_USDC);
        if (amount == 0 || market.yesReserve() == 0 || market.noReserve() == 0) return;

        vm.prank(actor);
        market.buyNo(amount, 0);
    }

    function _sellYes(address actor, uint256 seed) private {
        uint256 yesBal = outcomeToken.balanceOf(actor, market.yesTokenId());
        uint256 cap = _min(yesBal, market.yesReserve() / 5);
        if (cap == 0 || market.noReserve() == 0) return;

        uint256 amount = _bound(seed, 1, cap);
        try market.quoteSellYes(amount) returns (uint256 usdcOut, uint256) {
            if (usdcOut == 0) return;
        } catch {
            return;
        }
        vm.prank(actor);
        market.sellYes(amount, 0);
    }

    function _sellNo(address actor, uint256 seed) private {
        uint256 noBal = outcomeToken.balanceOf(actor, market.noTokenId());
        uint256 cap = _min(noBal, market.noReserve() / 5);
        if (cap == 0 || market.yesReserve() == 0) return;

        uint256 amount = _bound(seed, 1, cap);
        try market.quoteSellNo(amount) returns (uint256 usdcOut, uint256) {
            if (usdcOut == 0) return;
        } catch {
            return;
        }
        vm.prank(actor);
        market.sellNo(amount, 0);
    }

    function _addLiquidity(address actor, uint256 seed) private {
        uint256 amount = _boundedSpend(actor, seed, 1, 500 * ONE_USDC);
        if (amount == 0) return;
        if (market.totalLpShares() != 0) {
            uint256 sharesFromYes = amount * market.totalLpShares() / market.yesReserve();
            uint256 sharesFromNo = amount * market.totalLpShares() / market.noReserve();
            if (_min(sharesFromYes, sharesFromNo) == 0) return;
        }

        vm.prank(actor);
        market.addLiquidity(amount, 0);
    }

    function _removeLiquidity(address actor, uint256 seed) private {
        uint256 shares = market.lpShares(actor);
        if (shares == 0) return;

        uint256 amount = _bound(seed, 1, shares);
        vm.prank(actor);
        market.removeLiquidity(amount, 0, 0);
    }

    function _approveActor(address actor) private {
        _approveUSDCMax(actor, address(market));
        vm.prank(actor);
        outcomeToken.setApprovalForAll(address(market), true);
    }

    function _boundedSpend(address actor, uint256 seed, uint256 minAmount, uint256 maxAmount)
        private
        view
        returns (uint256)
    {
        uint256 balance = usdc.balanceOf(actor);
        if (balance < minAmount) return 0;
        return _bound(seed, minAmount, _min(balance, maxAmount));
    }

    function _assertAccounting() private view {
        require(
            usdc.balanceOf(address(market))
                == market.collateralBalance() + market.creationBond() + market.lpFeePool() + market.creatorFeePool()
                    + market.protocolFeePool(),
            "market USDC accounting invariant"
        );
    }

    function _assertReservesMatchBalances() private view {
        require(
            outcomeToken.balanceOf(address(market), market.yesTokenId()) == market.yesReserve(),
            "YES reserve balance invariant"
        );
        require(
            outcomeToken.balanceOf(address(market), market.noTokenId()) == market.noReserve(),
            "NO reserve balance invariant"
        );
    }

    function _actor(uint256 seed) private pure returns (address) {
        uint256 index = seed % 3;
        if (index == 0) return trader;
        if (index == 1) return lp;
        return stranger;
    }

    function _bound(uint256 seed, uint256 minAmount, uint256 maxAmount) private pure returns (uint256) {
        if (maxAmount <= minAmount) return minAmount;
        return minAmount + seed % (maxAmount - minAmount + 1);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
