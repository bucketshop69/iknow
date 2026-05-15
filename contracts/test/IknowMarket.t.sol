// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IknowMarket} from "../src/IknowMarket.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract IknowMarketTest {
    uint256 private constant UNIT = 1e6;

    MockUSDC private usdc;
    OutcomeToken private outcome;
    IknowMarket private market;

    function testBuySellMaintainsCollateralAccounting() external {
        _deployMarket(50);
        _seed(500 * UNIT, 10 * UNIT);

        MarketActor trader = new MarketActor(usdc, outcome, market);
        usdc.mint(address(trader), 100 * UNIT);
        trader.approveAll();

        uint256 yesBought = trader.buyYes(100 * UNIT);
        _assertGt(yesBought, 100 * UNIT, "buy should receive convex outcome exposure");
        _assertMarketUsdcAccounting("post-buy accounting");

        uint256 usdcOut = trader.sellYes(yesBought / 2);
        _assertGt(usdcOut, 0, "sell pays collateral");
        _assertMarketUsdcAccounting("post-sell accounting");
        _assertEq(
            outcome.balanceOf(address(trader), market.yesTokenId()), yesBought - yesBought / 2, "sold yes balance"
        );
    }

    function testResolutionRedeemsWinningYes() external {
        _deployMarket(0);
        _seed(1_000 * UNIT, 0);

        MarketActor trader = new MarketActor(usdc, outcome, market);
        usdc.mint(address(trader), 100 * UNIT);
        trader.approveAll();

        uint256 yesBought = trader.buyYes(100 * UNIT);
        market.close();
        market.proposeResolution(IknowMarket.Outcome.Yes, "ipfs://evidence");
        market.finalizeResolution();

        uint256 balanceBefore = usdc.balanceOf(address(trader));
        uint256 redeemed = trader.redeem();

        _assertEq(redeemed, yesBought, "winning token pays 1:1");
        _assertEq(usdc.balanceOf(address(trader)), balanceBefore + yesBought, "redeem transfer");
        _assertEq(outcome.balanceOf(address(trader), market.yesTokenId()), 0, "winning token burned");
        _assertEq(uint256(market.state()), uint256(IknowMarket.State.Resolved), "resolved state");
    }

    function testRedeemConvenienceFunctionPaysCaller() external {
        _deployMarket(0);
        _seed(1_000 * UNIT, 0);

        MarketActor trader = new MarketActor(usdc, outcome, market);
        usdc.mint(address(trader), 100 * UNIT);
        trader.approveAll();

        uint256 noBought = trader.buyNo(100 * UNIT);
        market.close();
        market.proposeResolution(IknowMarket.Outcome.No, "ipfs://evidence");
        market.finalizeResolution();

        uint256 balanceBefore = usdc.balanceOf(address(trader));
        uint256 redeemed = trader.redeem();

        _assertEq(redeemed, noBought, "winning NO pays 1:1");
        _assertEq(usdc.balanceOf(address(trader)), balanceBefore + noBought, "redeem transfer");
        _assertEq(outcome.balanceOf(address(trader), market.noTokenId()), 0, "winning token burned");
    }

    function testInvalidResolutionUnwindsMatchedCompleteSets() external {
        _deployMarket(0);
        _seed(1_000 * UNIT, 0);

        MarketActor trader = new MarketActor(usdc, outcome, market);
        usdc.mint(address(trader), 100 * UNIT);
        trader.approveAll();
        trader.split(100 * UNIT);

        market.close();
        market.proposeResolution(IknowMarket.Outcome.Invalid, "ipfs://invalid-evidence");
        market.finalizeResolution();

        uint256 balanceBefore = usdc.balanceOf(address(trader));
        uint256 redeemed = trader.redeem();

        _assertEq(redeemed, 100 * UNIT, "invalid redeems matched set");
        _assertEq(usdc.balanceOf(address(trader)), balanceBefore + 100 * UNIT, "invalid transfer");
        _assertEq(outcome.balanceOf(address(trader), market.yesTokenId()), 0, "YES burned");
        _assertEq(outcome.balanceOf(address(trader), market.noTokenId()), 0, "NO burned");
    }

    function testRemoveLiquidityReturnsPoolInventory() external {
        _deployMarket(0);
        _seed(200 * UNIT, 0);

        MarketActor trader = new MarketActor(usdc, outcome, market);
        usdc.mint(address(trader), 25 * UNIT);
        trader.approveAll();
        trader.buyYes(25 * UNIT);

        uint256 shares = market.lpShares(address(this));
        (uint256 yesOut, uint256 noOut) = market.removeLiquidity(shares / 2, 0, 0);

        _assertGt(yesOut + noOut, 0, "remove returns inventory");
        _assertEq(outcome.balanceOf(address(this), market.yesTokenId()), yesOut, "lp yes received");
        _assertEq(outcome.balanceOf(address(this), market.noTokenId()), noOut, "lp no received");
    }

    function testAddLiquidityMintsLpShares() external {
        _deployMarket(0);
        _seed(500 * UNIT, 0);

        MarketActor provider = new MarketActor(usdc, outcome, market);
        usdc.mint(address(provider), 100 * UNIT);
        provider.approveAll();

        uint256 shares = provider.addLiquidity(100 * UNIT);
        (uint256 yesReserve, uint256 noReserve) = market.reserves();

        _assertEq(shares, 100 * UNIT, "balanced add should mint proportional shares");
        _assertEq(market.lpShares(address(provider)), shares, "provider LP shares");
        _assertEq(yesReserve, 600 * UNIT, "YES reserve after add");
        _assertEq(noReserve, 600 * UNIT, "NO reserve after add");
    }

    function _deployMarket(uint256 feeBps) private {
        usdc = new MockUSDC();
        outcome = new OutcomeToken("ipfs://iknow/{id}.json");
        market = new IknowMarket(
            IERC20(address(usdc)),
            address(outcome),
            address(this),
            address(this),
            address(this),
            keccak256("iknow market test"),
            "ipfs://market",
            block.timestamp + 30 days,
            0,
            feeBps
        );
        outcome.setMinter(address(market), true);
    }

    function _seed(uint256 initialLiquidity, uint256 bond) private {
        usdc.mint(address(this), initialLiquidity + bond);
        usdc.approve(address(market), initialLiquidity + bond);
        market.seed(initialLiquidity, bond);
        _assertEq(market.lpShares(address(this)), initialLiquidity, "initial lp shares");
        _assertMarketUsdcAccounting("seed accounting");
    }

    function _assertMarketUsdcAccounting(string memory message) private view {
        _assertEq(
            usdc.balanceOf(address(market)),
            market.collateralBalance() + market.feePool() + market.creationBond(),
            message
        );
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertGt(uint256 actual, uint256 floor, string memory message) private pure {
        require(actual > floor, message);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return 0xbc197c81;
    }
}

contract MarketActor {
    MockUSDC private immutable _usdc;
    OutcomeToken private immutable _outcome;
    IknowMarket private immutable _market;

    constructor(MockUSDC usdc_, OutcomeToken outcome_, IknowMarket market_) {
        _usdc = usdc_;
        _outcome = outcome_;
        _market = market_;
    }

    function approveAll() external {
        _usdc.approve(address(_market), type(uint256).max);
        _outcome.setApprovalForAll(address(_market), true);
    }

    function buyYes(uint256 usdcIn) external returns (uint256) {
        return _market.buyYes(usdcIn, 0);
    }

    function buyNo(uint256 usdcIn) external returns (uint256) {
        return _market.buyNo(usdcIn, 0);
    }

    function sellYes(uint256 yesIn) external returns (uint256) {
        return _market.sellYes(yesIn, 0);
    }

    function split(uint256 amount) external {
        _market.split(amount);
    }

    function addLiquidity(uint256 amount) external returns (uint256) {
        return _market.addLiquidity(amount, 0);
    }

    function redeemTo(address recipient) external returns (uint256) {
        return _market.redeemTo(recipient);
    }

    function redeem() external returns (uint256) {
        return _market.redeem();
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return 0xbc197c81;
    }
}

contract MockUSDC is IERC20 {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            require(approved >= amount, "USDC_ALLOWANCE");
            allowance[from][msg.sender] = approved - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "USDC_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
