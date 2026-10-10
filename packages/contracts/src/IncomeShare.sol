// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title IncomeShare — a record of an income share agreement, not the agreement.
///
/// @notice **The legal agreement is the product. This contract is a ledger.**
///
/// It holds no token, has no balance, and cannot move a rupee. There is no
/// `transfer` in this file and nothing to withdraw. What it does is keep an
/// account that neither side can quietly edit: the agreed terms, the hash of
/// the signed agreement, and each repayment the recipient confirmed.
///
/// Real settlement happens on a licensed counterparty's payment rails. An
/// entry here means "the recipient agreed they owed this much for this month",
/// not "this much was paid".
///
/// **If this contract and the signed agreement ever disagree, the agreement
/// governs.** The hash recorded at creation is what ties the two together: it
/// identifies which document the parties signed, so a later edit to the PDF is
/// detectable. It does not make the on-chain copy authoritative, and nothing
/// here should be read as overriding a term a court would enforce. See
/// docs/limitations.md, "What requires a licensed partner".
///
/// What the contract does guarantee:
///  - The terms are fixed at creation. Percentage, cap, term and agreement hash
///    are never writable again.
///  - No repayment is recorded without the recipient's own signature over that
///    exact income figure and amount. The brief says do not auto-deduct; here
///    a repayment cannot even be recorded unilaterally.
///  - A confirmation cannot be replayed. Each is bound to this contract, this
///    chain, the agreement, and its position in the sequence.
///  - Recorded repayments never exceed the cap. The agreement closes itself the
///    moment the cap is reached.
///
/// Who may call what:
///  - Anyone may create an agreement, naming a recipient. Creating one grants
///    no power over that person: nothing can be recorded against them without
///    their signature.
///  - Only `recorder` — the licensed counterparty's signer, fixed at deployment
///    — may submit a repayment. That is the entity carrying the legal
///    obligation, and it is also what makes an off-chain dispute freeze
///    effective: if the counterparty stops submitting, nothing is recorded.
///  - Anyone may close an agreement once the cap is reached or the term is
///    over, because both are objective facts.
///
/// Amounts are in paise, matching the rest of this codebase. Percentages are
/// whole percent, as the brief's signature specifies.
contract IncomeShare {
    enum State {
        None, // 0 — never created
        Active,
        Complete
    }

    struct Agreement {
        address funder;
        address recipient;
        uint256 fundingAmount;
        /// @notice Whole percent of verified income, as the brief specifies.
        uint256 repaymentPercent;
        /// @notice The most that can ever be repaid in total.
        uint256 cap;
        uint256 totalRepaid;
        uint64 termEnd;
        uint32 repaymentCount;
        /// @notice Hash of the signed plain-language agreement.
        bytes32 agreementHash;
        State state;
    }

    struct Repayment {
        uint256 income;
        uint256 amount;
        uint64 recordedAt;
    }

    /// @notice The licensed counterparty's signer. The only address that may
    ///         record a repayment. Fixed at deployment so it cannot be
    ///         swapped for a friendlier one later.
    address public immutable recorder;

    uint256 public agreementCount;

    mapping(uint256 => Agreement) internal _agreements;
    mapping(uint256 => mapping(uint256 => Repayment)) internal _repayments;

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed funder,
        address indexed recipient,
        uint256 fundingAmount,
        uint256 repaymentPercent,
        uint256 cap,
        uint64 termEnd,
        bytes32 agreementHash
    );
    event RepaymentRecorded(
        uint256 indexed agreementId, uint256 indexed index, uint256 income, uint256 amount, uint256 totalRepaid
    );
    event AgreementCompleted(uint256 indexed agreementId, uint256 totalRepaid, bool capReached);

    error AgreementNotFound();
    error WrongState();
    error NotRecorder();
    error ZeroAddress();
    error SelfAgreement();
    error ZeroAmount();
    error BadPercent();
    error BadCap();
    error TermInPast();
    error AgreementHashRequired();
    error CapExceeded();
    error BadConfirmation();
    error NotFinishedYet();

    constructor(address recorder_) {
        if (recorder_ == address(0)) revert ZeroAddress();
        recorder = recorder_;
    }

    // ───────────── creating ─────────────

    /// @notice Record the terms of an agreement the parties have signed.
    /// @dev Creating this does not fund anything and does not bind the
    ///      recipient to anything on its own — their signature on each
    ///      repayment is what does that.
    /// @param repaymentPercent whole percent of verified income, 1 to 100.
    /// @param cap the most that can ever be repaid. Must be at least the
    ///        funding amount: a cap below it would mean the recipient repays
    ///        less than they received, which is a grant, not an ISA.
    /// @param agreementHash hash of the signed plain-language PDF. Required —
    ///        an agreement with no document behind it is not an agreement.
    function createAgreement(
        address recipient,
        uint256 fundingAmount,
        uint256 repaymentPercent,
        uint256 cap,
        uint256 termEnd,
        bytes32 agreementHash
    ) external returns (uint256 agreementId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == msg.sender) revert SelfAgreement();
        if (fundingAmount == 0) revert ZeroAmount();
        if (repaymentPercent == 0 || repaymentPercent > 100) revert BadPercent();
        if (cap < fundingAmount) revert BadCap();
        if (agreementHash == bytes32(0)) revert AgreementHashRequired();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 end = uint64(termEnd);
        if (uint256(end) != termEnd) revert TermInPast();
        if (end <= _now()) revert TermInPast();

        agreementId = agreementCount++;
        _agreements[agreementId] = Agreement({
            funder: msg.sender,
            recipient: recipient,
            fundingAmount: fundingAmount,
            repaymentPercent: repaymentPercent,
            cap: cap,
            totalRepaid: 0,
            termEnd: end,
            repaymentCount: 0,
            agreementHash: agreementHash,
            state: State.Active
        });

        emit AgreementCreated(
            agreementId, msg.sender, recipient, fundingAmount, repaymentPercent, cap, end, agreementHash
        );
    }

    // ───────────── repayments ─────────────

    /// @notice Record a repayment the recipient has confirmed.
    /// @dev Submitted by the counterparty, authorised by the recipient. The
    ///      brief asks for a server-signed call whose signature confirms the
    ///      recipient agreed to the income figure — a server's own signature
    ///      cannot evidence that, so this checks the recipient's signature and
    ///      restricts the caller to the counterparty. Both parties are
    ///      therefore accounted for: the counterparty submits, the recipient
    ///      consents, and neither can act alone.
    /// @param income the verified monthly income the recipient agreed to.
    /// @param repaymentAmount what is owed on it. Not recomputed here: the
    ///        agreement's definition of income, its rounding and any floor live
    ///        in the legal document, and the recipient signed this exact figure.
    /// @param signature the recipient's signature over `repaymentDigest`.
    function recordRepayment(uint256 agreementId, uint256 income, uint256 repaymentAmount, bytes calldata signature)
        external
    {
        Agreement storage a = _get(agreementId);
        if (a.state != State.Active) revert WrongState();
        if (msg.sender != recorder) revert NotRecorder();

        uint256 index = a.repaymentCount;
        bytes32 digest = repaymentDigest(agreementId, index, income, repaymentAmount);
        if (ECDSA.recover(digest, signature) != a.recipient) revert BadConfirmation();

        if (a.totalRepaid + repaymentAmount > a.cap) revert CapExceeded();

        a.totalRepaid += repaymentAmount;
        // forge-lint: disable-next-line(unsafe-typecast)
        a.repaymentCount = uint32(index + 1);
        _repayments[agreementId][index] = Repayment({income: income, amount: repaymentAmount, recordedAt: _now()});

        emit RepaymentRecorded(agreementId, index, income, repaymentAmount, a.totalRepaid);

        // Reaching the cap ends it there and then, so nothing further can be
        // recorded against someone who has finished paying.
        if (a.totalRepaid == a.cap) {
            a.state = State.Complete;
            emit AgreementCompleted(agreementId, a.totalRepaid, true);
        }
    }

    /// @notice Exactly what the recipient signs to confirm one repayment.
    /// @dev Bound to this contract, this chain, the agreement and the position
    ///      in the sequence, so a confirmation cannot be replayed onto another
    ///      month, another agreement or another deployment.
    function repaymentDigest(uint256 agreementId, uint256 index, uint256 income, uint256 repaymentAmount)
        public
        view
        returns (bytes32)
    {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(address(this), block.chainid, agreementId, index, income, repaymentAmount))
        );
    }

    // ───────────── closing ─────────────

    /// @notice Close an agreement whose cap is reached or whose term is over.
    /// @dev Permissionless: both conditions are objective, and the recipient
    ///      should not need anyone's cooperation to have it recorded that they
    ///      are done.
    function markComplete(uint256 agreementId) external {
        Agreement storage a = _get(agreementId);
        if (a.state != State.Active) revert WrongState();

        bool capReached = a.totalRepaid >= a.cap;
        if (!capReached && _now() < a.termEnd) revert NotFinishedYet();

        a.state = State.Complete;
        emit AgreementCompleted(agreementId, a.totalRepaid, capReached);
    }

    // ───────────── views ─────────────

    function getAgreement(uint256 agreementId) external view returns (Agreement memory) {
        return _get(agreementId);
    }

    function getRepayment(uint256 agreementId, uint256 index) external view returns (Repayment memory) {
        _get(agreementId);
        return _repayments[agreementId][index];
    }

    /// @notice How much more could ever be recorded against this agreement.
    function remainingToCap(uint256 agreementId) external view returns (uint256) {
        Agreement storage a = _get(agreementId);
        return a.totalRepaid >= a.cap ? 0 : a.cap - a.totalRepaid;
    }

    /// @notice True once the cap is reached or the term has run out.
    function isFinished(uint256 agreementId) external view returns (bool) {
        Agreement storage a = _get(agreementId);
        return a.totalRepaid >= a.cap || _now() >= a.termEnd;
    }

    /// @dev Block time as uint64, with the cast justified in one place.
    function _now() internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    function _get(uint256 agreementId) internal view returns (Agreement storage a) {
        a = _agreements[agreementId];
        if (a.state == State.None) revert AgreementNotFound();
    }
}
