// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./libraries/SafeTransfer.sol";

interface IOutcomeToken {
    function OUTCOME_YES() external pure returns (uint8);
    function OUTCOME_NO() external pure returns (uint8);
    function tokenId(address market, uint8 outcome) external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function mintCompleteSet(address to, address market, uint256 amount, bytes calldata data) external;
    function burn(address from, address market, uint8 outcome, uint256 amount) external;
    function burnCompleteSet(address from, address market, uint256 amount) external;
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;
}

/// @title IknowMarket
/// @notice Per-market binary AMM backed by USDC complete sets and market-scoped ERC-1155 outcomes.
/// @dev Amounts are denominated in collateral base units. For USDC, outcome token amounts should use
/// the same 6-decimal unit so that 1 USDC base unit backs 1 YES plus 1 NO base unit.
contract IknowMarket {
    using SafeTransfer for IERC20;

    enum State {
        Open,
        Closed,
        Proposed,
        Resolved
    }

    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE_BPS = 1_000;
    uint256 public constant TOTAL_FEE_BPS = 30;
    uint256 public constant LP_FEE_BPS = 20;
    uint256 public constant CREATOR_FEE_BPS = 5;
    uint256 public constant PROTOCOL_FEE_BPS = 5;
    uint256 public constant LP_FEE_ACC_PRECISION = 1e18;
    bytes4 private constant ERC1155_ACCEPTED = 0xf23a6e61;
    bytes4 private constant ERC1155_BATCH_ACCEPTED = 0xbc197c81;
    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ERC1155_RECEIVER_INTERFACE_ID = 0x4e2312e0;

    IERC20 public immutable usdc;
    IOutcomeToken public immutable outcomeToken;
    address public immutable factory;
    address public immutable creator;
    address public immutable resolver;
    address public immutable protocolFeeRecipient;
    bytes32 public immutable specHash;
    string public metadataURI;
    uint256 public immutable closeTime;
    uint256 public immutable challengeWindow;
    uint256 public immutable feeBps;
    uint8 public immutable outcomeYes;
    uint8 public immutable outcomeNo;
    uint256 public immutable yesTokenId;
    uint256 public immutable noTokenId;

    State public state;
    Outcome public proposedOutcome;
    Outcome public finalOutcome;
    uint256 public finalizeAfter;
    string public evidenceURI;

    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public collateralBalance;
    uint256 public lpFeePool;
    uint256 public creatorFeePool;
    uint256 public protocolFeePool;
    uint256 public accLpFeePerShare;
    uint256 public creationBond;
    uint256 public totalLpShares;

    mapping(address => uint256) public lpShares;
    mapping(address => uint256) public lpFeeDebt;
    mapping(address => uint256) public pendingLpFees;

    bool private locked;

    event CompleteSetsSplit(address indexed account, uint256 amount);
    event CompleteSetsMerged(address indexed account, uint256 amount);
    event Trade(
        address indexed trader,
        address indexed recipient,
        Outcome indexed outcome,
        bool isBuy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    event LiquidityAdded(address indexed lp, uint256 usdcAmount, uint256 yesUsed, uint256 noUsed, uint256 shares);
    event LiquidityRemoved(
        address indexed lp, address indexed recipient, uint256 shares, uint256 yesOut, uint256 noOut
    );
    event MarketClosed(uint256 timestamp);
    event ResolutionProposed(Outcome indexed outcome, string evidenceURI, uint256 finalizeAfter);
    event MarketResolved(Outcome indexed outcome);
    event Redeemed(
        address indexed account,
        address indexed recipient,
        Outcome indexed outcome,
        uint256 outcomeAmount,
        uint256 usdcAmount
    );
    event FeesAccrued(uint256 lpFee, uint256 creatorFee, uint256 protocolFee);
    event LpFeesClaimed(address indexed lp, address indexed recipient, uint256 amount);
    event CreatorFeesClaimed(address indexed recipient, uint256 amount);
    event ProtocolFeesClaimed(address indexed recipient, uint256 amount);
    event CreatorFeesForfeited(uint256 amount);
    event CreationBondClaimed(address indexed recipient, uint256 amount);
    event CreationBondSlashed(uint256 amount);

    error NotFactory();
    error NotResolver();
    error NotCreator();
    error NotProtocolFeeRecipient();
    error InvalidState();
    error InvalidAmount();
    error InvalidOutcome();
    error Slippage();
    error TooEarly();
    error InsufficientShares();
    error InsufficientLiquidity();
    error ZeroAddress();

    modifier nonReentrant() {
        require(!locked, "REENTRANCY");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    modifier onlyOpen() {
        if (state != State.Open || block.timestamp >= closeTime) revert InvalidState();
        _;
    }

    constructor(
        IERC20 usdc_,
        address outcomeToken_,
        address factory_,
        address creator_,
        address resolver_,
        address protocolFeeRecipient_,
        bytes32 specHash_,
        string memory metadataURI_,
        uint256 closeTime_,
        uint256 challengeWindow_,
        uint256 feeBps_
    ) {
        if (address(usdc_) == address(0) || outcomeToken_ == address(0) || factory_ == address(0)) {
            revert ZeroAddress();
        }
        if (creator_ == address(0) || resolver_ == address(0) || protocolFeeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (LP_FEE_BPS + CREATOR_FEE_BPS + PROTOCOL_FEE_BPS != TOTAL_FEE_BPS) revert InvalidAmount();
        if (feeBps_ != TOTAL_FEE_BPS || feeBps_ > MAX_FEE_BPS) revert InvalidAmount();

        usdc = usdc_;
        outcomeToken = IOutcomeToken(outcomeToken_);
        factory = factory_;
        creator = creator_;
        resolver = resolver_;
        protocolFeeRecipient = protocolFeeRecipient_;
        specHash = specHash_;
        metadataURI = metadataURI_;
        closeTime = closeTime_;
        challengeWindow = challengeWindow_;
        feeBps = feeBps_;
        outcomeYes = IOutcomeToken(outcomeToken_).OUTCOME_YES();
        outcomeNo = IOutcomeToken(outcomeToken_).OUTCOME_NO();
        yesTokenId = IOutcomeToken(outcomeToken_).tokenId(address(this), outcomeYes);
        noTokenId = IOutcomeToken(outcomeToken_).tokenId(address(this), outcomeNo);
        if (yesTokenId == noTokenId) revert InvalidOutcome();
        state = State.Open;
    }

    /// @notice Factory hook for creator-funded initial liquidity and optional separate creation bond.
    function seed(uint256 initialLiquidity, uint256 bondAmount) external nonReentrant onlyFactory {
        if (initialLiquidity == 0) revert InvalidAmount();
        if (totalLpShares != 0) revert InvalidState();
        uint256 requiredBalance = initialLiquidity + bondAmount;
        uint256 currentBalance = usdc.balanceOf(address(this));
        if (currentBalance < requiredBalance) {
            usdc.safeTransferFrom(creator, address(this), requiredBalance - currentBalance);
        }

        creationBond = bondAmount;
        collateralBalance = initialLiquidity;
        outcomeToken.mintCompleteSet(address(this), address(this), initialLiquidity, "");

        yesReserve = initialLiquidity;
        noReserve = initialLiquidity;
        totalLpShares = initialLiquidity;
        lpShares[creator] = initialLiquidity;
        lpFeeDebt[creator] = initialLiquidity * accLpFeePerShare / LP_FEE_ACC_PRECISION;

        emit LiquidityAdded(creator, initialLiquidity, initialLiquidity, initialLiquidity, initialLiquidity);
    }

    function split(uint256 amount) external nonReentrant onlyOpen {
        if (amount == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance += amount;
        outcomeToken.mintCompleteSet(msg.sender, address(this), amount, "");
        emit CompleteSetsSplit(msg.sender, amount);
    }

    function merge(uint256 amount) external nonReentrant onlyOpen {
        if (amount == 0) revert InvalidAmount();
        if (amount > collateralBalance) revert InsufficientLiquidity();
        outcomeToken.burnCompleteSet(msg.sender, address(this), amount);
        collateralBalance -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CompleteSetsMerged(msg.sender, amount);
    }

    function reserves() external view returns (uint256 yes, uint256 no) {
        return (yesReserve, noReserve);
    }

    function quoteBuyYes(uint256 usdcIn) public view returns (uint256 yesOut, uint256 fee) {
        (yesOut, fee) = _quoteBuy(usdcIn, yesReserve, noReserve);
    }

    function quoteBuyNo(uint256 usdcIn) public view returns (uint256 noOut, uint256 fee) {
        (noOut, fee) = _quoteBuy(usdcIn, noReserve, yesReserve);
    }

    function buyYes(uint256 usdcIn, uint256 minYesOut) external returns (uint256 yesOut) {
        yesOut = buy(Outcome.Yes, usdcIn, minYesOut, msg.sender);
    }

    function buyNo(uint256 usdcIn, uint256 minNoOut) external returns (uint256 noOut) {
        noOut = buy(Outcome.No, usdcIn, minNoOut, msg.sender);
    }

    function buy(Outcome outcome, uint256 usdcIn, uint256 minOutcomeOut, address recipient)
        public
        nonReentrant
        onlyOpen
        returns (uint256 outcomeOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (!_isTradableOutcome(outcome)) revert InvalidOutcome();
        if (yesReserve == 0 || noReserve == 0) revert InsufficientLiquidity();

        uint256 fee;
        (outcomeOut, fee) = outcome == Outcome.Yes ? quoteBuyYes(usdcIn) : quoteBuyNo(usdcIn);
        if (outcomeOut < minOutcomeOut) revert Slippage();

        uint256 net = usdcIn - fee;
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        _accrueFees(fee);
        collateralBalance += net;
        outcomeToken.mintCompleteSet(address(this), address(this), net, "");

        if (outcome == Outcome.Yes) {
            yesReserve = yesReserve + net - outcomeOut;
            noReserve = noReserve + net;
            outcomeToken.safeTransferFrom(address(this), recipient, yesTokenId, outcomeOut, "");
        } else {
            noReserve = noReserve + net - outcomeOut;
            yesReserve = yesReserve + net;
            outcomeToken.safeTransferFrom(address(this), recipient, noTokenId, outcomeOut, "");
        }

        emit Trade(msg.sender, recipient, outcome, true, usdcIn, outcomeOut, fee);
    }

    function quoteSellYes(uint256 yesIn) public view returns (uint256 usdcOut, uint256 fee) {
        (usdcOut, fee) = _quoteSellExactIn(yesIn, yesReserve, noReserve);
    }

    function quoteSellNo(uint256 noIn) public view returns (uint256 usdcOut, uint256 fee) {
        (usdcOut, fee) = _quoteSellExactIn(noIn, noReserve, yesReserve);
    }

    function sellYes(uint256 yesIn, uint256 minUsdcOut) external returns (uint256 usdcOut) {
        usdcOut = sell(Outcome.Yes, yesIn, minUsdcOut, msg.sender);
    }

    function sellNo(uint256 noIn, uint256 minUsdcOut) external returns (uint256 usdcOut) {
        usdcOut = sell(Outcome.No, noIn, minUsdcOut, msg.sender);
    }

    function sell(Outcome outcome, uint256 outcomeIn, uint256 minUsdcOut, address recipient)
        public
        nonReentrant
        onlyOpen
        returns (uint256 usdcOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (!_isTradableOutcome(outcome)) revert InvalidOutcome();
        if (outcomeIn == 0) revert InvalidAmount();

        uint256 fee;
        uint256 grossUsdc;
        if (outcome == Outcome.Yes) {
            (usdcOut, fee) = quoteSellYes(outcomeIn);
            grossUsdc = usdcOut + fee;
            if (grossUsdc > noReserve) revert InsufficientLiquidity();
            outcomeToken.safeTransferFrom(msg.sender, address(this), yesTokenId, outcomeIn, "");
            outcomeToken.burnCompleteSet(address(this), address(this), grossUsdc);
            yesReserve = yesReserve + outcomeIn - grossUsdc;
            noReserve -= grossUsdc;
        } else {
            (usdcOut, fee) = quoteSellNo(outcomeIn);
            grossUsdc = usdcOut + fee;
            if (grossUsdc > yesReserve) revert InsufficientLiquidity();
            outcomeToken.safeTransferFrom(msg.sender, address(this), noTokenId, outcomeIn, "");
            outcomeToken.burnCompleteSet(address(this), address(this), grossUsdc);
            noReserve = noReserve + outcomeIn - grossUsdc;
            yesReserve -= grossUsdc;
        }

        if (usdcOut < minUsdcOut) revert Slippage();
        if (grossUsdc > collateralBalance) revert InsufficientLiquidity();
        collateralBalance -= grossUsdc;
        _accrueFees(fee);
        usdc.safeTransfer(recipient, usdcOut);

        emit Trade(msg.sender, recipient, outcome, false, outcomeIn, usdcOut, fee);
    }

    function quoteSellYesForUsdc(uint256 usdcOut) public view returns (uint256 yesIn, uint256 fee) {
        (yesIn, fee) = _quoteSellForUsdc(usdcOut, yesReserve, noReserve);
    }

    function quoteSellNoForUsdc(uint256 usdcOut) public view returns (uint256 noIn, uint256 fee) {
        (noIn, fee) = _quoteSellForUsdc(usdcOut, noReserve, yesReserve);
    }

    function sellYesForUsdc(uint256 usdcOut, uint256 maxYesIn) external returns (uint256 yesIn) {
        yesIn = _sellForExactUsdc(Outcome.Yes, usdcOut, maxYesIn, msg.sender);
    }

    function sellNoForUsdc(uint256 usdcOut, uint256 maxNoIn) external returns (uint256 noIn) {
        noIn = _sellForExactUsdc(Outcome.No, usdcOut, maxNoIn, msg.sender);
    }

    function addLiquidity(uint256 usdcAmount, uint256 minShares)
        external
        nonReentrant
        onlyOpen
        returns (uint256 shares)
    {
        if (usdcAmount == 0) revert InvalidAmount();

        uint256 yesUsed;
        uint256 noUsed;
        if (totalLpShares == 0) {
            shares = usdcAmount;
            yesUsed = usdcAmount;
            noUsed = usdcAmount;
        } else {
            uint256 sharesFromYes = usdcAmount * totalLpShares / yesReserve;
            uint256 sharesFromNo = usdcAmount * totalLpShares / noReserve;
            shares = _min(sharesFromYes, sharesFromNo);
            if (shares == 0) revert InsufficientLiquidity();
            yesUsed = shares * yesReserve / totalLpShares;
            noUsed = shares * noReserve / totalLpShares;
        }
        if (shares < minShares) revert Slippage();

        _checkpointLpFees(msg.sender);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        collateralBalance += usdcAmount;
        outcomeToken.mintCompleteSet(address(this), address(this), usdcAmount, "");

        yesReserve += yesUsed;
        noReserve += noUsed;
        totalLpShares += shares;
        lpShares[msg.sender] += shares;
        _setLpFeeDebt(msg.sender);

        uint256 yesLeft = usdcAmount - yesUsed;
        uint256 noLeft = usdcAmount - noUsed;
        if (yesLeft != 0) outcomeToken.safeTransferFrom(address(this), msg.sender, yesTokenId, yesLeft, "");
        if (noLeft != 0) outcomeToken.safeTransferFrom(address(this), msg.sender, noTokenId, noLeft, "");

        emit LiquidityAdded(msg.sender, usdcAmount, yesUsed, noUsed, shares);
    }

    function removeLiquidity(uint256 shares, uint256 minYesOut, uint256 minNoOut)
        external
        returns (uint256 yesOut, uint256 noOut)
    {
        (yesOut, noOut) = removeLiquidityTo(shares, minYesOut, minNoOut, msg.sender);
    }

    function removeLiquidityTo(uint256 shares, uint256 minYesOut, uint256 minNoOut, address recipient)
        public
        nonReentrant
        returns (uint256 yesOut, uint256 noOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (shares == 0) revert InvalidAmount();
        if (lpShares[msg.sender] < shares) revert InsufficientShares();
        if (totalLpShares == 0) revert InsufficientLiquidity();

        yesOut = shares * yesReserve / totalLpShares;
        noOut = shares * noReserve / totalLpShares;
        if (yesOut < minYesOut || noOut < minNoOut) revert Slippage();

        _checkpointLpFees(msg.sender);
        uint256 lpFeeOut = pendingLpFees[msg.sender];
        pendingLpFees[msg.sender] = 0;

        lpShares[msg.sender] -= shares;
        totalLpShares -= shares;
        lpFeePool -= lpFeeOut;
        _setLpFeeDebt(msg.sender);
        yesReserve -= yesOut;
        noReserve -= noOut;

        if (yesOut != 0) outcomeToken.safeTransferFrom(address(this), recipient, yesTokenId, yesOut, "");
        if (noOut != 0) outcomeToken.safeTransferFrom(address(this), recipient, noTokenId, noOut, "");
        if (lpFeeOut != 0) {
            usdc.safeTransfer(recipient, lpFeeOut);
            emit LpFeesClaimed(msg.sender, recipient, lpFeeOut);
        }

        emit LiquidityRemoved(msg.sender, recipient, shares, yesOut, noOut);
    }

    function close() external {
        if (state != State.Open) revert InvalidState();
        if (block.timestamp < closeTime) revert TooEarly();
        state = State.Closed;
        emit MarketClosed(block.timestamp);
    }

    function proposeResolution(Outcome outcome, string calldata evidenceURI_) external onlyResolver {
        if (state == State.Open) {
            if (block.timestamp < closeTime) revert TooEarly();
            state = State.Closed;
            emit MarketClosed(block.timestamp);
        }
        if (state != State.Closed) revert InvalidState();
        if (!_isResolutionOutcome(outcome)) revert InvalidOutcome();

        proposedOutcome = outcome;
        evidenceURI = evidenceURI_;
        finalizeAfter = block.timestamp + challengeWindow;
        state = State.Proposed;

        emit ResolutionProposed(outcome, evidenceURI_, finalizeAfter);
    }

    function finalizeResolution() external {
        if (state != State.Proposed) revert InvalidState();
        if (block.timestamp < finalizeAfter) revert TooEarly();

        finalOutcome = proposedOutcome;
        state = State.Resolved;
        if (finalOutcome == Outcome.Invalid && creatorFeePool != 0) {
            uint256 forfeited = creatorFeePool;
            creatorFeePool = 0;
            _accrueLpFees(forfeited);
            emit CreatorFeesForfeited(forfeited);
        }
        if (finalOutcome == Outcome.Invalid && creationBond != 0) {
            uint256 slashed = creationBond;
            creationBond = 0;
            protocolFeePool += slashed;
            emit CreationBondSlashed(slashed);
        }

        emit MarketResolved(finalOutcome);
    }

    function redeem() external returns (uint256 usdcOut) {
        usdcOut = redeemTo(msg.sender);
    }

    function redeemTo(address recipient) public nonReentrant returns (uint256 usdcOut) {
        if (recipient == address(0)) revert ZeroAddress();
        if (state != State.Resolved) revert InvalidState();

        uint256 burnAmount;
        if (finalOutcome == Outcome.Yes) {
            burnAmount = outcomeToken.balanceOf(msg.sender, yesTokenId);
            if (burnAmount == 0) revert InvalidAmount();
            outcomeToken.burn(msg.sender, address(this), outcomeYes, burnAmount);
            usdcOut = burnAmount;
        } else if (finalOutcome == Outcome.No) {
            burnAmount = outcomeToken.balanceOf(msg.sender, noTokenId);
            if (burnAmount == 0) revert InvalidAmount();
            outcomeToken.burn(msg.sender, address(this), outcomeNo, burnAmount);
            usdcOut = burnAmount;
        } else if (finalOutcome == Outcome.Invalid) {
            uint256 yesBal = outcomeToken.balanceOf(msg.sender, yesTokenId);
            uint256 noBal = outcomeToken.balanceOf(msg.sender, noTokenId);
            burnAmount = _min(yesBal, noBal);
            if (burnAmount == 0) revert InvalidAmount();
            outcomeToken.burnCompleteSet(msg.sender, address(this), burnAmount);
            usdcOut = burnAmount;
        } else {
            revert InvalidOutcome();
        }

        if (usdcOut > collateralBalance) revert InsufficientLiquidity();
        collateralBalance -= usdcOut;
        usdc.safeTransfer(recipient, usdcOut);
        emit Redeemed(msg.sender, recipient, finalOutcome, burnAmount, usdcOut);
    }

    function claimCreatorFees(address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (recipient == address(0)) revert ZeroAddress();
        if (state != State.Resolved) revert InvalidState();
        if (finalOutcome == Outcome.Invalid) revert InvalidOutcome();
        if (amount == 0) revert InvalidAmount();
        if (amount > creatorFeePool) revert InsufficientLiquidity();

        creatorFeePool -= amount;
        usdc.safeTransfer(recipient, amount);

        emit CreatorFeesClaimed(recipient, amount);
    }

    function claimProtocolFees(address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != protocolFeeRecipient) revert NotProtocolFeeRecipient();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > protocolFeePool) revert InsufficientLiquidity();

        protocolFeePool -= amount;
        usdc.safeTransfer(recipient, amount);

        emit ProtocolFeesClaimed(recipient, amount);
    }

    function claimCreationBond(address recipient) external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (recipient == address(0)) revert ZeroAddress();
        if (state != State.Resolved) revert InvalidState();
        if (finalOutcome == Outcome.Invalid) revert InvalidOutcome();
        uint256 amount = creationBond;
        if (amount == 0) revert InvalidAmount();

        creationBond = 0;
        usdc.safeTransfer(recipient, amount);

        emit CreationBondClaimed(recipient, amount);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return ERC1155_ACCEPTED;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return ERC1155_BATCH_ACCEPTED;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC1155_RECEIVER_INTERFACE_ID;
    }

    function _sellForExactUsdc(Outcome outcome, uint256 usdcOut, uint256 maxOutcomeIn, address recipient)
        internal
        nonReentrant
        onlyOpen
        returns (uint256 outcomeIn)
    {
        if (!_isTradableOutcome(outcome)) revert InvalidOutcome();
        if (recipient == address(0)) revert ZeroAddress();
        if (usdcOut == 0) revert InvalidAmount();

        uint256 fee;
        uint256 grossUsdc;
        if (outcome == Outcome.Yes) {
            (outcomeIn, fee) = quoteSellYesForUsdc(usdcOut);
            if (outcomeIn > maxOutcomeIn) revert Slippage();
            grossUsdc = usdcOut + fee;
            outcomeToken.safeTransferFrom(msg.sender, address(this), yesTokenId, outcomeIn, "");
            outcomeToken.burnCompleteSet(address(this), address(this), grossUsdc);
            yesReserve = yesReserve + outcomeIn - grossUsdc;
            noReserve -= grossUsdc;
        } else {
            (outcomeIn, fee) = quoteSellNoForUsdc(usdcOut);
            if (outcomeIn > maxOutcomeIn) revert Slippage();
            grossUsdc = usdcOut + fee;
            outcomeToken.safeTransferFrom(msg.sender, address(this), noTokenId, outcomeIn, "");
            outcomeToken.burnCompleteSet(address(this), address(this), grossUsdc);
            noReserve = noReserve + outcomeIn - grossUsdc;
            yesReserve -= grossUsdc;
        }

        if (grossUsdc > collateralBalance) revert InsufficientLiquidity();
        collateralBalance -= grossUsdc;
        _accrueFees(fee);
        usdc.safeTransfer(recipient, usdcOut);

        emit Trade(msg.sender, recipient, outcome, false, outcomeIn, usdcOut, fee);
    }

    function _accrueFees(uint256 fee) private {
        if (fee == 0) return;
        uint256 creatorFee = fee * CREATOR_FEE_BPS / TOTAL_FEE_BPS;
        uint256 protocolFee = fee * PROTOCOL_FEE_BPS / TOTAL_FEE_BPS;
        uint256 lpFee = fee - creatorFee - protocolFee;

        _accrueLpFees(lpFee);
        creatorFeePool += creatorFee;
        protocolFeePool += protocolFee;

        emit FeesAccrued(lpFee, creatorFee, protocolFee);
    }

    function _accrueLpFees(uint256 amount) private {
        if (amount == 0) return;
        if (totalLpShares == 0) {
            protocolFeePool += amount;
            return;
        }
        lpFeePool += amount;
        accLpFeePerShare += amount * LP_FEE_ACC_PRECISION / totalLpShares;
    }

    function _checkpointLpFees(address account) private {
        uint256 shares = lpShares[account];
        uint256 accumulated = shares * accLpFeePerShare / LP_FEE_ACC_PRECISION;
        uint256 debt = lpFeeDebt[account];
        if (accumulated > debt) {
            pendingLpFees[account] += accumulated - debt;
        }
        lpFeeDebt[account] = accumulated;
    }

    function _setLpFeeDebt(address account) private {
        lpFeeDebt[account] = lpShares[account] * accLpFeePerShare / LP_FEE_ACC_PRECISION;
    }

    function _quoteBuy(uint256 usdcIn, uint256 buyReserve, uint256 otherReserve)
        internal
        view
        returns (uint256 outcomeOut, uint256 fee)
    {
        if (usdcIn == 0) revert InvalidAmount();
        if (buyReserve == 0 || otherReserve == 0) revert InsufficientLiquidity();

        fee = usdcIn * feeBps / BPS_DENOMINATOR;
        uint256 net = usdcIn - fee;
        if (net == 0) revert InvalidAmount();

        uint256 k = buyReserve * otherReserve;
        uint256 finalBuy = _ceilDiv(k, otherReserve + net);
        uint256 buyBalanceAfterSplit = buyReserve + net;
        if (buyBalanceAfterSplit <= finalBuy) revert InsufficientLiquidity();
        outcomeOut = buyBalanceAfterSplit - finalBuy;
    }

    function _quoteSellExactIn(uint256 outcomeIn, uint256 sellReserve, uint256 otherReserve)
        internal
        view
        returns (uint256 usdcOut, uint256 fee)
    {
        if (outcomeIn == 0) revert InvalidAmount();
        if (sellReserve == 0 || otherReserve == 0) revert InsufficientLiquidity();

        uint256 grossUsdc = _sellCollateralOut(sellReserve, otherReserve, outcomeIn);
        if (grossUsdc == 0 || grossUsdc >= otherReserve) revert InsufficientLiquidity();

        fee = grossUsdc * feeBps / BPS_DENOMINATOR;
        usdcOut = grossUsdc - fee;
    }

    function _quoteSellForUsdc(uint256 usdcOut, uint256 sellReserve, uint256 otherReserve)
        internal
        view
        returns (uint256 outcomeIn, uint256 fee)
    {
        if (usdcOut == 0) revert InvalidAmount();
        if (sellReserve == 0 || otherReserve == 0) revert InsufficientLiquidity();

        uint256 grossUsdc = _ceilDiv(usdcOut * BPS_DENOMINATOR, BPS_DENOMINATOR - feeBps);
        fee = grossUsdc - usdcOut;
        if (grossUsdc >= otherReserve) revert InsufficientLiquidity();

        uint256 k = sellReserve * otherReserve;
        uint256 finalOther = otherReserve - grossUsdc;
        uint256 requiredSellReserve = _ceilDiv(k, finalOther);
        outcomeIn = requiredSellReserve + grossUsdc - sellReserve;
    }

    function _sellCollateralOut(uint256 soldReserve, uint256 otherReserve, uint256 amountIn)
        private
        pure
        returns (uint256)
    {
        uint256 sum = soldReserve + amountIn + otherReserve;
        uint256 discriminant = sum * sum - 4 * amountIn * otherReserve;
        return (sum - _sqrt(discriminant)) / 2;
    }

    function _sqrt(uint256 value) private pure returns (uint256 result) {
        if (value == 0) return 0;
        uint256 x = value;
        result = 1;
        if (x >> 128 > 0) {
            x >>= 128;
            result <<= 64;
        }
        if (x >> 64 > 0) {
            x >>= 64;
            result <<= 32;
        }
        if (x >> 32 > 0) {
            x >>= 32;
            result <<= 16;
        }
        if (x >> 16 > 0) {
            x >>= 16;
            result <<= 8;
        }
        if (x >> 8 > 0) {
            x >>= 8;
            result <<= 4;
        }
        if (x >> 4 > 0) {
            x >>= 4;
            result <<= 2;
        }
        if (x >> 2 > 0) result <<= 1;

        unchecked {
            result = (result + value / result) >> 1;
            result = (result + value / result) >> 1;
            result = (result + value / result) >> 1;
            result = (result + value / result) >> 1;
            result = (result + value / result) >> 1;
            result = (result + value / result) >> 1;
            result = (result + value / result) >> 1;
            uint256 roundedDown = value / result;
            return result < roundedDown ? result : roundedDown;
        }
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _isTradableOutcome(Outcome outcome) private pure returns (bool) {
        return outcome == Outcome.Yes || outcome == Outcome.No;
    }

    function _isResolutionOutcome(Outcome outcome) private pure returns (bool) {
        return outcome == Outcome.Yes || outcome == Outcome.No || outcome == Outcome.Invalid;
    }
}
