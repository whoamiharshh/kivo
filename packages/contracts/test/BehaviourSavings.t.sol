// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {BehaviourSavings as BS} from "../src/BehaviourSavings.sol";

contract BehaviourSavingsTest is Test {
    TestRupee token;
    BS savings;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dan = makeAddr("dan");
    address eve = makeAddr("eve");

    address verifier;
    uint256 verifierKey;
    address admin = makeAddr("savings-admin");

    uint256 constant FAUCET = 500_000; // ₹5,000.00
    uint256 constant TARGET = 100_000; // ₹1,000.00 → stake ₹100.00
    uint256 constant STAKE = 10_000;
    uint64 deadline;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        savings = new BS(token, admin);
        (verifier, verifierKey) = makeAddrAndKey("verifier");
        deadline = uint64(block.timestamp + 30 days);

        // A saver can no longer name a verifier, so the admin has to approve
        // one and assign it before any ExternalSignal goal can exist.
        vm.startPrank(admin);
        savings.registerVerifier(verifier);
        savings.setBehaviourVerifier(verifier);
        vm.stopPrank();

        address[5] memory users = [alice, bob, carol, dan, eve];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(savings), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ───────────── helpers ─────────────

    function _goal(address who, uint256 target) internal returns (uint256 id) {
        vm.prank(who);
        id = savings.createSavingsGoal(who, target, deadline, BS.BehaviourType.SaveConsistently);
    }

    /// Deposit the whole target across exactly MIN_DEPOSITS instalments.
    function _saveFully(address who, uint256 id, uint256 target) internal {
        uint32 n = savings.MIN_DEPOSITS();
        uint256 each = target / n;
        uint256 paid;
        for (uint32 i; i < n; i++) {
            uint256 amount = i == n - 1 ? target - paid : each;
            vm.prank(who);
            savings.deposit(id, amount);
            paid += amount;
        }
    }

    function _sign(uint256 key, uint256 goalId, bytes32 signal) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, savings.behaviourDigest(goalId, signal));
        return abi.encodePacked(r, s, v);
    }

    // ───────────── the honesty invariant ─────────────

    /// The headline promise: your savings always come back, whatever happens.
    function test_PrincipalComesBackEvenWhenTheGoalIsMissed() public {
        uint256 id = _goal(alice, TARGET);

        // Two deposits only — the money is there but the habit is not.
        vm.prank(alice);
        savings.deposit(id, 40_000);
        vm.prank(alice);
        savings.deposit(id, 60_000);

        uint256 beforeFinalise = token.balanceOf(alice);
        assertEq(beforeFinalise, FAUCET - STAKE - TARGET, "stake and savings are in");

        vm.warp(deadline);
        savings.finalise(id);

        assertFalse(savings.getGoal(id).succeeded, "missed: fewer than MIN_DEPOSITS");
        assertEq(token.balanceOf(alice), beforeFinalise + TARGET, "every paisa of principal returned despite failing");
        assertEq(token.balanceOf(address(savings)), STAKE, "only the stake is still at risk");
    }

    function test_MeetingTheTargetButNotTheCadenceIsAMiss() public {
        uint256 id = _goal(alice, TARGET);
        vm.prank(alice);
        savings.deposit(id, TARGET); // one lump sum

        (uint256 amountLeft, uint32 depositsLeft) = savings.remaining(id);
        assertEq(amountLeft, 0, "target reached");
        assertEq(depositsLeft, savings.MIN_DEPOSITS() - 1, "but the habit is not");
        assertFalse(savings.onTrack(id));

        vm.warp(deadline);
        savings.finalise(id);
        assertFalse(savings.getGoal(id).succeeded);
    }

    function test_ReachingTargetAcrossEnoughDepositsSucceeds() public {
        uint256 id = _goal(alice, TARGET);
        _saveFully(alice, id, TARGET);

        assertTrue(savings.onTrack(id));
        (uint256 amountLeft, uint32 depositsLeft) = savings.remaining(id);
        assertEq(amountLeft, 0);
        assertEq(depositsLeft, 0);

        vm.warp(deadline);
        savings.finalise(id);
        assertTrue(savings.getGoal(id).succeeded);
    }

    // ───────────── distribution: all succeed ─────────────

    /// If nobody fails there is nothing to share, and the UI must not pretend
    /// otherwise. Everyone simply gets their stake back.
    function test_AllSucceed_NoBonusBecauseNothingWasForfeited() public {
        uint256 a = _goal(alice, TARGET);
        uint256 b = _goal(bob, TARGET);
        _saveFully(alice, a, TARGET);
        _saveFully(bob, b, TARGET);

        vm.warp(deadline);
        savings.finalise(a);
        savings.finalise(b);

        BS.Cohort memory c = savings.getCohort(deadline);
        assertEq(c.forfeitedPool, 0, "nothing forfeited");
        assertEq(c.winningStakeTotal, 2 * STAKE);

        vm.prank(alice);
        savings.claimOutcome(a);
        vm.prank(bob);
        savings.claimOutcome(b);

        assertEq(token.balanceOf(alice), FAUCET, "exactly what she started with");
        assertEq(token.balanceOf(bob), FAUCET);
        assertEq(token.balanceOf(address(savings)), 0);
    }

    // ───────────── distribution: all fail ─────────────

    /// Nobody to redistribute to, so the stakes go home. The contract never
    /// keeps money it has no rule for.
    function test_AllFail_StakesGoBackBecauseThereIsNobodyToPay() public {
        uint256 a = _goal(alice, TARGET);
        uint256 b = _goal(bob, TARGET);

        vm.warp(deadline);
        savings.finalise(a);
        savings.finalise(b);

        BS.Cohort memory c = savings.getCohort(deadline);
        assertEq(c.forfeitedPool, 2 * STAKE);
        assertEq(c.winningStakeTotal, 0, "no winners");

        vm.prank(alice);
        savings.claimOutcome(a);
        vm.prank(bob);
        savings.claimOutcome(b);

        assertEq(token.balanceOf(alice), FAUCET, "stake returned");
        assertEq(token.balanceOf(bob), FAUCET);
        assertEq(token.balanceOf(address(savings)), 0);
    }

    // ───────────── distribution: mixed ─────────────

    function test_Mixed_WinnersShareTheForfeitedStakes() public {
        uint256 a = _goal(alice, TARGET); // succeeds
        uint256 b = _goal(bob, TARGET); // succeeds
        uint256 c = _goal(carol, TARGET); // fails
        _saveFully(alice, a, TARGET);
        _saveFully(bob, b, TARGET);

        vm.warp(deadline);
        savings.finalise(a);
        savings.finalise(b);
        savings.finalise(c);

        vm.prank(alice);
        savings.claimOutcome(a);
        vm.prank(bob);
        savings.claimOutcome(b);

        // Carol's ₹100 stake split between the two who made it.
        assertEq(token.balanceOf(alice), FAUCET + STAKE / 2, "half of the forfeited stake");
        assertEq(token.balanceOf(bob), FAUCET + STAKE / 2);
        assertEq(token.balanceOf(carol), FAUCET - STAKE, "lost the stake, not the savings");

        vm.prank(carol);
        vm.expectRevert(BS.NothingToClaim.selector);
        savings.claimOutcome(c);

        assertEq(token.balanceOf(address(savings)), 0, "contract empty");
    }

    /// Three winners splitting a stake that does not divide by three. The last
    /// claimant absorbs the rounding dust so nothing is stranded.
    function test_Mixed_RoundingDustGoesToTheLastClaimant() public {
        uint256 a = _goal(alice, TARGET);
        uint256 b = _goal(bob, TARGET);
        uint256 c = _goal(carol, TARGET);
        uint256 d = _goal(dan, 70_000); // stake 7_000, fails
        _saveFully(alice, a, TARGET);
        _saveFully(bob, b, TARGET);
        _saveFully(carol, c, TARGET);

        vm.warp(deadline);
        savings.finalise(a);
        savings.finalise(b);
        savings.finalise(c);
        savings.finalise(d);

        BS.Cohort memory co = savings.getCohort(deadline);
        assertEq(co.forfeitedPool, 7_000);
        assertEq(co.winningStakeTotal, 3 * STAKE);

        vm.prank(alice);
        savings.claimOutcome(a);
        vm.prank(bob);
        savings.claimOutcome(b);
        vm.prank(carol);
        savings.claimOutcome(c);

        // 7000 / 3 = 2333 each, with 1 left over going to the last claimant.
        assertEq(token.balanceOf(alice), FAUCET + 2_333);
        assertEq(token.balanceOf(bob), FAUCET + 2_333);
        assertEq(token.balanceOf(carol), FAUCET + 2_334, "dust absorbed here");
        assertEq(token.balanceOf(dan), FAUCET - 7_000);

        uint256 distributed =
            (token.balanceOf(alice) - FAUCET) + (token.balanceOf(bob) - FAUCET) + (token.balanceOf(carol) - FAUCET);
        assertEq(distributed, 7_000, "the forfeited stake is fully distributed, to the paisa");
        assertEq(token.balanceOf(address(savings)), 0, "nothing stranded");
    }

    /// Bigger stakes earn a bigger share, in proportion.
    function test_Mixed_SharesAreProportionalToStake() public {
        uint256 a = _goal(alice, 200_000); // stake 20_000
        uint256 b = _goal(bob, 100_000); // stake 10_000
        uint256 c = _goal(carol, 90_000); // stake 9_000, fails
        _saveFully(alice, a, 200_000);
        _saveFully(bob, b, 100_000);

        vm.warp(deadline);
        savings.finalise(a);
        savings.finalise(b);
        savings.finalise(c);

        vm.prank(alice);
        savings.claimOutcome(a);
        vm.prank(bob);
        savings.claimOutcome(b);

        // 9,000 split 20:10 → 6,000 and 3,000.
        assertEq(token.balanceOf(alice), FAUCET + 6_000);
        assertEq(token.balanceOf(bob), FAUCET + 3_000);
        assertEq(token.balanceOf(address(savings)), 0);
    }

    /// Cohorts are by deadline: a stake forfeited on one date cannot leak to
    /// somebody who committed to another.
    function test_CohortsDoNotLeakIntoEachOther() public {
        uint64 otherDeadline = uint64(block.timestamp + 60 days);

        uint256 a = _goal(alice, TARGET); // cohort 1, fails
        vm.prank(bob);
        uint256 b = savings.createSavingsGoal(bob, TARGET, otherDeadline, BS.BehaviourType.SaveConsistently);
        _saveFully(bob, b, TARGET); // cohort 2, succeeds

        vm.warp(deadline);
        savings.finalise(a);
        vm.prank(alice);
        savings.claimOutcome(a); // sole member of a failed cohort: stake back
        assertEq(token.balanceOf(alice), FAUCET);

        vm.warp(otherDeadline);
        savings.finalise(b);
        vm.prank(bob);
        savings.claimOutcome(b);
        assertEq(token.balanceOf(bob), FAUCET, "no bonus from the other cohort");
    }

    function test_RevertWhen_ClaimingBeforeTheWholeCohortIsFinalised() public {
        uint256 a = _goal(alice, TARGET);
        _goal(bob, TARGET);
        _saveFully(alice, a, TARGET);

        vm.warp(deadline);
        savings.finalise(a);

        vm.prank(alice);
        vm.expectRevert(BS.CohortNotComplete.selector);
        savings.claimOutcome(a);
    }

    // ───────────── the external-signal path ─────────────

    function test_ExternalSignalGoalSucceedsOnlyWithTheVerifiersSignature() public {
        vm.prank(alice);
        uint256 id = savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        vm.prank(alice);
        savings.deposit(id, TARGET);

        bytes32 signal = keccak256("walked 10k a day for a month");
        savings.submitBehaviour(id, signal, _sign(verifierKey, id, signal));
        assertTrue(savings.getGoal(id).behaviourVerified);
        assertTrue(savings.onTrack(id), "one deposit is fine here; the signal is the behaviour");

        vm.warp(deadline);
        savings.finalise(id);
        assertTrue(savings.getGoal(id).succeeded);
    }

    function test_RevertWhen_SignalSignedBySomeoneElse() public {
        vm.prank(alice);
        uint256 id = savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        (, uint256 impostorKey) = makeAddrAndKey("impostor");
        bytes32 signal = keccak256("nope");
        bytes memory sig = _sign(impostorKey, id, signal);

        vm.expectRevert(BS.BadSignature.selector);
        savings.submitBehaviour(id, signal, sig);
    }

    function test_RevertWhen_SignalReplayedOnAnotherGoal() public {
        vm.prank(alice);
        uint256 first = savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        vm.prank(bob);
        uint256 second = savings.createSavingsGoal(bob, TARGET, deadline, BS.BehaviourType.ExternalSignal);

        bytes32 signal = keccak256("same signal");
        bytes memory sigForFirst = _sign(verifierKey, first, signal);

        vm.expectRevert(BS.BadSignature.selector);
        savings.submitBehaviour(second, signal, sigForFirst);
    }

    /// A chain-verifiable goal must not accept a signature: that would add a
    /// trusted party where none is needed.
    function test_RevertWhen_SigningAChainVerifiableGoal() public {
        uint256 id = _goal(alice, TARGET);
        bytes32 signal = keccak256("x");
        bytes memory sig = _sign(verifierKey, id, signal);

        vm.expectRevert(BS.BehaviourNotSignable.selector);
        savings.submitBehaviour(id, signal, sig);
    }

    function test_RevertWhen_SubmittingTheSameSignalTwice() public {
        vm.prank(alice);
        uint256 id = savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        bytes32 signal = keccak256("once");
        bytes memory sig = _sign(verifierKey, id, signal);
        savings.submitBehaviour(id, signal, sig);

        vm.expectRevert(BS.AlreadyVerified.selector);
        savings.submitBehaviour(id, signal, sig);
    }

    /// A chain-verifiable goal gets no verifier at all, whatever the registry
    /// currently says. Nothing off-chain is consulted for it.
    function test_ChainVerifiableGoalGetsNoVerifier() public {
        uint256 id = _goal(alice, TARGET);
        assertEq(savings.getGoal(id).verifier, address(0));
    }

    /// An ExternalSignal goal is assigned whoever the admin has set, and the
    /// saver has no input into it.
    function test_ExternalSignalGoalIsAssignedTheRegisteredVerifier() public {
        vm.prank(alice);
        uint256 id = savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        assertEq(savings.getGoal(id).verifier, verifier);
    }

    function test_RevertWhen_ExternalSignalGoalHasNoVerifier() public {
        // Turn ExternalSignal off by clearing the assignment.
        vm.prank(admin);
        savings.setBehaviourVerifier(address(0));

        vm.prank(alice);
        vm.expectRevert(BS.VerifierRequired.selector);
        savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
    }

    // --------------- C-2: the saver does not choose the verifier ---------------

    /// The hole this closes. A saver used to be able to name themselves, or a
    /// second address they held, as the verifier of their own goal, sign their
    /// own success, and take a guaranteed share of other people's forfeited
    /// stakes. There is now no parameter to do it with, and signing with your
    /// own key is just a bad signature.
    function test_RevertWhen_TheSaverSignsTheirOwnBehaviour() public {
        (address self, uint256 selfKey) = makeAddrAndKey("self-dealer");
        vm.startPrank(self);
        token.faucet();
        token.approve(address(savings), type(uint256).max);
        uint256 id = savings.createSavingsGoal(self, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        vm.stopPrank();

        // The goal points at the registered verifier, not at the saver.
        assertEq(savings.getGoal(id).verifier, verifier);
        assertTrue(savings.getGoal(id).verifier != self);

        bytes32 signal = keccak256("i say i did it");
        // Signed first: _sign reads behaviourDigest off the contract, and that
        // external view call would consume the expectRevert below.
        bytes memory selfSigned = _sign(selfKey, id, signal);

        vm.expectRevert(BS.BadSignature.selector);
        savings.submitBehaviour(id, signal, selfSigned);
    }

    /// Nor can a saver get there by having the admin point at them: creation
    /// refuses outright.
    function test_RevertWhen_TheAssignedVerifierIsAlsoTheSaver() public {
        vm.startPrank(admin);
        savings.registerVerifier(alice);
        savings.setBehaviourVerifier(alice);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(BS.SelfVerification.selector);
        savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);

        // Somebody else is unaffected: alice is a fine verifier for bob.
        vm.prank(bob);
        uint256 id = savings.createSavingsGoal(bob, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        assertEq(savings.getGoal(id).verifier, alice);
    }

    // --------------- the registry ---------------

    function test_RevertWhen_SomebodyElseRegistersAVerifier() public {
        vm.prank(alice);
        vm.expectRevert(BS.NotAdmin.selector);
        savings.registerVerifier(alice);
    }

    function test_RevertWhen_SomebodyElseAssignsAVerifier() public {
        vm.prank(alice);
        vm.expectRevert(BS.NotAdmin.selector);
        savings.setBehaviourVerifier(verifier);
    }

    function test_RevertWhen_SomebodyElseRevokesAVerifier() public {
        vm.prank(alice);
        vm.expectRevert(BS.NotAdmin.selector);
        savings.revokeVerifier(verifier);
    }

    /// Approving and assigning are two steps, so an address cannot be assigned
    /// by accident before anybody has looked at it.
    function test_RevertWhen_AssigningAnUnapprovedVerifier() public {
        vm.prank(admin);
        vm.expectRevert(BS.VerifierNotApproved.selector);
        savings.setBehaviourVerifier(makeAddr("stranger"));
    }

    function test_RevertWhen_RegisteringTheSameVerifierTwice() public {
        vm.prank(admin);
        vm.expectRevert(BS.AlreadySet.selector);
        savings.registerVerifier(verifier);
    }

    function test_RevertWhen_RegisteringTheZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(BS.ZeroAddress.selector);
        savings.registerVerifier(address(0));
    }

    function test_RevertWhen_RevokingSomebodyWhoWasNeverApproved() public {
        vm.prank(admin);
        vm.expectRevert(BS.VerifierNotApproved.selector);
        savings.revokeVerifier(makeAddr("stranger"));
    }

    /// Revoking the assigned verifier also clears the assignment, so no NEW
    /// goal can be handed a revoked verifier.
    function test_RevokingTheAssignedVerifierClearsTheAssignment() public {
        vm.prank(admin);
        savings.revokeVerifier(verifier);

        assertFalse(savings.approvedVerifier(verifier));
        assertEq(savings.behaviourVerifier(), address(0));

        vm.prank(alice);
        vm.expectRevert(BS.VerifierRequired.selector);
        savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
    }

    /// Deliberate, and worth a test so nobody "fixes" it: revoking does NOT
    /// strand a goal that is already open. If it did, the admin could force
    /// savers to forfeit stakes they were on course to keep.
    function test_RevokedVerifierCanStillSignAGoalThatWasAlreadyOpen() public {
        vm.prank(alice);
        uint256 id = savings.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
        vm.prank(alice);
        savings.deposit(id, TARGET);

        vm.prank(admin);
        savings.revokeVerifier(verifier);

        bytes32 signal = keccak256("done it anyway");
        savings.submitBehaviour(id, signal, _sign(verifierKey, id, signal));
        assertTrue(savings.getGoal(id).behaviourVerified);

        vm.warp(deadline);
        savings.finalise(id);
        assertTrue(savings.getGoal(id).succeeded, "an open goal is not punished for a revocation");
    }

    /// The admin's whole surface is two mappings. It cannot reach the money:
    /// no function on this contract pays it anything, and its balance does not
    /// move across the only calls it can make.
    function test_TheAdminCannotTouchTheMoney() public {
        uint256 id = _goal(alice, TARGET);
        vm.prank(alice);
        savings.deposit(id, TARGET);

        uint256 held = token.balanceOf(address(savings));
        uint256 adminBefore = token.balanceOf(admin);
        assertGt(held, 0);

        vm.startPrank(admin);
        savings.registerVerifier(makeAddr("another-verifier"));
        savings.revokeVerifier(verifier);
        vm.stopPrank();

        assertEq(token.balanceOf(address(savings)), held, "the contract still holds every paisa");
        assertEq(token.balanceOf(admin), adminBefore, "and the admin gained nothing");

        // It cannot settle somebody else's goal into its own hands either:
        // finalise returns principal to g.user, never to the caller.
        vm.warp(deadline);
        vm.prank(admin);
        savings.finalise(id);
        assertEq(token.balanceOf(admin), adminBefore);
    }

    // ───────────── everything else that must revert ─────────────

    function test_RevertWhen_ConstructorTokenIsZero() public {
        vm.expectRevert(BS.ZeroAddress.selector);
        new BS(TestRupee(address(0)), admin);
    }

    function test_RevertWhen_ConstructorAdminIsZero() public {
        vm.expectRevert(BS.ZeroAddress.selector);
        new BS(token, address(0));
    }

    /// A fresh deployment cannot offer an ExternalSignal goal to anybody until
    /// its admin has approved and assigned a verifier. That is the honest
    /// default: no verifier means no off-chain claims.
    function test_AFreshDeploymentHasNoVerifier() public {
        BS fresh = new BS(token, admin);
        assertEq(fresh.behaviourVerifier(), address(0));
        assertFalse(fresh.approvedVerifier(verifier));

        vm.prank(alice);
        vm.expectRevert(BS.VerifierRequired.selector);
        fresh.createSavingsGoal(alice, TARGET, deadline, BS.BehaviourType.ExternalSignal);
    }

    function test_RevertWhen_CreatingAGoalForSomeoneElse() public {
        vm.prank(alice);
        vm.expectRevert(BS.NotYourGoal.selector);
        savings.createSavingsGoal(bob, TARGET, deadline, BS.BehaviourType.SaveConsistently);
    }

    function test_RevertWhen_TargetTooSmallToStake() public {
        vm.prank(alice);
        vm.expectRevert(BS.TargetTooSmall.selector);
        savings.createSavingsGoal(alice, 9, deadline, BS.BehaviourType.SaveConsistently);
    }

    function test_RevertWhen_DeadlineTooSoon() public {
        uint256 soon = block.timestamp + 1 hours;
        vm.prank(alice);
        vm.expectRevert(BS.DurationOutOfRange.selector);
        savings.createSavingsGoal(alice, TARGET, soon, BS.BehaviourType.SaveConsistently);
    }

    function test_RevertWhen_DeadlineTooFar() public {
        uint256 far = block.timestamp + 366 days;
        vm.prank(alice);
        vm.expectRevert(BS.DurationOutOfRange.selector);
        savings.createSavingsGoal(alice, TARGET, far, BS.BehaviourType.SaveConsistently);
    }

    function test_RevertWhen_DepositingAfterTheDeadline() public {
        uint256 id = _goal(alice, TARGET);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(BS.DeadlinePassed.selector);
        savings.deposit(id, 1_000);
    }

    function test_RevertWhen_DepositingNothing() public {
        uint256 id = _goal(alice, TARGET);
        vm.prank(alice);
        vm.expectRevert(BS.ZeroAmount.selector);
        savings.deposit(id, 0);
    }

    function test_RevertWhen_DepositingIntoSomeoneElsesGoal() public {
        uint256 id = _goal(alice, TARGET);
        vm.prank(eve);
        vm.expectRevert(BS.NotYourGoal.selector);
        savings.deposit(id, 1_000);
    }

    function test_RevertWhen_FinalisingEarly() public {
        uint256 id = _goal(alice, TARGET);
        vm.warp(deadline - 1);
        vm.expectRevert(BS.DeadlineNotReached.selector);
        savings.finalise(id);
    }

    function test_RevertWhen_FinalisingTwice() public {
        uint256 id = _goal(alice, TARGET);
        vm.warp(deadline);
        savings.finalise(id);
        vm.expectRevert(BS.WrongState.selector);
        savings.finalise(id);
    }

    /// Anyone may finalise anyone's goal: it only returns that person's own
    /// savings to them, so nobody has to wait on anybody.
    function test_AStrangerCanFinaliseYourGoal() public {
        uint256 id = _goal(alice, TARGET);
        _saveFully(alice, id, TARGET);
        uint256 before = token.balanceOf(alice);

        vm.warp(deadline);
        vm.prank(eve);
        savings.finalise(id);

        assertEq(token.balanceOf(alice), before + TARGET, "her money went to her");
    }

    function test_RevertWhen_ClaimingSomeoneElsesOutcome() public {
        uint256 id = _goal(alice, TARGET);
        vm.warp(deadline);
        savings.finalise(id);

        vm.prank(eve);
        vm.expectRevert(BS.NotYourGoal.selector);
        savings.claimOutcome(id);
    }

    function test_RevertWhen_ClaimingTwice() public {
        uint256 id = _goal(alice, TARGET);
        vm.warp(deadline);
        savings.finalise(id);
        vm.prank(alice);
        savings.claimOutcome(id);

        vm.prank(alice);
        vm.expectRevert(BS.WrongState.selector);
        savings.claimOutcome(id);
    }

    function test_RevertWhen_ClaimingBeforeFinalising() public {
        uint256 id = _goal(alice, TARGET);
        vm.prank(alice);
        vm.expectRevert(BS.WrongState.selector);
        savings.claimOutcome(id);
    }

    function test_RevertWhen_GoalNotFound() public {
        vm.expectRevert(BS.GoalNotFound.selector);
        savings.getGoal(99);
    }

    function test_GoalIdsIncrementFromZero() public {
        assertEq(savings.goalCount(), 0);
        assertEq(_goal(alice, TARGET), 0);
        assertEq(_goal(bob, TARGET), 1);
        assertEq(savings.goalCount(), 2);
    }

    // ───────────── conservation ─────────────

    /// However a cohort turns out, the contract ends up holding nothing and no
    /// saver ends up with less principal than they put in.
    function testFuzz_NobodyEverLosesPrincipal(uint96 rawTarget, bool aliceSaves, bool bobSaves) public {
        uint256 target = (uint256(rawTarget) % 200_000) + 10_000; // stake is 10%
        uint256 a = _goal(alice, target);
        uint256 b = _goal(bob, target);
        uint256 stake = target / 10;

        if (aliceSaves) _saveFully(alice, a, target);
        if (bobSaves) _saveFully(bob, b, target);

        vm.warp(deadline);
        savings.finalise(a);
        savings.finalise(b);

        if (aliceSaves || !bobSaves) {
            vm.prank(alice);
            savings.claimOutcome(a);
        }
        if (bobSaves || !aliceSaves) {
            vm.prank(bob);
            savings.claimOutcome(b);
        }

        // Worst case is losing the stake. Principal is never touched.
        assertGe(token.balanceOf(alice), FAUCET - stake, "alice kept her savings");
        assertGe(token.balanceOf(bob), FAUCET - stake, "bob kept his savings");
        assertEq(token.balanceOf(address(savings)), 0, "contract holds nothing at the end");
    }
}
