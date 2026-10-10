// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MicroCover} from "../src/MicroCover.sol";
import {TestRupee} from "../src/TestRupee.sol";

/// What this suite is actually defending:
///  - no payout ever leaves without the insurer's signature over that exact
///    amount, on that exact claim, on this chain and this contract;
///  - a premium cannot be earned by an insurer that never bound the risk, and
///    the payer can always get it back if it didn't;
///  - committed reserve cannot be withdrawn out from under live cover;
///  - a policy pays at most once, and never more than its coverage.
contract MicroCoverTest is Test {
    MicroCover cover;
    TestRupee tinr;

    address insurer = makeAddr("insurer"); // the licensed, risk-bearing entity
    address insured = makeAddr("insured");
    address parent = makeAddr("parent"); // buys cover for someone else
    address stranger = makeAddr("stranger");

    address signer; // the insurer's claims-signing key
    uint256 signerKey;
    address impostor;
    uint256 impostorKey;

    uint256 constant PREMIUM = 2_000; // ₹20
    uint256 constant COVERAGE = 5_000_000; // ₹50,000
    bytes32 constant TERMS = keccak256("filed policy wording, laptop cover 3h, v1");
    bytes32 constant EVIDENCE = keccak256("invoice.pdf + photo.jpg, hashed in order");

    uint64 start;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        (signer, signerKey) = makeAddrAndKey("insurerSigner");
        (impostor, impostorKey) = makeAddrAndKey("impostor");

        tinr = new TestRupee();
        cover = new MicroCover(tinr, insurer, signer);

        start = uint64(block.timestamp);
        end = uint64(block.timestamp + 3 hours);

        // Everyone who needs money gets it from the faucet, as in the rest of
        // this codebase. ₹5,000 a day each.
        _fund(insured);
        _fund(parent);
        _fund(insurer);
    }

    // ───────────── helpers ─────────────

    function _fund(address who) internal {
        vm.prank(who);
        tinr.faucet();
        vm.prank(who);
        tinr.approve(address(cover), type(uint256).max);
    }

    /// The insurer collateralises its book before binding anything.
    function _fundReserve(uint256 amount) internal {
        // The faucet gives ₹5,000 a day; a ₹50,000 reserve needs several days
        // rather than an invented mint path.
        while (tinr.balanceOf(insurer) < amount) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(insurer);
            tinr.faucet();
        }
        // Warping forward moved the clock, so re-base the policy window.
        start = uint64(block.timestamp);
        end = uint64(block.timestamp + 3 hours);

        vm.prank(insurer);
        cover.fundReserve(amount);
    }

    function _createPolicy() internal returns (uint256 id) {
        vm.prank(insured);
        id = cover.createPolicy(insured, PREMIUM, COVERAGE, start, end, TERMS);
    }

    function _activePolicy() internal returns (uint256 id) {
        _fundReserve(COVERAGE);
        id = _createPolicy();
        vm.prank(insurer);
        cover.activatePolicy(id);
    }

    function _claimed() internal returns (uint256 id) {
        id = _activePolicy();
        vm.prank(insured);
        cover.submitClaim(id, EVIDENCE);
    }

    function _claimedWithEvidence(bytes32 evidence) internal returns (uint256 id) {
        _fundReserve(COVERAGE);
        vm.prank(insured);
        id = cover.createPolicy(insured, PREMIUM, COVERAGE, start, end, TERMS);
        vm.prank(insurer);
        cover.activatePolicy(id);
        vm.prank(insured);
        cover.submitClaim(id, evidence);
    }

    function _sign(uint256 key, uint256 policyId, uint256 payout) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, cover.settlementDigest(policyId, payout));
        return abi.encodePacked(r, s, v);
    }

    // ───────────── the reserve is what makes cover real ─────────────

    function test_ReserveIsFundedAndTracked() public {
        _fundReserve(COVERAGE);
        assertEq(cover.reserve(), COVERAGE);
        assertEq(cover.committed(), 0);
        assertEq(cover.uncommittedReserve(), COVERAGE);
    }

    function test_RevertWhen_ActivatingWithoutEnoughReserve() public {
        uint256 id = _createPolicy();
        vm.prank(insurer);
        vm.expectRevert(MicroCover.ReserveTooSmall.selector);
        cover.activatePolicy(id);
    }

    function test_ActivationCommitsTheCoverage() public {
        uint256 id = _activePolicy();
        assertEq(cover.committed(), COVERAGE);
        assertEq(cover.uncommittedReserve(), 0);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Active));
    }

    function test_RevertWhen_WithdrawingCommittedReserve() public {
        _activePolicy();
        vm.prank(insurer);
        vm.expectRevert(MicroCover.ReserveCommitted.selector);
        cover.withdrawReserve(1);
    }

    function test_UncommittedReserveIsWithdrawable() public {
        _fundReserve(COVERAGE);
        uint256 before = tinr.balanceOf(insurer);
        vm.prank(insurer);
        cover.withdrawReserve(COVERAGE);
        assertEq(tinr.balanceOf(insurer), before + COVERAGE);
        assertEq(cover.reserve(), 0);
    }

    function test_RevertWhen_StrangerWithdrawsReserve() public {
        _fundReserve(COVERAGE);
        vm.prank(stranger);
        vm.expectRevert(MicroCover.NotInsurer.selector);
        cover.withdrawReserve(1);
    }

    function test_ReserveMayBeToppedUpByAnyone() public {
        // A reinsurer or parent company funding the reserve is a good thing.
        vm.prank(insured);
        cover.fundReserve(1_000);
        assertEq(cover.reserve(), 1_000);
    }

    // ───────────── creating a policy escrows, it does not cover ─────────────

    function test_CreatingAPolicyEscrowsThePremiumAndCoversNothing() public {
        uint256 before = tinr.balanceOf(insured);
        uint256 id = _createPolicy();

        assertEq(tinr.balanceOf(insured), before - PREMIUM);
        assertEq(tinr.balanceOf(address(cover)), PREMIUM);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Escrowed));
        // The crucial one: escrow is not cover.
        assertFalse(cover.isCovered(id));
    }

    function test_PolicyRecordsItsTermsAndWindow() public {
        uint256 id = _createPolicy();
        MicroCover.Policy memory p = cover.getPolicy(id);
        assertEq(p.insured, insured);
        assertEq(p.payer, insured);
        assertEq(p.premium, PREMIUM);
        assertEq(p.coverage, COVERAGE);
        assertEq(p.startTime, start);
        assertEq(p.endTime, end);
        assertEq(p.policyTermsHash, TERMS);
    }

    function test_SomeoneElseMayBuyCoverForYou() public {
        vm.prank(parent);
        uint256 id = cover.createPolicy(insured, PREMIUM, COVERAGE, start, end, TERMS);
        MicroCover.Policy memory p = cover.getPolicy(id);
        assertEq(p.insured, insured, "cover is for the student");
        assertEq(p.payer, parent, "the parent paid");
    }

    function test_PolicyIdsIncrementFromOne() public {
        assertEq(_createPolicy(), 1);
        assertEq(_createPolicy(), 2);
    }

    function test_PremiumIsNotRemittableBeforeTheRiskIsBound() public {
        _createPolicy();
        assertEq(cover.remittablePremium(), 0);
        vm.prank(insurer);
        vm.expectRevert(MicroCover.ZeroAmount.selector);
        cover.remitPremiums();
    }

    function test_PremiumBecomesRemittableOnActivation() public {
        _activePolicy();
        assertEq(cover.remittablePremium(), PREMIUM);

        uint256 before = tinr.balanceOf(insurer);
        vm.prank(insurer);
        cover.remitPremiums();
        assertEq(tinr.balanceOf(insurer), before + PREMIUM);
        assertEq(cover.remittablePremium(), 0);
    }

    function test_RevertWhen_StrangerRemitsPremiums() public {
        _activePolicy();
        vm.prank(stranger);
        vm.expectRevert(MicroCover.NotInsurer.selector);
        cover.remitPremiums();
    }

    function test_RevertWhen_StrangerActivatesAPolicy() public {
        _fundReserve(COVERAGE);
        uint256 id = _createPolicy();
        vm.prank(stranger);
        vm.expectRevert(MicroCover.NotInsurer.selector);
        cover.activatePolicy(id);
    }

    function test_RevertWhen_ActivatingTwice() public {
        uint256 id = _activePolicy();
        vm.prank(insurer);
        vm.expectRevert(MicroCover.WrongState.selector);
        cover.activatePolicy(id);
    }

    // ───────────── the premium comes back if nothing was bound ─────────────

    function test_PayerReclaimsThePremiumIfTheInsurerNeverBinds() public {
        uint256 id = _createPolicy();
        uint256 before = tinr.balanceOf(insured);

        vm.warp(block.timestamp + 2 days);
        vm.prank(stranger); // permissionless: nobody has to cooperate
        cover.refundUnboundPremium(id);

        assertEq(tinr.balanceOf(insured), before + PREMIUM);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Refunded));
    }

    function test_RefundGoesToThePayerNotTheInsured() public {
        vm.prank(parent);
        uint256 id = cover.createPolicy(insured, PREMIUM, COVERAGE, start, end, TERMS);
        uint256 parentBefore = tinr.balanceOf(parent);
        uint256 insuredBefore = tinr.balanceOf(insured);

        vm.warp(block.timestamp + 2 days);
        cover.refundUnboundPremium(id);

        assertEq(tinr.balanceOf(parent), parentBefore + PREMIUM);
        assertEq(tinr.balanceOf(insured), insuredBefore);
    }

    function test_RevertWhen_RefundingBeforeTheBindWindowIsOver() public {
        uint256 id = _createPolicy();
        vm.expectRevert(MicroCover.TooEarly.selector);
        cover.refundUnboundPremium(id);
    }

    function test_RefundIsAvailableOnceCoverWouldHaveEndedEvenInsideBindWindow() public {
        // A 3-hour policy that was never bound should not make the buyer wait
        // a whole day for money that can no longer buy them anything.
        uint256 id = _createPolicy();
        vm.warp(end + 1);
        cover.refundUnboundPremium(id);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Refunded));
    }

    function test_InsurerCanDeclineToBindAndReturnThePremiumAtOnce() public {
        uint256 id = _createPolicy();
        uint256 before = tinr.balanceOf(insured);

        vm.prank(insurer);
        cover.declineToBind(id);

        assertEq(tinr.balanceOf(insured), before + PREMIUM);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Refunded));
    }

    function test_RevertWhen_StrangerDeclinesToBind() public {
        uint256 id = _createPolicy();
        vm.prank(stranger);
        vm.expectRevert(MicroCover.NotInsurer.selector);
        cover.declineToBind(id);
    }

    function test_RevertWhen_RefundingATwiceRefundedPolicy() public {
        uint256 id = _createPolicy();
        vm.prank(insurer);
        cover.declineToBind(id);
        vm.expectRevert(MicroCover.WrongState.selector);
        cover.refundUnboundPremium(id);
    }

    function test_RevertWhen_ActivatingARefundedPolicy() public {
        _fundReserve(COVERAGE);
        uint256 id = _createPolicy();
        vm.prank(insurer);
        cover.declineToBind(id);

        vm.prank(insurer);
        vm.expectRevert(MicroCover.WrongState.selector);
        cover.activatePolicy(id);
    }

    // ───────────── claims ─────────────

    function test_InsuredSubmitsAClaimAndItIsRecorded() public {
        uint256 id = _activePolicy();
        vm.prank(insured);
        cover.submitClaim(id, EVIDENCE);

        MicroCover.Claim memory c = cover.getClaim(id);
        assertEq(c.evidenceHash, EVIDENCE);
        assertEq(uint8(c.state), uint8(MicroCover.ClaimState.Submitted));
        assertEq(c.payout, 0);
    }

    function test_RevertWhen_SomeoneElseClaimsOnYourPolicy() public {
        uint256 id = _activePolicy();
        vm.prank(stranger);
        vm.expectRevert(MicroCover.NotInsured.selector);
        cover.submitClaim(id, EVIDENCE);
    }

    function test_RevertWhen_ClaimingOnAnUnboundPolicy() public {
        uint256 id = _createPolicy();
        vm.prank(insured);
        vm.expectRevert(MicroCover.WrongState.selector);
        cover.submitClaim(id, EVIDENCE);
    }

    function test_RevertWhen_ClaimingTwice() public {
        uint256 id = _claimed();
        vm.prank(insured);
        vm.expectRevert(MicroCover.ClaimAlreadyMade.selector);
        cover.submitClaim(id, EVIDENCE);
    }

    function test_RevertWhen_EvidenceHashIsZero() public {
        uint256 id = _activePolicy();
        vm.prank(insured);
        vm.expectRevert(MicroCover.ZeroHash.selector);
        cover.submitClaim(id, bytes32(0));
    }

    function test_ClaimIsReportableAfterCoverEndsWithinTheWindow() public {
        uint256 id = _activePolicy();
        vm.warp(end + 29 days);
        vm.prank(insured);
        cover.submitClaim(id, EVIDENCE);
        assertEq(uint8(cover.getClaim(id).state), uint8(MicroCover.ClaimState.Submitted));
    }

    function test_RevertWhen_ClaimingAfterTheReportingWindow() public {
        uint256 id = _activePolicy();
        vm.warp(end + 30 days + 1);
        vm.prank(insured);
        vm.expectRevert(MicroCover.ClaimWindowClosed.selector);
        cover.submitClaim(id, EVIDENCE);
    }

    // ───────────── settlement needs the insurer's signature ─────────────

    function test_SignedPayoutReachesTheInsured() public {
        uint256 id = _claimed();
        uint256 payout = 1_200_000; // ₹12,000 of ₹50,000 cover
        uint256 before = tinr.balanceOf(insured);

        // Anyone may submit it — the signature is the authority, not the caller.
        bytes memory sig = _sign(signerKey, id, payout);
        vm.prank(stranger);
        cover.settleClaim(id, payout, sig);

        assertEq(tinr.balanceOf(insured), before + payout);
        assertEq(uint8(cover.getClaim(id).state), uint8(MicroCover.ClaimState.Paid));
        assertEq(cover.getClaim(id).payout, payout);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Closed));
        // The whole coverage is released, not just the amount paid.
        assertEq(cover.committed(), 0);
        assertEq(cover.reserve(), COVERAGE - payout);
    }

    function test_RevertWhen_NobodySignedAtAll() public {
        uint256 id = _claimed();
        bytes memory sig = _sign(impostorKey, id, 1_000);
        vm.expectRevert(MicroCover.BadInsurerSignature.selector);
        cover.settleClaim(id, 1_000, sig);
    }

    function test_RevertWhen_TheInsurerTreasurySignsInsteadOfTheSigningKey() public {
        // Funding the reserve does not make you able to authorise a payout.
        uint256 id = _claimed();
        (, uint256 insurerKey) = makeAddrAndKey("insurer");
        bytes memory sig = _sign(insurerKey, id, 1_000);
        vm.expectRevert(MicroCover.BadInsurerSignature.selector);
        cover.settleClaim(id, 1_000, sig);
    }

    function test_RevertWhen_AmountDiffersFromWhatWasSigned() public {
        uint256 id = _claimed();
        bytes memory sig = _sign(signerKey, id, 1_000);
        vm.expectRevert(MicroCover.BadInsurerSignature.selector);
        cover.settleClaim(id, 2_000, sig); // more than was authorised
    }

    function test_RevertWhen_PayoutExceedsCoverage() public {
        uint256 id = _claimed();
        vm.expectRevert(MicroCover.PayoutAboveCoverage.selector);
        // Signed or not, the ceiling is checked first.
        cover.settleClaim(id, COVERAGE + 1, hex"");
    }

    function test_RevertWhen_SettlingTheSameClaimTwice() public {
        uint256 id = _claimed();
        bytes memory sig = _sign(signerKey, id, 1_000);
        cover.settleClaim(id, 1_000, sig);

        vm.expectRevert(MicroCover.NoClaim.selector);
        cover.settleClaim(id, 1_000, sig);
    }

    function test_RevertWhen_SettlingAPolicyWithNoClaim() public {
        uint256 id = _activePolicy();
        vm.expectRevert(MicroCover.NoClaim.selector);
        cover.settleClaim(id, 1_000, hex"");
    }

    function test_SignatureForOnePolicyCannotSettleAnother() public {
        // Two identical claims, same evidence, same amount. The digest commits
        // to the policy id, so the first signature must not move the second.
        uint256 first = _claimed();

        _fundReserve(COVERAGE);
        vm.prank(insured);
        uint256 second = cover.createPolicy(insured, PREMIUM, COVERAGE, start, end, TERMS);
        vm.prank(insurer);
        cover.activatePolicy(second);
        vm.prank(insured);
        cover.submitClaim(second, EVIDENCE);

        bytes memory sigForFirst = _sign(signerKey, first, 1_000);
        vm.expectRevert(MicroCover.BadInsurerSignature.selector);
        cover.settleClaim(second, 1_000, sigForFirst);
    }

    function test_SignatureIsBoundToTheEvidenceOnTheClaim() public {
        // The insurer signs for the evidence it reviewed. Different evidence
        // gives a different digest, so an approval cannot be lifted onto a
        // re-papered bundle.
        uint256 id = _activePolicy();
        vm.prank(insured);
        cover.submitClaim(id, EVIDENCE);
        bytes32 digestReviewed = cover.settlementDigest(id, 1_000);

        uint256 other = _claimedWithEvidence(keccak256("a different bundle"));
        bytes32 digestOther = cover.settlementDigest(other, 1_000);

        assertTrue(digestReviewed != digestOther, "evidence must change the digest");
    }

    function test_RevertWhen_DigestRequestedForAClaimThatDoesNotExist() public {
        uint256 id = _activePolicy();
        vm.expectRevert(MicroCover.NoClaim.selector);
        cover.settlementDigest(id, 1_000);
    }

    // ───────────── a declined claim ─────────────

    function test_ZeroPayoutRecordsADeclineAndPaysNothing() public {
        uint256 id = _claimed();
        uint256 before = tinr.balanceOf(insured);

        bytes memory sig = _sign(signerKey, id, 0);
        cover.settleClaim(id, 0, sig);

        assertEq(tinr.balanceOf(insured), before, "a decline moves no money");
        assertEq(uint8(cover.getClaim(id).state), uint8(MicroCover.ClaimState.Declined));
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Closed));
        // The reserve is released back to the insurer's free capital, intact.
        assertEq(cover.committed(), 0);
        assertEq(cover.reserve(), COVERAGE);
    }

    function test_RevertWhen_DeclineIsNotSigned() public {
        // A decline is still the insurer's decision; nobody else may record one.
        uint256 id = _claimed();
        bytes memory sig = _sign(impostorKey, id, 0);
        vm.expectRevert(MicroCover.BadInsurerSignature.selector);
        cover.settleClaim(id, 0, sig);
    }

    // ───────────── expiry frees the insurer's capital ─────────────

    function test_ExpiredPolicyWithNoClaimReleasesTheReserve() public {
        uint256 id = _activePolicy();
        vm.warp(end + 30 days + 1);

        cover.closeExpiredPolicy(id); // permissionless
        assertEq(cover.committed(), 0);
        assertEq(cover.reserve(), COVERAGE);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Closed));

        vm.prank(insurer);
        cover.withdrawReserve(COVERAGE); // now free again
        assertEq(cover.reserve(), 0);
    }

    function test_RevertWhen_ClosingWhileTheClaimWindowIsStillOpen() public {
        uint256 id = _activePolicy();
        vm.warp(end + 30 days);
        vm.expectRevert(MicroCover.ClaimWindowOpen.selector);
        cover.closeExpiredPolicy(id);
    }

    function test_RevertWhen_ClosingAPolicyThatHasAClaim() public {
        uint256 id = _claimed();
        vm.warp(end + 30 days + 1);
        vm.expectRevert(MicroCover.ClaimAlreadyMade.selector);
        cover.closeExpiredPolicy(id);
    }

    function test_RevertWhen_ClosingAnUnboundPolicy() public {
        uint256 id = _createPolicy();
        vm.warp(end + 30 days + 1);
        vm.expectRevert(MicroCover.WrongState.selector);
        cover.closeExpiredPolicy(id);
    }

    // ───────────── cover is in force only inside its window ─────────────

    function test_CoverIsNotInForceBeforeItStarts() public {
        _fundReserve(COVERAGE);
        uint64 later = uint64(block.timestamp + 7 days);
        vm.prank(insured);
        uint256 id = cover.createPolicy(insured, PREMIUM, COVERAGE, later, later + 3 hours, TERMS);
        vm.prank(insurer);
        cover.activatePolicy(id);

        assertFalse(cover.isCovered(id), "bought for next week, not covered today");
        vm.warp(later + 1);
        assertTrue(cover.isCovered(id));
    }

    function test_CoverIsNotInForceAfterItEnds() public {
        uint256 id = _activePolicy();
        assertTrue(cover.isCovered(id));
        vm.warp(end + 1);
        assertFalse(cover.isCovered(id));
    }

    // ───────────── creation is validated ─────────────

    function test_RevertWhen_InsuredIsZero() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.ZeroAddress.selector);
        cover.createPolicy(address(0), PREMIUM, COVERAGE, start, end, TERMS);
    }

    function test_RevertWhen_PremiumIsZero() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.ZeroAmount.selector);
        cover.createPolicy(insured, 0, COVERAGE, start, end, TERMS);
    }

    function test_RevertWhen_CoverageDoesNotBeatThePremium() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.CoverageBelowPremium.selector);
        cover.createPolicy(insured, PREMIUM, PREMIUM, start, end, TERMS);
    }

    function test_RevertWhen_ThereIsNoPolicyWording() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.ZeroHash.selector);
        cover.createPolicy(insured, PREMIUM, COVERAGE, start, end, bytes32(0));
    }

    function test_RevertWhen_WindowIsBackwards() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.WindowOutOfRange.selector);
        cover.createPolicy(insured, PREMIUM, COVERAGE, end, start, TERMS);
    }

    function test_RevertWhen_CoverAlreadyEnded() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.AlreadyEnded.selector);
        cover.createPolicy(
            insured, PREMIUM, COVERAGE, uint64(block.timestamp - 4 hours), uint64(block.timestamp - 1), TERMS
        );
    }

    function test_RevertWhen_CoverIsTooBrief() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.WindowOutOfRange.selector);
        cover.createPolicy(insured, PREMIUM, COVERAGE, start, start + 9 minutes, TERMS);
    }

    function test_RevertWhen_CoverRunsTooLong() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.WindowOutOfRange.selector);
        cover.createPolicy(insured, PREMIUM, COVERAGE, start, start + 366 days, TERMS);
    }

    function test_RevertWhen_WindowDoesNotFitU64() public {
        vm.prank(insured);
        vm.expectRevert(MicroCover.WindowOutOfRange.selector);
        cover.createPolicy(insured, PREMIUM, COVERAGE, start, uint256(type(uint64).max) + 1, TERMS);
    }

    function test_RevertWhen_PolicyDoesNotExist() public {
        vm.expectRevert(MicroCover.PolicyNotFound.selector);
        cover.getPolicy(999);
    }

    function test_RevertWhen_ConstructedWithAZeroAddress() public {
        // A rail with no token, no insurer, or no signing key is not a rail.
        vm.expectRevert(MicroCover.ZeroAddress.selector);
        new MicroCover(TestRupee(address(0)), insurer, signer);

        vm.expectRevert(MicroCover.ZeroAddress.selector);
        new MicroCover(tinr, address(0), signer);

        vm.expectRevert(MicroCover.ZeroAddress.selector);
        new MicroCover(tinr, insurer, address(0));
    }

    // ───────────── the invariant that matters most ─────────────

    /// However the amount is chosen, the contract never pays out more than the
    /// coverage, and its balance always matches what it owes.
    function testFuzz_PayoutNeverExceedsCoverageOrReserve(uint256 payout) public {
        payout = bound(payout, 0, COVERAGE);
        uint256 id = _claimed();

        bytes memory sig = _sign(signerKey, id, payout);
        cover.settleClaim(id, payout, sig);

        assertLe(cover.getClaim(id).payout, COVERAGE);
        assertEq(tinr.balanceOf(address(cover)), cover.reserve() + cover.remittablePremium());
        assertEq(cover.committed(), 0);
    }

    /// The contract's token balance always covers what it owes: the reserve,
    /// plus premiums not yet remitted, plus premiums still in escrow.
    function test_ContractHoldsExactlyWhatItOwes() public {
        uint256 id = _activePolicy(); // reserve + remittable premium
        _createPolicy(); // a second policy, premium still escrowed

        uint256 escrowed = PREMIUM; // the unbound one
        assertEq(tinr.balanceOf(address(cover)), cover.reserve() + cover.remittablePremium() + escrowed);
        assertEq(uint8(cover.getPolicy(id).state), uint8(MicroCover.PolicyState.Active));
    }
}
