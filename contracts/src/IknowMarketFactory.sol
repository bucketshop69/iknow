// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./libraries/SafeTransfer.sol";
import {OutcomeToken} from "./OutcomeToken.sol";
import {IknowMarket} from "./IknowMarket.sol";

/// @title IknowMarketFactory
/// @notice Creates iknow binary AMM prediction markets.
contract IknowMarketFactory {
    using SafeTransfer for IERC20;

    event MarketCreated(
        address indexed market,
        address indexed creator,
        bytes32 indexed specHash,
        string metadataURI,
        uint256 closeTime,
        uint256 creationBond,
        uint256 initialLiquidity
    );

    error InvalidAmount();
    error InvalidCloseTime();
    error InvalidAddress();

    uint256 public constant DEFAULT_TOTAL_FEE_BPS = 30;

    IERC20 public immutable usdc;
    OutcomeToken public immutable outcomeToken;
    address public resolver;
    address public protocolFeeRecipient;
    uint256 public defaultChallengeWindow = 1 hours;
    uint256 public defaultFeeBps = DEFAULT_TOTAL_FEE_BPS;

    address[] public allMarkets;
    mapping(address => bool) public isMarket;

    constructor(IERC20 usdc_, OutcomeToken outcomeToken_, address resolver_, address protocolFeeRecipient_) {
        if (
            address(usdc_) == address(0) || address(outcomeToken_) == address(0) || resolver_ == address(0)
                || protocolFeeRecipient_ == address(0)
        ) {
            revert InvalidAddress();
        }
        usdc = usdc_;
        outcomeToken = outcomeToken_;
        resolver = resolver_;
        protocolFeeRecipient = protocolFeeRecipient_;
    }

    function marketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    function createMarket(
        bytes32 specHash,
        string calldata metadataURI,
        uint256 closeTime,
        uint256 creationBond,
        uint256 initialLiquidity
    ) external returns (address marketAddr) {
        if (closeTime <= block.timestamp) revert InvalidCloseTime();
        if (initialLiquidity == 0) revert InvalidAmount();

        IknowMarket market = new IknowMarket(
            usdc,
            address(outcomeToken),
            address(this),
            msg.sender,
            resolver,
            protocolFeeRecipient,
            specHash,
            metadataURI,
            closeTime,
            defaultChallengeWindow,
            defaultFeeBps
        );
        marketAddr = address(market);
        isMarket[marketAddr] = true;
        allMarkets.push(marketAddr);

        outcomeToken.setMinter(marketAddr, true);
        usdc.safeTransferFrom(msg.sender, marketAddr, creationBond + initialLiquidity);
        market.seed(initialLiquidity, creationBond);

        emit MarketCreated(marketAddr, msg.sender, specHash, metadataURI, closeTime, creationBond, initialLiquidity);
    }
}
