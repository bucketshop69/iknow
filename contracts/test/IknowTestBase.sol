// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockUSDC} from "./mocks/MockUSDC.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function assume(bool condition) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function label(address account, string calldata label) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
}

/// @title IknowTestBase
/// @notice Shared Foundry test base for iknow contract tests.
abstract contract IknowTestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint8 internal constant USDC_DECIMALS = 6;
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    uint256 internal constant DEFAULT_CREATOR_BALANCE = 100_000 * ONE_USDC;
    uint256 internal constant DEFAULT_TRADER_BALANCE = 25_000 * ONE_USDC;
    uint256 internal constant DEFAULT_LP_BALANCE = 100_000 * ONE_USDC;

    uint256 internal constant DEFAULT_CREATION_BOND = 100 * ONE_USDC;
    uint256 internal constant DEFAULT_INITIAL_LIQUIDITY = 10_000 * ONE_USDC;
    uint256 internal constant DEFAULT_TRADE_AMOUNT = 100 * ONE_USDC;

    uint16 internal constant DEFAULT_TRADE_FEE_BPS = 30;
    uint16 internal constant MAX_TRADE_FEE_BPS = 500;
    uint16 internal constant MAX_CREATOR_FEE_BPS = 500;
    uint16 internal constant MAX_PROTOCOL_FEE_BPS = 500;
    uint16 internal constant MAX_TOTAL_FEE_BPS = 1_000;

    address internal constant creator = address(0x1001);
    address internal constant trader = address(0x1002);
    address internal constant lp = address(0x1003);
    address internal constant resolver = address(0x1004);
    address internal constant feeRecipient = address(0x1005);
    address internal constant treasury = address(0x1006);
    address internal constant stranger = address(0x1007);

    MockUSDC internal usdc;

    function setUp() public virtual {
        usdc = new MockUSDC();

        vm.label(creator, "creator");
        vm.label(trader, "trader");
        vm.label(lp, "lp");
        vm.label(resolver, "resolver");
        vm.label(feeRecipient, "feeRecipient");
        vm.label(treasury, "treasury");
        vm.label(stranger, "stranger");
        vm.label(address(usdc), "MockUSDC");

        _fundDefaultActors();
    }

    function _fundDefaultActors() internal {
        usdc.mint(creator, DEFAULT_CREATOR_BALANCE);
        usdc.mint(trader, DEFAULT_TRADER_BALANCE);
        usdc.mint(lp, DEFAULT_LP_BALANCE);
    }

    function _mintUSDC(address account, uint256 amount) internal {
        usdc.mint(account, amount);
    }

    function _approveUSDC(address owner, address spender, uint256 amount) internal {
        vm.prank(owner);
        usdc.approve(spender, amount);
    }

    function _approveUSDCMax(address owner, address spender) internal {
        _approveUSDC(owner, spender, type(uint256).max);
    }

    function _assumeValidTradeFee(uint16 feeBps) internal {
        vm.assume(feeBps <= MAX_TRADE_FEE_BPS);
    }

    function _assumeValidTotalFee(uint16 creatorFeeBps, uint16 protocolFeeBps) internal {
        vm.assume(creatorFeeBps <= MAX_CREATOR_FEE_BPS);
        vm.assume(protocolFeeBps <= MAX_PROTOCOL_FEE_BPS);
        vm.assume(uint256(creatorFeeBps) + uint256(protocolFeeBps) <= MAX_TOTAL_FEE_BPS);
    }
}
