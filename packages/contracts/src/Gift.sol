// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Gift — money that unlocks when something happens.
/// @notice Someone puts money aside for a friend, to be released on a date, or
///         when an agreed thing happens. The money sits here in the meantime.
///         Nobody — not even the sender — can quietly change the deal
///         afterwards.
///
/// Three kinds of condition:
///
///   Time        the date arrives. Nothing to verify; the chain knows the time.
///   Event       something an API can check. A backend watches for it and signs.
///   Attestation something only a person can confirm. A named attester signs.
///
/// Event and Attestation are the same mechanism on-chain — a signature from one
/// named address — and differ only in who holds the key and what they are
/// attesting to. That difference is real, and it is documented in
/// docs/limitations.md rather than pretended away here.
///
/// What this contract guarantees:
///  - The condition is fixed when the gift is created. `conditionHash` can
///    never be rewritten, so the deal the recipient reads is the deal that
///    executes.
///  - Only the recipient can ever receive the money, except on a cancellation,
///    which returns it to the sender and is impossible once the condition is
///    met.
///  - An irrevocable gift cannot be cancelled. The sender is told which they
///    are choosing before they confirm, and the flag is immutable afterwards.
///  - A gift cannot be held hostage. If the attester never signs — they lost
///    the key, they refuse, they died — the recipient can release it themselves
///    after `TIMEOUT_PERIOD`.
///  - Signatures are bound to this contract, this chain and this gift id, so an
///    attestation cannot be replayed onto a different gift or a fork.
///
/// What it does NOT do: verify that the thing actually happened. It verifies
/// that the attester said so. See "What the contract cannot verify" in
/// docs/limitations.md.
///
/// Amounts are in the token's own units. With TestRupee (2 decimals) one unit
/// is one paisa, so ₹5,000 is 500000.
contract Gift is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice How long a recipient waits before they can release an
    ///         un-attested gift themselves. Two years, per the spec's default.
    uint64 public constant TIMEOUT_PERIOD = 730 days;

    /// @dev Stops a "time" gift being created with a date already gone, which
    ///      would make it instantly claimable and the condition meaningless.
    uint64 public constant MIN_RELEASE_DELAY = 1 hours;

    enum ConditionType {
        Time, // 0 — releases on a date
        Event, // 1 — an API-verifiable happening, signed by a backend
        Attestation // 2 — a person confirms it
    }

    enum State {
        None, // 0 — never created
        Pending, // waiting for the date, or for the attester
        Attested, // the condition was confirmed; the recipient may claim
        Claimed, // the recipient took it
        Cancelled, // the sender took it back (refundable gifts only)
        Released // the recipient took it via the timeout path
    }

    struct GiftRecord {
        address sender;
        address recipient;
        uint256 amount;
        /// @dev keccak256 of the agreed condition text, which stays off-chain.
        ///      The recipient checks the text they were shown against this.
        bytes32 conditionHash;
        /// @dev Only meaningful for a Time gift.
        uint64 releaseTime;
        /// @dev Zero for a Time gift; required otherwise.
        address attester;
        bool irrevocable;
        uint64 createdAt;
        /// @dev When the recipient may release it without an attestation.
        uint64 timeoutAt;
        ConditionType conditionType;
        State state;
    }

    IERC20 public immutable token;

    /// @notice Number of gifts ever created; also the next gift's id.
    uint256 public giftCount;

    mapping(uint256 => GiftRecord) internal _gifts;

    event GiftCreated(
        uint256 indexed giftId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        ConditionType conditionType,
        bytes32 conditionHash,
        address attester,
        bool irrevocable,
        uint64 releaseTime,
        uint64 timeoutAt
    );
    event ConditionAttested(uint256 indexed giftId, address indexed attester, address indexed submittedBy);
    event GiftClaimed(uint256 indexed giftId, address indexed recipient, uint256 amount);
    event GiftCancelled(uint256 indexed giftId, address indexed sender, uint256 amount);
    event TimeoutReleased(uint256 indexed giftId, address indexed recipient, uint256 amount);

    error GiftNotFound();
    error WrongState();
    error ZeroAmount();
    error ZeroAddress();
    error SelfGift();
    error NotRecipient();
    error NotSender();
    error GiftIsIrrevocable();
    error ConditionNotMet();
    error TimeoutNotReached();
    error AttesterRequired();
    error AttesterNotAllowed();
    error TimeGiftNeedsNoAttestation();
    error BadConditionData();
    error ReleaseTooSoon();
    error BadAttestation();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ───────────── creating ─────────────

    /// @notice Put money aside for someone, released when the condition is met.
    /// @param conditionType Time, Event or Attestation.
    /// @param conditionData for a Time gift, `abi.encode(uint64 releaseTime)`.
    ///        Otherwise the agreed condition text's bytes — only its hash is
    ///        stored, so nothing readable about a person reaches the chain.
    /// @param attester who may confirm the condition. Must be the zero address
    ///        for a Time gift, and a real address otherwise.
    /// @param irrevocable true means the sender can never cancel. The UI must
    ///        say so before the sender confirms, because it cannot be undone.
    function createGift(
        address recipient,
        uint256 amount,
        ConditionType conditionType,
        bytes calldata conditionData,
        address attester,
        bool irrevocable
    ) external nonReentrant returns (uint256 giftId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == msg.sender) revert SelfGift();
        if (amount == 0) revert ZeroAmount();

        uint64 releaseTime;
        if (conditionType == ConditionType.Time) {
            if (attester != address(0)) revert AttesterNotAllowed();
            if (conditionData.length != 32) revert BadConditionData();
            releaseTime = uint64(abi.decode(conditionData, (uint256)));
            if (releaseTime < _now() + MIN_RELEASE_DELAY) revert ReleaseTooSoon();
        } else {
            if (attester == address(0)) revert AttesterRequired();
            if (conditionData.length == 0) revert BadConditionData();
        }

        giftId = giftCount++;
        uint64 timeoutAt = _now() + TIMEOUT_PERIOD;
        bytes32 conditionHash = keccak256(conditionData);

        _gifts[giftId] = GiftRecord({
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            conditionHash: conditionHash,
            releaseTime: releaseTime,
            attester: attester,
            irrevocable: irrevocable,
            createdAt: _now(),
            timeoutAt: timeoutAt,
            conditionType: conditionType,
            state: State.Pending
        });

        emit GiftCreated(
            giftId,
            msg.sender,
            recipient,
            amount,
            conditionType,
            conditionHash,
            attester,
            irrevocable,
            releaseTime,
            timeoutAt
        );

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ───────────── attesting ─────────────

    /// @notice Submit the attester's signature confirming the condition.
    /// @dev Anyone may submit it — the signature is what counts, not the caller,
    ///      so a recipient can push it through without the attester paying a
    ///      fee. A Time gift has nothing to attest and rejects this outright.
    function attestCondition(uint256 giftId, bytes calldata signature) external {
        GiftRecord storage g = _get(giftId);
        if (g.conditionType == ConditionType.Time) revert TimeGiftNeedsNoAttestation();
        if (g.state != State.Pending) revert WrongState();

        address signer = ECDSA.recover(attestationDigest(giftId), signature);
        if (signer != g.attester) revert BadAttestation();

        g.state = State.Attested;
        emit ConditionAttested(giftId, g.attester, msg.sender);
    }

    /// @notice Exactly what an attester has to sign for a given gift.
    /// @dev Bound to the gift, its condition, this contract and this chain, so
    ///      a signature cannot be replayed onto another gift, another
    ///      deployment or a fork.
    function attestationDigest(uint256 giftId) public view returns (bytes32) {
        GiftRecord storage g = _gifts[giftId];
        if (g.state == State.None) revert GiftNotFound();
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, giftId, g.conditionHash))
        );
    }

    // ───────────── releasing ─────────────

    /// @notice Recipient takes the money once the condition is met.
    function claim(uint256 giftId) external nonReentrant {
        GiftRecord storage g = _get(giftId);
        if (msg.sender != g.recipient) revert NotRecipient();

        if (g.conditionType == ConditionType.Time) {
            if (g.state != State.Pending) revert WrongState();
            if (_now() < g.releaseTime) revert ConditionNotMet();
        } else {
            if (g.state != State.Attested) revert ConditionNotMet();
        }

        g.state = State.Claimed;
        uint256 amount = g.amount;

        emit GiftClaimed(giftId, g.recipient, amount);
        token.safeTransfer(g.recipient, amount);
    }

    /// @notice The escape hatch: after the timeout the recipient can release an
    ///         un-attested gift themselves.
    /// @dev This is what stops a gift being held hostage by an attester who
    ///      cannot or will not sign. A Time gift does not need it — the date
    ///      always arrives — so it is rejected there to keep the paths honest.
    function requestTimeoutRelease(uint256 giftId) external nonReentrant {
        GiftRecord storage g = _get(giftId);
        if (g.conditionType == ConditionType.Time) revert TimeGiftNeedsNoAttestation();
        if (g.state != State.Pending) revert WrongState();
        if (msg.sender != g.recipient) revert NotRecipient();
        if (_now() < g.timeoutAt) revert TimeoutNotReached();

        g.state = State.Released;
        uint256 amount = g.amount;

        emit TimeoutReleased(giftId, g.recipient, amount);
        token.safeTransfer(g.recipient, amount);
    }

    /// @notice Sender takes the gift back. Only possible while the condition is
    ///         still unmet, and never for an irrevocable gift.
    function cancel(uint256 giftId) external nonReentrant {
        GiftRecord storage g = _get(giftId);
        if (msg.sender != g.sender) revert NotSender();
        if (g.irrevocable) revert GiftIsIrrevocable();
        if (g.state != State.Pending) revert WrongState();

        // For a time gift, "before the condition is met" means before the date.
        if (g.conditionType == ConditionType.Time && _now() >= g.releaseTime) {
            revert WrongState();
        }

        g.state = State.Cancelled;
        uint256 amount = g.amount;

        emit GiftCancelled(giftId, g.sender, amount);
        token.safeTransfer(g.sender, amount);
    }

    // ───────────── views ─────────────

    function getGift(uint256 giftId) external view returns (GiftRecord memory) {
        return _get(giftId);
    }

    /// @notice True while the money is still sitting here.
    function isOpen(uint256 giftId) external view returns (bool) {
        State s = _get(giftId).state;
        return s == State.Pending || s == State.Attested;
    }

    /// @notice Whether the recipient could claim right now.
    function claimable(uint256 giftId) external view returns (bool) {
        GiftRecord storage g = _get(giftId);
        if (g.conditionType == ConditionType.Time) {
            return g.state == State.Pending && _now() >= g.releaseTime;
        }
        return g.state == State.Attested;
    }

    /// @notice Seconds until the recipient may use the timeout path, or 0.
    function timeUntilTimeout(uint256 giftId) external view returns (uint64) {
        GiftRecord storage g = _get(giftId);
        if (_now() >= g.timeoutAt) return 0;
        return g.timeoutAt - _now();
    }

    /// @dev Block time as uint64, with the cast justified in one place.
    ///      uint64 seconds runs out in the year 584 billion.
    function _now() internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    function _get(uint256 giftId) internal view returns (GiftRecord storage g) {
        g = _gifts[giftId];
        if (g.state == State.None) revert GiftNotFound();
    }
}
