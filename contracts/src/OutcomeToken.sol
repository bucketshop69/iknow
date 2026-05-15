// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC1155Receiver {
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4);
    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4);
}

/// @title OutcomeToken
/// @notice Minimal ERC-1155-like token for iknow YES/NO outcome positions.
/// @dev Dependency-light for hackathon speed. Production should use audited ERC-1155.
contract OutcomeToken {
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event MinterUpdated(address indexed minter, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotMinter();
    error NotApproved();
    error InvalidAddress();
    error InvalidOutcome();
    error LengthMismatch();
    error InsufficientBalance();

    uint8 public constant OUTCOME_YES = 0;
    uint8 public constant OUTCOME_NO = 1;
    uint8 public constant OUTCOME_COUNT = 2;

    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ERC1155_INTERFACE_ID = 0xd9b67a26;
    bytes4 private constant ERC1155_METADATA_URI_INTERFACE_ID = 0x0e89341c;

    address public owner;
    string private baseURI;

    mapping(address => bool) public isMinter;
    mapping(uint256 => mapping(address => uint256)) private balances;
    mapping(address => mapping(address => bool)) private operatorApprovals;

    constructor(string memory uri_) {
        owner = msg.sender;
        baseURI = uri_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit URI(uri_, 0);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMinter() {
        if (!isMinter[msg.sender]) revert NotMinter();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert InvalidAddress();
        isMinter[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC1155_INTERFACE_ID
            || interfaceId == ERC1155_METADATA_URI_INTERFACE_ID;
    }

    function uri(uint256) external view returns (string memory) {
        return baseURI;
    }

    function setURI(string calldata uri_) external onlyOwner {
        baseURI = uri_;
        emit URI(uri_, 0);
    }

    function tokenId(address market, uint8 outcome) public pure returns (uint256) {
        if (market == address(0)) revert InvalidAddress();
        if (outcome != OUTCOME_YES && outcome != OUTCOME_NO) revert InvalidOutcome();
        return uint256(keccak256(abi.encodePacked(market, outcome)));
    }

    function completeSetTokenIds(address market) external pure returns (uint256 yesId, uint256 noId) {
        yesId = tokenId(market, OUTCOME_YES);
        noId = tokenId(market, OUTCOME_NO);
    }

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        if (account == address(0)) revert InvalidAddress();
        return balances[id][account];
    }

    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory batchBalances) {
        if (accounts.length != ids.length) revert LengthMismatch();

        batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            batchBalances[i] = balanceOf(accounts[i], ids[i]);
        }
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return operatorApprovals[account][operator];
    }

    function setApprovalForAll(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        if (to == address(0)) revert InvalidAddress();
        if (msg.sender != from && !operatorApprovals[from][msg.sender]) revert NotApproved();
        _transfer(from, to, id, amount);
        _checkReceiver(msg.sender, from, to, id, amount, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        if (to == address(0)) revert InvalidAddress();
        if (ids.length != amounts.length) revert LengthMismatch();
        if (msg.sender != from && !operatorApprovals[from][msg.sender]) revert NotApproved();

        for (uint256 i = 0; i < ids.length; i++) {
            _transfer(from, to, ids[i], amounts[i]);
        }

        emit TransferBatch(msg.sender, from, to, ids, amounts);
        _checkBatchReceiver(msg.sender, from, to, ids, amounts, data);
    }

    function _mint(address to, uint256 id, uint256 amount) private {
        if (to == address(0)) revert InvalidAddress();
        balances[id][to] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
    }

    function mintCompleteSet(address to, address market, uint256 amount, bytes calldata data) external onlyMinter {
        uint256 yesId = tokenId(market, OUTCOME_YES);
        uint256 noId = tokenId(market, OUTCOME_NO);
        _mint(to, yesId, amount);
        _mint(to, noId, amount);
        _checkReceiver(msg.sender, address(0), to, yesId, amount, data);
        _checkReceiver(msg.sender, address(0), to, noId, amount, data);
    }

    function burn(address from, uint256 id, uint256 amount) public onlyMinter {
        uint256 bal = balances[id][from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balances[id][from] = bal - amount;
        }
        emit TransferSingle(msg.sender, from, address(0), id, amount);
    }

    function burn(address from, address market, uint8 outcome, uint256 amount) external onlyMinter {
        burn(from, tokenId(market, outcome), amount);
    }

    function burnCompleteSet(address from, address market, uint256 amount) external onlyMinter {
        burn(from, tokenId(market, OUTCOME_YES), amount);
        burn(from, tokenId(market, OUTCOME_NO), amount);
    }

    function minterTransferFrom(address from, address to, uint256 id, uint256 amount) external onlyMinter {
        if (to == address(0)) revert InvalidAddress();
        _transfer(from, to, id, amount);
        _checkReceiver(msg.sender, from, to, id, amount, "");
    }

    function _transfer(address from, address to, uint256 id, uint256 amount) internal {
        uint256 bal = balances[id][from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balances[id][from] = bal - amount;
        }
        balances[id][to] += amount;
        emit TransferSingle(msg.sender, from, to, id, amount);
    }

    function _checkReceiver(address operator, address from, address to, uint256 id, uint256 amount, bytes memory data)
        internal
    {
        if (to.code.length == 0) return;
        bytes4 accepted = IERC1155Receiver(to).onERC1155Received(operator, from, id, amount, data);
        require(accepted == IERC1155Receiver.onERC1155Received.selector, "ERC1155_REJECTED");
    }

    function _checkBatchReceiver(
        address operator,
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) internal {
        if (to.code.length == 0) return;
        bytes4 accepted = IERC1155Receiver(to).onERC1155BatchReceived(operator, from, ids, amounts, data);
        require(accepted == IERC1155Receiver.onERC1155BatchReceived.selector, "ERC1155_BATCH_REJECTED");
    }
}
