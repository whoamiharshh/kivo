// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title BehaviourSavings — save toward a goal, with a stake on following through.
///
/// @notice THIS IS A COMMITMENT CONTRACT WITH A SAVINGS WRAPPER. It is not a
///         yield product and there is no interest anywhere in it.
///
/// Where the money comes from: **from savers who did not meet their goal.**
/// Nothing else funds the bonus — no sponsor, no fund, no venture subsidy. If
/// everybody in a cohort succeeds, there is no bonus, because nothing was
/// forfeited. That is the honest arithmetic of redistribution and the UI must
/// say so rather than implying a return appears from somewhere.
///
/// The one rule that makes this a savings product rather than a wager:
///
///   **Principal is always returned in full, success or failure.**
///
/// Everything you deposit toward your target comes back to you. The only money
/// at risk is a separate commitment stake, taken when the goal is created and
/// fixed at STAKE_BPS of the target. Miss your goal and you lose the stake, not
/// your savings. Hit it and you get the stake back plus a share of the stakes
/// forfeited by those who missed.
///
/// How "behaviour" is verified:
///
///   SaveConsistently  The chain already knows. Reaching the target across at
///                     least MIN_DEPOSITS separate deposits before the deadline
///                     is a fact in storage — no server, no oracle, no device,
///                     nobody to trust.
///   ExternalSignal    An APPROVED verifier signs that something off-chain
///                     happened. The signature is checked here, but the
///                     contract cannot know whether the signal was real. See
///                     docs/limitations.md. Do not use this to claim device
///                     integrity: no attested signal source exists in this
///                     repository yet.
///
/// Who may verify, and why the saver does not choose:
///
/// An earlier version of this contract let whoever created a goal name its own
/// verifier. That was a hole, not a feature. Money here moves BETWEEN savers:
/// stakes forfeited by people who missed their goals are shared out among the
/// people who met theirs. So a saver who could appoint their own verifier could
/// sign their own success, be certain of winning, and take a share of strangers'
/// forfeited stakes at no risk. Naming a second address they control defeats
/// any "verifier != user" check, so the fix cannot be a comparison.
///
/// Instead there is a registry. `admin` approves verifier addresses and picks
/// which approved address new ExternalSignal goals are assigned to; a saver
/// passes no verifier at all and cannot influence the choice. The assignment is
/// SNAPSHOTTED onto the goal at creation, so changing the registry later cannot
/// retarget a goal that is already open.
///
/// What `admin` can and cannot do, precisely. It can approve a verifier,
/// revoke one, and set which approved verifier new goals get. It cannot create,
/// finalise or settle a goal, cannot sign a behaviour signal (unless it also
/// registers itself, which is visible on-chain), cannot move a single token out
/// of this contract, and cannot be changed — the key is immutable, so rotating
/// it means redeploying. Revoking a verifier stops it being assigned to NEW
/// goals; it deliberately does NOT invalidate open goals that already point at
/// it, because that would let an admin force savers to forfeit stakes they were
/// on course to keep.
///
/// Cohorts: goals that share an identical deadline form a cohort, and
/// redistribution happens strictly within it. A forfeited stake can only ever
/// reach somebody who committed to the same date, which is the only grouping
/// that makes "they failed, so you gain" defensible.
///
/// If a cohort has no successful savers, the forfeited stakes go back to the
/// people who posted them. There is nobody to redistribute to, and this
/// contract will not keep money it has no rule for.
///
/// Settlement is two steps on purpose. A pro-rata share cannot be computed
/// until every goal in the cohort has been finalised, and paying an unbounded
/// number of savers in one transaction is exactly the loop this codebase does
/// not allow. So `finalise` tallies one goal and returns its principal;
/// `claimOutcome` pays the stake and any bonus once the cohort is complete.
///
/// Amounts are in the token's own units. With TestRupee (2 decimals) one unit
/// is one paisa, so ₹5,000 is 500000.
contract BehaviourSavings is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The commitment stake, in basis points of the target. 10%.
    /// @dev The spec's `createSavingsGoal` signature carries no stake
    ///      parameter, so it is derived from the target rather than invented
    ///      per goal. One documented constant beats a magic number per call.
    uint256 public constant STAKE_BPS = 1000;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice How many separate deposits "saving consistently" takes.
    /// @dev Also absent from the spec's signature, for the same reason. Four
    ///      deposits is what makes the behaviour a habit rather than one
    ///      transfer on the last day.
    uint32 public constant MIN_DEPOSITS = 4;

    uint64 public constant MIN_DURATION = 1 days;
    uint64 public constant MAX_DURATION = 365 days;

    enum BehaviourType {
        SaveConsistently, // 0 — verified from this contract's own records
        ExternalSignal // 1 — verified by a named signer, off-chain
    }

    enum State {
        None, // 0 — never created
        Open, // saving; the deadline has not passed
        Finalised, // outcome known, principal returned, stake still here
        Settled // stake and any bonus paid out
    }

    struct Goal {
        address user;
        /// @notice Who may sign an ExternalSignal, snapshotted from the
        ///         registry at creation. Zero for SaveConsistently.
        address verifier;
        uint256 target;
        /// @notice At risk. Never taken from `saved`.
        uint256 stake;
        /// @notice Principal. Always returned in full.
        uint256 saved;
        uint64 deadline;
        uint32 depositCount;
        BehaviourType behaviour;
        bool behaviourVerified;
        bool succeeded;
        State state;
    }

    /// @dev Everyone who committed to the same deadline.
    struct Cohort {
        uint32 goalCount;
        uint32 finalisedCount;
        /// @notice Successful goals that have not claimed yet.
        uint32 winnersRemaining;
        /// @notice Stakes forfeited by goals that missed.
        uint256 forfeitedPool;
        /// @notice What is left of that pool to hand out.
        uint256 poolRemaining;
        /// @notice Sum of the stakes of successful goals.
        uint256 winningStakeTotal;
    }

    IERC20 public immutable token;

    /// @notice May approve verifiers and choose the one new goals are assigned.
    ///         Cannot touch money. Immutable: rotation means redeployment.
    address public immutable admin;

    /// @notice Addresses the admin has approved to sign behaviour signals.
    mapping(address => bool) public approvedVerifier;

    /// @notice The approved verifier that new ExternalSignal goals are assigned
    ///         to. Zero means ExternalSignal goals cannot be created at all,
    ///         which is the honest default for a fresh deployment.
    address public behaviourVerifier;

    uint256 public goalCount;

    mapping(uint256 => Goal) internal _goals;
    mapping(uint64 => Cohort) internal _cohorts;

    event GoalCreated(
        uint256 indexed goalId,
        address indexed user,
        uint256 target,
        uint256 stake,
        uint64 deadline,
        BehaviourType behaviour,
        address verifier
    );
    event Deposited(
        uint256 indexed goalId, address indexed user, uint256 amount, uint256 savedTotal, uint32 depositCount
    );
    event BehaviourSubmitted(uint256 indexed goalId, bytes32 signalHash, address indexed verifier);
    event VerifierApproved(address indexed verifier);
    event VerifierRevoked(address indexed verifier);
    event BehaviourVerifierSet(address indexed previous, address indexed current);
    event GoalFinalised(uint256 indexed goalId, bool succeeded, uint256 principalReturned);
    event OutcomeSettled(uint256 indexed goalId, uint256 stakeReturned, uint256 bonus);
    event StakeForfeited(uint256 indexed goalId, uint256 stake);

    error GoalNotFound();
    error WrongState();
    error NotYourGoal();
    error ZeroAmount();
    error ZeroAddress();
    error TargetTooSmall();
    error DurationOutOfRange();
    error DeadlinePassed();
    error DeadlineNotReached();
    error CohortNotComplete();
    error VerifierRequired();
    error VerifierNotApproved();
    error SelfVerification();
    error NotAdmin();
    error AlreadySet();
    error BehaviourNotSignable();
    error BadSignature();
    error AlreadyVerified();
    error NothingToClaim();

    constructor(IERC20 token_, address admin_) {
        if (address(token_) == address(0) || admin_ == address(0)) revert ZeroAddress();
        token = token_;
        admin = admin_;
    }

    // ───────────── who may verify ─────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @notice Add an address to the set allowed to sign behaviour signals.
    /// @dev Approving does not assign it to anything. `setBehaviourVerifier`
    ///      is the separate, deliberate second step.
    function registerVerifier(address verifier) external onlyAdmin {
        if (verifier == address(0)) revert ZeroAddress();
        if (approvedVerifier[verifier]) revert AlreadySet();
        approvedVerifier[verifier] = true;
        emit VerifierApproved(verifier);
    }

    /// @notice Remove an address from the approved set.
    /// @dev Open goals already pointing at it keep working. See the note at the
    ///      top of this file for why that is deliberate rather than an
    ///      oversight. If it is currently assigned, the assignment is cleared,
    ///      so no NEW goal can be given a revoked verifier.
    function revokeVerifier(address verifier) external onlyAdmin {
        if (!approvedVerifier[verifier]) revert VerifierNotApproved();
        approvedVerifier[verifier] = false;
        if (behaviourVerifier == verifier) {
            emit BehaviourVerifierSet(verifier, address(0));
            behaviourVerifier = address(0);
        }
        emit VerifierRevoked(verifier);
    }

    /// @notice Choose which approved verifier new ExternalSignal goals get.
    /// @dev Zero turns ExternalSignal goals off without revoking anybody.
    function setBehaviourVerifier(address verifier) external onlyAdmin {
        if (verifier != address(0) && !approvedVerifier[verifier]) revert VerifierNotApproved();
        emit BehaviourVerifierSet(behaviourVerifier, verifier);
        behaviourVerifier = verifier;
    }

    // ───────────── setting up ─────────────

    /// @notice Commit to saving `target` by `deadline`.
    /// @dev `user` must be the caller. The parameter is kept because it is in
    ///      the spec's signature, but creating a goal on somebody else's behalf
    ///      would let anyone spam goals against a stranger's address, so it is
    ///      rejected.
    ///
    ///      There is deliberately no verifier parameter. An ExternalSignal goal
    ///      is assigned the currently-registered `behaviourVerifier`, and the
    ///      saver has no say in it. See the note at the top of this file.
    /// @param behaviour SaveConsistently needs no verifier and is checked from
    ///        this contract's own deposit records. ExternalSignal is assigned
    ///        one from the registry, and reverts if none is set.
    function createSavingsGoal(address user, uint256 target, uint256 deadline, BehaviourType behaviour)
        external
        nonReentrant
        returns (uint256 goalId)
    {
        if (user == address(0)) revert ZeroAddress();
        if (user != msg.sender) revert NotYourGoal();

        // The stake must round to something, or "at risk" means nothing.
        uint256 stake = (target * STAKE_BPS) / BPS_DENOMINATOR;
        if (stake == 0) revert TargetTooSmall();

        uint64 due = uint64(deadline);
        if (deadline != uint256(due)) revert DurationOutOfRange();
        if (due < _now() + MIN_DURATION || due > _now() + MAX_DURATION) {
            revert DurationOutOfRange();
        }

        address verifier;
        if (behaviour == BehaviourType.ExternalSignal) {
            verifier = behaviourVerifier;
            if (verifier == address(0)) revert VerifierRequired();
            // Belt and braces. The admin should never assign a verifier that is
            // also saving here, but if it did, that saver must not get a goal
            // it can sign for itself.
            if (verifier == user) revert SelfVerification();
        }

        goalId = goalCount++;
        _goals[goalId] = Goal({
            user: user,
            verifier: verifier,
            target: target,
            stake: stake,
            saved: 0,
            deadline: due,
            depositCount: 0,
            behaviour: behaviour,
            behaviourVerified: false,
            succeeded: false,
            state: State.Open
        });

        _cohorts[due].goalCount += 1;

        emit GoalCreated(goalId, user, target, stake, due, behaviour, verifier);

        token.safeTransferFrom(msg.sender, address(this), stake);
    }

    // ───────────── saving ─────────────

    /// @notice Put money toward your target. Always yours, whatever happens.
    function deposit(uint256 goalId, uint256 amount) external nonReentrant {
        Goal storage g = _get(goalId);
        if (g.state != State.Open) revert WrongState();
        if (msg.sender != g.user) revert NotYourGoal();
        if (amount == 0) revert ZeroAmount();
        if (_now() >= g.deadline) revert DeadlinePassed();

        g.saved += amount;
        g.depositCount += 1;

        emit Deposited(goalId, msg.sender, amount, g.saved, g.depositCount);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Submit the verifier's signature that the off-chain behaviour
    ///         happened.
    /// @dev Anyone may relay it; the signature is what counts. A
    ///      SaveConsistently goal rejects this outright — its behaviour is
    ///      already a fact in storage and accepting a signature for it would
    ///      introduce a trusted party where none is needed.
    function submitBehaviour(uint256 goalId, bytes32 signalHash, bytes calldata signature) external {
        Goal storage g = _get(goalId);
        if (g.behaviour != BehaviourType.ExternalSignal) revert BehaviourNotSignable();
        if (g.state != State.Open) revert WrongState();
        if (_now() >= g.deadline) revert DeadlinePassed();
        if (g.behaviourVerified) revert AlreadyVerified();

        address signer = ECDSA.recover(behaviourDigest(goalId, signalHash), signature);
        if (signer != g.verifier) revert BadSignature();

        g.behaviourVerified = true;
        emit BehaviourSubmitted(goalId, signalHash, g.verifier);
    }

    /// @notice What a verifier has to sign. Bound to this contract, this chain
    ///         and this goal, so a signature cannot be replayed elsewhere.
    function behaviourDigest(uint256 goalId, bytes32 signalHash) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, goalId, signalHash))
        );
    }

    // ───────────── settling ─────────────

    /// @notice After the deadline: work out whether the goal was met, and hand
    ///         the principal straight back.
    /// @dev Permissionless. Anyone may finalise anyone's goal, because all it
    ///      can do is return that person's own savings to them and record the
    ///      outcome. Nobody has to wait on anybody.
    function finalise(uint256 goalId) external nonReentrant {
        Goal storage g = _get(goalId);
        if (g.state != State.Open) revert WrongState();
        if (_now() < g.deadline) revert DeadlineNotReached();

        bool met = g.saved >= g.target
            && (g.behaviour == BehaviourType.SaveConsistently ? g.depositCount >= MIN_DEPOSITS : g.behaviourVerified);

        g.succeeded = met;
        g.state = State.Finalised;

        Cohort storage c = _cohorts[g.deadline];
        c.finalisedCount += 1;
        if (met) {
            c.winnersRemaining += 1;
            c.winningStakeTotal += g.stake;
        } else {
            c.forfeitedPool += g.stake;
            c.poolRemaining += g.stake;
            emit StakeForfeited(goalId, g.stake);
        }

        uint256 principal = g.saved;
        emit GoalFinalised(goalId, met, principal);

        // Principal is never at risk, so it goes back the moment the outcome is
        // known, before any redistribution is worked out.
        if (principal > 0) token.safeTransfer(g.user, principal);
    }

    /// @notice Collect your stake, plus your share of the forfeited stakes if
    ///         you met your goal.
    /// @dev Only once every goal sharing your deadline has been finalised,
    ///      because the pool is not known until then. The last winner to claim
    ///      takes whatever is left, so rounding never strands a paisa.
    function claimOutcome(uint256 goalId) external nonReentrant {
        Goal storage g = _get(goalId);
        if (g.state != State.Finalised) revert WrongState();
        if (msg.sender != g.user) revert NotYourGoal();

        Cohort storage c = _cohorts[g.deadline];
        if (c.finalisedCount < c.goalCount) revert CohortNotComplete();

        uint256 stakeBack;
        uint256 bonus;

        if (g.succeeded) {
            stakeBack = g.stake;
            if (c.winnersRemaining == 1) {
                // Last one out takes the remainder, dust included.
                bonus = c.poolRemaining;
            } else if (c.winningStakeTotal > 0) {
                bonus = (c.forfeitedPool * g.stake) / c.winningStakeTotal;
            }
            c.poolRemaining -= bonus;
            c.winnersRemaining -= 1;
        } else if (c.winningStakeTotal == 0) {
            // Nobody in this cohort succeeded, so there is nobody to give the
            // forfeited stakes to. They go back where they came from.
            stakeBack = g.stake;
            c.poolRemaining -= g.stake;
        } else {
            // Missed the goal, and somebody else made it. The stake is theirs.
            revert NothingToClaim();
        }

        g.state = State.Settled;
        emit OutcomeSettled(goalId, stakeBack, bonus);

        uint256 total = stakeBack + bonus;
        if (total > 0) token.safeTransfer(g.user, total);
    }

    // ───────────── views ─────────────

    function getGoal(uint256 goalId) external view returns (Goal memory) {
        return _get(goalId);
    }

    function getCohort(uint64 deadline) external view returns (Cohort memory) {
        return _cohorts[deadline];
    }

    /// @notice Whether the goal would count as met if the deadline were now.
    function onTrack(uint256 goalId) external view returns (bool) {
        Goal storage g = _get(goalId);
        if (g.saved < g.target) return false;
        return g.behaviour == BehaviourType.SaveConsistently ? g.depositCount >= MIN_DEPOSITS : g.behaviourVerified;
    }

    /// @notice How much more, and how many more deposits, the goal still needs.
    function remaining(uint256 goalId) external view returns (uint256 amountLeft, uint32 depositsLeft) {
        Goal storage g = _get(goalId);
        amountLeft = g.saved >= g.target ? 0 : g.target - g.saved;
        if (g.behaviour == BehaviourType.SaveConsistently && g.depositCount < MIN_DEPOSITS) {
            depositsLeft = MIN_DEPOSITS - g.depositCount;
        }
    }

    /// @dev Block time as uint64, with the cast justified in one place.
    function _now() internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    function _get(uint256 goalId) internal view returns (Goal storage g) {
        g = _goals[goalId];
        if (g.state == State.None) revert GoalNotFound();
    }
}
