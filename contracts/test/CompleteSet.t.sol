// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1155Receiver, OutcomeToken} from "../src/OutcomeToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CompleteSetMarketHarness {
    MockUSDC public immutable collateral;
    OutcomeToken public immutable outcomeToken;

    constructor(MockUSDC collateral_, OutcomeToken outcomeToken_) {
        collateral = collateral_;
        outcomeToken = outcomeToken_;
    }

    function split(uint256 amount) external {
        require(collateral.transferFrom(msg.sender, address(this), amount), "USDC transfer in failed");
        outcomeToken.mintCompleteSet(msg.sender, address(this), amount, "");
    }

    function merge(uint256 amount) external {
        outcomeToken.burnCompleteSet(msg.sender, address(this), amount);
        require(collateral.transfer(msg.sender, amount), "USDC transfer out failed");
    }

    function yesTokenId() external view returns (uint256) {
        return outcomeToken.tokenId(address(this), outcomeToken.OUTCOME_YES());
    }

    function noTokenId() external view returns (uint256) {
        return outcomeToken.tokenId(address(this), outcomeToken.OUTCOME_NO());
    }
}

contract CompleteSetUser is IERC1155Receiver {
    function approveUSDC(MockUSDC collateral, address spender, uint256 amount) external {
        collateral.approve(spender, amount);
    }

    function split(CompleteSetMarketHarness market, uint256 amount) external {
        market.split(amount);
    }

    function merge(CompleteSetMarketHarness market, uint256 amount) external {
        market.merge(amount);
    }

    function transferOutcome(OutcomeToken token, address to, uint256 id, uint256 amount) external {
        token.safeTransferFrom(address(this), to, id, amount, "");
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }
}

contract CompleteSetTest {
    uint256 private constant _ONE_USDC = 1_000_000;

    MockUSDC private _usdc;
    OutcomeToken private _outcomeToken;
    CompleteSetMarketHarness private _market;
    CompleteSetUser private _alice;
    CompleteSetUser private _bob;

    function setUp() public {
        _usdc = new MockUSDC();
        _outcomeToken = new OutcomeToken("ipfs://iknow/{id}.json");
        _market = new CompleteSetMarketHarness(_usdc, _outcomeToken);
        _alice = new CompleteSetUser();
        _bob = new CompleteSetUser();

        _outcomeToken.setMinter(address(_market), true);
        _usdc.mint(address(_alice), 10 * _ONE_USDC);
        _usdc.mint(address(_bob), 10 * _ONE_USDC);
    }

    function testSplitOneUsdcMintsMatchedYesNo() public {
        uint256 yesId = _market.yesTokenId();
        uint256 noId = _market.noTokenId();

        _alice.approveUSDC(_usdc, address(_market), _ONE_USDC);
        _alice.split(_market, _ONE_USDC);

        require(_usdc.balanceOf(address(_market)) == _ONE_USDC, "market collateral mismatch");
        require(_usdc.balanceOf(address(_alice)) == 9 * _ONE_USDC, "alice USDC mismatch");
        require(_outcomeToken.balanceOf(address(_alice), yesId) == _ONE_USDC, "YES balance mismatch");
        require(_outcomeToken.balanceOf(address(_alice), noId) == _ONE_USDC, "NO balance mismatch");
    }

    function testMergeOneCompleteSetWithdrawsOneUsdc() public {
        uint256 yesId = _market.yesTokenId();
        uint256 noId = _market.noTokenId();

        _alice.approveUSDC(_usdc, address(_market), _ONE_USDC);
        _alice.split(_market, _ONE_USDC);
        _alice.merge(_market, _ONE_USDC);

        require(_usdc.balanceOf(address(_market)) == 0, "market collateral should unwind");
        require(_usdc.balanceOf(address(_alice)) == 10 * _ONE_USDC, "alice USDC should be restored");
        require(_outcomeToken.balanceOf(address(_alice), yesId) == 0, "YES should burn");
        require(_outcomeToken.balanceOf(address(_alice), noId) == 0, "NO should burn");
    }

    function testSplitRequiresUsdcAllowance() public {
        bool reverted;
        try _alice.split(_market, _ONE_USDC) {}
        catch {
            reverted = true;
        }

        require(reverted, "split without allowance should revert");
        require(_usdc.balanceOf(address(_market)) == 0, "collateral should not move");
    }

    function testMergeRequiresMatchedCompleteSet() public {
        uint256 noId = _market.noTokenId();

        _alice.approveUSDC(_usdc, address(_market), _ONE_USDC);
        _alice.split(_market, _ONE_USDC);
        _alice.transferOutcome(_outcomeToken, address(_bob), noId, 1);

        bool reverted;
        try _alice.merge(_market, _ONE_USDC) {}
        catch {
            reverted = true;
        }

        require(reverted, "merge without full set should revert");
        require(_usdc.balanceOf(address(_market)) == _ONE_USDC, "collateral should remain locked");
        require(_usdc.balanceOf(address(_alice)) == 9 * _ONE_USDC, "alice USDC should remain spent");
    }

    function testCollateralTracksOutstandingCompleteSetsAcrossPartialMerge() public {
        uint256 yesId = _market.yesTokenId();
        uint256 noId = _market.noTokenId();
        uint256 splitAmount = 2 * _ONE_USDC;
        uint256 mergeAmount = _ONE_USDC / 2;
        uint256 outstanding = splitAmount - mergeAmount;

        _alice.approveUSDC(_usdc, address(_market), splitAmount);
        _alice.split(_market, splitAmount);
        _alice.merge(_market, mergeAmount);

        require(_usdc.balanceOf(address(_market)) == outstanding, "escrowed collateral mismatch");
        require(_outcomeToken.balanceOf(address(_alice), yesId) == outstanding, "outstanding YES mismatch");
        require(_outcomeToken.balanceOf(address(_alice), noId) == outstanding, "outstanding NO mismatch");
        require(_usdc.balanceOf(address(_alice)) == 10 * _ONE_USDC - outstanding, "alice net USDC mismatch");
    }
}
