// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PotManager — shared money boxes for friend groups.
/// @notice Members add money; the pot reimburses members under group rules;
///         on close, leftover returns to members in proportion to what they put in.
/// Rules:
///  - Payouts go only to members (reimbursement model: the friend who paid the cab gets repaid).
///  - Payout to another member <= approvalLimit executes instantly.
///  - Payout > approvalLimit, or any payout to yourself, needs 1 approval from another member.
///  - Only the creator can close; refunds are pro-rata to contributions, so closing cannot be used to steal.
/// Known limitation: the invite code becomes visible onchain after the first join; maxMembers bounds abuse.
contract PotManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint32 public constant MAX_MEMBERS_CAP = 20;

    struct Pot {
        address creator;
        bytes32 inviteHash;
        uint256 approvalLimit;
        uint256 balance;
        uint256 totalContributed;
        uint32 maxMembers;
        uint32 spendCount;
        bool closed;
    }

    struct Spend {
        address requester;
        address to;
        uint256 amount;
        bytes32 memoHash;
        bool executed;
    }

    IERC20 public immutable token;
    uint256 public potCount;

    mapping(uint256 => Pot) internal _pots;
    mapping(uint256 => address[]) internal _members;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => uint256)) public contributed;
    mapping(uint256 => mapping(uint256 => Spend)) internal _spends;

    event PotCreated(uint256 indexed potId, address indexed creator, uint256 approvalLimit, uint32 maxMembers);
    event MemberJoined(uint256 indexed potId, address indexed member);
    event Deposited(uint256 indexed potId, address indexed member, uint256 amount);
    event SpendRequested(
        uint256 indexed potId,
        uint256 indexed spendId,
        address indexed requester,
        address to,
        uint256 amount,
        bytes32 memoHash,
        bool needsApproval
    );
    event SpendApproved(uint256 indexed potId, uint256 indexed spendId, address indexed approver);
    event SpendExecuted(uint256 indexed potId, uint256 indexed spendId, address indexed to, uint256 amount);
    event PotClosed(uint256 indexed potId, uint256 refundedTotal);
    event Refunded(uint256 indexed potId, address indexed member, uint256 amount);

    error InvalidParams();
    error PotNotFound();
    error PotIsClosed();
    error NotMember();
    error AlreadyMember();
    error BadInviteCode();
    error PotFull();
    error NotCreator();
    error ZeroAmount();
    error InsufficientBalance();
    error RecipientNotMember();
    error SpendNotFound();
    error SpendAlreadyExecuted();
    error CannotApproveOwnSpend();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert InvalidParams();
        token = token_;
    }

    // ───────────── actions ─────────────

    function createPot(bytes32 inviteHash, uint256 approvalLimit, uint32 maxMembers) external returns (uint256 potId) {
        if (inviteHash == bytes32(0) || maxMembers < 2 || maxMembers > MAX_MEMBERS_CAP) revert InvalidParams();
        potId = ++potCount;
        Pot storage p = _pots[potId];
        p.creator = msg.sender;
        p.inviteHash = inviteHash;
        p.approvalLimit = approvalLimit;
        p.maxMembers = maxMembers;
        emit PotCreated(potId, msg.sender, approvalLimit, maxMembers);
        _addMember(potId, msg.sender);
    }

    function join(uint256 potId, bytes32 inviteCode) external {
        Pot storage p = _openPot(potId);
        if (isMember[potId][msg.sender]) revert AlreadyMember();
        if (keccak256(abi.encodePacked(inviteCode)) != p.inviteHash) revert BadInviteCode();
        if (_members[potId].length >= p.maxMembers) revert PotFull();
        _addMember(potId, msg.sender);
    }

    function deposit(uint256 potId, uint256 amount) external nonReentrant {
        Pot storage p = _openPot(potId);
        _requireMember(potId, msg.sender);
        if (amount == 0) revert ZeroAmount();
        p.balance += amount;
        p.totalContributed += amount;
        contributed[potId][msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(potId, msg.sender, amount);
    }

    function requestSpend(uint256 potId, address to, uint256 amount, bytes32 memoHash)
        external
        nonReentrant
        returns (uint256 spendId)
    {
        Pot storage p = _openPot(potId);
        _requireMember(potId, msg.sender);
        if (!isMember[potId][to]) revert RecipientNotMember();
        if (amount == 0) revert ZeroAmount();
        if (amount > p.balance) revert InsufficientBalance();

        spendId = ++p.spendCount;
        _spends[potId][spendId] =
            Spend({requester: msg.sender, to: to, amount: amount, memoHash: memoHash, executed: false});

        bool needsApproval = amount > p.approvalLimit || to == msg.sender;
        emit SpendRequested(potId, spendId, msg.sender, to, amount, memoHash, needsApproval);
        if (!needsApproval) _execute(potId, spendId);
    }

    function approveSpend(uint256 potId, uint256 spendId) external nonReentrant {
        _openPot(potId);
        _requireMember(potId, msg.sender);
        Spend storage s = _spends[potId][spendId];
        if (s.requester == address(0)) revert SpendNotFound();
        if (s.executed) revert SpendAlreadyExecuted();
        if (s.requester == msg.sender) revert CannotApproveOwnSpend();
        emit SpendApproved(potId, spendId, msg.sender);
        _execute(potId, spendId);
    }

    function closePot(uint256 potId) external nonReentrant {
        Pot storage p = _openPot(potId);
        if (msg.sender != p.creator) revert NotCreator();

        p.closed = true;
        uint256 remaining = p.balance;
        p.balance = 0;
        emit PotClosed(potId, remaining);
        if (remaining == 0) return;

        address[] storage m = _members[potId];
        uint256 lastIdx;
        for (uint256 i = m.length; i > 0; i--) {
            if (contributed[potId][m[i - 1]] > 0) {
                lastIdx = i - 1;
                break;
            }
        }

        uint256 distributed;
        for (uint256 i; i < m.length; i++) {
            uint256 c = contributed[potId][m[i]];
            if (c == 0) continue;
            uint256 share = i == lastIdx ? remaining - distributed : (remaining * c) / p.totalContributed;
            distributed += share;
            if (share > 0) {
                token.safeTransfer(m[i], share);
                emit Refunded(potId, m[i], share);
            }
        }
    }

    // ───────────── views ─────────────

    function getPot(uint256 potId) external view returns (Pot memory) {
        return _pots[potId];
    }

    function getMembers(uint256 potId) external view returns (address[] memory) {
        return _members[potId];
    }

    function getSpend(uint256 potId, uint256 spendId) external view returns (Spend memory) {
        return _spends[potId][spendId];
    }

    // ───────────── internal ─────────────

    function _execute(uint256 potId, uint256 spendId) internal {
        Pot storage p = _pots[potId];
        Spend storage s = _spends[potId][spendId];
        if (s.amount > p.balance) revert InsufficientBalance();
        s.executed = true;
        p.balance -= s.amount;
        token.safeTransfer(s.to, s.amount);
        emit SpendExecuted(potId, spendId, s.to, s.amount);
    }

    function _addMember(uint256 potId, address account) internal {
        isMember[potId][account] = true;
        _members[potId].push(account);
        emit MemberJoined(potId, account);
    }

    function _openPot(uint256 potId) internal view returns (Pot storage p) {
        p = _pots[potId];
        if (p.creator == address(0)) revert PotNotFound();
        if (p.closed) revert PotIsClosed();
    }

    function _requireMember(uint256 potId, address account) internal view {
        if (!isMember[potId][account]) revert NotMember();
    }
}
