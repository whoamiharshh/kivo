// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SocialPay} from "../src/SocialPay.sol";

/// A token that tries to re-enter SocialPay while it is paying someone out.
///
/// This is the realistic shape of the attack: the escrow is only as safe as the
/// token it holds, and a hostile or badly written ERC-20 gets control during
/// `transfer`. Two defences should both hold — `nonReentrant`, and the fact
/// that every function writes its state before it moves any money.
contract ReentrantToken is ERC20 {
    SocialPay public target;
    uint256 public attackId;

    /// @dev When true the inner revert is swallowed, so the outer call can
    ///      finish and the test can check nobody was paid twice.
    bool public swallowInnerRevert;
    bool private armed;

    uint256 public innerAttempts;
    uint256 public innerReverts;

    constructor() ERC20("Hostile", "EVIL") {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(SocialPay target_, uint256 paymentId, bool swallow) external {
        target = target_;
        attackId = paymentId;
        swallowInnerRevert = swallow;
        armed = true;
    }

    /// @dev Fires once, during the payout, then disarms so the retry itself
    ///      cannot recurse forever.
    function _attack() private {
        if (!armed || address(target) == address(0)) return;
        armed = false;
        innerAttempts++;

        if (swallowInnerRevert) {
            try target.confirmReceipt(attackId) {
            // A success here would mean a double payout.
            }
            catch {
                innerReverts++;
            }
        } else {
            target.confirmReceipt(attackId);
        }
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _attack();
        return super.transfer(to, amount);
    }
}

contract SocialPaySecurityTest is Test {
    ReentrantToken token;
    SocialPay pay;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address arb = makeAddr("arbitrator");

    uint256 constant AMOUNT = 100_000; // ₹1,000.00
    uint256 constant WINDOW = 72 hours;
    bytes32 constant MEMO = keccak256("memo");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new ReentrantToken();
        pay = new SocialPay(token, arb);

        token.mintTo(alice, 500_000);
        vm.prank(alice);
        token.approve(address(pay), type(uint256).max);
    }

    /// With the inner revert allowed to propagate, the whole settlement fails.
    /// The money stays held — it is never paid out twice and never stranded.
    function test_ReentrantConfirmIsBlockedAndNothingMoves() public {
        vm.prank(alice);
        uint256 id = pay.sendPayment(bob, AMOUNT, MEMO, WINDOW);

        token.arm(pay, id, false);

        vm.prank(bob);
        vm.expectRevert(); // ReentrancyGuardReentrantCall
        pay.confirmReceipt(id);

        assertEq(token.balanceOf(bob), 0, "recipient not paid");
        assertEq(token.balanceOf(address(pay)), AMOUNT, "money still held");
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Held), "still awaiting confirmation");
    }

    /// With the inner revert swallowed, the outer settlement completes. The
    /// recipient must be paid exactly once, and the re-entrant attempt must
    /// have been refused.
    function test_ReentrancyCannotProduceADoublePayout() public {
        vm.prank(alice);
        uint256 id = pay.sendPayment(bob, AMOUNT, MEMO, WINDOW);

        token.arm(pay, id, true);

        vm.prank(bob);
        pay.confirmReceipt(id);

        assertEq(token.innerAttempts(), 1, "the attack did run");
        assertEq(token.innerReverts(), 1, "and it was refused");
        assertEq(token.balanceOf(bob), AMOUNT, "paid exactly once");
        assertEq(token.balanceOf(address(pay)), 0, "nothing left over");
        assertEq(uint8(pay.getPayment(id).state), uint8(SocialPay.State.Confirmed));
    }

    /// The same protection has to hold on the sender's path out.
    function test_ReentrancyCannotDoubleReclaim() public {
        vm.prank(alice);
        uint256 id = pay.sendPayment(bob, AMOUNT, MEMO, WINDOW);

        uint256 aliceBefore = token.balanceOf(alice);
        token.arm(pay, id, true);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        pay.reclaim(id);

        assertEq(token.innerReverts(), 1, "re-entrant confirm refused during reclaim");
        assertEq(token.balanceOf(alice), aliceBefore + AMOUNT, "returned exactly once");
        assertEq(token.balanceOf(bob), 0, "recipient got nothing");
        assertEq(token.balanceOf(address(pay)), 0);
    }

    /// A hostile token cannot make the contract pay out more than it holds,
    /// whatever order the calls arrive in.
    function testFuzz_ContractNeverPaysOutMoreThanItHolds(uint96 raw) public {
        uint256 amount = uint256(raw) % token.balanceOf(alice);
        vm.assume(amount > 0);

        vm.prank(alice);
        uint256 id = pay.sendPayment(bob, amount, MEMO, WINDOW);
        assertEq(token.balanceOf(address(pay)), amount);

        token.arm(pay, id, true);

        vm.prank(bob);
        pay.confirmReceipt(id);

        assertEq(token.balanceOf(bob), amount, "exactly the held amount");
        assertEq(token.balanceOf(address(pay)), 0, "and no more");
    }
}
