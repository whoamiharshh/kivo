// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {PotManager} from "../src/PotManager.sol";

contract PotManagerTest is Test {
    TestRupee token;
    PotManager mgr;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address eve = makeAddr("eve");

    bytes32 constant CODE = keccak256("invite-secret");
    bytes32 inviteHash;

    uint256 constant LIMIT = 100_000; // ₹1,000.00
    uint256 constant RS2000 = 200_000;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        mgr = new PotManager(token);
        inviteHash = keccak256(abi.encodePacked(CODE));

        address[4] memory users = [alice, bob, carol, eve];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(mgr), type(uint256).max);
            vm.stopPrank();
        }
    }

    // alice creates, bob + carol join, each deposits ₹2,000
    function _fundedPot() internal returns (uint256 id) {
        vm.prank(alice);
        id = mgr.createPot(inviteHash, LIMIT, 5);
        vm.prank(bob);
        mgr.join(id, CODE);
        vm.prank(carol);
        mgr.join(id, CODE);
        vm.prank(alice);
        mgr.deposit(id, RS2000);
        vm.prank(bob);
        mgr.deposit(id, RS2000);
        vm.prank(carol);
        mgr.deposit(id, RS2000);
    }

    // ───── create / join ─────

    function test_CreateAndJoin() public {
        uint256 id = _fundedPot();
        assertEq(mgr.getMembers(id).length, 3);
        assertEq(mgr.getPot(id).balance, 3 * RS2000);
        assertEq(mgr.contributed(id, bob), RS2000);
    }

    function test_RevertWhen_BadInviteCode() public {
        vm.prank(alice);
        uint256 id = mgr.createPot(inviteHash, LIMIT, 5);
        vm.prank(eve);
        vm.expectRevert(PotManager.BadInviteCode.selector);
        mgr.join(id, keccak256("wrong"));
    }

    function test_RevertWhen_PotFull() public {
        vm.prank(alice);
        uint256 id = mgr.createPot(inviteHash, LIMIT, 2);
        vm.prank(bob);
        mgr.join(id, CODE);
        vm.prank(carol);
        vm.expectRevert(PotManager.PotFull.selector);
        mgr.join(id, CODE);
    }

    function test_RevertWhen_JoinTwice() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        vm.expectRevert(PotManager.AlreadyMember.selector);
        mgr.join(id, CODE);
    }

    function test_RevertWhen_NonMemberDeposits() public {
        uint256 id = _fundedPot();
        vm.prank(eve);
        vm.expectRevert(PotManager.NotMember.selector);
        mgr.deposit(id, 1_000);
    }

    // ───── spending rules ─────

    function test_SmallPayoutToOtherMemberIsInstant() public {
        uint256 id = _fundedPot();
        uint256 before = token.balanceOf(bob);
        vm.prank(alice);
        mgr.requestSpend(id, bob, 50_000, bytes32("cab"));
        assertEq(token.balanceOf(bob), before + 50_000);
        assertEq(mgr.getPot(id).balance, 3 * RS2000 - 50_000);
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
        mgr.requestSpend(id, bob, 3 * RS2000 + 1, bytes32(0));
    }

    function test_RevertWhen_ApprovedSpendExceedsBalanceAtExecution() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        uint256 big = mgr.requestSpend(id, bob, 500_000, bytes32(0)); // pending, ₹5,000 of ₹6,000
        vm.prank(bob);
        uint256 other = mgr.requestSpend(id, carol, 200_000, bytes32(0)); // pending
        vm.prank(alice);
        mgr.approveSpend(id, other); // balance now ₹4,000
        vm.prank(carol);
        vm.expectRevert(PotManager.InsufficientBalance.selector);
        mgr.approveSpend(id, big);
    }

    // ───── close & refunds ─────

    function test_CloseRefundsProRata() public {
        vm.prank(alice);
        uint256 id = mgr.createPot(inviteHash, LIMIT, 5);
        vm.prank(bob);
        mgr.join(id, CODE);
        vm.prank(alice);
        mgr.deposit(id, 100_000); // ₹1,000
        vm.prank(bob);
        mgr.deposit(id, 300_000); // ₹3,000
        vm.prank(alice);
        uint256 sid = mgr.requestSpend(id, bob, 200_000, bytes32(0)); // over limit
        vm.prank(bob);
        mgr.approveSpend(id, sid); // pot left: ₹2,000

        uint256 a0 = token.balanceOf(alice);
        uint256 b0 = token.balanceOf(bob);
        vm.prank(alice);
        mgr.closePot(id);

        assertEq(token.balanceOf(alice) - a0, 50_000); // 25% of ₹2,000
        assertEq(token.balanceOf(bob) - b0, 150_000); // 75% of ₹2,000
        assertEq(token.balanceOf(address(mgr)), 0);
        assertTrue(mgr.getPot(id).closed);
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

    function test_RevertWhen_NonCreatorCloses() public {
        uint256 id = _fundedPot();
        vm.prank(bob);
        vm.expectRevert(PotManager.NotCreator.selector);
        mgr.closePot(id);
    }

    function test_RevertWhen_ActionAfterClose() public {
        uint256 id = _fundedPot();
        vm.prank(alice);
        mgr.closePot(id);
        vm.prank(bob);
        vm.expectRevert(PotManager.PotIsClosed.selector);
        mgr.deposit(id, 1_000);
    }

    // ───── faucet ─────

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
