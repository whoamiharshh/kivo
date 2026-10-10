// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {Gift} from "../src/Gift.sol";

contract GiftTest is Test {
    TestRupee token;
    Gift gift;

    address alice = makeAddr("alice"); // sender
    address bob = makeAddr("bob"); // recipient
    address eve = makeAddr("eve"); // party to nothing

    address attester;
    uint256 attesterKey;
    address impostor;
    uint256 impostorKey;

    uint256 constant RS5000 = 500_000;
    uint256 constant RS1000 = 100_000;
    bytes constant CONDITION = bytes("Graduates from DU with a bachelor's degree");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        gift = new Gift(token);

        (attester, attesterKey) = makeAddrAndKey("attester");
        (impostor, impostorKey) = makeAddrAndKey("impostor");

        address[3] memory users = [alice, bob, eve];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(gift), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ───────────── helpers ─────────────

    function _timeData(uint64 when) internal pure returns (bytes memory) {
        return abi.encode(uint256(when));
    }

    function _createTime(uint64 when, bool irrevocable) internal returns (uint256 id) {
        vm.prank(alice);
        id = gift.createGift(bob, RS1000, Gift.ConditionType.Time, _timeData(when), address(0), irrevocable);
    }

    function _createAttested(bool irrevocable) internal returns (uint256 id) {
        vm.prank(alice);
        id = gift.createGift(bob, RS1000, Gift.ConditionType.Attestation, CONDITION, attester, irrevocable);
    }

    function _sign(uint256 key, uint256 giftId) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gift.attestationDigest(giftId));
        return abi.encodePacked(r, s, v);
    }

    // ───────────── time-based gifts ─────────────

    function test_TimeGiftHoldsThenReleasesOnTheDate() public {
        uint64 when = uint64(block.timestamp + 30 days);
        uint256 before = token.balanceOf(alice);

        uint256 id = _createTime(when, false);

        assertEq(token.balanceOf(alice), before - RS1000, "sender funded it");
        assertEq(token.balanceOf(address(gift)), RS1000, "contract holds it");
        assertFalse(gift.claimable(id), "not yet");

        Gift.GiftRecord memory g = gift.getGift(id);
        assertEq(g.recipient, bob);
        assertEq(g.releaseTime, when);
        assertEq(g.attester, address(0), "a date needs no attester");
        assertEq(g.conditionHash, keccak256(_timeData(when)));
        assertEq(uint8(g.conditionType), uint8(Gift.ConditionType.Time));
        assertEq(uint8(g.state), uint8(Gift.State.Pending));

        vm.warp(when);
        assertTrue(gift.claimable(id), "the date arrived");

        vm.prank(bob);
        gift.claim(id);

        assertEq(token.balanceOf(bob), RS5000 + RS1000, "recipient paid");
        assertEq(token.balanceOf(address(gift)), 0);
        assertEq(uint8(gift.getGift(id).state), uint8(Gift.State.Claimed));
    }

    function test_RevertWhen_TimeGiftClaimedEarly() public {
        uint64 when = uint64(block.timestamp + 30 days);
        uint256 id = _createTime(when, false);

        vm.warp(when - 1);
        vm.prank(bob);
        vm.expectRevert(Gift.ConditionNotMet.selector);
        gift.claim(id);
    }

    function test_RevertWhen_TimeGiftGetsAnAttester() public {
        bytes memory data = _timeData(uint64(block.timestamp + 1 days));
        vm.prank(alice);
        vm.expectRevert(Gift.AttesterNotAllowed.selector);
        gift.createGift(bob, RS1000, Gift.ConditionType.Time, data, attester, false);
    }

    function test_RevertWhen_TimeGiftDateIsTooSoon() public {
        bytes memory data = _timeData(uint64(block.timestamp + 59 minutes));
        vm.prank(alice);
        vm.expectRevert(Gift.ReleaseTooSoon.selector);
        gift.createGift(bob, RS1000, Gift.ConditionType.Time, data, address(0), false);
    }

    function test_RevertWhen_TimeGiftConditionDataIsMalformed() public {
        vm.prank(alice);
        vm.expectRevert(Gift.BadConditionData.selector);
        gift.createGift(bob, RS1000, Gift.ConditionType.Time, bytes("not-a-timestamp"), address(0), false);
    }

    /// A date arrives on its own, so attesting and the timeout path make no
    /// sense here and are refused rather than silently ignored.
    function test_RevertWhen_AttestingATimeGift() public {
        uint256 id = _createTime(uint64(block.timestamp + 30 days), false);
        bytes memory sig = _sign(attesterKey, id);
        vm.expectRevert(Gift.TimeGiftNeedsNoAttestation.selector);
        gift.attestCondition(id, sig);
    }

    function test_RevertWhen_TimeoutReleaseOnATimeGift() public {
        uint256 id = _createTime(uint64(block.timestamp + 30 days), false);
        vm.warp(block.timestamp + gift.TIMEOUT_PERIOD() + 1);
        vm.prank(bob);
        vm.expectRevert(Gift.TimeGiftNeedsNoAttestation.selector);
        gift.requestTimeoutRelease(id);
    }

    // ───────────── attested gifts ─────────────

    function test_AttestedGiftReleasesAfterTheAttesterSigns() public {
        uint256 id = _createAttested(false);
        assertFalse(gift.claimable(id));

        // Anyone may submit the signature — the signature is what counts.
        vm.prank(eve);
        gift.attestCondition(id, _sign(attesterKey, id));

        assertEq(uint8(gift.getGift(id).state), uint8(Gift.State.Attested));
        assertTrue(gift.claimable(id));

        vm.prank(bob);
        gift.claim(id);
        assertEq(token.balanceOf(bob), RS5000 + RS1000);
    }

    function test_ConditionHashCommitsToTheAgreedText() public {
        uint256 id = _createAttested(false);
        // The recipient can check the text they were shown against the chain.
        assertEq(gift.getGift(id).conditionHash, keccak256(CONDITION));
        assertTrue(gift.getGift(id).conditionHash != keccak256(bytes("something else")));
    }

    function test_RevertWhen_AttestedBySomeoneElse() public {
        uint256 id = _createAttested(false);
        bytes memory sig = _sign(impostorKey, id);
        vm.expectRevert(Gift.BadAttestation.selector);
        gift.attestCondition(id, sig);
    }

    function test_RevertWhen_AttestingTwice() public {
        uint256 id = _createAttested(false);
        bytes memory sig = _sign(attesterKey, id);
        gift.attestCondition(id, sig);

        vm.expectRevert(Gift.WrongState.selector);
        gift.attestCondition(id, sig);
    }

    /// A signature for one gift must not work on another.
    function test_RevertWhen_AttestationIsReplayedOnAnotherGift() public {
        uint256 first = _createAttested(false);
        uint256 second = _createAttested(false);

        bytes memory sigForFirst = _sign(attesterKey, first);

        vm.expectRevert(Gift.BadAttestation.selector);
        gift.attestCondition(second, sigForFirst);

        // It still works on the gift it was made for.
        gift.attestCondition(first, sigForFirst);
        assertEq(uint8(gift.getGift(first).state), uint8(Gift.State.Attested));
    }

    function test_RevertWhen_ClaimingBeforeAttestation() public {
        uint256 id = _createAttested(false);
        vm.prank(bob);
        vm.expectRevert(Gift.ConditionNotMet.selector);
        gift.claim(id);
    }

    function test_RevertWhen_AttestedGiftHasNoAttester() public {
        vm.prank(alice);
        vm.expectRevert(Gift.AttesterRequired.selector);
        gift.createGift(bob, RS1000, Gift.ConditionType.Attestation, CONDITION, address(0), false);
    }

    function test_RevertWhen_AttestedGiftHasNoCondition() public {
        vm.prank(alice);
        vm.expectRevert(Gift.BadConditionData.selector);
        gift.createGift(bob, RS1000, Gift.ConditionType.Event, bytes(""), attester, false);
    }

    function test_EventConditionWorksTheSameWay() public {
        vm.prank(alice);
        uint256 id = gift.createGift(
            bob, RS1000, Gift.ConditionType.Event, bytes("github.com/x/y release v1.0.0"), attester, true
        );

        gift.attestCondition(id, _sign(attesterKey, id));
        vm.prank(bob);
        gift.claim(id);
        assertEq(token.balanceOf(bob), RS5000 + RS1000);
    }

    // ───────────── the recipient cannot be held hostage ─────────────

    function test_RecipientReleasesItThemselvesAfterTheTimeout() public {
        uint256 id = _createAttested(true); // irrevocable, so no way back for alice
        assertEq(gift.timeUntilTimeout(id), gift.TIMEOUT_PERIOD());

        vm.warp(block.timestamp + gift.TIMEOUT_PERIOD());
        assertEq(gift.timeUntilTimeout(id), 0);

        vm.prank(bob);
        gift.requestTimeoutRelease(id);

        assertEq(token.balanceOf(bob), RS5000 + RS1000, "recipient got it anyway");
        assertEq(uint8(gift.getGift(id).state), uint8(Gift.State.Released));
    }

    function test_RevertWhen_TimeoutReleaseTooEarly() public {
        uint256 id = _createAttested(false);
        vm.warp(block.timestamp + gift.TIMEOUT_PERIOD() - 1);

        vm.prank(bob);
        vm.expectRevert(Gift.TimeoutNotReached.selector);
        gift.requestTimeoutRelease(id);
    }

    function test_RevertWhen_TimeoutReleaseByNonRecipient() public {
        uint256 id = _createAttested(false);
        vm.warp(block.timestamp + gift.TIMEOUT_PERIOD());

        vm.prank(eve);
        vm.expectRevert(Gift.NotRecipient.selector);
        gift.requestTimeoutRelease(id);
    }

    function test_RevertWhen_TimeoutReleaseAfterAttestation() public {
        uint256 id = _createAttested(false);
        gift.attestCondition(id, _sign(attesterKey, id));
        vm.warp(block.timestamp + gift.TIMEOUT_PERIOD());

        vm.prank(bob);
        vm.expectRevert(Gift.WrongState.selector);
        gift.requestTimeoutRelease(id);
    }

    // ───────────── cancelling ─────────────

    function test_SenderCancelsARefundableGift() public {
        uint256 id = _createAttested(false);
        uint256 afterCreate = token.balanceOf(alice);

        vm.prank(alice);
        gift.cancel(id);

        assertEq(token.balanceOf(alice), afterCreate + RS1000, "sender made whole");
        assertEq(token.balanceOf(bob), RS5000, "recipient got nothing");
        assertEq(uint8(gift.getGift(id).state), uint8(Gift.State.Cancelled));
        assertFalse(gift.isOpen(id));
    }

    function test_RevertWhen_CancellingAnIrrevocableGift() public {
        uint256 id = _createAttested(true);
        vm.prank(alice);
        vm.expectRevert(Gift.GiftIsIrrevocable.selector);
        gift.cancel(id);
    }

    function test_RevertWhen_CancellingAfterTheConditionIsMet() public {
        uint256 id = _createAttested(false);
        gift.attestCondition(id, _sign(attesterKey, id));

        vm.prank(alice);
        vm.expectRevert(Gift.WrongState.selector);
        gift.cancel(id);
    }

    function test_RevertWhen_CancellingATimeGiftAfterItsDate() public {
        uint64 when = uint64(block.timestamp + 30 days);
        uint256 id = _createTime(when, false);

        vm.warp(when);
        vm.prank(alice);
        vm.expectRevert(Gift.WrongState.selector);
        gift.cancel(id);
    }

    function test_SenderCanCancelATimeGiftBeforeItsDate() public {
        uint64 when = uint64(block.timestamp + 30 days);
        uint256 id = _createTime(when, false);
        uint256 afterCreate = token.balanceOf(alice);

        vm.warp(when - 1);
        vm.prank(alice);
        gift.cancel(id);
        assertEq(token.balanceOf(alice), afterCreate + RS1000);
    }

    function test_RevertWhen_CancelledByNonSender() public {
        uint256 id = _createAttested(false);
        vm.prank(bob);
        vm.expectRevert(Gift.NotSender.selector);
        gift.cancel(id);
    }

    function test_RevertWhen_ClaimingACancelledGift() public {
        uint256 id = _createAttested(false);
        vm.prank(alice);
        gift.cancel(id);

        vm.prank(bob);
        vm.expectRevert(Gift.ConditionNotMet.selector);
        gift.claim(id);
    }

    // ───────────── everything else that must revert ─────────────

    function test_RevertWhen_ConstructorTokenIsZero() public {
        vm.expectRevert(Gift.ZeroAddress.selector);
        new Gift(TestRupee(address(0)));
    }

    function test_RevertWhen_RecipientIsZero() public {
        vm.prank(alice);
        vm.expectRevert(Gift.ZeroAddress.selector);
        gift.createGift(address(0), RS1000, Gift.ConditionType.Attestation, CONDITION, attester, false);
    }

    function test_RevertWhen_GiftingYourself() public {
        vm.prank(alice);
        vm.expectRevert(Gift.SelfGift.selector);
        gift.createGift(alice, RS1000, Gift.ConditionType.Attestation, CONDITION, attester, false);
    }

    function test_RevertWhen_AmountIsZero() public {
        vm.prank(alice);
        vm.expectRevert(Gift.ZeroAmount.selector);
        gift.createGift(bob, 0, Gift.ConditionType.Attestation, CONDITION, attester, false);
    }

    function test_RevertWhen_GiftNotFound() public {
        vm.expectRevert(Gift.GiftNotFound.selector);
        gift.getGift(42);
    }

    function test_RevertWhen_DigestOfAMissingGift() public {
        vm.expectRevert(Gift.GiftNotFound.selector);
        gift.attestationDigest(42);
    }

    function test_RevertWhen_ClaimedByNonRecipient() public {
        uint256 id = _createAttested(false);
        gift.attestCondition(id, _sign(attesterKey, id));

        vm.prank(eve);
        vm.expectRevert(Gift.NotRecipient.selector);
        gift.claim(id);
    }

    function test_RevertWhen_ClaimingTwice() public {
        uint256 id = _createAttested(false);
        gift.attestCondition(id, _sign(attesterKey, id));

        vm.prank(bob);
        gift.claim(id);

        vm.prank(bob);
        vm.expectRevert(Gift.ConditionNotMet.selector);
        gift.claim(id);
    }

    function test_RevertWhen_TimeGiftClaimedTwice() public {
        uint64 when = uint64(block.timestamp + 30 days);
        uint256 id = _createTime(when, false);
        vm.warp(when);

        vm.prank(bob);
        gift.claim(id);

        vm.prank(bob);
        vm.expectRevert(Gift.WrongState.selector);
        gift.claim(id);
    }

    function test_GiftIdsIncrementFromZero() public {
        assertEq(gift.giftCount(), 0);
        assertEq(_createAttested(false), 0);
        assertEq(_createAttested(false), 1);
        assertEq(gift.giftCount(), 2);
    }

    // ───────────── money conservation ─────────────

    function testFuzz_EveryPathConservesTheMoney(uint96 raw, uint8 path) public {
        uint256 amount = uint256(raw) % token.balanceOf(alice);
        vm.assume(amount > 0);

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);

        vm.prank(alice);
        uint256 id = gift.createGift(bob, amount, Gift.ConditionType.Attestation, CONDITION, attester, false);

        if (path % 3 == 0) {
            // attested and claimed
            gift.attestCondition(id, _sign(attesterKey, id));
            vm.prank(bob);
            gift.claim(id);
            assertEq(token.balanceOf(bob), bobBefore + amount);
            assertEq(token.balanceOf(alice), aliceBefore - amount);
        } else if (path % 3 == 1) {
            // cancelled
            vm.prank(alice);
            gift.cancel(id);
            assertEq(token.balanceOf(alice), aliceBefore);
            assertEq(token.balanceOf(bob), bobBefore);
        } else {
            // released by timeout
            vm.warp(block.timestamp + gift.TIMEOUT_PERIOD());
            vm.prank(bob);
            gift.requestTimeoutRelease(id);
            assertEq(token.balanceOf(bob), bobBefore + amount);
            assertEq(token.balanceOf(alice), aliceBefore - amount);
        }

        assertEq(token.balanceOf(address(gift)), 0, "contract keeps nothing");
    }
}
