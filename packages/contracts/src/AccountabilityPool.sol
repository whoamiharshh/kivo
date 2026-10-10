// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title AccountabilityPool — a group puts money on turning up, together.
///
/// @notice Everyone stakes the same amount. Each day, an attester signs that a
///         member did the thing. At the deadline, whoever showed up often
///         enough gets their stake back plus a share of what the others
///         forfeited. Whoever did not, loses their stake to the people who did.
///
/// This is a WAGER BETWEEN MEMBERS and the contract says so rather than
/// dressing it up. There is no sponsor, no yield and no outside money: the only
/// source of a payout is somebody else's forfeited stake. If everybody
/// succeeds, everybody gets exactly their stake back and nobody gains a paisa,
/// which is the honest arithmetic and the UI must show it that way.
///
/// How it differs from BehaviourSavings, since the two look alike:
///
///   BehaviourSavings   you save toward a target. Your PRINCIPAL always comes
///                      back; only a separate 10% stake is at risk. Redistri-
///                      bution is across everyone sharing a deadline.
///   AccountabilityPool there is no principal. The stake IS the money, the
///                      group is explicit and closed, and the rule is a count
///                      of days rather than an amount saved.
///
/// ───────────── the grace rule ─────────────
///
/// A pool sets `requiredDays` and `graceDays`. You succeed if
///
///     daysAttested + graceDays >= requiredDays
///
/// so `graceDays` is how many days you may miss. It is fixed at creation and
/// cannot be changed afterwards, because a grace rule that moves once people
/// can see who is losing is not a rule.
///
/// ───────────── what the attester can and cannot do ─────────────
///
/// An attester signs (pool, member, day). It cannot take money, cannot change
/// a pool's rules, and cannot attest a day twice — the second attempt reverts.
/// What it CAN do is decline to attest, which fails a member. That is a real
/// power and the reason the attester is fixed at deployment and visible:
/// nobody should join a pool without knowing who is judging it.
///
/// **The attester cannot see whether the behaviour happened.** In this
/// repository it is a server taking somebody's word (see docs/trust-layer.md).
/// Nothing here should be read as proof of a step count.
///
/// ───────────── settlement is two steps, on purpose ─────────────
///
/// `finalise` tallies the whole pool in one bounded loop (at most
/// MAX_MEMBERS_CAP members) and moves no money. `claim` pays one member, when
/// they ask. Pull-based, so a member who never claims cannot block anyone
/// else, and no transfer happens inside a loop.
///
/// Amounts are in the token's own units. With TestRupee (2 decimals) one unit
/// is one paisa, so ₹500 is 50000.
contract AccountabilityPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint32 public constant MAX_MEMBERS_CAP = 20;
    uint64 public constant MIN_DURATION = 1 days;
    uint64 public constant MAX_DURATION = 365 days;

    /// @dev Tags the attestation digest so it can never be read as another
    ///      contract's message, even one with the same argument shapes.
    bytes32 private constant ATTEST_ACTION = keccak256("AccountabilityPool.attest.v1");

    enum State {
        None,
        Open,
        Finalised
    }

    struct Pool {
        address creator;
        uint256 stakePerMember;
        uint256 pot;
        /// @notice Forfeited stakes still waiting to be handed out.
        uint256 forfeited;
        uint256 winningStakeTotal;
        uint64 deadline;
        uint32 requiredDays;
        uint32 graceDays;
        uint32 maxMembers;
        uint32 winners;
        uint32 unclaimed;
        State state;
    }

    struct Member {
        bool joined;
        bool succeeded;
        bool claimed;
        uint32 daysAttested;
    }

    IERC20 public immutable token;

    /// @notice Whose signature counts as an attestation. Immutable: rotating it
    ///         means a new deployment, which is deliberate — members agreed to
    ///         this judge when they joined.
    address public immutable attester;

    uint256 public poolCount;

    mapping(uint256 => Pool) internal _pools;
    mapping(uint256 => address[]) internal _members;
    mapping(uint256 => mapping(address => Member)) internal _member;
    /// @notice One attestation per member per day, enforced here not off-chain.
    mapping(uint256 => mapping(address => mapping(uint64 => bool))) public dayAttested;

    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        uint256 stakePerMember,
        uint64 deadline,
        uint32 requiredDays,
        uint32 graceDays,
        uint32 maxMembers
    );
    event MemberJoined(uint256 indexed poolId, address indexed member, uint256 stake);
    event DayAttested(uint256 indexed poolId, address indexed member, uint64 day, uint32 daysAttested);
    event PoolFinalised(uint256 indexed poolId, uint32 winners, uint256 forfeited);
    event Claimed(uint256 indexed poolId, address indexed member, uint256 stakeBack, uint256 bonus);
    event StakeForfeited(uint256 indexed poolId, address indexed member, uint256 stake);

    error InvalidParams();
    error PoolNotFound();
    error WrongState();
    error AlreadyMember();
    error NotMember();
    error PoolFull();
    error DeadlinePassed();
    error DeadlineNotReached();
    error AlreadyAttested();
    error BadAttestation();
    error AlreadyClaimed();
    error ZeroAddress();

    constructor(IERC20 token_, address attester_) {
        if (address(token_) == address(0) || attester_ == address(0)) revert ZeroAddress();
        token = token_;
        attester = attester_;
    }

    // ───────────── setting up ─────────────

    /// @notice Open a pool and join it by staking.
    /// @param stakePerMember what everybody puts in. The same for all, so no
    ///        member can buy a bigger share of other people's losses.
    /// @param deadline unix seconds, EXCLUSIVE. Days may be attested while
    ///        `block.timestamp < deadline`.
    /// @param requiredDays how many attested days count as showing up.
    /// @param graceDays how many of those you are allowed to miss.
    function createPool(
        uint256 stakePerMember,
        uint64 deadline,
        uint32 requiredDays,
        uint32 graceDays,
        uint32 maxMembers
    ) external nonReentrant returns (uint256 poolId) {
        if (
            stakePerMember == 0 || maxMembers < 2 || maxMembers > MAX_MEMBERS_CAP || requiredDays == 0
                || graceDays >= requiredDays || deadline < block.timestamp + MIN_DURATION
                || deadline > block.timestamp + MAX_DURATION
        ) revert InvalidParams();

        // A pool whose rule can be met by missing everything is not a pool.
        // graceDays >= requiredDays is rejected above for exactly that reason.

        poolId = ++poolCount;
        Pool storage p = _pools[poolId];
        p.creator = msg.sender;
        p.stakePerMember = stakePerMember;
        p.deadline = deadline;
        p.requiredDays = requiredDays;
        p.graceDays = graceDays;
        p.maxMembers = maxMembers;
        p.state = State.Open;

        emit PoolCreated(poolId, msg.sender, stakePerMember, deadline, requiredDays, graceDays, maxMembers);
        _join(poolId, p);
    }

    /// @notice Stake and join an open pool.
    /// @dev Allowed right up to the deadline. Joining late is a bad idea rather
    ///      than a forbidden one: the required-days rule will simply be
    ///      unreachable, and the UI warns about it. The contract does not
    ///      second-guess an adult who wants in.
    function joinPool(uint256 poolId) external nonReentrant {
        Pool storage p = _get(poolId);
        if (p.state != State.Open) revert WrongState();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        if (_member[poolId][msg.sender].joined) revert AlreadyMember();
        if (_members[poolId].length >= p.maxMembers) revert PoolFull();
        _join(poolId, p);
    }

    function _join(uint256 poolId, Pool storage p) internal {
        _member[poolId][msg.sender].joined = true;
        _members[poolId].push(msg.sender);
        p.pot += p.stakePerMember;

        emit MemberJoined(poolId, msg.sender, p.stakePerMember);
        token.safeTransferFrom(msg.sender, address(this), p.stakePerMember);
    }

    // ───────────── turning up ─────────────

    /// @notice Record that `member` did the thing on `day`.
    /// @dev Anyone may relay the signature; the signature is the authority, so
    ///      a member can submit their own attestation and does not have to wait
    ///      for the attester to send a transaction.
    /// @param day whole days since the unix epoch, so one calendar day is one
    ///        number and "the same day twice" is a cheap comparison. The caller
    ///        and the attester have to agree which timezone produced it; the
    ///        app uses the member's own local date (see docs/trust-layer.md).
    function attestDay(uint256 poolId, address member, uint64 day, bytes calldata signature) external {
        Pool storage p = _get(poolId);
        if (p.state != State.Open) revert WrongState();
        if (block.timestamp >= p.deadline) revert DeadlinePassed();
        if (!_member[poolId][member].joined) revert NotMember();
        if (dayAttested[poolId][member][day]) revert AlreadyAttested();

        if (ECDSA.recover(attestationDigest(poolId, member, day), signature) != attester) {
            revert BadAttestation();
        }

        dayAttested[poolId][member][day] = true;
        uint32 total = _member[poolId][member].daysAttested + 1;
        _member[poolId][member].daysAttested = total;

        emit DayAttested(poolId, member, day, total);
    }

    /// @notice Exactly what the attester has to sign.
    /// @dev Bound to this contract, this chain, the pool, the member and the
    ///      day, plus an action tag. So an attestation cannot be replayed onto
    ///      another member, another day, another pool, another deployment, or
    ///      another contract that happens to take the same argument shapes.
    function attestationDigest(uint256 poolId, address member, uint64 day) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(ATTEST_ACTION, address(this), block.chainid, poolId, member, day))
        );
    }

    // ───────────── settling ─────────────

    /// @notice After the deadline, work out who showed up. Moves no money.
    /// @dev Permissionless. All it can do is record an outcome that was already
    ///      determined by the attestations, so nobody has to wait on the
    ///      creator or the attester to be allowed to claim.
    ///
    ///      The loop is bounded by `maxMembers`, which `createPool` caps at
    ///      MAX_MEMBERS_CAP. That is the only loop in this contract and it
    ///      contains no transfers.
    function finalise(uint256 poolId) external {
        Pool storage p = _get(poolId);
        if (p.state != State.Open) revert WrongState();
        if (block.timestamp < p.deadline) revert DeadlineNotReached();

        p.state = State.Finalised;

        address[] storage list = _members[poolId];
        uint256 forfeited;
        uint32 winners;
        uint256 winningStake;

        for (uint256 i; i < list.length; i++) {
            Member storage m = _member[poolId][list[i]];
            // The grace rule, in one line. Addition rather than subtraction so
            // graceDays > requiredDays could not underflow — though createPool
            // rejects that case anyway.
            bool met = m.daysAttested + p.graceDays >= p.requiredDays;
            if (met) {
                m.succeeded = true;
                winners += 1;
                winningStake += p.stakePerMember;
            } else {
                forfeited += p.stakePerMember;
                emit StakeForfeited(poolId, list[i], p.stakePerMember);
            }
        }

        p.winners = winners;
        p.winningStakeTotal = winningStake;

        // If NOBODY met the rule there is nobody to redistribute to. The
        // forfeited stakes stay claimable by the people who posted them: this
        // contract will not keep money it has no rule for, and "everyone
        // failed" is not a reason to confiscate.
        if (winners == 0) {
            p.forfeited = 0;
            // Safe: createPool caps maxMembers at MAX_MEMBERS_CAP (20), and the
            // member list can never exceed it.
            // forge-lint: disable-next-line(unsafe-typecast)
            p.unclaimed = uint32(list.length);
        } else {
            p.forfeited = forfeited;
            p.unclaimed = winners;
        }

        emit PoolFinalised(poolId, winners, p.forfeited);
    }

    /// @notice Take your stake back, plus your share of the forfeits if you met
    ///         the rule.
    /// @dev Pull-based and once only. Checks, then effects, then the transfer.
    function claim(uint256 poolId) external nonReentrant {
        Pool storage p = _get(poolId);
        if (p.state != State.Finalised) revert WrongState();

        Member storage m = _member[poolId][msg.sender];
        if (!m.joined) revert NotMember();
        if (m.claimed) revert AlreadyClaimed();

        // A member who failed gets nothing — UNLESS nobody succeeded, in which
        // case finalise left every stake claimable by its owner.
        bool everybodyFailed = p.winners == 0;
        if (!m.succeeded && !everybodyFailed) {
            m.claimed = true;
            emit Claimed(poolId, msg.sender, 0, 0);
            return;
        }

        m.claimed = true;

        uint256 stakeBack = p.stakePerMember;
        uint256 bonus;
        if (m.succeeded && p.forfeited > 0) {
            p.unclaimed -= 1;
            // The last winner takes the rounding dust, so the pool empties
            // exactly and no paisa is stranded.
            bonus = p.unclaimed == 0 ? p.forfeited : (p.forfeited * p.stakePerMember) / p.winningStakeTotal;
            p.forfeited -= bonus;
        } else if (m.succeeded) {
            p.unclaimed -= 1;
        }

        uint256 payout = stakeBack + bonus;
        p.pot -= payout;

        emit Claimed(poolId, msg.sender, stakeBack, bonus);
        token.safeTransfer(msg.sender, payout);
    }

    // ───────────── views ─────────────

    function getPool(uint256 poolId) external view returns (Pool memory) {
        Pool storage p = _pools[poolId];
        if (p.state == State.None) revert PoolNotFound();
        return p;
    }

    function getMembers(uint256 poolId) external view returns (address[] memory) {
        return _members[poolId];
    }

    function getMember(uint256 poolId, address who) external view returns (Member memory) {
        return _member[poolId][who];
    }

    /// @notice How many more days this member needs. Zero means they are safe.
    function daysStillNeeded(uint256 poolId, address who) external view returns (uint32) {
        Pool storage p = _pools[poolId];
        uint32 have = _member[poolId][who].daysAttested + p.graceDays;
        if (have >= p.requiredDays) return 0;
        return p.requiredDays - have;
    }

    /// @notice Would this member meet the rule if the pool finalised now?
    function onTrack(uint256 poolId, address who) external view returns (bool) {
        Pool storage p = _pools[poolId];
        return _member[poolId][who].daysAttested + p.graceDays >= p.requiredDays;
    }

    /// @notice What `claim` would pay this member right now, stake and bonus.
    /// @dev Returns zeros before the pool is finalised, because the answer
    ///      genuinely is not known yet and a guess shown in a UI would be
    ///      read as a promise.
    function claimableOf(uint256 poolId, address who) external view returns (uint256 stakeBack, uint256 bonus) {
        Pool storage p = _pools[poolId];
        if (p.state != State.Finalised) return (0, 0);

        Member storage m = _member[poolId][who];
        if (!m.joined || m.claimed) return (0, 0);

        bool everybodyFailed = p.winners == 0;
        if (!m.succeeded && !everybodyFailed) return (0, 0);

        stakeBack = p.stakePerMember;
        if (m.succeeded && p.forfeited > 0) {
            bonus = p.unclaimed == 1 ? p.forfeited : (p.forfeited * p.stakePerMember) / p.winningStakeTotal;
        }
    }

    function memberCount(uint256 poolId) external view returns (uint256) {
        return _members[poolId].length;
    }

    // ───────────── internal ─────────────

    function _get(uint256 poolId) internal view returns (Pool storage p) {
        p = _pools[poolId];
        if (p.state == State.None) revert PoolNotFound();
    }
}
