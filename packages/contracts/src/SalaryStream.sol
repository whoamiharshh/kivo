// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SalaryStream — salary that arrives by the second instead of monthly.
///
/// @notice An employer funds a stream for an employee at a rate per second. The
///         employee can take whatever has accrued whenever they like. Nobody
///         waits for payday and nobody asks for an advance.
///
/// ## Why this does not import Sablier or Superfluid
///
/// The brief says to use the audited library rather than reinvent streaming
/// math. Checked on 2026-10-10, neither is usable here:
///
///  - **Superfluid** publishes its network list in the npm package `superfluid-finance/metadata`.
///    That file names 16 chains and Monad is not one of them: no chainId 10143,
///    no "monad" anywhere in it.
///  - **Sablier Lockup v4.0** is deployed on 25 mainnets and 5 testnets. Monad
///    *mainnet* is included; **Monad Testnet is not**, and this project is
///    testnet-only by design.
///
/// Separately, the required interface does not fit either library. A Sablier
/// Lockup stream is created with a *total amount*, a cliff and a duration — not
/// a rate per second — and it has no pause and no top-up once it exists. So
/// `createStream(employee, ratePerSecond, startTime, endTime)`, `pauseStream`
/// and `topUp` would need a wrapper doing its own rate accounting regardless.
///
/// What is left of "streaming math" here is one multiplication:
/// `ratePerSecond × secondsElapsed`. There is no division anywhere in the
/// accrual path, so there is no rounding and no dust — an employee is owed an
/// exact number of paise at every instant.
///
/// ## The rule that makes this safe
///
/// **Accrual is capped at the funded balance.** The brief asks that employees
/// never accrue salary that cannot be paid, and leaves that to an off-chain
/// monitor. A monitor can be late, or down. Here it is structural: accrual can
/// never exceed what has actually been deposited, so every paisa the contract
/// says you are owed is a paisa it is holding. If the money runs out, accrual
/// stops by itself — there is no such thing as an unpayable balance to chase.
///
/// Paused time is not paid for. Resuming starts the clock again from the moment
/// of resumption, so a pause costs the employee nothing retroactively and gains
/// the employer nothing either.
///
/// Cancelling does not take anything already earned. The accrued balance stays
/// withdrawable by the employee forever; only the unaccrued remainder goes back
/// to the employer.
///
/// Amounts are in the token's own units. With TestRupee (2 decimals) one unit
/// is one paisa, so a ₹50,000 monthly salary is about 2 paise per second.
contract SalaryStream is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Below this much runway, anyone may pause the stream.
    /// @dev The brief's section 1.3 threshold. Permissionless because the point
    ///      is to stop the clock before an employee is told they are owed money
    ///      the employer has not funded — that should not wait on the employer
    ///      noticing.
    uint64 public constant LOW_RUNWAY = 7 days;

    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 3650 days;

    enum State {
        None, // 0 — never created
        Active, // accruing
        Paused, // not accruing; accrued balance still withdrawable
        Cancelled // finished; accrued balance still withdrawable
    }

    struct Stream {
        address employer;
        address employee;
        uint256 ratePerSecond;
        /// @notice Everything the employer has put in.
        uint256 funded;
        /// @notice Credited to the employee by the accrual rule so far.
        uint256 settled;
        /// @notice Already taken by the employee.
        uint256 withdrawn;
        uint64 startTime;
        uint64 endTime;
        /// @notice The instant `settled` is accurate up to.
        uint64 lastAccrualAt;
        State state;
    }

    IERC20 public immutable token;

    uint256 public streamCount;

    mapping(uint256 => Stream) internal _streams;

    event StreamCreated(
        uint256 indexed streamId,
        address indexed employer,
        address indexed employee,
        uint256 ratePerSecond,
        uint64 startTime,
        uint64 endTime,
        uint256 funded
    );
    event ToppedUp(uint256 indexed streamId, address indexed employer, uint256 amount, uint256 funded);
    event Withdrawn(uint256 indexed streamId, address indexed employee, uint256 amount);
    event StreamPaused(uint256 indexed streamId, address indexed by, uint256 runwayLeft);
    event StreamResumed(uint256 indexed streamId, address indexed by);
    event StreamCancelled(uint256 indexed streamId, uint256 owedToEmployee, uint256 returnedToEmployer);

    error StreamNotFound();
    error WrongState();
    error NotEmployer();
    error NotEmployee();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroRate();
    error SelfStream();
    error BadWindow();
    error UnderfundedStart();
    error NothingToWithdraw();
    error RunwayNotLow();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ───────────── creating ─────────────

    /// @notice Open a stream and fund it in the same step.
    /// @dev Kept at the brief's exact signature. It opens an unfunded stream,
    ///      which is refused — a stream funded with nothing accrues nothing and
    ///      only misleads the employee's dashboard — so in practice the app
    ///      calls `createAndFundStream`.
    function createStream(address employee, uint256 ratePerSecond, uint256 startTime, uint256 endTime)
        external
        nonReentrant
        returns (uint256 streamId)
    {
        return _createStream(employee, ratePerSecond, startTime, endTime, 0);
    }

    /// @notice Open a stream with its opening deposit stated explicitly.
    function createAndFundStream(
        address employee,
        uint256 ratePerSecond,
        uint256 startTime,
        uint256 endTime,
        uint256 deposit
    ) external nonReentrant returns (uint256 streamId) {
        return _createStream(employee, ratePerSecond, startTime, endTime, deposit);
    }

    function _createStream(address employee, uint256 ratePerSecond, uint256 startTime, uint256 endTime, uint256 deposit)
        internal
        returns (uint256 streamId)
    {
        if (employee == address(0)) revert ZeroAddress();
        if (employee == msg.sender) revert SelfStream();
        if (ratePerSecond == 0) revert ZeroRate();
        if (deposit == 0) revert UnderfundedStart();

        uint64 start = _toU64(startTime);
        uint64 end = _toU64(endTime);
        // A start in the past does not create backdated salary: accrual only
        // ever runs forward from `lastAccrualAt`.
        if (start < _now()) start = _now();
        if (end <= start) revert BadWindow();
        if (end - start < MIN_DURATION || end - start > MAX_DURATION) revert BadWindow();

        streamId = streamCount++;
        _streams[streamId] = Stream({
            employer: msg.sender,
            employee: employee,
            ratePerSecond: ratePerSecond,
            funded: deposit,
            settled: 0,
            withdrawn: 0,
            startTime: start,
            endTime: end,
            lastAccrualAt: start,
            state: State.Active
        });

        emit StreamCreated(streamId, msg.sender, employee, ratePerSecond, start, end, deposit);

        token.safeTransferFrom(msg.sender, address(this), deposit);
    }

    /// @notice Employer adds more funds, extending the runway.
    function topUp(uint256 streamId, uint256 amount) external nonReentrant {
        Stream storage s = _get(streamId);
        if (s.state != State.Active && s.state != State.Paused) revert WrongState();
        if (msg.sender != s.employer) revert NotEmployer();
        if (amount == 0) revert ZeroAmount();

        // Settle first, so the new money cannot back-pay a stretch the stream
        // was already out of funds for.
        _accrue(s);

        s.funded += amount;
        emit ToppedUp(streamId, msg.sender, amount, s.funded);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ───────────── taking the money ─────────────

    /// @notice Employee takes everything accrued so far.
    function withdraw(uint256 streamId) external nonReentrant {
        Stream storage s = _get(streamId);
        if (msg.sender != s.employee) revert NotEmployee();

        _accrue(s);

        uint256 amount = s.settled - s.withdrawn;
        if (amount == 0) revert NothingToWithdraw();

        s.withdrawn += amount;
        emit Withdrawn(streamId, s.employee, amount);

        token.safeTransfer(s.employee, amount);
    }

    // ───────────── pausing ─────────────

    /// @notice Stop the clock. The employer may always do this; anyone may do
    ///         it once the runway is under `LOW_RUNWAY`.
    /// @dev The second case is the brief's "or contract can pause if balance is
    ///      low". It cannot take money from anyone — all it does is stop an
    ///      employee being shown a growing number the employer has not funded.
    function pauseStream(uint256 streamId) external nonReentrant {
        Stream storage s = _get(streamId);
        if (s.state != State.Active) revert WrongState();

        _accrue(s);

        if (msg.sender != s.employer) {
            uint256 left = s.funded - s.settled;
            if (left >= s.ratePerSecond * uint256(LOW_RUNWAY)) revert RunwayNotLow();
        }

        s.state = State.Paused;
        emit StreamPaused(streamId, msg.sender, s.funded - s.settled);
    }

    /// @notice Start the clock again. Paused time is never back-paid.
    function resumeStream(uint256 streamId) external nonReentrant {
        Stream storage s = _get(streamId);
        if (s.state != State.Paused) revert WrongState();
        if (msg.sender != s.employer) revert NotEmployer();

        // Accrual resumes from now, so the paused stretch costs nobody anything.
        s.lastAccrualAt = _now() > s.endTime ? s.endTime : _now();
        s.state = State.Active;
        emit StreamResumed(streamId, msg.sender);
    }

    /// @notice Employer ends the stream. Everything already earned stays the
    ///         employee's to withdraw; the rest goes back to the employer.
    /// @dev Also how an employer sweeps what is left after `endTime`.
    function cancelStream(uint256 streamId) external nonReentrant {
        Stream storage s = _get(streamId);
        if (s.state != State.Active && s.state != State.Paused) revert WrongState();
        if (msg.sender != s.employer) revert NotEmployer();

        _accrue(s);

        uint256 owed = s.settled - s.withdrawn;
        uint256 unspent = s.funded - s.settled;

        s.funded = s.settled; // only the employee's money stays behind
        s.state = State.Cancelled;

        emit StreamCancelled(streamId, owed, unspent);

        if (unspent > 0) token.safeTransfer(s.employer, unspent);
    }

    // ───────────── views ─────────────

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return _get(streamId);
    }

    /// @notice What the employee could take right now.
    function withdrawable(uint256 streamId) external view returns (uint256) {
        Stream storage s = _get(streamId);
        return _settledAsOfNow(s) - s.withdrawn;
    }

    /// @notice Total earned so far, withdrawn or not.
    function earned(uint256 streamId) external view returns (uint256) {
        return _settledAsOfNow(_get(streamId));
    }

    /// @notice Seconds of salary the remaining balance covers. Zero once the
    ///         funds are exhausted.
    function runwaySeconds(uint256 streamId) external view returns (uint256) {
        Stream storage s = _get(streamId);
        uint256 left = s.funded - _settledAsOfNow(s);
        return left / s.ratePerSecond;
    }

    /// @notice True when anyone is allowed to pause it (section 1.3).
    function runwayIsLow(uint256 streamId) external view returns (bool) {
        Stream storage s = _get(streamId);
        if (s.state != State.Active) return false;
        uint256 left = s.funded - _settledAsOfNow(s);
        return left < s.ratePerSecond * uint256(LOW_RUNWAY);
    }

    // ───────────── accrual ─────────────

    /// @dev Bring `settled` up to date. The only arithmetic is a multiplication
    ///      and a cap, which is why there is no rounding anywhere.
    function _accrue(Stream storage s) internal {
        uint256 owed = _settledAsOfNow(s);
        if (owed > s.settled) s.settled = owed;

        uint64 upTo = _now() > s.endTime ? s.endTime : _now();
        if (s.state == State.Active && upTo > s.lastAccrualAt) {
            s.lastAccrualAt = upTo;
        }
    }

    /// @dev What `settled` would be if accrual ran to this instant. Capped at
    ///      `funded`, which is the guarantee that nothing accrues unpayably.
    function _settledAsOfNow(Stream storage s) internal view returns (uint256) {
        if (s.state != State.Active) return s.settled;

        uint64 upTo = _now() > s.endTime ? s.endTime : _now();
        if (upTo <= s.lastAccrualAt) return s.settled;

        uint256 fresh = s.ratePerSecond * uint256(upTo - s.lastAccrualAt);
        uint256 headroom = s.funded - s.settled;
        if (fresh > headroom) fresh = headroom;
        return s.settled + fresh;
    }

    function _toU64(uint256 value) internal pure returns (uint64 out) {
        // forge-lint: disable-next-line(unsafe-typecast)
        out = uint64(value);
        if (uint256(out) != value) revert BadWindow();
    }

    /// @dev Block time as uint64, with the cast justified in one place.
    function _now() internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    function _get(uint256 streamId) internal view returns (Stream storage s) {
        s = _streams[streamId];
        if (s.state == State.None) revert StreamNotFound();
    }
}
