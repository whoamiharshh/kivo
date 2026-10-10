// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {SocialPay} from "../src/SocialPay.sol";

contract SocialPayTest is Test {
    TestRupee token;
    SocialPay pay;

    address alice = makeAddr("alice"); // usual sender
    address bob = makeAddr("bob"); // usual recipient
    address carol = makeAddr("carol");
    address eve = makeAddr("eve"); // party to nothing
    address arb = makeAddr("arbitrator");

    uint256 constant RS500 = 50_000;
    uint256 constant RS1200 = 120_000;
    uint256 constant WINDOW = 72 hours; // the spec's default
    bytes32 constant MEMO = keccak256("cab");

    bytes32 constant SECRET = keccak256("claim-secret");
    bytes32 claimHash;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        pay = new SocialPay(token, arb);
        claimHash = keccak256(abi.encodePacked(SECRET));

        address[4] memory users = [alice, bob, carol, eve];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(pay), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ───────────── helpers ─────────────

    function _send(address from, address to, uint256 amount) internal returns (uint256 id) {
        vm.prank(from);
        id = pay.sendPayment(to, amount, MEMO, WINDOW);
    }

    function _claimable(address from, uint256 amount) internal returns (uint256 id) {
        vm.prank(from);
        id = pay.createClaimablePayment(claimHash, amount, MEMO);
    }

    // ───────────── sending ─────────────

    function test_SendPaymentHoldsTheMoney() public {
        uint256 before = token.balanceOf(alice);

        uint256 id = _send(alice, bob, RS1200);

        assertEq(token.balanceOf(alice), before - RS1200, "sender paid");
        assertEq(token.balanceOf(address(pay)), RS1200, "contract holds it");
        assertEq(token.balanceOf(bob), 500_000, "recipient not paid yet");

        SocialPay.Payment memory p = pay.getPayment(id);
        assertEq(p.sender, alice);
        assertEq(p.recipient, bob);
        assertEq(p.amount, RS1200);
        assertEq(p.memoHash, MEMO);
        assertEq(uint8(p.state), uint8(SocialPay.State.Held));
        assertEq(p.deadline, uint64(block.timestamp + WINDOW));
        assertTrue(pay.isOpen(id));
    }

    function test_PaymentIdsIncrementFromZero() public {
        assertEq(pay.paymentCount(), 0);
        assertEq(_send(alice, bob, RS500), 0);
        assertEq(_send(alice, carol, RS500), 1);
        assertEq(pay.paymentCount(), 2);
    }

    function test_SendPaymentEmitsInitiated() public {
        vm.expectEmit(true, true, true, true);
        emit SocialPay.PaymentInitiated(0, alice, bob, RS1200, MEMO, uint64(block.timestamp + WINDOW));
        _send(alice, bob, RS1200);
    }

    // ───────────── confirming ─────────────

    function test_RecipientConfirmsAndGetsPaid() public {
        uint256 id = _send(alice, bob, RS1200);

        vm.prank(bob);
        pay.confirmReceipt(id);

        assertEq(token.balanceOf(bob), 500_000 + RS1200, "recipient paid");
        assertEq(token.balanceOf(address(pay)), 0, "nothing left held");
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Confirmed));
        assertFalse(pay.isOpen(id));
    }

    /// The deadline unlocks the sender's option; it does not void the payment.
    function test_RecipientCanStillConfirmAfterTheWindowIfNotReclaimed() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.warp(block.timestamp + WINDOW + 1 days);

        vm.prank(bob);
        pay.confirmReceipt(id);

        assertEq(token.balanceOf(bob), 500_000 + RS1200);
    }

    // ───────────── reclaiming ─────────────

    function test_SenderReclaimsAfterTheWindow() public {
        uint256 id = _send(alice, bob, RS1200);
        uint256 afterSend = token.balanceOf(alice);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        pay.reclaim(id);

        assertEq(token.balanceOf(alice), afterSend + RS1200, "sender made whole");
        assertEq(token.balanceOf(bob), 500_000, "recipient never paid");
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Reclaimed));
    }

    function test_TimeUntilReclaimableCountsDownThenHitsZero() public {
        uint256 id = _send(alice, bob, RS500);
        assertEq(pay.timeUntilReclaimable(id), uint64(WINDOW));

        vm.warp(block.timestamp + WINDOW - 60);
        assertEq(pay.timeUntilReclaimable(id), 60);

        vm.warp(block.timestamp + 60);
        assertEq(pay.timeUntilReclaimable(id), 0);
    }

    // ───────────── claimable payments ─────────────

    function test_ClaimablePaymentIsHeldThenClaimed() public {
        uint256 id = _claimable(alice, RS1200);

        SocialPay.Payment memory p = pay.getPayment(id);
        assertEq(p.recipient, address(0), "no recipient yet");
        assertEq(p.claimHash, claimHash);
        assertEq(uint8(p.state), uint8(SocialPay.State.Claimable));
        assertEq(token.balanceOf(address(pay)), RS1200);

        vm.prank(carol);
        pay.claimPayment(id, SECRET);

        assertEq(token.balanceOf(carol), 500_000 + RS1200, "claimer paid");
        assertEq(pay.getPayment(id).recipient, carol, "recorded as recipient");
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Claimed));
    }

    function test_UnclaimedClaimablePaymentGoesBackToSenderAfterExpiry() public {
        uint256 id = _claimable(alice, RS1200);
        uint256 afterSend = token.balanceOf(alice);

        vm.warp(block.timestamp + pay.CLAIM_EXPIRY());
        vm.prank(alice);
        pay.reclaim(id);

        assertEq(token.balanceOf(alice), afterSend + RS1200);
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Reclaimed));
    }

    // ───────────── disputes ─────────────

    function test_BothPartiesAgreeingSettlesWithoutTheArbitrator() public {
        uint256 id = _send(alice, bob, RS1200);

        vm.prank(bob);
        pay.dispute(id);
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Disputed));
        assertTrue(pay.isOpen(id), "money still held while disputed");

        vm.prank(alice);
        pay.resolveDispute(id, true);
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Disputed), "one vote is not enough");
        assertEq(token.balanceOf(bob), 500_000, "nothing moved on a single vote");

        vm.prank(bob);
        pay.resolveDispute(id, true);

        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Resolved));
        assertEq(token.balanceOf(bob), 500_000 + RS1200, "released to recipient");
        assertEq(token.balanceOf(address(pay)), 0);
    }

    function test_ArbitratorPlusOnePartySettlesToSender() public {
        uint256 id = _send(alice, bob, RS1200);
        uint256 afterSend = token.balanceOf(alice);

        vm.prank(alice);
        pay.dispute(id);

        vm.prank(arb);
        pay.resolveDispute(id, false);
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Disputed));

        vm.prank(alice);
        pay.resolveDispute(id, false);

        assertEq(token.balanceOf(alice), afterSend + RS1200, "returned to sender");
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Resolved));
    }

    /// The arbitrator holds one seat of three, not a casting vote.
    function test_ArbitratorAloneCannotSettle() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.prank(alice);
        pay.dispute(id);

        vm.prank(arb);
        pay.resolveDispute(id, true);

        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Disputed));
        assertEq(token.balanceOf(address(pay)), RS1200, "money untouched");
    }

    function test_DisagreeingVotesLeaveItDisputedUntilTwoMatch() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.prank(bob);
        pay.dispute(id);

        vm.prank(alice);
        pay.resolveDispute(id, false); // sender wants it back
        vm.prank(bob);
        pay.resolveDispute(id, true); // recipient wants it released
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Disputed), "deadlocked");

        vm.prank(arb);
        pay.resolveDispute(id, true); // arbitrator breaks the tie

        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Resolved));
        assertEq(token.balanceOf(bob), 500_000 + RS1200);
    }

    function test_EitherPartyMayOpenADispute() public {
        uint256 a = _send(alice, bob, RS500);
        vm.prank(alice);
        pay.dispute(a);
        assertEq(uint8(pay.getPayment(a).state), uint8(SocialPay.State.Disputed));

        uint256 b = _send(alice, bob, RS500);
        vm.prank(bob);
        pay.dispute(b);
        assertEq(uint8(pay.getPayment(b).state), uint8(SocialPay.State.Disputed));
    }

    // ───────────── the regressions the spec names ─────────────

    function test_RevertWhen_ConfirmTwice() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.prank(bob);
        pay.confirmReceipt(id);

        vm.prank(bob);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.confirmReceipt(id);
    }

    function test_RevertWhen_ConfirmAfterReclaim() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        pay.reclaim(id);

        vm.prank(bob);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.confirmReceipt(id);
    }

    function test_RevertWhen_ReclaimBeforeWindow() public {
        uint256 id = _send(alice, bob, RS1200);

        vm.warp(block.timestamp + WINDOW - 1);
        vm.prank(alice);
        vm.expectRevert(SocialPay.TooEarly.selector);
        pay.reclaim(id);
    }

    function test_RevertWhen_DisputeAfterConfirm() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.prank(bob);
        pay.confirmReceipt(id);

        vm.prank(alice);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.dispute(id);
    }

    function test_RevertWhen_ResolveByNonArbitrator() public {
        uint256 id = _send(alice, bob, RS1200);
        vm.prank(bob);
        pay.dispute(id);

        vm.prank(eve);
        vm.expectRevert(SocialPay.NotResolver.selector);
        pay.resolveDispute(id, true);
    }

    // ───────────── every other failure path ─────────────

    function test_RevertWhen_ConstructorTokenIsZero() public {
        vm.expectRevert(SocialPay.ZeroAddress.selector);
        new SocialPay(TestRupee(address(0)), arb);
    }

    function test_RevertWhen_ConstructorArbitratorIsZero() public {
        vm.expectRevert(SocialPay.ZeroAddress.selector);
        new SocialPay(token, address(0));
    }

    function test_RevertWhen_SendToZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert(SocialPay.ZeroAddress.selector);
        pay.sendPayment(address(0), RS500, MEMO, WINDOW);
    }

    function test_RevertWhen_SendToSelf() public {
        vm.prank(alice);
        vm.expectRevert(SocialPay.SelfPayment.selector);
        pay.sendPayment(alice, RS500, MEMO, WINDOW);
    }

    function test_RevertWhen_SendZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(SocialPay.ZeroAmount.selector);
        pay.sendPayment(bob, 0, MEMO, WINDOW);
    }

    function test_RevertWhen_WindowTooShort() public {
        // Read the constant before arming expectRevert: otherwise the getter
        // call is the "next call" and it is the one expected to revert.
        uint256 tooShort = uint256(pay.MIN_CONFIRM_WINDOW()) - 1;

        vm.prank(alice);
        vm.expectRevert(SocialPay.WindowOutOfRange.selector);
        pay.sendPayment(bob, RS500, MEMO, tooShort);
    }

    function test_RevertWhen_WindowTooLong() public {
        uint256 tooLong = uint256(pay.MAX_CONFIRM_WINDOW()) + 1;

        vm.prank(alice);
        vm.expectRevert(SocialPay.WindowOutOfRange.selector);
        pay.sendPayment(bob, RS500, MEMO, tooLong);
    }

    function test_RevertWhen_PaymentNotFound() public {
        vm.expectRevert(SocialPay.PaymentNotFound.selector);
        pay.getPayment(99);
    }

    function test_RevertWhen_NonRecipientConfirms() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(eve);
        vm.expectRevert(SocialPay.NotRecipient.selector);
        pay.confirmReceipt(id);
    }

    /// Even the sender cannot confirm on the recipient's behalf.
    function test_RevertWhen_SenderConfirmsOwnPayment() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(alice);
        vm.expectRevert(SocialPay.NotRecipient.selector);
        pay.confirmReceipt(id);
    }

    function test_RevertWhen_NonSenderReclaims() public {
        uint256 id = _send(alice, bob, RS500);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(bob);
        vm.expectRevert(SocialPay.NotSender.selector);
        pay.reclaim(id);
    }

    function test_RevertWhen_ReclaimAfterConfirmed() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(bob);
        pay.confirmReceipt(id);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.reclaim(id);
    }

    function test_RevertWhen_StrangerDisputes() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(eve);
        vm.expectRevert(SocialPay.NotParty.selector);
        pay.dispute(id);
    }

    function test_RevertWhen_DisputeTwice() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(bob);
        pay.dispute(id);

        vm.prank(alice);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.dispute(id);
    }

    function test_RevertWhen_VoteTwice() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(bob);
        pay.dispute(id);

        vm.prank(arb);
        pay.resolveDispute(id, true);

        vm.prank(arb);
        vm.expectRevert(SocialPay.AlreadyVoted.selector);
        pay.resolveDispute(id, false);
    }

    function test_RevertWhen_ResolveWhenNotDisputed() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(arb);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.resolveDispute(id, true);
    }

    function test_RevertWhen_ClaimHashIsZero() public {
        vm.prank(alice);
        vm.expectRevert(SocialPay.ClaimHashZero.selector);
        pay.createClaimablePayment(bytes32(0), RS500, MEMO);
    }

    function test_RevertWhen_ClaimableAmountIsZero() public {
        vm.prank(alice);
        vm.expectRevert(SocialPay.ZeroAmount.selector);
        pay.createClaimablePayment(claimHash, 0, MEMO);
    }

    function test_RevertWhen_ClaimWithWrongSecret() public {
        uint256 id = _claimable(alice, RS500);
        vm.prank(carol);
        vm.expectRevert(SocialPay.BadClaimSecret.selector);
        pay.claimPayment(id, keccak256("guess"));
    }

    function test_RevertWhen_ClaimAfterExpiry() public {
        uint256 id = _claimable(alice, RS500);
        vm.warp(block.timestamp + pay.CLAIM_EXPIRY());

        vm.prank(carol);
        vm.expectRevert(SocialPay.Expired.selector);
        pay.claimPayment(id, SECRET);
    }

    function test_RevertWhen_SenderClaimsOwnClaimablePayment() public {
        uint256 id = _claimable(alice, RS500);
        vm.prank(alice);
        vm.expectRevert(SocialPay.CannotClaimOwnPayment.selector);
        pay.claimPayment(id, SECRET);
    }

    function test_RevertWhen_ClaimTwice() public {
        uint256 id = _claimable(alice, RS500);
        vm.prank(carol);
        pay.claimPayment(id, SECRET);

        vm.prank(bob);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.claimPayment(id, SECRET);
    }

    function test_RevertWhen_ClaimingADirectPayment() public {
        uint256 id = _send(alice, bob, RS500);
        vm.prank(bob);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.claimPayment(id, SECRET);
    }

    function test_RevertWhen_ReclaimingAClaimedPayment() public {
        uint256 id = _claimable(alice, RS500);
        vm.prank(carol);
        pay.claimPayment(id, SECRET);

        vm.warp(block.timestamp + pay.CLAIM_EXPIRY());
        vm.prank(alice);
        vm.expectRevert(SocialPay.WrongState.selector);
        pay.reclaim(id);
    }

    function test_RevertWhen_SendingMoreThanYouHave() public {
        uint256 tooMuch = token.balanceOf(alice) + 1;
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientBalance from OpenZeppelin
        pay.sendPayment(bob, tooMuch, MEMO, WINDOW);
    }

    // ───────────── money conservation ─────────────

    /// Whatever happens to a payment, the contract ends up holding nothing and
    /// the two parties' balances move by exactly the amount, in one direction.
    function testFuzz_SettlingConservesEveryPaisa(uint96 raw, bool confirmIt) public {
        uint256 amount = uint256(raw) % token.balanceOf(alice);
        vm.assume(amount > 0);

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);

        uint256 id = _send(alice, bob, amount);

        if (confirmIt) {
            vm.prank(bob);
            pay.confirmReceipt(id);
            assertEq(token.balanceOf(alice), aliceBefore - amount);
            assertEq(token.balanceOf(bob), bobBefore + amount);
        } else {
            vm.warp(block.timestamp + WINDOW);
            vm.prank(alice);
            pay.reclaim(id);
            assertEq(token.balanceOf(alice), aliceBefore);
            assertEq(token.balanceOf(bob), bobBefore);
        }

        assertEq(token.balanceOf(address(pay)), 0, "contract holds nothing after settling");
    }

    /// Several payments at once stay independent: settling one must not touch
    /// the money held for another.
    function test_ConcurrentPaymentsDoNotInterfere() public {
        uint256 a = _send(alice, bob, RS500);
        uint256 b = _send(alice, carol, RS1200);
        assertEq(token.balanceOf(address(pay)), RS500 + RS1200);

        vm.prank(bob);
        pay.confirmReceipt(a);

        assertEq(token.balanceOf(address(pay)), RS1200, "carol's money untouched");
        assertEq(uint8(pay.getPayment(b).state), uint8(SocialPay.State.Held));

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        pay.reclaim(b);
        assertEq(token.balanceOf(address(pay)), 0);
    }
}
