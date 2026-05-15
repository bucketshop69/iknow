// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {OutcomeToken} from "../src/OutcomeToken.sol";

contract OutcomeTokenActor {
    OutcomeToken private immutable _token;

    constructor(OutcomeToken token_) {
        _token = token_;
    }

    function setMinter(address minter, bool authorized) external {
        _token.setMinter(minter, authorized);
    }

    function mintCompleteSet(address to, address market, uint256 amount) external {
        _token.mintCompleteSet(to, market, amount, "");
    }

    function burn(address from, address market, uint8 outcome, uint256 amount) external {
        _token.burn(from, market, outcome, amount);
    }
}

contract OutcomeTokenTest {
    OutcomeToken private _token;
    OutcomeTokenActor private _authorizedMinter;
    OutcomeTokenActor private _unauthorizedActor;

    address private constant _MARKET_A = address(0xA11CE);
    address private constant _MARKET_B = address(0xB0B);
    address private constant _TRADER = address(0xCAFE);

    function setUp() public {
        _token = new OutcomeToken("ipfs://iknow/{id}.json");
        _authorizedMinter = new OutcomeTokenActor(_token);
        _unauthorizedActor = new OutcomeTokenActor(_token);

        _token.setMinter(address(_authorizedMinter), true);
    }

    function testTokenIdsAreDeterministicPerMarketAndOutcome() public {
        uint256 yesA = _token.tokenId(_MARKET_A, _token.OUTCOME_YES());
        uint256 yesAAgain = _token.tokenId(_MARKET_A, _token.OUTCOME_YES());
        uint256 noA = _token.tokenId(_MARKET_A, _token.OUTCOME_NO());
        uint256 yesB = _token.tokenId(_MARKET_B, _token.OUTCOME_YES());
        (uint256 completeSetYes, uint256 completeSetNo) = _token.completeSetTokenIds(_MARKET_A);

        require(yesA == yesAAgain, "token id must be deterministic");
        require(yesA == completeSetYes, "complete-set YES id mismatch");
        require(noA == completeSetNo, "complete-set NO id mismatch");
        require(yesA != noA, "YES and NO ids must differ");
        require(yesA != yesB, "market-scoped ids must differ");
    }

    function testInvalidOutcomeReverts() public {
        bool reverted;
        try _token.tokenId(_MARKET_A, 2) returns (uint256) {}
        catch {
            reverted = true;
        }

        require(reverted, "invalid outcome should revert");
    }

    function testOnlyOwnerCanAuthorizeMinters() public {
        bool reverted;
        try _unauthorizedActor.setMinter(address(_unauthorizedActor), true) {}
        catch {
            reverted = true;
        }

        require(reverted, "non-owner should not authorize minters");
    }

    function testOnlyAuthorizedMinterCanMintCompleteSetAndBurn() public {
        uint256 yesId = _token.tokenId(_MARKET_A, _token.OUTCOME_YES());
        uint256 noId = _token.tokenId(_MARKET_A, _token.OUTCOME_NO());

        bool mintReverted;
        try _unauthorizedActor.mintCompleteSet(_TRADER, _MARKET_A, 1) {}
        catch {
            mintReverted = true;
        }

        require(mintReverted, "unauthorized mint should revert");

        _authorizedMinter.mintCompleteSet(_TRADER, _MARKET_A, 10);
        require(_token.balanceOf(_TRADER, yesId) == 10, "authorized YES mint failed");
        require(_token.balanceOf(_TRADER, noId) == 10, "authorized NO mint failed");

        bool burnReverted;
        try _unauthorizedActor.burn(_TRADER, _MARKET_A, _token.OUTCOME_YES(), 1) {}
        catch {
            burnReverted = true;
        }

        require(burnReverted, "unauthorized burn should revert");

        _authorizedMinter.burn(_TRADER, _MARKET_A, _token.OUTCOME_YES(), 4);
        require(_token.balanceOf(_TRADER, yesId) == 6, "authorized burn failed");
    }

    function testAuthorizedMinterCanMintCompleteSet() public {
        (uint256 yesId, uint256 noId) = _token.completeSetTokenIds(_MARKET_A);

        _authorizedMinter.mintCompleteSet(_TRADER, _MARKET_A, 1_000_000);

        require(_token.balanceOf(_TRADER, yesId) == 1_000_000, "YES amount mismatch");
        require(_token.balanceOf(_TRADER, noId) == 1_000_000, "NO amount mismatch");
    }
}
