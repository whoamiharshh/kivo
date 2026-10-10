// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SocialPay — money that is held until the other person says it arrived.
/// @notice You send a friend money. It does not land in their account yet: the
///         contract holds it until they confirm they got it. If they never
///         confirm, you take it back after an agreed window. Nobody has to
///         chase anybody.
///
/// Lifecycle of a direct payment:
///
///   Held --(recipient confirms)------------------> Confirmed
///     |                                              ^
///     |--(window passed, sender reclaims)--> Reclaimed
///     |
///     |--(either party disputes)--> Disputed --(two of three agree)--> Resolved
///
/// Lifecycle of a payment to someone who has not registered yet:
///
///   Claimable --(recipient presents the claim secret)--> Claimed
///        |
///        +--(expiry passed, sender reclaims)----------> Reclaimed
///
/// Rules that must stay true:
///  - Money leaves this contract only to the payment's sender or its recipient.
///  - A payment is only ever settled once. Every function checks the state it
///    requires, so confirming twice, reclaiming after confirming, or disputing
///    a settled payment all revert.
///  - A sender cannot reclaim before the window they themselves chose has
///    passed. There is no way for a sender to pull money back early.
///  - A recipient may confirm at any time until the sender actually reclaims.
///    Passing the deadline does not void the payment, it only unlocks the
///    sender's option — whoever acts first wins, and both outcomes are honest.
///  - Only the sender's own money is ever at stake. There is no admin that can
///    move a held payment, including the arbitrator: all it can do is pick
///    which of the two parties receives it.
///
/// On "the arbitrator multisig": resolution here is two-of-three between the
/// sender, the recipient and the platform arbitrator, and `resolveDispute` is
/// callable only by those three. Any two agreeing on the same outcome settles
/// it, so the arbitrator alone cannot decide, and the two parties can settle
/// between themselves without the platform at all. This is a placeholder for a
/// decentralised arbitration layer (Kleros or equivalent) — see
/// docs/limitations.md.
///
/// On the claim secret: `claimHash` is not a secret. It is stored so a claimer's
/// secret can be checked, and the secret itself becomes visible in calldata the
/// moment someone claims. It is single-use and expiring, which is what bounds
/// the exposure. The secret is 32 bytes from a cryptographically secure source
/// in the app, so it cannot be guessed from a payment's id or timing.
///
/// Amounts are in the token's own units. With TestRupee (2 decimals) one unit
/// is one paisa, so ₹1,200 is 120000.
contract SocialPay is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Stops a mistyped window from holding money for a decade, and stops
    ///      a zero window from making "held until confirmed" meaningless.
    uint64 public constant MIN_CONFIRM_WINDOW = 1 hours;
    uint64 public constant MAX_CONFIRM_WINDOW = 30 days;

    /// @dev How long an unregistered recipient has to come and claim.
    uint64 public constant CLAIM_EXPIRY = 30 days;

    enum State {
        None, // 0 — never created
        Held, // direct payment, waiting for the recipient to confirm
        Claimable, // waiting for an unregistered recipient to claim
        Confirmed, // recipient confirmed; money released to them
        Claimed, // claim secret presented; money released to the claimer
        Reclaimed, // window or expiry passed; money returned to the sender
        Disputed, // frozen, waiting for two of three to agree
        Resolved // dispute settled; money moved to one of the two parties
    }

    /// @dev Which way a disputing party voted. `None` means they have not voted.
    enum Vote {
        None,
        ToRecipient,
        ToSender
    }

    struct Payment {
        address sender;
        /// @dev Zero for a claimable payment until someone claims it.
        address recipient;
        uint256 amount;
        bytes32 memoHash;
        /// @dev Zero for a direct payment.
        bytes32 claimHash;
        uint64 createdAt;
        /// @dev End of the confirmation window, or the claim expiry.
        uint64 deadline;
        State state;
    }

    IERC20 public immutable token;

    /// @notice The platform's seat in the two-of-three. Fixed at deployment so
    ///         nobody can swap in a friendlier arbitrator later.
    address public immutable arbitrator;

    /// @notice Number of payments ever created; also the next payment's id.
    uint256 public paymentCount;

    mapping(uint256 => Payment) internal _payments;
    mapping(uint256 => mapping(address => Vote)) public voteOf;

    event PaymentInitiated(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        bytes32 memoHash,
        uint64 deadline
    );
    event ClaimablePaymentCreated(
        uint256 indexed paymentId,
        address indexed sender,
        uint256 amount,
        bytes32 memoHash,
        bytes32 claimHash,
        uint64 expiresAt
    );
    event PaymentConfirmed(uint256 indexed paymentId, address indexed recipient, uint256 amount);
    event PaymentClaimed(uint256 indexed paymentId, address indexed recipient, uint256 amount);
    event PaymentReclaimed(uint256 indexed paymentId, address indexed sender, uint256 amount);
    event PaymentDisputed(uint256 indexed paymentId, address indexed by);
    event DisputeVoteCast(uint256 indexed paymentId, address indexed voter, bool releaseToRecipient);
    event DisputeResolved(uint256 indexed paymentId, address indexed paidTo, uint256 amount);

    error PaymentNotFound();
    error WrongState();
    error ZeroAmount();
    error ZeroAddress();
    error SelfPayment();
    error WindowOutOfRange();
    error NotSender();
    error NotRecipient();
    error NotParty();
    error NotResolver();
    error TooEarly();
    error Expired();
    error ClaimHashZero();
    error BadClaimSecret();
    error CannotClaimOwnPayment();
    error AlreadyVoted();

    constructor(IERC20 token_, address arbitrator_) {
        if (address(token_) == address(0) || arbitrator_ == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        arbitrator = arbitrator_;
    }

    // ───────────── sending ─────────────

    /// @notice Send money to someone, held until they confirm it arrived.
    /// @param recipient who the money is for. Must not be you.
    /// @param amount in token units (paise with TestRupee).
    /// @param memoHash keccak256 of what it was for; the text stays off-chain.
    /// @param confirmWindow seconds the recipient has before you may reclaim.
    /// @return paymentId the new payment's id.
    function sendPayment(address recipient, uint256 amount, bytes32 memoHash, uint256 confirmWindow)
        external
        nonReentrant
        returns (uint256 paymentId)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == msg.sender) revert SelfPayment();
        if (amount == 0) revert ZeroAmount();
        if (confirmWindow < MIN_CONFIRM_WINDOW || confirmWindow > MAX_CONFIRM_WINDOW) {
            revert WindowOutOfRange();
        }

        paymentId = paymentCount++;
        // confirmWindow is bounded by MAX_CONFIRM_WINDOW just above, so this
        // cast cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 deadline = _now() + uint64(confirmWindow);

        _payments[paymentId] = Payment({
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            memoHash: memoHash,
            claimHash: bytes32(0),
            createdAt: _now(),
            deadline: deadline,
            state: State.Held
        });

        emit PaymentInitiated(paymentId, msg.sender, recipient, amount, memoHash, deadline);

        // Interaction last: the record is already written, so a token that
        // calls back in finds a consistent state, and nonReentrant blocks it.
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Send money to someone who has not registered yet.
    /// @dev The recipient is whoever presents the secret behind `claimHash`
    ///      before the expiry. Until then the money is held here, and after it
    ///      the sender can take it back.
    /// @param claimHash keccak256(abi.encodePacked(claimSecret)).
    function createClaimablePayment(bytes32 claimHash, uint256 amount, bytes32 memoHash)
        external
        nonReentrant
        returns (uint256 paymentId)
    {
        if (claimHash == bytes32(0)) revert ClaimHashZero();
        if (amount == 0) revert ZeroAmount();

        paymentId = paymentCount++;
        uint64 expiresAt = _now() + CLAIM_EXPIRY;

        _payments[paymentId] = Payment({
            sender: msg.sender,
            recipient: address(0),
            amount: amount,
            memoHash: memoHash,
            claimHash: claimHash,
            createdAt: _now(),
            deadline: expiresAt,
            state: State.Claimable
        });

        emit ClaimablePaymentCreated(paymentId, msg.sender, amount, memoHash, claimHash, expiresAt);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ───────────── settling ─────────────

    /// @notice Recipient says the money arrived; it is released to them.
    /// @dev Allowed even after the window has passed, as long as the sender has
    ///      not already reclaimed. The deadline unlocks the sender's option, it
    ///      does not cancel the payment.
    function confirmReceipt(uint256 paymentId) external nonReentrant {
        Payment storage p = _get(paymentId);
        if (p.state != State.Held) revert WrongState();
        if (msg.sender != p.recipient) revert NotRecipient();

        p.state = State.Confirmed;
        uint256 amount = p.amount;

        emit PaymentConfirmed(paymentId, p.recipient, amount);
        token.safeTransfer(p.recipient, amount);
    }

    /// @notice Present the secret from a share link and take the money.
    function claimPayment(uint256 paymentId, bytes32 claimSecret) external nonReentrant {
        Payment storage p = _get(paymentId);
        if (p.state != State.Claimable) revert WrongState();
        if (block.timestamp >= p.deadline) revert Expired();
        if (msg.sender == p.sender) revert CannotClaimOwnPayment();
        if (keccak256(abi.encodePacked(claimSecret)) != p.claimHash) {
            revert BadClaimSecret();
        }

        p.recipient = msg.sender;
        p.state = State.Claimed;
        uint256 amount = p.amount;

        emit PaymentClaimed(paymentId, msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    /// @notice Sender takes the money back: the window passed without a
    ///         confirmation, or a claimable payment expired unclaimed.
    function reclaim(uint256 paymentId) external nonReentrant {
        Payment storage p = _get(paymentId);
        if (p.state != State.Held && p.state != State.Claimable) revert WrongState();
        if (msg.sender != p.sender) revert NotSender();
        if (block.timestamp < p.deadline) revert TooEarly();

        p.state = State.Reclaimed;
        uint256 amount = p.amount;

        emit PaymentReclaimed(paymentId, p.sender, amount);
        token.safeTransfer(p.sender, amount);
    }

    // ───────────── disputes ─────────────

    /// @notice Either party freezes the payment pending resolution.
    /// @dev Only a held payment can be disputed: once it is confirmed,
    ///      reclaimed or claimed the money has already moved, and there is
    ///      nothing here to freeze.
    function dispute(uint256 paymentId) external {
        Payment storage p = _get(paymentId);
        if (p.state != State.Held) revert WrongState();
        if (msg.sender != p.sender && msg.sender != p.recipient) revert NotParty();

        p.state = State.Disputed;
        emit PaymentDisputed(paymentId, msg.sender);
    }

    /// @notice Vote on where a disputed payment should go. Two matching votes
    ///         from the sender, the recipient and the arbitrator settle it.
    /// @dev The arbitrator cannot decide alone, and the two parties can agree
    ///      without the platform. Nobody may vote twice, and no vote can send
    ///      the money anywhere but to one of the two parties.
    function resolveDispute(uint256 paymentId, bool releaseToRecipient) external nonReentrant {
        Payment storage p = _get(paymentId);
        if (p.state != State.Disputed) revert WrongState();
        if (msg.sender != p.sender && msg.sender != p.recipient && msg.sender != arbitrator) {
            revert NotResolver();
        }
        if (voteOf[paymentId][msg.sender] != Vote.None) revert AlreadyVoted();

        Vote cast = releaseToRecipient ? Vote.ToRecipient : Vote.ToSender;
        voteOf[paymentId][msg.sender] = cast;
        emit DisputeVoteCast(paymentId, msg.sender, releaseToRecipient);

        // Two of the three seats agreeing is the threshold. Counting three
        // fixed addresses is not a loop over user input.
        uint256 agreeing;
        if (voteOf[paymentId][p.sender] == cast) agreeing++;
        if (voteOf[paymentId][p.recipient] == cast) agreeing++;
        if (voteOf[paymentId][arbitrator] == cast) agreeing++;
        if (agreeing < 2) return;

        address paidTo = releaseToRecipient ? p.recipient : p.sender;
        uint256 amount = p.amount;
        p.state = State.Resolved;

        emit DisputeResolved(paymentId, paidTo, amount);
        token.safeTransfer(paidTo, amount);
    }

    // ───────────── views ─────────────

    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        return _get(paymentId);
    }

    /// @notice True while the money is still sitting here.
    function isOpen(uint256 paymentId) external view returns (bool) {
        State s = _get(paymentId).state;
        return s == State.Held || s == State.Claimable || s == State.Disputed;
    }

    /// @notice Seconds until the sender may reclaim, or 0 if they already may.
    function timeUntilReclaimable(uint256 paymentId) external view returns (uint64) {
        Payment storage p = _get(paymentId);
        if (block.timestamp >= p.deadline) return 0;
        return p.deadline - _now();
    }

    /// @dev Block time as uint64, with the cast justified in one place rather
    ///      than six. uint64 seconds runs out in the year 584 billion.
    function _now() internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    function _get(uint256 paymentId) internal view returns (Payment storage p) {
        p = _payments[paymentId];
        if (p.state == State.None) revert PaymentNotFound();
    }
}
