// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IncomeShare} from "../src/IncomeShare.sol";

/// Note there is no token in this suite. `IncomeShare` holds no balance and
/// moves no money, so there is nothing to fund and nothing to drain — the only
/// things worth testing are the record-keeping guarantees.
contract IncomeShareTest is Test {
    IncomeShare isa;

    address funder = makeAddr("funder");
    address nbfc = makeAddr("nbfc"); // the licensed counterparty's signer
    address stranger = makeAddr("stranger");

    address recipient;
    uint256 recipientKey;
    address impostor;
    uint256 impostorKey;

    uint256 constant FUNDING = 20_000_000; // ₹2,00,000
    uint256 constant PERCENT = 8;
    uint256 constant CAP = 36_000_000; // ₹3,60,000 — 1.8x
    bytes32 constant AGREEMENT = keccak256("the signed plain-language agreement v1");
    uint64 termEnd;

    function setUp() public {
        vm.warp(1_700_000_000);
        isa = new IncomeShare(nbfc);
        (recipient, recipientKey) = makeAddrAndKey("recipient");
        (impostor, impostorKey) = makeAddrAndKey("impostor");
        termEnd = uint64(block.timestamp + 365 days * 3);
    }

    // ───────────── helpers ─────────────

    function _create() internal returns (uint256 id) {
        vm.prank(funder);
        id = isa.createAgreement(recipient, FUNDING, PERCENT, CAP, termEnd, AGREEMENT);
    }

    function _confirm(uint256 key, uint256 id, uint256 index, uint256 income, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, isa.repaymentDigest(id, index, income, amount));
        return abi.encodePacked(r, s, v);
    }

    function _record(uint256 id, uint256 index, uint256 income, uint256 amount) internal {
        // Build the signature first: `_confirm` calls `repaymentDigest` on the
        // contract, and that call would otherwise consume the prank.
        bytes memory sig = _confirm(recipientKey, id, index, income, amount);
        vm.prank(nbfc);
        isa.recordRepayment(id, income, amount, sig);
    }

    // ───────────── the terms are fixed ─────────────

    function test_AgreementRecordsTheTermsAndTheDocumentHash() public {
        uint256 id = _create();

        IncomeShare.Agreement memory a = isa.getAgreement(id);
        assertEq(a.funder, funder);
        assertEq(a.recipient, recipient);
        assertEq(a.fundingAmount, FUNDING);
        assertEq(a.repaymentPercent, PERCENT);
        assertEq(a.cap, CAP);
        assertEq(a.termEnd, termEnd);
        assertEq(a.agreementHash, AGREEMENT, "the signed document is identified");
        assertEq(a.totalRepaid, 0);
        assertEq(uint8(a.state), uint8(IncomeShare.State.Active));
        assertEq(isa.remainingToCap(id), CAP);
    }

    /// There is no setter for any term. This is the whole point of recording
    /// them: the hash pins which document was signed, so editing the PDF
    /// afterwards is detectable.
    function test_TheDocumentHashIsWhatTiesTheRecordToTheAgreement() public {
        uint256 id = _create();
        assertEq(isa.getAgreement(id).agreementHash, keccak256("the signed plain-language agreement v1"));
        assertTrue(
            isa.getAgreement(id).agreementHash != keccak256("a quietly edited agreement v2"),
            "a different document hashes differently"
        );
    }

    // ───────────── nothing is recorded without the recipient ─────────────

    function test_RepaymentNeedsTheRecipientsOwnConfirmation() public {
        uint256 id = _create();
        uint256 income = 5_000_000; // ₹50,000 that month
        uint256 amount = 400_000; // ₹4,000, being 8% of it

        _record(id, 0, income, amount);

        IncomeShare.Agreement memory a = isa.getAgreement(id);
        assertEq(a.totalRepaid, amount);
        assertEq(a.repaymentCount, 1);
        assertEq(isa.remainingToCap(id), CAP - amount);

        IncomeShare.Repayment memory r = isa.getRepayment(id, 0);
        assertEq(r.income, income);
        assertEq(r.amount, amount);
    }

    /// The brief says do not auto-deduct. Here it cannot even be recorded.
    function test_RevertWhen_CounterpartyActsWithoutTheRecipient() public {
        uint256 id = _create();
        bytes memory forged = _confirm(impostorKey, id, 0, 5_000_000, 400_000);

        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.BadConfirmation.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, forged);
    }

    /// A confirmation for ₹4,000 cannot be used to record ₹40,000.
    function test_RevertWhen_AmountDiffersFromWhatWasSigned() public {
        uint256 id = _create();
        bytes memory signedFor4k = _confirm(recipientKey, id, 0, 5_000_000, 400_000);

        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.BadConfirmation.selector);
        isa.recordRepayment(id, 5_000_000, 4_000_000, signedFor4k);
    }

    /// Nor can the income figure be altered after the recipient agreed to it.
    function test_RevertWhen_IncomeFigureDiffersFromWhatWasSigned() public {
        uint256 id = _create();
        bytes memory signedFor50k = _confirm(recipientKey, id, 0, 5_000_000, 400_000);

        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.BadConfirmation.selector);
        isa.recordRepayment(id, 9_000_000, 400_000, signedFor50k);
    }

    /// One month's confirmation must not be replayed as the next month's.
    function test_RevertWhen_ConfirmationIsReplayedForTheNextMonth() public {
        uint256 id = _create();
        bytes memory month0 = _confirm(recipientKey, id, 0, 5_000_000, 400_000);

        vm.prank(nbfc);
        isa.recordRepayment(id, 5_000_000, 400_000, month0);

        // Index is now 1, so the same signature no longer matches.
        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.BadConfirmation.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, month0);
    }

    function test_RevertWhen_ConfirmationIsReplayedOnAnotherAgreement() public {
        uint256 first = _create();
        uint256 second = _create();
        bytes memory forFirst = _confirm(recipientKey, first, 0, 5_000_000, 400_000);

        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.BadConfirmation.selector);
        isa.recordRepayment(second, 5_000_000, 400_000, forFirst);
    }

    /// Only the licensed counterparty may submit. This is also what makes an
    /// off-chain dispute freeze effective: if they stop, nothing is recorded.
    function test_RevertWhen_SomeoneElseSubmitsAValidConfirmation() public {
        uint256 id = _create();
        bytes memory valid = _confirm(recipientKey, id, 0, 5_000_000, 400_000);

        vm.prank(stranger);
        vm.expectRevert(IncomeShare.NotRecorder.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, valid);

        // Not even the funder, who has the most to gain from recording one.
        vm.prank(funder);
        vm.expectRevert(IncomeShare.NotRecorder.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, valid);
    }

    // ───────────── the cap ─────────────

    function test_ReachingTheCapClosesTheAgreementImmediately() public {
        uint256 id = _create();

        _record(id, 0, 100_000_000, CAP); // an unusually good year

        IncomeShare.Agreement memory a = isa.getAgreement(id);
        assertEq(a.totalRepaid, CAP);
        assertEq(uint8(a.state), uint8(IncomeShare.State.Complete), "closed on reaching the cap");
        assertEq(isa.remainingToCap(id), 0);
        assertTrue(isa.isFinished(id));
    }

    function test_RevertWhen_RecordingPastTheCap() public {
        uint256 id = _create();
        _record(id, 0, 50_000_000, CAP - 100);

        bytes memory sig = _confirm(recipientKey, id, 1, 5_000_000, 400_000);
        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.CapExceeded.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, sig);
    }

    function test_RevertWhen_RecordingAgainstAClosedAgreement() public {
        uint256 id = _create();
        _record(id, 0, 100_000_000, CAP);

        bytes memory sig = _confirm(recipientKey, id, 1, 5_000_000, 400_000);
        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.WrongState.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, sig);
    }

    function test_ManyMonthsAccumulateTowardTheCap() public {
        uint256 id = _create();
        uint256 monthly = 400_000;

        for (uint256 i; i < 12; i++) {
            _record(id, i, 5_000_000, monthly);
        }

        assertEq(isa.getAgreement(id).totalRepaid, monthly * 12);
        assertEq(isa.getAgreement(id).repaymentCount, 12);
        assertEq(isa.remainingToCap(id), CAP - monthly * 12);
        assertEq(uint8(isa.getAgreement(id).state), uint8(IncomeShare.State.Active));
    }

    // ───────────── closing ─────────────

    function test_AnyoneMayCloseItOnceTheTermIsOver() public {
        uint256 id = _create();
        _record(id, 0, 5_000_000, 400_000);

        vm.warp(termEnd);
        assertTrue(isa.isFinished(id));

        vm.prank(stranger);
        isa.markComplete(id);

        IncomeShare.Agreement memory a = isa.getAgreement(id);
        assertEq(uint8(a.state), uint8(IncomeShare.State.Complete));
        assertEq(a.totalRepaid, 400_000, "the cap was never reached, and that is fine");
    }

    function test_RevertWhen_ClosingEarly() public {
        uint256 id = _create();
        vm.warp(termEnd - 1);
        vm.expectRevert(IncomeShare.NotFinishedYet.selector);
        isa.markComplete(id);
    }

    function test_RevertWhen_ClosingTwice() public {
        uint256 id = _create();
        vm.warp(termEnd);
        isa.markComplete(id);

        vm.expectRevert(IncomeShare.WrongState.selector);
        isa.markComplete(id);
    }

    function test_RevertWhen_RecordingAfterTheTermIsClosedOut() public {
        uint256 id = _create();
        vm.warp(termEnd);
        isa.markComplete(id);

        bytes memory sig = _confirm(recipientKey, id, 0, 5_000_000, 400_000);
        vm.prank(nbfc);
        vm.expectRevert(IncomeShare.WrongState.selector);
        isa.recordRepayment(id, 5_000_000, 400_000, sig);
    }

    // ───────────── validation ─────────────

    function test_RevertWhen_RecorderIsZero() public {
        vm.expectRevert(IncomeShare.ZeroAddress.selector);
        new IncomeShare(address(0));
    }

    function test_RevertWhen_RecipientIsZero() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.ZeroAddress.selector);
        isa.createAgreement(address(0), FUNDING, PERCENT, CAP, termEnd, AGREEMENT);
    }

    function test_RevertWhen_FundingYourself() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.SelfAgreement.selector);
        isa.createAgreement(funder, FUNDING, PERCENT, CAP, termEnd, AGREEMENT);
    }

    function test_RevertWhen_FundingIsZero() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.ZeroAmount.selector);
        isa.createAgreement(recipient, 0, PERCENT, CAP, termEnd, AGREEMENT);
    }

    function test_RevertWhen_PercentIsZero() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.BadPercent.selector);
        isa.createAgreement(recipient, FUNDING, 0, CAP, termEnd, AGREEMENT);
    }

    function test_RevertWhen_PercentAboveOneHundred() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.BadPercent.selector);
        isa.createAgreement(recipient, FUNDING, 101, CAP, termEnd, AGREEMENT);
    }

    /// A cap below the funding amount is a grant, not an income share.
    function test_RevertWhen_CapIsBelowTheFunding() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.BadCap.selector);
        isa.createAgreement(recipient, FUNDING, PERCENT, FUNDING - 1, termEnd, AGREEMENT);
    }

    /// An agreement with no document behind it is not an agreement.
    function test_RevertWhen_ThereIsNoSignedDocument() public {
        vm.prank(funder);
        vm.expectRevert(IncomeShare.AgreementHashRequired.selector);
        isa.createAgreement(recipient, FUNDING, PERCENT, CAP, termEnd, bytes32(0));
    }

    function test_RevertWhen_TermAlreadyPassed() public {
        uint256 past = block.timestamp - 1;
        vm.prank(funder);
        vm.expectRevert(IncomeShare.TermInPast.selector);
        isa.createAgreement(recipient, FUNDING, PERCENT, CAP, past, AGREEMENT);
    }

    function test_RevertWhen_TermDoesNotFitU64() public {
        uint256 huge = uint256(type(uint64).max) + 1;
        vm.prank(funder);
        vm.expectRevert(IncomeShare.TermInPast.selector);
        isa.createAgreement(recipient, FUNDING, PERCENT, CAP, huge, AGREEMENT);
    }

    function test_RevertWhen_AgreementNotFound() public {
        vm.expectRevert(IncomeShare.AgreementNotFound.selector);
        isa.getAgreement(99);
    }

    function test_AgreementIdsIncrementFromZero() public {
        assertEq(isa.agreementCount(), 0);
        assertEq(_create(), 0);
        assertEq(_create(), 1);
        assertEq(isa.agreementCount(), 2);
    }

    /// The contract never holds value, so this is the honest invariant to
    /// assert: it has no balance, whatever has been recorded against it.
    function test_TheContractNeverHoldsAnything() public {
        uint256 id = _create();
        _record(id, 0, 5_000_000, 400_000);
        assertEq(address(isa).balance, 0, "no native balance, and no token either");
    }

    function testFuzz_RecordedTotalNeverExceedsTheCap(uint8 months, uint64 monthly) public {
        vm.assume(monthly > 0);
        uint256 id = _create();

        uint256 recorded;
        for (uint256 i; i < months; i++) {
            if (recorded + monthly > CAP) break;
            _record(id, i, uint256(monthly) * 12, monthly);
            recorded += monthly;
            if (recorded == CAP) break; // the agreement closed itself
        }

        assertEq(isa.getAgreement(id).totalRepaid, recorded);
        assertLe(isa.getAgreement(id).totalRepaid, CAP, "never past the cap");
    }
}
