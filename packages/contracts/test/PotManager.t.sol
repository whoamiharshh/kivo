// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {PotManager} from "../src/PotManager.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PotManagerTest is Test {
    TestRupee token;
    PotManager mgr;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address eve = makeAddr("eve");

    bytes32 constant CODE = keccak256("invite-secret");
    bytes32 inviteHash;

    /// The app server's join-authorization key. The digest is recomputed in
    /// these tests rather than read back from the contract, so a change to
    /// `joinDigest` has to be matched here on purpose instead of agreeing
    /// with itself.
    address trustSigner;
    uint256 trustKey;

    uint256 constant LIMIT = 100_000; // ₹1,000.00
    uint256 constant RS2000 = 200_000;
    uint256 constant TARGET = 600_000; // ₹6,000.00 — three people at ₹2,000

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        (trustSigner, trustKey) = makeAddrAndKey("trust-signer");
        mgr = new PotManager(token, trustSigner);
        inviteHash = keccak256(abi.encodePacked(CODE));

        address[4] memory users = [alice, bob, carol, eve];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(mgr), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ───────────── helpers ─────────────

    function _soon() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    /// How long a join authorization is good for.
    function _exp() internal view returns (uint64) {
        return uint64(block.timestamp + 10 minutes);
    }

    /// The join digest, recomputed here rather than read from the contract.
    ///
    /// Deliberately not a call to `mgr`: `vm.sign` is a cheatcode and leaves an
    /// active `vm.prank` alone, but an external view call on `mgr` would
    /// consume it.
    function _joinDigest(uint256 potId, address joiner, uint64 expiry) internal view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(keccak256("PotManager.join.v1"), address(mgr), block.chainid, potId, joiner, expiry))
        );
    }

    function _authFor(uint256 potId, address joiner, uint64 expiry, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _joinDigest(potId, joiner, expiry));
        return abi.encodePacked(r, s, v);
    }

    /// A valid, fresh authorization from the real signer.
    function _auth(uint256 potId, address joiner) internal view returns (bytes memory) {
        return _authFor(potId, joiner, _exp(), trustKey);
    }

    function _create(uint256 target, uint32 maxMembers) internal returns (uint256 id) {
        vm.prank(alice);
        id = mgr.createPot(inviteHash, LIMIT, maxMembers, target, _soon());
    }

    /// alice creates, bob + carol join. Still Collecting.
    function _openPot() internal returns (uint256 id) {
        id = _create(TARGET, 5);
        vm.prank(bob);
        mgr.join(id, CODE, _exp(), _auth(id, bob));
        vm.prank(carol);
        mgr.join(id, CODE, _exp(), _auth(id, carol));
    }

    /// A pot that reached its target: three people at ₹2,000 each.
    function _fundedPot() internal returns (uint256 id) {
        id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.prank(bob);
        mgr.deposit(id, RS2000);
        vm.prank(carol);
        mgr.deposit(id, RS2000);
    }

    function _assertState(uint256 id, PotManager.PotState want) internal view {
        assertEq(uint8(mgr.getPot(id).state), uint8(want), "unexpected pot state");
    }

    // ───────────── creating ─────────────

    function test_CreateAndJoin() public {
        uint256 id = _fundedPot();
        assertEq(mgr.getMembers(id).length, 3);
        assertEq(mgr.getPot(id).balance, TARGET);
        assertEq(mgr.contributed(id, bob), RS2000);
    }

    function test_CreateStartsCollectingWithTargetAndDeadline() public {
        uint64 deadline = _soon();
        vm.prank(alice);
        uint256 id = mgr.createPot(inviteHash, LIMIT, 5, TARGET, deadline);

        PotManager.PotInfo memory p = mgr.getPot(id);
        _assertState(id, PotManager.PotState.Collecting);
        assertEq(p.targetAmount, TARGET);
        assertEq(p.deadline, deadline);
        assertEq(p.creator, alice);
        assertEq(p.memberCount, 1, "creator joins automatically");
        assertEq(p.balance, 0);
        assertEq(mgr.remainingToTarget(id), TARGET);
    }

    function test_RevertWhen_TargetIsZero() public {
        vm.prank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, LIMIT, 5, 0, _soon());
    }

    function test_RevertWhen_DeadlineInThePast() public {
        vm.prank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, LIMIT, 5, TARGET, uint64(block.timestamp - 1));
    }

    function test_RevertWhen_DeadlineIsNow() public {
        vm.prank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, LIMIT, 5, TARGET, uint64(block.timestamp));
    }

    function test_RevertWhen_DeadlineBeyondHorizon() public {
        vm.prank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, LIMIT, 5, TARGET, uint64(block.timestamp + 366 days));
    }

    function test_RevertWhen_MaxMembersOutOfRange() public {
        // Read the cap first: expectRevert applies to the very next call, and a
        // view call in between would consume it.
        uint32 overCap = mgr.MAX_MEMBERS_CAP() + 1;
        uint64 deadline = _soon();

        vm.startPrank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, LIMIT, 1, TARGET, deadline);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, LIMIT, overCap, TARGET, deadline);
        vm.stopPrank();
    }

    function test_RevertWhen_InviteHashIsZero() public {
        vm.prank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(bytes32(0), LIMIT, 5, TARGET, _soon());
    }

    function test_RevertWhen_PotNotFound() public {
        vm.expectRevert(PotManager.PotNotFound.selector);
        mgr.getPot(999);
    }

    // ───────────── joining ─────────────

    // --------------- C-1: the code alone is not enough ---------------

    /// The whole point of the fix. Somebody holding the code - scraped out of a
    /// past join transaction, or leaked from anywhere - still cannot get in.
    function test_RevertWhen_JoinAuthorizationIsSignedByTheWrongKey() public {
        uint256 id = _create(TARGET, 5);
        (, uint256 impostorKey) = makeAddrAndKey("impostor");
        bytes memory sig = _authFor(id, eve, _exp(), impostorKey);

        vm.prank(eve);
        vm.expectRevert(PotManager.BadAuthorization.selector);
        mgr.join(id, CODE, _exp(), sig);
    }

    function test_RevertWhen_JoinAuthorizationHasExpired() public {
        uint256 id = _create(TARGET, 5);
        uint64 expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _authFor(id, eve, expiry, trustKey);

        vm.warp(expiry);
        vm.prank(eve);
        vm.expectRevert(PotManager.AuthorizationExpired.selector);
        mgr.join(id, CODE, expiry, sig);
    }

    /// An authorization naming bob does not let eve in, even with the code.
    function test_RevertWhen_JoinAuthorizationNamesSomeoneElse() public {
        uint256 id = _create(TARGET, 5);
        bytes memory forBob = _auth(id, bob);

        vm.prank(eve);
        vm.expectRevert(PotManager.BadAuthorization.selector);
        mgr.join(id, CODE, _exp(), forBob);
    }

    /// Nor does an authorization for one pot work on another.
    function test_RevertWhen_JoinAuthorizationIsForAnotherPot() public {
        uint256 first = _create(TARGET, 5);
        uint256 second = _create(TARGET, 5);
        bytes memory forFirst = _auth(first, bob);

        vm.prank(bob);
        vm.expectRevert(PotManager.BadAuthorization.selector);
        mgr.join(second, CODE, _exp(), forFirst);
    }

    /// Replay needs no nonce mapping: the pair (pot, joiner) joins only once.
    function test_JoinAuthorizationCannotBeUsedTwice() public {
        uint256 id = _create(TARGET, 5);
        uint64 expiry = _exp();
        bytes memory sig = _authFor(id, bob, expiry, trustKey);

        vm.prank(bob);
        mgr.join(id, CODE, expiry, sig);
        assertTrue(mgr.isMember(id, bob));

        vm.prank(bob);
        vm.expectRevert(PotManager.AlreadyMember.selector);
        mgr.join(id, CODE, expiry, sig);
    }

    /// The contract's own digest must agree with the formula the server uses.
    function test_JoinDigestMatchesTheIndependentlyComputedOne() public view {
        uint64 expiry = _exp();
        assertEq(mgr.joinDigest(1, bob, expiry), _joinDigest(1, bob, expiry));
    }

    function test_RevertWhen_ConstructedWithAZeroTrustSigner() public {
        vm.expectRevert(PotManager.InvalidParams.selector);
        new PotManager(token, address(0));
    }

    /// A valid authorization is still not a way past the code.
    function test_RevertWhen_BadInviteCode() public {
        uint256 id = _create(TARGET, 5);
        vm.prank(eve);
        vm.expectRevert(PotManager.BadInviteCode.selector);
        mgr.join(id, keccak256("wrong"), _exp(), _auth(id, eve));
    }

    function test_RevertWhen_PotFull() public {
        uint256 id = _create(TARGET, 2);
        vm.prank(bob);
        mgr.join(id, CODE, _exp(), _auth(id, bob));
        vm.prank(carol);
        vm.expectRevert(PotManager.PotFull.selector);
        mgr.join(id, CODE, _exp(), _auth(id, carol));
    }

    function test_RevertWhen_JoinTwice() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        vm.expectRevert(PotManager.AlreadyMember.selector);
        mgr.join(id, CODE, _exp(), _auth(id, bob));
    }

    function test_RevertWhen_JoinAfterDeadline() public {
        uint256 id = _create(TARGET, 5);
        vm.warp(block.timestamp + 8 days);
        vm.prank(bob);
        vm.expectRevert(PotManager.DeadlinePassed.selector);
        mgr.join(id, CODE, _exp(), _auth(id, bob));
    }

    /// A friend who paid for something can still be added so the pot can repay them.
    function test_JoinFundedPotIsAllowed() public {
        uint256 id = _fundedPot();
        vm.prank(eve);
        mgr.join(id, CODE, _exp(), _auth(id, eve));
        assertTrue(mgr.isMember(id, eve));
        assertEq(mgr.contributed(id, eve), 0);
    }

    function test_RevertWhen_JoinRefundingPot() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(eve);
        vm.expectRevert(PotManager.NotCollecting.selector);
        mgr.join(id, CODE, _exp(), _auth(id, eve));
    }

    // --------------- C-1b: who may approve a payout ---------------

    /// The hole: the recipient of an over-limit payout signing it off
    /// themselves. One member types the request, the other approves money into
    /// their own hands, and "a second person agrees" has done nothing.
    function test_RevertWhen_TheRecipientApprovesTheirOwnPayout() public {
        uint256 id = _fundedPot();
        uint256 over = LIMIT + 1;

        vm.prank(alice);
        uint256 spendId = mgr.requestSpend(id, bob, over, keccak256("cab"));

        vm.prank(bob);
        vm.expectRevert(PotManager.CannotApproveOwnPayout.selector);
        mgr.approveSpend(id, spendId);

        // And the money is still held, not lost.
        assertEq(mgr.availableBalance(id), TARGET - over);
    }

    /// A genuinely independent third member can approve it, and it pays out.
    function test_AThirdMemberApprovesAPayoutBetweenTheOtherTwo() public {
        uint256 id = _fundedPot();
        uint256 over = LIMIT + 1;
        uint256 b0 = token.balanceOf(bob);

        vm.prank(alice);
        uint256 spendId = mgr.requestSpend(id, bob, over, keccak256("cab"));
        vm.prank(carol);
        mgr.approveSpend(id, spendId);

        assertEq(token.balanceOf(bob) - b0, over);
        assertTrue(mgr.getSpend(id, spendId).executed);
    }

    /// Repaying yourself needs somebody else, and that still works: requester
    /// and recipient are the same person, so any other member is independent.
    function test_SelfRepaymentIsApprovedByAnyOtherMember() public {
        uint256 id = _fundedPot();
        uint256 a0 = token.balanceOf(alice);

        vm.prank(alice);
        uint256 spendId = mgr.requestSpend(id, alice, RS2000, keccak256("alice paid the deposit"));
        vm.prank(bob);
        mgr.approveSpend(id, spendId);

        assertEq(token.balanceOf(alice) - a0, RS2000);
    }

    /// The honest consequence, pinned down so nobody discovers it in a demo.
    /// In a two-member pot there is no third person, so an over-limit payout
    /// from one member to the other cannot be approved by anybody. The pot has
    /// to live inside its approval limit, or add a member. The money is not
    /// stuck: cancel the request and it is spendable again.
    function test_TwoMemberPotCannotApproveAnOverLimitPayoutToTheOtherMember() public {
        uint256 id = _create(TARGET, 2);
        vm.prank(bob);
        mgr.join(id, CODE, _exp(), _auth(id, bob));
        vm.prank(alice);
        mgr.deposit(id, 300_000);
        vm.prank(bob);
        mgr.deposit(id, 300_000);
        _assertState(id, PotManager.PotState.Funded);

        uint256 over = LIMIT + 1;
        vm.prank(alice);
        uint256 spendId = mgr.requestSpend(id, bob, over, keccak256("too big"));

        // Nobody can approve it: alice is the requester, bob is the recipient.
        vm.prank(alice);
        vm.expectRevert(PotManager.CannotApproveOwnSpend.selector);
        mgr.approveSpend(id, spendId);
        vm.prank(bob);
        vm.expectRevert(PotManager.CannotApproveOwnPayout.selector);
        mgr.approveSpend(id, spendId);

        // But it can be cancelled, and the money goes back to being spendable.
        vm.prank(alice);
        mgr.cancelSpend(id, spendId);
        assertEq(mgr.availableBalance(id), TARGET);

        // Inside the limit, the same payout needs nobody.
        vm.prank(alice);
        mgr.requestSpend(id, bob, LIMIT, keccak256("small enough"));
        assertEq(mgr.availableBalance(id), TARGET - LIMIT);
    }

    // ───────────── contributing ─────────────

    function test_ContributionBelowTargetStaysCollecting() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);

        _assertState(id, PotManager.PotState.Collecting);
        assertEq(mgr.getPot(id).totalContributed, RS2000);
        assertEq(mgr.remainingToTarget(id), TARGET - RS2000);
    }

    function test_ContributionExactlyAtTargetFundsThePot() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.prank(bob);
        mgr.deposit(id, RS2000);

        _assertState(id, PotManager.PotState.Collecting);

        vm.expectEmit(true, false, false, true, address(mgr));
        emit PotManager.PotFunded(id, TARGET);
        vm.prank(carol);
        mgr.deposit(id, RS2000);

        _assertState(id, PotManager.PotState.Funded);
        assertEq(mgr.remainingToTarget(id), 0);
    }

    /// Asking to add more than the pot needs contributes the remainder only.
    function test_ContributionBeyondTargetIsPartiallyFilled() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.prank(bob);
        mgr.deposit(id, RS2000);
        // ₹2,000 still needed; carol offers ₹5,000.

        uint256 walletBefore = token.balanceOf(carol);
        vm.prank(carol);
        uint256 accepted = mgr.deposit(id, 500_000);

        assertEq(accepted, RS2000, "only the shortfall is taken");
        assertEq(walletBefore - token.balanceOf(carol), RS2000, "the rest stays with her");
        assertEq(mgr.contributed(id, carol), RS2000);
        assertEq(mgr.getPot(id).totalContributed, TARGET, "never overshoots the target");
        _assertState(id, PotManager.PotState.Funded);
    }

    function test_RevertWhen_DepositAtDeadline() public {
        uint256 id = _openPot();
        vm.warp(mgr.getPot(id).deadline);
        vm.prank(alice);
        vm.expectRevert(PotManager.DeadlinePassed.selector);
        mgr.deposit(id, RS2000);
    }

    function test_RevertWhen_DepositAfterDeadline() public {
        uint256 id = _openPot();
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        vm.expectRevert(PotManager.DeadlinePassed.selector);
        mgr.deposit(id, RS2000);
    }

    function test_RevertWhen_DepositZero() public {
        uint256 id = _openPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.ZeroAmount.selector);
        mgr.deposit(id, 0);
    }

    function test_RevertWhen_NonMemberDeposits() public {
        uint256 id = _openPot();
        vm.prank(eve);
        vm.expectRevert(PotManager.NotMember.selector);
        mgr.deposit(id, 1_000);
    }

    function test_RevertWhen_DepositIntoFundedPot() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.NotCollecting.selector);
        mgr.deposit(id, 1_000);
    }

    function test_RevertWhen_DepositIntoRefundingPot() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(bob);
        vm.expectRevert(PotManager.NotCollecting.selector);
        mgr.deposit(id, 1_000);
    }

    // ───────────── spending rules ─────────────

    function test_SmallPayoutToOtherMemberIsInstant() public {
        uint256 id = _fundedPot();
        uint256 before = token.balanceOf(bob);
        vm.prank(alice);
        mgr.requestSpend(id, bob, 50_000, bytes32("cab"));
        assertEq(token.balanceOf(bob), before + 50_000);
        assertEq(mgr.getPot(id).balance, TARGET - 50_000);
    }

    function test_LargePayoutNeedsApproval() public {
        uint256 id = _fundedPot();
        uint256 before = token.balanceOf(bob);
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 150_000, bytes32("hotel"));
        assertEq(token.balanceOf(bob), before, "should be pending");
        assertFalse(mgr.getSpend(id, sid).executed);

        vm.prank(carol);
        mgr.approveSpend(id, sid);
        assertEq(token.balanceOf(bob), before + 150_000);
        assertTrue(mgr.getSpend(id, sid).executed);
    }

    function test_SelfPayoutAlwaysNeedsApproval() public {
        uint256 id = _fundedPot();
        uint256 before = token.balanceOf(bob);
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 10_000, bytes32("chai"));
        assertEq(token.balanceOf(bob), before, "self payout must wait");

        vm.prank(alice);
        mgr.approveSpend(id, sid);
        assertEq(token.balanceOf(bob), before + 10_000);
    }

    function test_RevertWhen_RequesterApprovesOwnSpend() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 10_000, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(PotManager.CannotApproveOwnSpend.selector);
        mgr.approveSpend(id, sid);
    }

    function test_RevertWhen_ApproveExecutedSpend() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 150_000, bytes32(0));
        vm.prank(carol);
        mgr.approveSpend(id, sid);
        vm.prank(bob);
        vm.expectRevert(PotManager.SpendAlreadyExecuted.selector);
        mgr.approveSpend(id, sid);
    }

    function test_RevertWhen_ApproveUnknownSpend() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        vm.expectRevert(PotManager.SpendNotFound.selector);
        mgr.approveSpend(id, 42);
    }

    function test_RevertWhen_NonMemberApproves() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 150_000, bytes32(0));
        vm.prank(eve);
        vm.expectRevert(PotManager.NotMember.selector);
        mgr.approveSpend(id, sid);
    }

    function test_RevertWhen_PayoutToNonMember() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.RecipientNotMember.selector);
        mgr.requestSpend(id, eve, 10_000, bytes32(0));
    }

    function test_RevertWhen_PayoutOverBalance() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.InsufficientBalance.selector);
        mgr.requestSpend(id, bob, TARGET + 1, bytes32(0));
    }

    function test_RevertWhen_PayoutIsZero() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.ZeroAmount.selector);
        mgr.requestSpend(id, bob, 0, bytes32(0));
    }

    /// A pending request holds its money, so a second request cannot be made
    /// against the same rupees in the first place.
    function test_PendingRequestReservesTheMoney() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.requestSpend(id, bob, 500_000, bytes32(0)); // pending: ₹5,000 of ₹6,000

        assertEq(mgr.getPot(id).reserved, 500_000);
        assertEq(mgr.availableBalance(id), 100_000);

        // Only ₹1,000 is actually free, so asking for ₹2,000 is refused now
        // rather than failing confusingly at approval time.
        vm.prank(bob);
        vm.expectRevert(PotManager.InsufficientBalance.selector);
        mgr.requestSpend(id, carol, 200_000, bytes32(0));

        // What does fit is fine.
        vm.prank(bob);
        mgr.requestSpend(id, carol, 100_000, bytes32(0));
        assertEq(mgr.availableBalance(id), 0);
    }

    function test_ApprovingReleasesTheReservation() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 500_000, bytes32(0));
        assertEq(mgr.getPot(id).reserved, 500_000);

        vm.prank(carol);
        mgr.approveSpend(id, sid);

        PotManager.PotInfo memory info = mgr.getPot(id);
        assertEq(info.reserved, 0, "hold released");
        assertEq(info.pendingSpendCount, 0);
        assertEq(info.balance, TARGET - 500_000);
    }

    // ───────────── spending is gated on state ─────────────

    function test_RevertWhen_SpendBeforeFunded() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.requestSpend(id, bob, 1_000, bytes32(0));
    }

    function test_RevertWhen_SpendAfterRefunding() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.requestSpend(id, bob, 1_000, bytes32(0));
    }

    function test_RevertWhen_SpendAfterClose() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.closePot(id);
        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.requestSpend(id, bob, 1_000, bytes32(0));
    }

    /// Closing must not quietly throw away a repayment someone is owed.
    function test_RevertWhen_CloseWithPendingRequest() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.requestSpend(id, bob, 150_000, bytes32(0)); // pending

        vm.prank(alice);
        vm.expectRevert(PotManager.PendingRequests.selector);
        mgr.closePot(id);
    }

    function test_CloseWorksOncePendingRequestIsCancelled() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 150_000, bytes32(0));

        vm.prank(alice);
        mgr.cancelSpend(id, sid);
        assertEq(mgr.getPot(id).pendingSpendCount, 0);
        assertEq(mgr.getPot(id).reserved, 0);

        vm.prank(alice);
        mgr.closePot(id);
        _assertState(id, PotManager.PotState.Closed);
        assertEq(token.balanceOf(address(mgr)), 0);
    }

    /// A cancelled request cannot be approved after the pot has closed either.
    function test_RevertWhen_ApproveCancelledRequestAfterClose() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 150_000, bytes32(0));
        vm.prank(alice);
        mgr.cancelSpend(id, sid);
        vm.prank(alice);
        mgr.closePot(id);

        vm.prank(carol);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.approveSpend(id, sid);
    }

    function test_RevertWhen_DepositAfterClose() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.closePot(id);
        vm.prank(bob);
        vm.expectRevert(PotManager.NotCollecting.selector);
        mgr.deposit(id, 1_000);
    }

    // ───────────── closing a funded pot ─────────────

    function test_CloseRefundsProRata() public {
        uint256 id = _create(400_000, 5); // ₹4,000 target
        vm.prank(bob);
        mgr.join(id, CODE, _exp(), _auth(id, bob));
        // Carol joins only to be the independent approver below. She puts
        // nothing in, so the pro-rata split is still alice 25% / bob 75%.
        vm.prank(carol);
        mgr.join(id, CODE, _exp(), _auth(id, carol));
        vm.prank(alice);
        mgr.deposit(id, 100_000); // ₹1,000
        vm.prank(bob);
        mgr.deposit(id, 300_000); // ₹3,000 — target met
        _assertState(id, PotManager.PotState.Funded);

        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 200_000, bytes32(0)); // over limit
        vm.prank(carol);
        mgr.approveSpend(id, sid); // pot left: ₹2,000

        uint256 a0 = token.balanceOf(alice);
        uint256 b0 = token.balanceOf(bob);
        vm.prank(alice);
        mgr.closePot(id);

        assertEq(token.balanceOf(alice) - a0, 50_000); // 25% of ₹2,000
        assertEq(token.balanceOf(bob) - b0, 150_000); // 75% of ₹2,000
        assertEq(token.balanceOf(address(mgr)), 0);
        _assertState(id, PotManager.PotState.Closed);
    }

    function test_RefundRoundingNeverLosesPaise() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.requestSpend(id, bob, 1, bytes32(0)); // leaves an amount not divisible by 3
        uint256 potBal = mgr.getPot(id).balance;
        uint256 sumBefore = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol);
        vm.prank(alice);
        mgr.closePot(id);
        uint256 sumAfter = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol);
        assertEq(sumAfter - sumBefore, potBal);
        assertEq(token.balanceOf(address(mgr)), 0);
    }

    function test_CloseEmptiedPotPaysNothing() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, TARGET, bytes32(0)); // drain it
        vm.prank(carol);
        mgr.approveSpend(id, sid);
        assertEq(mgr.getPot(id).balance, 0);

        vm.prank(alice);
        mgr.closePot(id);
        _assertState(id, PotManager.PotState.Closed);
        assertEq(token.balanceOf(address(mgr)), 0);
    }

    /// Someone who joined but never put money in gets nothing back, and that
    /// does not disturb anyone else's share.
    function test_CloseSkipsNonContributors() public {
        uint256 id = _fundedPot();
        vm.prank(eve);
        mgr.join(id, CODE, _exp(), _auth(id, eve));

        uint256 e0 = token.balanceOf(eve);
        vm.prank(alice);
        mgr.closePot(id);

        assertEq(token.balanceOf(eve), e0, "no contribution, no refund");
        assertEq(token.balanceOf(address(mgr)), 0);
    }

    function test_RevertWhen_NonCreatorCloses() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        vm.expectRevert(PotManager.NotCreator.selector);
        mgr.closePot(id);
    }

    function test_RevertWhen_CloseWhileCollecting() public {
        uint256 id = _openPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.closePot(id);
    }

    function test_RevertWhen_CloseRefundingPot() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.closePot(id);
    }

    function test_RevertWhen_CloseTwice() public {
        uint256 id = _fundedPot();
        vm.startPrank(alice);
        mgr.closePot(id);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.closePot(id);
        vm.stopPrank();
    }

    // ───────────── the deadline passed and the target was missed ─────────────

    function test_FinalizeFailedIsPermissionless() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);

        // eve is not a member and has no special role.
        vm.expectEmit(true, false, false, true, address(mgr));
        emit PotManager.RefundingStarted(id, RS2000);
        vm.prank(eve);
        mgr.finalizeFailed(id);

        _assertState(id, PotManager.PotState.Refunding);
    }

    function test_RevertWhen_FinalizeBeforeDeadline() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.expectRevert(PotManager.DeadlineNotReached.selector);
        mgr.finalizeFailed(id);
    }

    function test_RevertWhen_FinalizeFundedPot() public {
        uint256 id = _fundedPot();
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(PotManager.NotCollecting.selector);
        mgr.finalizeFailed(id);
    }

    function test_RevertWhen_FinalizeTwice() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);
        vm.expectRevert(PotManager.NotCollecting.selector);
        mgr.finalizeFailed(id);
    }

    /// Nobody put anything in, so there is nothing to refund and it just closes.
    function test_FinalizeEmptyPotClosesImmediately() public {
        uint256 id = _openPot();
        vm.warp(block.timestamp + 8 days);

        vm.expectEmit(true, false, false, true, address(mgr));
        emit PotManager.PotClosed(id, 0);
        mgr.finalizeFailed(id);

        _assertState(id, PotManager.PotState.Closed);
    }

    // ───────────── claiming a refund ─────────────

    function test_EachContributorClaimsExactlyWhatTheyPutIn() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 100_000); // ₹1,000
        vm.prank(bob);
        mgr.deposit(id, 250_000); // ₹2,500 — the ₹6,000 target is missed
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        assertEq(mgr.refundableOf(id, alice), 100_000);
        assertEq(mgr.refundableOf(id, bob), 250_000);
        assertEq(mgr.refundableOf(id, carol), 0);

        uint256 a0 = token.balanceOf(alice);
        vm.prank(alice);
        mgr.claimRefund(id);
        assertEq(token.balanceOf(alice) - a0, 100_000);
        assertEq(mgr.refundableOf(id, alice), 0, "nothing left to claim");

        uint256 b0 = token.balanceOf(bob);
        vm.prank(bob);
        mgr.claimRefund(id);
        assertEq(token.balanceOf(bob) - b0, 250_000);

        assertEq(token.balanceOf(address(mgr)), 0, "contract fully emptied");
    }

    function test_LastClaimClosesThePot() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 100_000);
        vm.prank(bob);
        mgr.deposit(id, 100_000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(alice);
        mgr.claimRefund(id);
        _assertState(id, PotManager.PotState.Refunding);

        vm.prank(bob);
        mgr.claimRefund(id);
        _assertState(id, PotManager.PotState.Closed);
    }

    function test_RevertWhen_ClaimTwice() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 100_000);
        vm.prank(bob);
        mgr.deposit(id, 100_000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.startPrank(alice);
        mgr.claimRefund(id);
        vm.expectRevert(PotManager.AlreadyClaimed.selector);
        mgr.claimRefund(id);
        vm.stopPrank();
    }

    /// A member who never contributed cannot take anyone else's money.
    function test_RevertWhen_NonContributorClaims() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 100_000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(carol);
        vm.expectRevert(PotManager.NothingToClaim.selector);
        mgr.claimRefund(id);
    }

    function test_RevertWhen_StrangerClaims() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 100_000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(eve);
        vm.expectRevert(PotManager.NothingToClaim.selector);
        mgr.claimRefund(id);
    }

    function test_RevertWhen_ClaimWhileCollecting() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 100_000);
        vm.prank(alice);
        vm.expectRevert(PotManager.NotRefunding.selector);
        mgr.claimRefund(id);
    }

    function test_RevertWhen_ClaimFromFundedPot() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.NotRefunding.selector);
        mgr.claimRefund(id);
    }

    /// Money in a failed pot is refundable, never spendable.
    function test_FailedPotMoneyCannotBeSpent() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.requestSpend(id, bob, 1_000, bytes32(0));

        // and it is all still there for its contributor
        assertEq(mgr.refundableOf(id, alice), RS2000);
        assertEq(token.balanceOf(address(mgr)), RS2000);
    }

    // ───────────── the whole way through ─────────────

    function test_FullLifecycleFundThenRepayThenClose() public {
        uint256 id = _openPot();

        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.prank(bob);
        mgr.deposit(id, RS2000);
        vm.prank(carol);
        mgr.deposit(id, RS2000);
        _assertState(id, PotManager.PotState.Funded);

        // small repayment to someone else: instant
        vm.prank(alice);
        mgr.requestSpend(id, bob, 60_000, bytes32("cab"));

        // bigger one: needs a second person
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, carol, 240_000, bytes32("hotel"));
        vm.prank(alice);
        mgr.approveSpend(id, sid);

        uint256 left = mgr.getPot(id).balance;
        assertEq(left, TARGET - 60_000 - 240_000); // ₹3,000

        uint256 a0 = token.balanceOf(alice);
        uint256 b0 = token.balanceOf(bob);
        uint256 c0 = token.balanceOf(carol);
        vm.prank(alice);
        mgr.closePot(id);

        // Everyone put in the same amount, so the leftover splits three ways.
        assertEq(token.balanceOf(alice) - a0, left / 3);
        assertEq(token.balanceOf(bob) - b0, left / 3);
        assertEq(token.balanceOf(carol) - c0, left / 3);
        assertEq(token.balanceOf(address(mgr)), 0);
        _assertState(id, PotManager.PotState.Closed);
    }

    function test_FullLifecycleMissTargetThenEveryoneClaims() public {
        uint256 id = _openPot();
        vm.prank(alice);
        mgr.deposit(id, 150_000);
        vm.prank(bob);
        mgr.deposit(id, 120_000);
        vm.prank(carol);
        mgr.deposit(id, 90_000);
        _assertState(id, PotManager.PotState.Collecting);

        vm.warp(block.timestamp + 8 days);
        vm.prank(eve);
        mgr.finalizeFailed(id);

        uint256 a0 = token.balanceOf(alice);
        uint256 b0 = token.balanceOf(bob);
        uint256 c0 = token.balanceOf(carol);

        vm.prank(alice);
        mgr.claimRefund(id);
        vm.prank(bob);
        mgr.claimRefund(id);
        vm.prank(carol);
        mgr.claimRefund(id);

        assertEq(token.balanceOf(alice) - a0, 150_000);
        assertEq(token.balanceOf(bob) - b0, 120_000);
        assertEq(token.balanceOf(carol) - c0, 90_000);
        assertEq(token.balanceOf(address(mgr)), 0);
        _assertState(id, PotManager.PotState.Closed);
    }

    function test_GetPotDoesNotExposeInviteHash() public {
        uint256 id = _openPot();
        // PotInfo has no inviteHash field at all, which the compiler enforces.
        // What it exposes is only what the screens actually need.
        PotManager.PotInfo memory p = mgr.getPot(id);
        assertEq(p.memberCount, 3);
        assertEq(p.targetAmount, TARGET);
    }

    // ───────────── the limit is a cumulative budget ─────────────

    /// Several small repayments cannot add up to more than one approved
    /// repayment would have allowed. This is the split-the-payout bypass.
    function test_SplittingCannotBeatTheApprovalLimit() public {
        uint256 id = _fundedPot();
        assertEq(mgr.instantRemaining(id, alice), LIMIT);

        vm.prank(alice);
        mgr.requestSpend(id, bob, 40_000, bytes32("one"));
        assertEq(mgr.instantRemaining(id, alice), 60_000);

        vm.prank(alice);
        mgr.requestSpend(id, carol, 40_000, bytes32("two"));
        assertEq(mgr.instantRemaining(id, alice), 20_000);

        // ₹200 of budget left, so a third ₹400 repayment has to be approved.
        uint256 before = token.balanceOf(bob);
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 40_000, bytes32("three"));
        assertEq(token.balanceOf(bob), before, "must not pay out on its own");
        assertFalse(mgr.getSpend(id, sid).executed);
        assertEq(mgr.getPot(id).pendingSpendCount, 1);

        vm.prank(carol);
        mgr.approveSpend(id, sid);
        assertEq(token.balanceOf(bob), before + 40_000);
    }

    /// Each member gets their own budget; one person using theirs up does not
    /// spend anyone else's.
    function test_BudgetIsPerMember() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.requestSpend(id, bob, LIMIT, bytes32(0)); // alice uses hers up
        assertEq(mgr.instantRemaining(id, alice), 0);
        assertEq(mgr.instantRemaining(id, bob), LIMIT);

        uint256 before = token.balanceOf(carol);
        vm.prank(bob);
        mgr.requestSpend(id, carol, 50_000, bytes32(0));
        assertEq(token.balanceOf(carol), before + 50_000, "bob still has his own budget");
    }

    /// An approved payout does not eat into the requester's unapproved budget.
    function test_ApprovedPayoutDoesNotConsumeBudget() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 300_000, bytes32(0)); // over budget, pending
        vm.prank(carol);
        mgr.approveSpend(id, sid);

        assertEq(mgr.instantRemaining(id, alice), LIMIT, "budget untouched");
    }

    function test_RevertWhen_ApprovalLimitExceedsTarget() public {
        vm.prank(alice);
        vm.expectRevert(PotManager.InvalidParams.selector);
        mgr.createPot(inviteHash, TARGET + 1, 5, TARGET, _soon());
    }

    // ───────────── cancelling a pending request ─────────────

    function test_RequesterCanCancelTheirOwnRequest() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 50_000, bytes32(0)); // self payout, pending

        vm.prank(bob);
        mgr.cancelSpend(id, sid);

        assertTrue(mgr.getSpend(id, sid).cancelled);
        assertEq(mgr.getPot(id).reserved, 0);
        assertEq(mgr.getPot(id).pendingSpendCount, 0);
    }

    /// So one member going quiet cannot leave the pot permanently unclosable.
    function test_CreatorCanCancelAnyonesRequest() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 50_000, bytes32(0));

        vm.prank(alice); // the creator
        mgr.cancelSpend(id, sid);
        assertTrue(mgr.getSpend(id, sid).cancelled);
    }

    function test_RevertWhen_StrangerCancels() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 50_000, bytes32(0));

        vm.prank(carol); // a member, but neither requester nor creator
        vm.expectRevert(PotManager.NotRequesterOrCreator.selector);
        mgr.cancelSpend(id, sid);
    }

    function test_RevertWhen_ApproveCancelledRequest() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 50_000, bytes32(0));
        vm.prank(bob);
        mgr.cancelSpend(id, sid);

        vm.prank(alice);
        vm.expectRevert(PotManager.SpendWasCancelled.selector);
        mgr.approveSpend(id, sid);
    }

    function test_RevertWhen_CancelTwice() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        uint256 sid = mgr.requestSpend(id, bob, 50_000, bytes32(0));
        vm.startPrank(bob);
        mgr.cancelSpend(id, sid);
        vm.expectRevert(PotManager.SpendWasCancelled.selector);
        mgr.cancelSpend(id, sid);
        vm.stopPrank();
    }

    function test_RevertWhen_CancelExecutedRequest() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 50_000, bytes32(0)); // instant
        vm.prank(alice);
        vm.expectRevert(PotManager.SpendAlreadyExecuted.selector);
        mgr.cancelSpend(id, sid);
    }

    /// Cancelling, requesting and approving in sequence must leave the counters
    /// and the reservation exactly where they started.
    function test_PendingCountersStayCorrectThroughChurn() public {
        uint256 id = _fundedPot();

        vm.prank(alice);
        uint256 a = mgr.requestSpend(id, bob, 300_000, bytes32(0)); // pending
        vm.prank(bob);
        uint256 b = mgr.requestSpend(id, carol, 200_000, bytes32(0)); // pending
        assertEq(mgr.getPot(id).pendingSpendCount, 2);
        assertEq(mgr.getPot(id).reserved, 500_000);

        vm.prank(alice);
        mgr.cancelSpend(id, a);
        assertEq(mgr.getPot(id).pendingSpendCount, 1);
        assertEq(mgr.getPot(id).reserved, 200_000);

        vm.prank(alice);
        mgr.approveSpend(id, b);
        PotManager.PotInfo memory info = mgr.getPot(id);
        assertEq(info.pendingSpendCount, 0);
        assertEq(info.reserved, 0);
        assertEq(info.balance, TARGET - 200_000);

        vm.prank(alice);
        mgr.closePot(id);
        assertEq(token.balanceOf(address(mgr)), 0);
    }

    function test_RevertWhen_CancelOutsideFundedState() public {
        uint256 id = _openPot();
        vm.prank(alice);
        vm.expectRevert(PotManager.NotFunded.selector);
        mgr.cancelSpend(id, 1);
    }

    // ───────────── faucet ─────────────

    function test_FaucetCooldown() public {
        vm.prank(alice);
        vm.expectRevert();
        token.faucet();
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        token.faucet();
        assertEq(token.balanceOf(alice), 2 * token.FAUCET_AMOUNT());
    }
}
