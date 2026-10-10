// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title MicroCover — a premium and payout rail for a licensed insurer.
///
/// @notice **This contract is not an insurer and does not provide cover.**
///
/// Underwriting, pricing, claims adjudication, solvency and grievance
/// redressal all belong to an IRDAI-licensed insurer. This contract is the
/// plumbing underneath that insurer: it escrows a premium, records that the
/// insurer bound the risk, records that a claim was made, and pays out the
/// amount the insurer signed for. It never decides anything.
///
/// Read `docs/limitations.md`, "What requires an IRDAI-licensed insurer",
/// before putting this anywhere near real money or a real buyer.
///
/// What the contract does guarantee:
///  - **No payout without the insurer's signature.** `settleClaim` recovers a
///    signature over this contract, this chain, the policy, the claim's
///    evidence hash and the exact amount. Nobody — not the buyer, not the
///    deployer, not this contract's author — can move a payout without it.
///  - **A premium cannot be taken until the risk is bound.** Premiums sit in
///    escrow. They become remittable to the insurer only on `activatePolicy`,
///    and if the insurer never binds, the payer takes the premium back.
///  - **Cover is fully collateralised on-chain.** A policy cannot be activated
///    unless the insurer's reserve already holds its full coverage amount,
///    uncommitted. The insurer cannot withdraw reserve that is committed to
///    live cover. This is *stricter* than real insurance, deliberately — see
///    "Why cover is fully collateralised here" below.
///  - **A payout never exceeds the coverage** on that policy, and a policy
///    pays out at most once.
///
/// What it cannot do, stated plainly:
///  - It cannot tell whether the insured event actually happened. It records
///    `evidenceHash` and nothing more. The evidence lives in Supabase; the
///    insurer, or a licensed assessor, is what turns evidence into a decision.
///  - It cannot tell *when* the event happened. Only the off-chain record has
///    the event time, and only the database checks it against the cover
///    window. A signature from the insurer is the contract's whole notion of
///    "this claim is good".
///  - It cannot make the insurer solvent, licensed, or honest. It can only
///    make the insurer's on-chain promises visible and its committed reserve
///    un-withdrawable.
///
/// **Why cover is fully collateralised here.** A real insurer holds capital
/// against a portfolio under IRDAI solvency rules, not one-for-one against
/// each policy. This contract cannot read a solvency margin, audit a balance
/// sheet, or call a regulator, so the only promise it can actually keep is the
/// one it can hold in its own hands: the tokens are here. That makes this rail
/// safe for a buyer and capital-inefficient for an insurer. A production
/// design would replace this with a funded reserve plus the insurer's audited
/// solvency position, which is a commercial and regulatory arrangement, not a
/// Solidity change.
///
/// Amounts are in paise, matching the rest of this codebase, and a payout of
/// zero is how the insurer records a declined claim.
contract MicroCover is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PolicyState {
        None, // 0 — never created
        Escrowed, // premium held, risk NOT yet bound; no cover exists
        Active, // insurer bound the risk
        Refunded, // insurer never bound it; premium returned to the payer
        Closed // settled, declined, or expired without a claim
    }

    enum ClaimState {
        None, // 0 — no claim on this policy
        Submitted,
        Paid,
        Declined
    }

    struct Policy {
        /// @notice Who the cover is for. Payouts go here and nowhere else.
        address insured;
        /// @notice Who paid the premium. Refunds go here, which is not
        ///         necessarily the insured — a parent may buy a student's cover.
        address payer;
        uint256 premium;
        uint256 coverage;
        uint64 startTime;
        uint64 endTime;
        uint64 createdAt;
        /// @notice Hash of the insurer's filed policy wording. Fixed forever.
        bytes32 policyTermsHash;
        PolicyState state;
    }

    struct Claim {
        bytes32 evidenceHash;
        uint256 payout;
        uint64 submittedAt;
        uint64 settledAt;
        ClaimState state;
    }

    /// @notice The licensed, risk-bearing entity's treasury. Funds the reserve
    ///         and receives remitted premiums. Fixed at deployment.
    address public immutable insurer;

    /// @notice The key whose signature authorises a payout. Kept separate from
    ///         `insurer` because a treasury address and a claims-signing key
    ///         are different things with different custody.
    address public immutable insurerSigner;

    IERC20 public immutable token;

    /// @notice How long after cover ends a claim may still be reported. Damage
    ///         is often found later than it happened.
    uint64 public constant CLAIM_WINDOW = 30 days;

    /// @notice How long the insurer has to bind the risk before the payer may
    ///         take the premium back.
    uint64 public constant BIND_WINDOW = 1 days;

    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 365 days;

    /// @notice Tokens the insurer has put up to pay claims.
    uint256 public reserve;

    /// @notice The part of `reserve` promised to live cover. Not withdrawable.
    uint256 public committed;

    /// @notice Premiums on bound policies, waiting to be pulled by the insurer.
    uint256 public remittablePremium;

    uint256 public policyCount;

    mapping(uint256 => Policy) private _policies;
    mapping(uint256 => Claim) private _claims;

    event ReserveFunded(address indexed from, uint256 amount, uint256 reserve);
    event ReserveWithdrawn(address indexed to, uint256 amount, uint256 reserve);
    event PolicyCreated(
        uint256 indexed policyId,
        address indexed insured,
        address indexed payer,
        uint256 premium,
        uint256 coverage,
        uint64 startTime,
        uint64 endTime,
        bytes32 policyTermsHash
    );
    event PolicyActivated(uint256 indexed policyId, uint256 coverage, uint256 committed);
    event PolicyRefunded(uint256 indexed policyId, address indexed payer, uint256 premium);
    event PolicyClosed(uint256 indexed policyId);
    event PremiumRemitted(address indexed insurer, uint256 amount);
    event ClaimSubmitted(uint256 indexed policyId, address indexed insured, bytes32 evidenceHash);
    event ClaimPaid(uint256 indexed policyId, address indexed insured, uint256 payout);
    event ClaimDeclined(uint256 indexed policyId, address indexed insured);

    error PolicyNotFound();
    error WrongState();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroHash();
    error CoverageBelowPremium();
    error WindowOutOfRange();
    error AlreadyEnded();
    error NotInsurer();
    error NotInsured();
    error ReserveTooSmall();
    error ReserveCommitted();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error ClaimAlreadyMade();
    error NoClaim();
    error PayoutAboveCoverage();
    error BadInsurerSignature();
    error TooEarly();

    constructor(IERC20 token_, address insurer_, address insurerSigner_) {
        if (address(token_) == address(0) || insurer_ == address(0) || insurerSigner_ == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        insurer = insurer_;
        insurerSigner = insurerSigner_;
    }

    // ───────────── the insurer's reserve ─────────────

    /// @notice Insurer puts up the money claims will be paid from.
    /// @dev Permissionless on purpose: a reinsurer or a parent company topping
    ///      up the reserve is a good thing, and the money can only ever leave
    ///      as a signed payout or as an uncommitted withdrawal to `insurer`.
    function fundReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        reserve += amount;
        emit ReserveFunded(msg.sender, amount, reserve);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Insurer takes back reserve that is not promised to live cover.
    function withdrawReserve(uint256 amount) external nonReentrant {
        if (msg.sender != insurer) revert NotInsurer();
        if (amount == 0) revert ZeroAmount();
        // Committed reserve belongs to policyholders until their cover ends.
        if (reserve - committed < amount) revert ReserveCommitted();

        reserve -= amount;
        emit ReserveWithdrawn(insurer, amount, reserve);
        token.safeTransfer(insurer, amount);
    }

    /// @notice Insurer pulls the premiums on policies it has bound.
    /// @dev Pull, not push, and only for risk already bound. The "schedule" in
    ///      the insurer API contract is off-chain; this is the settlement leg.
    function remitPremiums() external nonReentrant {
        if (msg.sender != insurer) revert NotInsurer();
        uint256 amount = remittablePremium;
        if (amount == 0) revert ZeroAmount();

        remittablePremium = 0;
        emit PremiumRemitted(insurer, amount);
        token.safeTransfer(insurer, amount);
    }

    // ───────────── policies ─────────────

    /// @notice Record a policy and escrow its premium. **This does not create
    ///         cover.** Cover begins when the insurer calls `activatePolicy`.
    /// @param insured who the cover is for; the only address a payout can go to.
    /// @param premium pulled from `msg.sender`, who may be the insured or
    ///        somebody buying on their behalf.
    /// @param coverage the most this policy can ever pay out.
    /// @param policyTermsHash hash of the insurer's filed wording. Required:
    ///        a policy with no wording behind it is not a policy.
    function createPolicy(
        address insured,
        uint256 premium,
        uint256 coverage,
        uint256 startTime,
        uint256 endTime,
        bytes32 policyTermsHash
    ) external nonReentrant returns (uint256 policyId) {
        if (insured == address(0)) revert ZeroAddress();
        if (premium == 0) revert ZeroAmount();
        // A policy that pays out less than it costs is worse than no policy.
        if (coverage <= premium) revert CoverageBelowPremium();
        if (policyTermsHash == bytes32(0)) revert ZeroHash();

        uint64 start = uint64(startTime);
        uint64 end = uint64(endTime);
        // Round-trip the narrowing casts: anything that truncated is rejected
        // rather than silently wrapping into a different date.
        if (startTime != uint256(start) || endTime != uint256(end)) revert WindowOutOfRange();
        if (end <= start) revert WindowOutOfRange();
        if (end <= _now()) revert AlreadyEnded();

        uint64 duration = end - start;
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert WindowOutOfRange();

        policyId = ++policyCount;
        _policies[policyId] = Policy({
            insured: insured,
            payer: msg.sender,
            premium: premium,
            coverage: coverage,
            startTime: start,
            endTime: end,
            createdAt: _now(),
            policyTermsHash: policyTermsHash,
            state: PolicyState.Escrowed
        });

        emit PolicyCreated(policyId, insured, msg.sender, premium, coverage, start, end, policyTermsHash);

        token.safeTransferFrom(msg.sender, address(this), premium);
    }

    /// @notice Insurer confirms the premium is received and binds the risk.
    /// @dev Requires the reserve to already hold this policy's full coverage,
    ///      uncommitted. The insurer cannot bind cover it has not funded.
    function activatePolicy(uint256 policyId) external {
        Policy storage p = _get(policyId);
        if (msg.sender != insurer) revert NotInsurer();
        if (p.state != PolicyState.Escrowed) revert WrongState();
        // Binding risk on cover that has already expired would be meaningless.
        if (_now() >= p.endTime) revert AlreadyEnded();
        if (reserve - committed < p.coverage) revert ReserveTooSmall();

        p.state = PolicyState.Active;
        committed += p.coverage;
        // The premium is only earned once the risk is actually carried.
        remittablePremium += p.premium;

        emit PolicyActivated(policyId, p.coverage, committed);
    }

    /// @notice Insurer declines to bind, returning the premium immediately.
    /// @dev Better than making the buyer wait out `BIND_WINDOW` for money that
    ///      was never going to buy them anything.
    function declineToBind(uint256 policyId) external nonReentrant {
        Policy storage p = _get(policyId);
        if (msg.sender != insurer) revert NotInsurer();
        if (p.state != PolicyState.Escrowed) revert WrongState();

        _refund(policyId, p);
    }

    /// @notice Payer takes the premium back when the insurer never bound it.
    /// @dev Permissionless so the payer never needs the insurer's cooperation
    ///      to recover money that bought no cover. Available once the bind
    ///      window has passed, or once the cover period is over regardless.
    function refundUnboundPremium(uint256 policyId) external nonReentrant {
        Policy storage p = _get(policyId);
        if (p.state != PolicyState.Escrowed) revert WrongState();
        if (_now() <= p.createdAt + BIND_WINDOW && _now() <= p.endTime) revert TooEarly();

        _refund(policyId, p);
    }

    /// @notice Release the reserve behind a policy that ended with no claim.
    /// @dev Permissionless: the claim window closing is an objective fact, and
    ///      the insurer should not depend on anyone to free its own capital.
    function closeExpiredPolicy(uint256 policyId) external {
        Policy storage p = _get(policyId);
        if (p.state != PolicyState.Active) revert WrongState();
        if (_claims[policyId].state != ClaimState.None) revert ClaimAlreadyMade();
        if (_now() <= p.endTime + CLAIM_WINDOW) revert ClaimWindowOpen();

        p.state = PolicyState.Closed;
        committed -= p.coverage;
        emit PolicyClosed(policyId);
    }

    // ───────────── claims ─────────────

    /// @notice Insured records a claim against an active policy.
    /// @dev `evidenceHash` commits to the whole evidence bundle held off-chain.
    ///      The contract cannot and does not check what it hashes, nor when the
    ///      event happened — only the insurer's signature decides the outcome.
    function submitClaim(uint256 policyId, bytes32 evidenceHash) external {
        Policy storage p = _get(policyId);
        if (msg.sender != p.insured) revert NotInsured();
        if (p.state != PolicyState.Active) revert WrongState();
        if (evidenceHash == bytes32(0)) revert ZeroHash();
        if (_claims[policyId].state != ClaimState.None) revert ClaimAlreadyMade();
        // Reportable during cover and for CLAIM_WINDOW afterwards.
        if (_now() > p.endTime + CLAIM_WINDOW) revert ClaimWindowClosed();

        _claims[policyId] = Claim({
            evidenceHash: evidenceHash, payout: 0, submittedAt: _now(), settledAt: 0, state: ClaimState.Submitted
        });

        emit ClaimSubmitted(policyId, p.insured, evidenceHash);
    }

    /// @notice Pay a claim the insurer has signed for. `payoutAmount` of zero
    ///         records the insurer's decision to decline.
    /// @dev Anyone may submit the signature, so the insured can collect without
    ///      waiting for the insurer to send a transaction. The signature, not
    ///      the caller, is the authority. It is bound to this contract, this
    ///      chain, the policy, the claim's evidence hash and this exact amount,
    ///      so it cannot be replayed elsewhere, re-used for a different amount,
    ///      or applied to another claim.
    function settleClaim(uint256 policyId, uint256 payoutAmount, bytes calldata insurerSignature)
        external
        nonReentrant
    {
        Policy storage p = _get(policyId);
        Claim storage c = _claims[policyId];
        if (c.state != ClaimState.Submitted) revert NoClaim();
        if (payoutAmount > p.coverage) revert PayoutAboveCoverage();

        address signer = ECDSA.recover(settlementDigest(policyId, payoutAmount), insurerSignature);
        if (signer != insurerSigner) revert BadInsurerSignature();

        // The policy closes either way: one event, one decision.
        p.state = PolicyState.Closed;
        c.settledAt = _now();
        committed -= p.coverage;

        if (payoutAmount == 0) {
            c.state = ClaimState.Declined;
            emit ClaimDeclined(policyId, p.insured);
            emit PolicyClosed(policyId);
            return;
        }

        c.state = ClaimState.Paid;
        c.payout = payoutAmount;
        reserve -= payoutAmount;

        emit ClaimPaid(policyId, p.insured, payoutAmount);
        emit PolicyClosed(policyId);

        token.safeTransfer(p.insured, payoutAmount);
    }

    /// @notice Exactly what the insurer's key has to sign to settle a claim.
    function settlementDigest(uint256 policyId, uint256 payoutAmount) public view returns (bytes32) {
        Claim storage c = _claims[policyId];
        if (c.state == ClaimState.None) revert NoClaim();
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, policyId, c.evidenceHash, payoutAmount))
        );
    }

    // ───────────── views ─────────────

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _get(policyId);
    }

    function getClaim(uint256 policyId) external view returns (Claim memory) {
        return _claims[policyId];
    }

    /// @notice Reserve not promised to live cover; what `withdrawReserve` can take.
    function uncommittedReserve() external view returns (uint256) {
        return reserve - committed;
    }

    /// @notice Whether cover is in force right now. False before `startTime`,
    ///         which is why a policy bought for later cannot be claimed today.
    function isCovered(uint256 policyId) external view returns (bool) {
        Policy storage p = _policies[policyId];
        return p.state == PolicyState.Active && _now() >= p.startTime && _now() <= p.endTime;
    }

    // ───────────── internal ─────────────

    function _refund(uint256 policyId, Policy storage p) private {
        p.state = PolicyState.Refunded;
        uint256 amount = p.premium;
        address payer = p.payer;

        emit PolicyRefunded(policyId, payer, amount);

        token.safeTransfer(payer, amount);
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _get(uint256 policyId) internal view returns (Policy storage p) {
        p = _policies[policyId];
        if (p.state == PolicyState.None) revert PolicyNotFound();
    }
}
