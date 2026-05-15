// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";

library SafeTransfer {
    error TransferFailed();
    error TransferFromFailed();

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        bool ok = token.transfer(to, amount);
        if (!ok) revert TransferFailed();
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        bool ok = token.transferFrom(from, to, amount);
        if (!ok) revert TransferFromFailed();
    }
}
