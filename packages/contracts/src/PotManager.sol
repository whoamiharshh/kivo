// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title PotManager — shared money boxes for friend groups, on a deadline.
/// @notice A group collects money toward a target by a date. If the target is
///         met, the pot reimburses members under the group's rules and the
///         creator closes it, returning the leftover pro-rata. If the deadline
///         passes without the target being met, every contribution becomes
///         refundable and each contributor claims their own back.
///
/// Lifecycle:
///
///   Collecting --(target reached)--> Funded --(creator closes)--> Closed
///        |                                                          ^
///        +--(deadline passed, target missed)--> Refunding -----------+
///                                              (all refunds claimed)
///
/// Deadline semantics, applied identically in the contract, the app, the tests
/// and the docs: `deadline` is EXCLUSIVE. Money may go in while
/// `block.timestamp < deadline`. At `block.timestamp == deadline` collection is
/// over and `finalizeFailed` may be called.
///
/// Rules that must stay true:
///  - Money can only leave a pot that reached its target.
///  - Contributions never exceed the target; the excess is simply not taken.
///  - Payouts go only to members (the friend who paid the cab gets repaid).
///  - `approvalLimit` is a CUMULATIVE budget per member, not a per-request
///    ceiling. Each member may move up to that much in total without anyone
///    else agreeing; past that, every further request needs one approval. This
///    is what stops one person splitting a big payout into many small ones.
///  - Any payout to yourself needs an approval, whatever the amount.
///  - A pending request RESERVES its amount, so two pending requests can never
///    both be approved for money the pot does not have.
///  - A pot cannot close while requests are still pending. The requester, or
///    the creator, can cancel one — so a stale request cannot freeze the pot.
///  - Only the creator can close a funded pot, and closing refunds strictly
///    pro-rata to contributions, so closing cannot be used to take the money.
///  - A failed pot refunds by claim: nobody depends on the creator to act, and
///    no one can claim twice or claim someone else's share.
///
/// On the deadline: a contract cannot wake itself up. `finalizeFailed` is
/// permissionless and anyone may call it once the deadline has passed. The
/// contract guarantees the outcome, not the instant.
///
/// On the invite code: `inviteHash` is NOT a secret. It is stored so a joiner's
/// code can be checked, and it is readable from transaction calldata and from
/// contract storage by anyone who looks. No view returns it, but that is
/// tidiness, not confidentiality. The code itself is 32 bytes from a
/// cryptographically secure source in the app, so it cannot be guessed from a
/// pot's name, id or creation time.
///
/// Because the code is not confidential once used, the code ALONE does not gate
/// membership. `join` also requires a short-lived authorization signed by
/// `trustSigner`, naming this pot and this joiner. Both are needed:
///
///   - the code proves the joiner was given the invite link;
///   - the authorization proves the app's server checked that code against its
///     own private record of it, and is willing to admit this address now.
///
/// What that buys: somebody who scrapes a code out of a past join transaction
/// still cannot join, because they cannot produce an authorization. What it
/// costs, stated plainly: `trustSigner` is a trusted party. It holds the codes,
/// so a compromised signer could admit itself to any pot that is still open. It
/// cannot spend, approve, close or refund anything — none of the money rules
/// below consult it. Rotation means redeployment, because the key is immutable.
///
/// An authorization is single-use without needing a nonce mapping: it names one
/// joiner and one pot, and a second `join` for that pair reverts AlreadyMember.
contract PotManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint32 public constant MAX_MEMBERS_CAP = 20;
    /// @dev Stops a mistyped deadline from parking money for a decade.
    uint64 public constant MAX_DEADLINE_HORIZON = 365 days;

    enum PotState {
        Collecting,
        Funded,
        Refunding,
        Closed
    }

    struct Pot {
        address creator;
        bytes32 inviteHash;
        uint256 approvalLimit;
        uint256 targetAmount;
        uint256 balance;
        /// @dev Held by pending requests; not spendable or distributable.
        uint256 reserved;
        uint256 totalContributed;
        uint64 deadline;
        uint32 maxMembers;
        uint32 spendCount;
        uint32 pendingSpendCount;
        uint32 refundsOutstanding;
        PotState state;
    }

    /// @notice Everything about a pot except the invite hash.
    struct PotInfo {
        address creator;
        uint256 approvalLimit;
        uint256 targetAmount;
        uint256 balance;
        uint256 reserved;
        uint256 totalContributed;
        uint64 deadline;
        uint32 maxMembers;
        uint32 memberCount;
        uint32 spendCount;
        uint32 pendingSpendCount;
        uint32 refundsOutstanding;
        PotState state;
    }

    struct Spend {
        address requester;
        address to;
        uint256 amount;
        bytes32 memoHash;
        bool executed;
        bool cancelled;
    }

    IERC20 public immutable token;

    /// @notice Whose signature admits a joiner. Cannot move money. See the note
    ///         at the top of this file for what trusting it does and does not
    ///         mean.
    address public immutable trustSigner;

    /// @dev Tags the join digest, so a signature meant for one action in this
    ///      contract can never be read as another if more are ever added.
    bytes32 private constant JOIN_ACTION = keccak256("PotManager.join.v1");

    uint256 public potCount;

    mapping(uint256 => Pot) internal _pots;
    mapping(uint256 => address[]) internal _members;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => uint256)) public contributed;
    mapping(uint256 => mapping(address => bool)) public refundClaimed;
    /// @notice How much each member has moved without anyone else approving.
    mapping(uint256 => mapping(address => uint256)) public instantSpent;
    mapping(uint256 => mapping(uint256 => Spend)) internal _spends;

    event PotCreated(
        uint256 indexed potId,
        address indexed creator,
        uint256 approvalLimit,
        uint32 maxMembers,
        uint256 targetAmount,
        uint64 deadline
    );
    event MemberJoined(uint256 indexed potId, address indexed member);
    event Deposited(uint256 indexed potId, address indexed member, uint256 amount);
    event PotFunded(uint256 indexed potId, uint256 totalContributed);
    event RefundingStarted(uint256 indexed potId, uint256 refundableTotal);
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
    event SpendCancelled(uint256 indexed potId, uint256 indexed spendId, address indexed by);
    event SpendExecuted(uint256 indexed potId, uint256 indexed spendId, address indexed to, uint256 amount);
    event PotClosed(uint256 indexed potId, uint256 refundedTotal);
    event Refunded(uint256 indexed potId, address indexed member, uint256 amount);

    error InvalidParams();
    error PotNotFound();
    error NotCollecting();
    error NotFunded();
    error NotRefunding();
    error DeadlinePassed();
    error DeadlineNotReached();
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
    error SpendWasCancelled();
    error CannotApproveOwnSpend();
    error CannotApproveOwnPayout();
    error AuthorizationExpired();
    error BadAuthorization();
    error NotRequesterOrCreator();
    error PendingRequests();
    error NothingToClaim();
    error AlreadyClaimed();

    constructor(IERC20 token_, address trustSigner_) {
        if (address(token_) == address(0) || trustSigner_ == address(0)) revert InvalidParams();
        token = token_;
        trustSigner = trustSigner_;
    }

    // ───────────── setting up ─────────────

    /// @param inviteHash keccak256(abi.encodePacked(inviteCode)). Not a secret.
    /// @param approvalLimit cumulative amount each member may move unapproved.
    /// @param maxMembers how many people may join. Independent of the target.
    /// @param targetAmount what the group is collecting, in token units.
    /// @param deadline unix seconds, exclusive; money goes in strictly before it.
    function createPot(
        bytes32 inviteHash,
        uint256 approvalLimit,
        uint32 maxMembers,
        uint256 targetAmount,
        uint64 deadline
    ) external returns (uint256 potId) {
        if (
            inviteHash == bytes32(0) || maxMembers < 2 || maxMembers > MAX_MEMBERS_CAP || targetAmount == 0
                || deadline <= block.timestamp || deadline > block.timestamp + MAX_DEADLINE_HORIZON
                || approvalLimit > targetAmount
        ) revert InvalidParams();

        potId = ++potCount;
        Pot storage p = _pots[potId];
        p.creator = msg.sender;
        p.inviteHash = inviteHash;
        p.approvalLimit = approvalLimit;
        p.maxMembers = maxMembers;
        p.targetAmount = targetAmount;
        p.deadline = deadline;
        p.state = PotState.Collecting;

        emit PotCreated(potId, msg.sender, approvalLimit, maxMembers, targetAmount, deadline);
        _addMember(potId, msg.sender);
    }

    /// @notice Join with the code from the invite link, plus a fresh
    ///         authorization from `trustSigner` for this pot and this address.
    /// @dev Allowed while the pot is still collecting (before its deadline) or
    ///      already funded — a friend who paid for something can be added so
    ///      they can be repaid.
    ///
    ///      `AlreadyMember` is checked before the code and the signature on
    ///      purpose: a replayed authorization should say "you are already in"
    ///      rather than reveal whether the signature was still good.
    /// @param expiry unix seconds, exclusive. The authorization is dead at it.
    /// @param authorization 65-byte ECDSA signature over `joinDigest`.
    function join(uint256 potId, bytes32 inviteCode, uint64 expiry, bytes calldata authorization) external {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state == PotState.Collecting) {
            if (block.timestamp >= p.deadline) revert DeadlinePassed();
        } else if (p.state != PotState.Funded) {
            revert NotCollecting();
        }
        if (isMember[potId][msg.sender]) revert AlreadyMember();
        if (block.timestamp >= expiry) revert AuthorizationExpired();
        if (keccak256(abi.encodePacked(inviteCode)) != p.inviteHash) revert BadInviteCode();
        if (ECDSA.recover(joinDigest(potId, msg.sender, expiry), authorization) != trustSigner) {
            revert BadAuthorization();
        }
        if (_members[potId].length >= p.maxMembers) revert PotFull();
        _addMember(potId, msg.sender);
    }

    /// @notice What `trustSigner` has to sign to admit `joiner` to `potId`.
    /// @dev Bound to this contract, this chain, this pot, this address and an
    ///      expiry, so an authorization cannot be replayed on another chain, at
    ///      another deployment, for another pot, by another person, or later.
    function joinDigest(uint256 potId, address joiner, uint64 expiry) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(JOIN_ACTION, address(this), block.chainid, potId, joiner, expiry))
        );
    }

    // ───────────── collecting ─────────────

    /// @notice Add money toward the target.
    /// @dev Takes only what the pot still needs: asking to add more than that
    ///      contributes the remainder and leaves the rest with the sender,
    ///      rather than reverting or overshooting the target.
    /// @return accepted how much actually went in.
    function deposit(uint256 potId, uint256 amount) external nonReentrant returns (uint256 accepted) {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Collecting) revert NotCollecting();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        _requireMember(potId, msg.sender);
        if (amount == 0) revert ZeroAmount();

        // A Collecting pot always still needs something, or it would be Funded.
        uint256 remaining = p.targetAmount - p.totalContributed;
        accepted = amount < remaining ? amount : remaining;

        if (contributed[potId][msg.sender] == 0) p.refundsOutstanding += 1;
        p.balance += accepted;
        p.totalContributed += accepted;
        contributed[potId][msg.sender] += accepted;

        bool reachedTarget = p.totalContributed == p.targetAmount;
        if (reachedTarget) p.state = PotState.Funded;

        token.safeTransferFrom(msg.sender, address(this), accepted);

        emit Deposited(potId, msg.sender, accepted);
        if (reachedTarget) emit PotFunded(potId, p.totalContributed);
    }

    // ───────────── spending, once funded ─────────────

    /// @notice Ask the pot to repay a member.
    /// @dev Executes at once only if the requester still has unapproved budget
    ///      left and is not paying themselves. Otherwise the amount is reserved
    ///      and waits for one other member.
    function requestSpend(uint256 potId, address to, uint256 amount, bytes32 memoHash)
        external
        nonReentrant
        returns (uint256 spendId)
    {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Funded) revert NotFunded();
        _requireMember(potId, msg.sender);
        if (!isMember[potId][to]) revert RecipientNotMember();
        if (amount == 0) revert ZeroAmount();
        // Only money that no pending request has already claimed.
        if (amount > p.balance - p.reserved) revert InsufficientBalance();

        // The limit is a running total per member, so several small requests
        // cannot add up to more than one approved request would have allowed.
        bool needsApproval = to == msg.sender || instantSpent[potId][msg.sender] + amount > p.approvalLimit;

        spendId = ++p.spendCount;
        _spends[potId][spendId] = Spend({
            requester: msg.sender, to: to, amount: amount, memoHash: memoHash, executed: false, cancelled: false
        });

        emit SpendRequested(potId, spendId, msg.sender, to, amount, memoHash, needsApproval);

        if (needsApproval) {
            p.reserved += amount;
            p.pendingSpendCount += 1;
        } else {
            instantSpent[potId][msg.sender] += amount;
            _execute(potId, spendId);
        }
    }

    /// @notice Approve someone else's pending request. It pays out at once.
    /// @dev Still checks state, so a request made while the pot was healthy
    ///      cannot be cashed in after the pot closed.
    ///
    ///      The approver may be neither the requester nor the recipient. An
    ///      approval is meant to be a second person agreeing the money should
    ///      move; somebody signing off on a payment into their own hands is not
    ///      that, whoever typed the request. The consequence is worth saying
    ///      out loud: in a TWO-member pot, an over-limit payout from one member
    ///      to the other cannot be approved by anyone, because there is no
    ///      third person to ask. A two-person pot has to live inside its
    ///      `approvalLimit`, or add a third member. That is the honest shape of
    ///      "one other member agrees" when there is no other member.
    function approveSpend(uint256 potId, uint256 spendId) external nonReentrant {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Funded) revert NotFunded();
        _requireMember(potId, msg.sender);

        Spend storage s = _spends[potId][spendId];
        if (s.requester == address(0)) revert SpendNotFound();
        if (s.executed) revert SpendAlreadyExecuted();
        if (s.cancelled) revert SpendWasCancelled();
        if (s.requester == msg.sender) revert CannotApproveOwnSpend();
        if (s.to == msg.sender) revert CannotApproveOwnPayout();

        // Release the hold, then pay. The amount was reserved when requested,
        // so this can never find the money missing.
        p.reserved -= s.amount;
        p.pendingSpendCount -= 1;

        emit SpendApproved(potId, spendId, msg.sender);
        _execute(potId, spendId);
    }

    /// @notice Withdraw a pending request and release the money it was holding.
    /// @dev The requester can always cancel their own. The creator can cancel
    ///      any pending one, so a member who goes quiet cannot leave the pot
    ///      permanently unclosable.
    function cancelSpend(uint256 potId, uint256 spendId) external nonReentrant {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Funded) revert NotFunded();

        Spend storage s = _spends[potId][spendId];
        if (s.requester == address(0)) revert SpendNotFound();
        if (s.executed) revert SpendAlreadyExecuted();
        if (s.cancelled) revert SpendWasCancelled();
        if (msg.sender != s.requester && msg.sender != p.creator) revert NotRequesterOrCreator();

        s.cancelled = true;
        p.reserved -= s.amount;
        p.pendingSpendCount -= 1;

        emit SpendCancelled(potId, spendId, msg.sender);
    }

    // ───────────── ending it ─────────────

    /// @notice Close a funded pot and return the leftover pro-rata.
    /// @dev Refuses while anything is still pending, so closing cannot quietly
    ///      cancel a repayment someone is owed. Cancel those first.
    function closePot(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Funded) revert NotFunded();
        if (msg.sender != p.creator) revert NotCreator();
        if (p.pendingSpendCount != 0) revert PendingRequests();

        p.state = PotState.Closed;
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
            // The last contributor absorbs the rounding dust, so the pot empties exactly.
            uint256 share = i == lastIdx ? remaining - distributed : (remaining * c) / p.totalContributed;
            distributed += share;
            if (share > 0) {
                token.safeTransfer(m[i], share);
                emit Refunded(potId, m[i], share);
            }
        }
    }

    /// @notice Once the deadline has passed on a pot that never hit its target,
    ///         move it to Refunding so contributors can claim their money back.
    /// @dev Permissionless on purpose: nobody has to wait on the creator. A pot
    ///      with no contributions at all closes straight away.
    function finalizeFailed(uint256 potId) external {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Collecting) revert NotCollecting();
        if (block.timestamp < p.deadline) revert DeadlineNotReached();

        if (p.refundsOutstanding == 0) {
            p.state = PotState.Closed;
            emit PotClosed(potId, 0);
        } else {
            p.state = PotState.Refunding;
            emit RefundingStarted(potId, p.totalContributed);
        }
    }

    /// @notice Take back everything you put into a failed pot.
    /// @dev Claim-based: you can only move your own contribution, only once,
    ///      and never depending on anyone else claiming first. An unclaimed
    ///      share stays claimable indefinitely — there is no expiry and no way
    ///      for anyone, including the creator, to sweep it.
    function claimRefund(uint256 potId) external nonReentrant {
        Pot storage p = _pots[potId];
        _requireExists(p);
        if (p.state != PotState.Refunding) revert NotRefunding();

        uint256 amount = contributed[potId][msg.sender];
        if (amount == 0) revert NothingToClaim();
        if (refundClaimed[potId][msg.sender]) revert AlreadyClaimed();

        refundClaimed[potId][msg.sender] = true;
        p.balance -= amount;
        p.refundsOutstanding -= 1;
        bool wasLast = p.refundsOutstanding == 0;
        if (wasLast) p.state = PotState.Closed;

        token.safeTransfer(msg.sender, amount);

        emit Refunded(potId, msg.sender, amount);
        if (wasLast) emit PotClosed(potId, 0);
    }

    // ───────────── views ─────────────

    /// @notice Pot details, deliberately without the invite hash.
    function getPot(uint256 potId) external view returns (PotInfo memory) {
        Pot storage p = _pots[potId];
        if (p.creator == address(0)) revert PotNotFound();
        return PotInfo({
            creator: p.creator,
            approvalLimit: p.approvalLimit,
            targetAmount: p.targetAmount,
            balance: p.balance,
            reserved: p.reserved,
            totalContributed: p.totalContributed,
            deadline: p.deadline,
            maxMembers: p.maxMembers,
            // casting to 'uint32' is safe because a pot's member list can never
            // exceed maxMembers, which createPot caps at MAX_MEMBERS_CAP (20).
            // forge-lint: disable-next-line(unsafe-typecast)
            memberCount: uint32(_members[potId].length),
            spendCount: p.spendCount,
            pendingSpendCount: p.pendingSpendCount,
            refundsOutstanding: p.refundsOutstanding,
            state: p.state
        });
    }

    function getMembers(uint256 potId) external view returns (address[] memory) {
        return _members[potId];
    }

    function getSpend(uint256 potId, uint256 spendId) external view returns (Spend memory) {
        return _spends[potId][spendId];
    }

    /// @notice What this pot still needs to reach its target.
    function remainingToTarget(uint256 potId) external view returns (uint256) {
        Pot storage p = _pots[potId];
        if (p.creator == address(0)) revert PotNotFound();
        if (p.totalContributed >= p.targetAmount) return 0;
        return p.targetAmount - p.totalContributed;
    }

    /// @notice Money not already held by a pending request.
    function availableBalance(uint256 potId) external view returns (uint256) {
        Pot storage p = _pots[potId];
        if (p.creator == address(0)) revert PotNotFound();
        return p.balance - p.reserved;
    }

    /// @notice How much more this member can move without an approval.
    function instantRemaining(uint256 potId, address member) external view returns (uint256) {
        Pot storage p = _pots[potId];
        uint256 used = instantSpent[potId][member];
        if (used >= p.approvalLimit) return 0;
        return p.approvalLimit - used;
    }

    /// @notice What `claimRefund` would pay this member right now.
    function refundableOf(uint256 potId, address member) external view returns (uint256) {
        Pot storage p = _pots[potId];
        if (p.state != PotState.Refunding) return 0;
        if (refundClaimed[potId][member]) return 0;
        return contributed[potId][member];
    }

    // ───────────── internal ─────────────

    function _execute(uint256 potId, uint256 spendId) internal {
        Pot storage p = _pots[potId];
        Spend storage s = _spends[potId][spendId];
        // Reserved money has already been released by the caller, so what is
        // left here must still cover it.
        if (s.amount > p.balance - p.reserved) revert InsufficientBalance();
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

    function _requireExists(Pot storage p) internal view {
        if (p.creator == address(0)) revert PotNotFound();
    }

    function _requireMember(uint256 potId, address account) internal view {
        if (!isMember[potId][account]) revert NotMember();
    }
}
