// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {AccountabilityPool as AP} from "../src/AccountabilityPool.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract AccountabilityPoolTest is Test {
    TestRupee token;
    AP pool;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dan = makeAddr("dan");

    address attester;
    uint256 attesterKey;

    uint256 constant FAUCET = 500_000; // ₹5,000.00
    uint256 constant STAKE = 50_000; // ₹500.00
    uint32 constant REQUIRED = 5;
    uint32 constant GRACE = 1;
    uint64 deadline;
    uint64 day0;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        (attester, attesterKey) = makeAddrAndKey("attester");
        pool = new AP(token, attester);
        deadline = uint64(block.timestamp + 7 days);
        day0 = uint64(block.timestamp / 1 days);

        address[4] memory users = [alice, bob, carol, dan];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ───────────── helpers ─────────────

    /// Signed independently of the contract, so the digest formula is checked
    /// rather than restated. A call to `pool.attestationDigest` here would also
    /// consume any active `vm.prank`.
    function _sign(uint256 poolId, address member, uint64 day) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(
                abi.encode(keccak256("AccountabilityPool.attest.v1"), address(pool), block.chainid, poolId, member, day)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _pool() internal returns (uint256 id) {
        vm.prank(alice);
        id = pool.createPool(STAKE, deadline, REQUIRED, GRACE, 5);
    }

    function _join(uint256 id, address who) internal {
        vm.prank(who);
        pool.joinPool(id);
    }

    /// Attest `n` consecutive days for `who`, starting at day0.
    function _attest(uint256 id, address who, uint32 n) internal {
        for (uint32 i; i < n; i++) {
            pool.attestDay(id, who, day0 + i, _sign(id, who, day0 + i));
        }
    }

    // ───────────── the headline arithmetic ─────────────

    /// The honest centre of this contract: with nobody failing, nobody gains.
    /// A UI that implies a return has to answer to this test.
    function test_WhenEverybodySucceedsNobodyGainsAnything() public {
        uint256 id = _pool();
        _join(id, bob);
        _attest(id, alice, REQUIRED);
        _attest(id, bob, REQUIRED);

        vm.warp(deadline);
        pool.finalise(id);

        uint256 a0 = token.balanceOf(alice);
        vm.prank(alice);
        pool.claim(id);
        assertEq(token.balanceOf(alice) - a0, STAKE, "stake back, not a paisa more");

        uint256 b0 = token.balanceOf(bob);
        vm.prank(bob);
        pool.claim(id);
        assertEq(token.balanceOf(bob) - b0, STAKE);
        assertEq(token.balanceOf(address(pool)), 0, "pool empties exactly");
    }

    /// One failure funds the others, and the sums add up to the whole pot.
    function test_AFailedMemberFundsTheOnesWhoShowedUp() public {
        uint256 id = _pool();
        _join(id, bob);
        _join(id, carol);

        _attest(id, alice, REQUIRED);
        _attest(id, bob, REQUIRED);
        _attest(id, carol, 1); // nowhere near, even with grace

        vm.warp(deadline);
        pool.finalise(id);

        assertTrue(pool.getMember(id, alice).succeeded);
        assertTrue(pool.getMember(id, bob).succeeded);
        assertFalse(pool.getMember(id, carol).succeeded);

        uint256 a0 = token.balanceOf(alice);
        uint256 b0 = token.balanceOf(bob);
        vm.prank(alice);
        pool.claim(id);
        vm.prank(bob);
        pool.claim(id);

        uint256 aGot = token.balanceOf(alice) - a0;
        uint256 bGot = token.balanceOf(bob) - b0;
        // Two equal winners split one forfeited stake.
        assertEq(aGot, STAKE + STAKE / 2);
        assertEq(bGot, STAKE + STAKE / 2);
        assertEq(aGot + bGot, STAKE * 3, "the whole pot, nothing created or lost");

        // The loser gets nothing, and claiming says so without reverting.
        uint256 c0 = token.balanceOf(carol);
        vm.prank(carol);
        pool.claim(id);
        assertEq(token.balanceOf(carol), c0);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    /// If nobody meets the rule there is nobody to redistribute to, so every
    /// stake goes back to whoever posted it. "Everyone failed" is not a reason
    /// for the contract to keep the money.
    function test_WhenNobodySucceedsEverybodyGetsTheirOwnStakeBack() public {
        uint256 id = _pool();
        _join(id, bob);
        _attest(id, alice, 1);
        _attest(id, bob, 2);

        vm.warp(deadline);
        pool.finalise(id);
        assertEq(pool.getPool(id).winners, 0);

        uint256 a0 = token.balanceOf(alice);
        uint256 b0 = token.balanceOf(bob);
        vm.prank(alice);
        pool.claim(id);
        vm.prank(bob);
        pool.claim(id);

        assertEq(token.balanceOf(alice) - a0, STAKE);
        assertEq(token.balanceOf(bob) - b0, STAKE);
        assertEq(token.balanceOf(address(pool)), 0, "nothing confiscated");
    }

    /// Rounding dust goes to the last claimer, so the pool always empties.
    function test_RoundingDustDoesNotStrandMoney() public {
        // Three winners sharing two forfeited stakes: 100000/3 does not divide.
        vm.prank(alice);
        uint256 id = pool.createPool(STAKE, deadline, REQUIRED, GRACE, 5);
        _join(id, bob);
        _join(id, carol);
        _join(id, dan);
        // alice, bob, carol succeed; dan fails. One forfeit over three winners.
        _attest(id, alice, REQUIRED);
        _attest(id, bob, REQUIRED);
        _attest(id, carol, REQUIRED);

        vm.warp(deadline);
        pool.finalise(id);

        vm.prank(alice);
        pool.claim(id);
        vm.prank(bob);
        pool.claim(id);
        vm.prank(carol);
        pool.claim(id);
        vm.prank(dan);
        pool.claim(id);

        assertEq(token.balanceOf(address(pool)), 0, "every paisa handed out");
    }

    // ───────────── the grace rule ─────────────

    function test_GraceLetsYouMissExactlyThatManyDays() public {
        uint256 id = _pool();
        // REQUIRED 5, GRACE 1 -> four attested days is enough.
        _attest(id, alice, REQUIRED - GRACE);

        assertTrue(pool.onTrack(id, alice));
        assertEq(pool.daysStillNeeded(id, alice), 0);

        vm.warp(deadline);
        pool.finalise(id);
        assertTrue(pool.getMember(id, alice).succeeded);
    }

    function test_OneDayShortOfGraceFails() public {
        uint256 id = _pool();
        _attest(id, alice, REQUIRED - GRACE - 1);

        assertFalse(pool.onTrack(id, alice));
        assertEq(pool.daysStillNeeded(id, alice), 1);

        vm.warp(deadline);
        pool.finalise(id);
        assertFalse(pool.getMember(id, alice).succeeded);
    }

    /// A pool you could win by doing nothing is not a pool.
    function test_RevertWhen_GraceCoversTheWholeRequirement() public {
        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(STAKE, deadline, 3, 3, 5);
    }

    // ───────────── attestations ─────────────

    function test_RevertWhen_AttestationIsSignedBySomeoneElse() public {
        uint256 id = _pool();
        (, uint256 impostorKey) = makeAddrAndKey("impostor");
        bytes32 digest = pool.attestationDigest(id, alice, day0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(impostorKey, digest);

        vm.expectRevert(AP.BadAttestation.selector);
        pool.attestDay(id, alice, day0, abi.encodePacked(r, s, v));
    }

    /// A member cannot sign their own day. The whole point of the attester.
    function test_RevertWhen_TheMemberSignsTheirOwnDay() public {
        uint256 id = _pool();
        (address self, uint256 selfKey) = makeAddrAndKey("self-attester");
        vm.startPrank(self);
        token.faucet();
        token.approve(address(pool), type(uint256).max);
        pool.joinPool(id);
        vm.stopPrank();

        bytes32 digest = pool.attestationDigest(id, self, day0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(selfKey, digest);

        vm.expectRevert(AP.BadAttestation.selector);
        pool.attestDay(id, self, day0, abi.encodePacked(r, s, v));
    }

    function test_RevertWhen_TheSameDayIsAttestedTwice() public {
        uint256 id = _pool();
        bytes memory sig = _sign(id, alice, day0);
        pool.attestDay(id, alice, day0, sig);

        vm.expectRevert(AP.AlreadyAttested.selector);
        pool.attestDay(id, alice, day0, sig);
    }

    /// An attestation for one member cannot be used for another.
    function test_RevertWhen_AttestationIsReplayedOntoAnotherMember() public {
        uint256 id = _pool();
        _join(id, bob);
        bytes memory forAlice = _sign(id, alice, day0);

        vm.expectRevert(AP.BadAttestation.selector);
        pool.attestDay(id, bob, day0, forAlice);
    }

    /// Nor onto another day.
    function test_RevertWhen_AttestationIsReplayedOntoAnotherDay() public {
        uint256 id = _pool();
        bytes memory forDay0 = _sign(id, alice, day0);

        vm.expectRevert(AP.BadAttestation.selector);
        pool.attestDay(id, alice, day0 + 1, forDay0);
    }

    /// Nor onto another pool.
    function test_RevertWhen_AttestationIsReplayedOntoAnotherPool() public {
        uint256 first = _pool();
        uint256 second = _pool();
        bytes memory forFirst = _sign(first, alice, day0);

        vm.expectRevert(AP.BadAttestation.selector);
        pool.attestDay(second, alice, day0, forFirst);
    }

    function test_RevertWhen_AttestingSomebodyWhoIsNotAMember() public {
        uint256 id = _pool();
        vm.expectRevert(AP.NotMember.selector);
        pool.attestDay(id, carol, day0, _sign(id, carol, day0));
    }

    function test_RevertWhen_AttestingAfterTheDeadline() public {
        uint256 id = _pool();
        bytes memory sig = _sign(id, alice, day0);
        vm.warp(deadline);
        vm.expectRevert(AP.DeadlinePassed.selector);
        pool.attestDay(id, alice, day0, sig);
    }

    // ───────────── joining ─────────────

    function test_CreatorIsAMemberAndHasStaked() public {
        uint256 before = token.balanceOf(alice);
        uint256 id = _pool();

        assertTrue(pool.getMember(id, alice).joined);
        assertEq(before - token.balanceOf(alice), STAKE);
        assertEq(pool.memberCount(id), 1);
        assertEq(pool.getPool(id).pot, STAKE);
    }

    function test_RevertWhen_JoiningTwice() public {
        uint256 id = _pool();
        vm.prank(alice);
        vm.expectRevert(AP.AlreadyMember.selector);
        pool.joinPool(id);
    }

    function test_RevertWhen_PoolIsFull() public {
        vm.prank(alice);
        uint256 id = pool.createPool(STAKE, deadline, REQUIRED, GRACE, 2);
        _join(id, bob);

        vm.prank(carol);
        vm.expectRevert(AP.PoolFull.selector);
        pool.joinPool(id);
    }

    function test_RevertWhen_JoiningAfterTheDeadline() public {
        uint256 id = _pool();
        vm.warp(deadline);
        vm.prank(bob);
        vm.expectRevert(AP.DeadlinePassed.selector);
        pool.joinPool(id);
    }

    function test_RevertWhen_JoiningAFinalisedPool() public {
        uint256 id = _pool();
        vm.warp(deadline);
        pool.finalise(id);
        vm.prank(bob);
        vm.expectRevert(AP.WrongState.selector);
        pool.joinPool(id);
    }

    function test_RevertWhen_PoolDoesNotExist() public {
        vm.prank(bob);
        vm.expectRevert(AP.PoolNotFound.selector);
        pool.joinPool(999);
    }

    // ───────────── bad parameters ─────────────

    function test_RevertWhen_StakeIsZero() public {
        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(0, deadline, REQUIRED, GRACE, 5);
    }

    function test_RevertWhen_RequiredDaysIsZero() public {
        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(STAKE, deadline, 0, 0, 5);
    }

    function test_RevertWhen_FewerThanTwoMembersAllowed() public {
        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(STAKE, deadline, REQUIRED, GRACE, 1);
    }

    function test_RevertWhen_MoreMembersThanTheCap() public {
        // Read first: an external view call on `pool` would consume the
        // expectRevert below before createPool is ever reached.
        uint32 tooMany = pool.MAX_MEMBERS_CAP() + 1;

        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(STAKE, deadline, REQUIRED, GRACE, tooMany);
    }

    function test_RevertWhen_DeadlineIsTooSoon() public {
        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(STAKE, uint64(block.timestamp + 1 hours), REQUIRED, GRACE, 5);
    }

    function test_RevertWhen_DeadlineIsTooFarAway() public {
        vm.prank(alice);
        vm.expectRevert(AP.InvalidParams.selector);
        pool.createPool(STAKE, uint64(block.timestamp + 400 days), REQUIRED, GRACE, 5);
    }

    function test_RevertWhen_ConstructedWithAZeroToken() public {
        vm.expectRevert(AP.ZeroAddress.selector);
        new AP(TestRupee(address(0)), attester);
    }

    function test_RevertWhen_ConstructedWithAZeroAttester() public {
        vm.expectRevert(AP.ZeroAddress.selector);
        new AP(token, address(0));
    }

    // ───────────── finalising and claiming ─────────────

    function test_RevertWhen_FinalisingBeforeTheDeadline() public {
        uint256 id = _pool();
        vm.expectRevert(AP.DeadlineNotReached.selector);
        pool.finalise(id);
    }

    function test_RevertWhen_FinalisingTwice() public {
        uint256 id = _pool();
        vm.warp(deadline);
        pool.finalise(id);
        vm.expectRevert(AP.WrongState.selector);
        pool.finalise(id);
    }

    /// Nobody has to wait on the creator or the attester to settle.
    function test_AnyoneMayFinalise() public {
        uint256 id = _pool();
        vm.warp(deadline);
        vm.prank(dan); // not even a member
        pool.finalise(id);
        assertEq(uint8(pool.getPool(id).state), uint8(AP.State.Finalised));
    }

    function test_RevertWhen_ClaimingBeforeFinalise() public {
        uint256 id = _pool();
        vm.prank(alice);
        vm.expectRevert(AP.WrongState.selector);
        pool.claim(id);
    }

    function test_RevertWhen_ClaimingTwice() public {
        uint256 id = _pool();
        _attest(id, alice, REQUIRED);
        vm.warp(deadline);
        pool.finalise(id);

        vm.prank(alice);
        pool.claim(id);
        vm.prank(alice);
        vm.expectRevert(AP.AlreadyClaimed.selector);
        pool.claim(id);
    }

    function test_RevertWhen_AStrangerClaims() public {
        uint256 id = _pool();
        vm.warp(deadline);
        pool.finalise(id);

        vm.prank(dan);
        vm.expectRevert(AP.NotMember.selector);
        pool.claim(id);
    }

    /// `claimableOf` must not promise anything before the outcome is known.
    function test_ClaimableIsZeroUntilFinalised() public {
        uint256 id = _pool();
        _attest(id, alice, REQUIRED);
        (uint256 stakeBack, uint256 bonus) = pool.claimableOf(id, alice);
        assertEq(stakeBack, 0);
        assertEq(bonus, 0);
    }

    function test_ClaimableMatchesWhatClaimActuallyPays() public {
        uint256 id = _pool();
        _join(id, bob);
        _attest(id, alice, REQUIRED);

        vm.warp(deadline);
        pool.finalise(id);

        (uint256 stakeBack, uint256 bonus) = pool.claimableOf(id, alice);
        uint256 a0 = token.balanceOf(alice);
        vm.prank(alice);
        pool.claim(id);
        assertEq(token.balanceOf(alice) - a0, stakeBack + bonus);
        assertEq(stakeBack + bonus, STAKE * 2, "alice takes bob's forfeited stake");
    }

    /// The member list is what a leaderboard is built from, so it has to come
    /// back in join order and contain exactly the people who joined.
    function test_MemberListIsEveryoneWhoJoinedInOrder() public {
        uint256 id = _pool();
        _join(id, bob);
        _join(id, carol);

        address[] memory list = pool.getMembers(id);
        assertEq(list.length, 3);
        assertEq(list[0], alice, "the creator is first");
        assertEq(list[1], bob);
        assertEq(list[2], carol);
        assertEq(pool.getMembers(999).length, 0, "an unknown pool has no members");
    }

    // ───────────── the invariant that matters ─────────────

    /// However the days fall, the contract can never pay out more than it took
    /// in, and never keeps anything once everyone has claimed.
    function testFuzz_PayoutsNeverExceedTheStakesPutIn(uint8 aDays, uint8 bDays, uint8 cDays) public {
        uint256 id = _pool();
        _join(id, bob);
        _join(id, carol);

        uint256 held = token.balanceOf(address(pool));
        assertEq(held, STAKE * 3);

        _attest(id, alice, uint32(bound(uint256(aDays), 0, REQUIRED)));
        _attest(id, bob, uint32(bound(uint256(bDays), 0, REQUIRED)));
        _attest(id, carol, uint32(bound(uint256(cDays), 0, REQUIRED)));

        vm.warp(deadline);
        pool.finalise(id);

        uint256 paid;
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < who.length; i++) {
            uint256 before = token.balanceOf(who[i]);
            vm.prank(who[i]);
            pool.claim(id);
            paid += token.balanceOf(who[i]) - before;
        }

        assertLe(paid, held, "never pays out more than it took in");
        assertEq(token.balanceOf(address(pool)), held - paid);
        // And with everyone claiming, the only way money stays behind is if
        // some members failed while others succeeded... which cannot happen,
        // because the forfeits are fully redistributed.
        assertEq(paid, held, "the pool always empties when everyone claims");
    }
}
