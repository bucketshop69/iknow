// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IknowMarketFactory
/// @notice Placeholder contract for the iknow AMM prediction market factory.
contract IknowMarketFactory {
    event MarketFactoryBootstrapped(address indexed deployer);

    constructor() {
        emit MarketFactoryBootstrapped(msg.sender);
    }
}
