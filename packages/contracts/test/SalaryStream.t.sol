// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {SalaryStream} from "../src/SalaryStream.sol";

contract SalaryStreamTest is Test {
    TestRupee token;
    SalaryStream stream;

    address boss = makeAddr("boss");
    address worker = makeAddr("worker");
    address stranger = makeAddr("stranger");

    /// ₹50,000 a month is about 2 paise a second. Round numbers make the
    /// arithmetic in these tests checkable by hand.
    uint256 constant RATE = 2;
    uint256 constant FAUCET = 500_000;
    uint64 start;
    uint64 end;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new TestRupee();
        stream = new SalaryStream(token);

        start = uint64(block.timestamp);
        end = start + 30 days;

        address[3] memory users = [boss, worker, stranger];
        for (uint256 i; i < users.length; i++) {
            vm.startPrank(users[i]);
            token.faucet();
            token.approve(address(stream), type(uint256).max);
            vm.stopPrank();
        }

        // A month of salary at 2 paise a second is ₹51,840, well past the
        // faucet's ₹5,000. Only the employer needs the bigger balance; the
        // worker keeps exactly FAUCET so the assertions below stay readable.
        deal(address(token), boss, 100_000_000);
    }

    function _open(uint256 deposit) internal returns (uint256 id) {
        vm.prank(boss);
        id = stream.createAndFundStream(worker, RATE, start, end, deposit);
    }

    // ───────────── accrual ─────────────

    function test_SalaryAccruesBySecond() public {
        uint256 id = _open(RATE * 30 days); // a full term, so the cap is not in play
        assertEq(stream.withdrawable(id), 0, "nothing at the first instant");

        vm.warp(start + 1);
        assertEq(stream.withdrawable(id), RATE, "one second, one tick of salary");

        vm.warp(start + 3600);
        assertEq(stream.withdrawable(id), RATE * 3600, "an hour of it");

        vm.warp(start + 10 days);
        assertEq(stream.earned(id), RATE * 10 days);
    }

    function test_WithdrawPaysExactlyWhatAccrued() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 1 days);

        uint256 expected = RATE * 1 days;
        vm.prank(worker);
        stream.withdraw(id);

        assertEq(token.balanceOf(worker), FAUCET + expected);
        assertEq(stream.withdrawable(id), 0, "nothing left right after withdrawing");

        // And it keeps accruing afterwards.
        vm.warp(start + 2 days);
        assertEq(stream.withdrawable(id), RATE * 1 days);
    }

    function test_AccrualStopsAtTheEndOfTheContract() public {
        uint256 id = _open(RATE * 40 days); // more than enough
        vm.warp(end + 10 days);

        assertEq(stream.earned(id), RATE * 30 days, "paid to the end date, not beyond");
    }

    /// There is no division in the accrual path, so no amount is ever lost to
    /// rounding — whatever the rate, the arithmetic is exact.
    function testFuzz_AccrualIsExactForAnyRate(uint64 rate, uint32 elapsed) public {
        vm.assume(rate > 0 && rate < 1_000_000);
        vm.assume(elapsed > 0 && elapsed < 30 days);

        uint256 deposit = uint256(rate) * 30 days;
        deal(address(token), boss, deposit);

        vm.prank(boss);
        uint256 id = stream.createAndFundStream(worker, rate, start, end, deposit);

        vm.warp(start + elapsed);
        assertEq(stream.withdrawable(id), uint256(rate) * elapsed, "exact, to the paisa");
    }

    // ───────────── the funded-balance cap ─────────────

    /// The rule the brief leaves to an off-chain monitor, enforced structurally:
    /// an employee is never shown salary the employer has not funded.
    function test_AccrualNeverExceedsWhatWasFunded() public {
        uint256 oneDay = RATE * 1 days;
        uint256 id = _open(oneDay); // funded for exactly one day

        vm.warp(start + 10 days); // ten days pass
        assertEq(stream.earned(id), oneDay, "accrual stopped when the money ran out");
        assertEq(stream.runwaySeconds(id), 0);

        // And the employee can take all of it, because it is really there.
        vm.prank(worker);
        stream.withdraw(id);
        assertEq(token.balanceOf(worker), FAUCET + oneDay);
        assertEq(token.balanceOf(address(stream)), 0, "the contract held every paisa it promised");
    }

    function test_ToppingUpExtendsTheRunwayWithoutBackPaying() public {
        uint256 oneDay = RATE * 1 days;
        uint256 id = _open(oneDay);

        vm.warp(start + 5 days); // four days spent out of funds
        assertEq(stream.earned(id), oneDay, "capped");

        vm.prank(boss);
        stream.topUp(id, oneDay);

        // The top-up must not retroactively pay for the dry stretch.
        assertEq(stream.earned(id), oneDay, "no back-pay for the unfunded days");

        vm.warp(start + 6 days);
        assertEq(stream.earned(id), oneDay + RATE * 1 days, "accruing again from the top-up");
    }

    function test_RunwayAndLowRunwayFlag() public {
        uint256 id = _open(RATE * 30 days);
        assertEq(stream.runwaySeconds(id), 30 days);
        assertFalse(stream.runwayIsLow(id));

        vm.warp(start + 24 days); // 6 days of runway left
        assertEq(stream.runwaySeconds(id), 6 days);
        assertTrue(stream.runwayIsLow(id), "under the seven-day line");
    }

    // ───────────── pausing ─────────────

    function test_PausedTimeIsNotPaid() public {
        uint256 id = _open(RATE * 30 days);

        vm.warp(start + 1 days);
        vm.prank(boss);
        stream.pauseStream(id);
        uint256 atPause = stream.earned(id);
        assertEq(atPause, RATE * 1 days);

        vm.warp(start + 5 days); // four days paused
        assertEq(stream.earned(id), atPause, "the clock really stopped");

        vm.prank(boss);
        stream.resumeStream(id);
        vm.warp(start + 6 days);
        assertEq(stream.earned(id), atPause + RATE * 1 days, "one day since resuming, not five");
    }

    function test_EmployeeCanStillWithdrawWhilePaused() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 1 days);
        vm.prank(boss);
        stream.pauseStream(id);

        vm.prank(worker);
        stream.withdraw(id);
        assertEq(token.balanceOf(worker), FAUCET + RATE * 1 days, "earned money is still theirs");
    }

    /// Anyone may pause a stream that is nearly out of money — the whole point
    /// is that it should not wait on the employer noticing.
    function test_AnyoneMayPauseAStreamWithLowRunway() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 24 days); // 6 days left

        vm.prank(stranger);
        stream.pauseStream(id);
        assertEq(uint8(stream.getStream(id).state), uint8(SalaryStream.State.Paused));
    }

    function test_RevertWhen_StrangerPausesAHealthyStream() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 1 days);

        vm.prank(stranger);
        vm.expectRevert(SalaryStream.RunwayNotLow.selector);
        stream.pauseStream(id);
    }

    function test_RevertWhen_PausingTwice() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(boss);
        stream.pauseStream(id);

        vm.prank(boss);
        vm.expectRevert(SalaryStream.WrongState.selector);
        stream.pauseStream(id);
    }

    function test_RevertWhen_ResumingWhatIsNotPaused() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(boss);
        vm.expectRevert(SalaryStream.WrongState.selector);
        stream.resumeStream(id);
    }

    function test_RevertWhen_StrangerResumes() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(boss);
        stream.pauseStream(id);

        vm.prank(stranger);
        vm.expectRevert(SalaryStream.NotEmployer.selector);
        stream.resumeStream(id);
    }

    // ───────────── cancelling ─────────────

    function test_CancellingLeavesEarnedSalaryWithTheEmployee() public {
        uint256 deposit = RATE * 30 days;
        uint256 id = _open(deposit);
        uint256 bossAfterFunding = token.balanceOf(boss);

        vm.warp(start + 10 days);
        uint256 earnedSoFar = RATE * 10 days;

        vm.prank(boss);
        stream.cancelStream(id);

        assertEq(
            token.balanceOf(boss),
            bossAfterFunding + (deposit - earnedSoFar),
            "employer got back only the unearned part"
        );
        assertEq(stream.withdrawable(id), earnedSoFar, "employee's earnings untouched");

        vm.prank(worker);
        stream.withdraw(id);
        assertEq(token.balanceOf(worker), FAUCET + earnedSoFar);
        assertEq(token.balanceOf(address(stream)), 0);
    }

    function test_CancellingStopsFurtherAccrual() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 1 days);
        vm.prank(boss);
        stream.cancelStream(id);

        uint256 owed = stream.withdrawable(id);
        vm.warp(start + 20 days);
        assertEq(stream.withdrawable(id), owed, "a cancelled stream does not keep accruing");
    }

    /// After the end date, cancelling is how the employer sweeps the remainder.
    function test_EmployerSweepsLeftoverAfterTheEndDate() public {
        uint256 deposit = RATE * 40 days;
        uint256 id = _open(deposit);
        uint256 bossAfterFunding = token.balanceOf(boss);

        vm.warp(end + 1 days);
        vm.prank(boss);
        stream.cancelStream(id);

        uint256 fullTerm = RATE * 30 days;
        assertEq(token.balanceOf(boss), bossAfterFunding + (deposit - fullTerm));
    }

    function test_RevertWhen_StrangerCancels() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(stranger);
        vm.expectRevert(SalaryStream.NotEmployer.selector);
        stream.cancelStream(id);
    }

    function test_RevertWhen_CancellingTwice() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(boss);
        stream.cancelStream(id);

        vm.prank(boss);
        vm.expectRevert(SalaryStream.WrongState.selector);
        stream.cancelStream(id);
    }

    function test_RevertWhen_ToppingUpACancelledStream() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(boss);
        stream.cancelStream(id);

        vm.prank(boss);
        vm.expectRevert(SalaryStream.WrongState.selector);
        stream.topUp(id, 1_000);
    }

    // ───────────── access and validation ─────────────

    function test_RevertWhen_ConstructorTokenIsZero() public {
        vm.expectRevert(SalaryStream.ZeroAddress.selector);
        new SalaryStream(TestRupee(address(0)));
    }

    /// The brief's own signature opens an unfunded stream, which is refused.
    function test_RevertWhen_CreatingAnUnfundedStream() public {
        vm.prank(boss);
        vm.expectRevert(SalaryStream.UnderfundedStart.selector);
        stream.createStream(worker, RATE, start, end);
    }

    function test_RevertWhen_EmployeeIsZero() public {
        vm.prank(boss);
        vm.expectRevert(SalaryStream.ZeroAddress.selector);
        stream.createAndFundStream(address(0), RATE, start, end, 1_000);
    }

    function test_RevertWhen_StreamingToYourself() public {
        vm.prank(boss);
        vm.expectRevert(SalaryStream.SelfStream.selector);
        stream.createAndFundStream(boss, RATE, start, end, 1_000);
    }

    function test_RevertWhen_RateIsZero() public {
        vm.prank(boss);
        vm.expectRevert(SalaryStream.ZeroRate.selector);
        stream.createAndFundStream(worker, 0, start, end, 1_000);
    }

    function test_RevertWhen_EndBeforeStart() public {
        uint64 s = start + 10 days;
        vm.prank(boss);
        vm.expectRevert(SalaryStream.BadWindow.selector);
        stream.createAndFundStream(worker, RATE, s, s - 1 days, 1_000);
    }

    function test_RevertWhen_WindowTooShort() public {
        vm.prank(boss);
        vm.expectRevert(SalaryStream.BadWindow.selector);
        stream.createAndFundStream(worker, RATE, start, start + 59 minutes, 1_000);
    }

    function test_RevertWhen_WindowTooLong() public {
        vm.prank(boss);
        vm.expectRevert(SalaryStream.BadWindow.selector);
        stream.createAndFundStream(worker, RATE, start, start + 3651 days, 1_000);
    }

    function test_RevertWhen_TimestampDoesNotFitU64() public {
        uint256 huge = uint256(type(uint64).max) + 1;
        vm.prank(boss);
        vm.expectRevert(SalaryStream.BadWindow.selector);
        stream.createAndFundStream(worker, RATE, start, huge, 1_000);
    }

    function test_RevertWhen_StrangerWithdraws() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 1 days);
        vm.prank(stranger);
        vm.expectRevert(SalaryStream.NotEmployee.selector);
        stream.withdraw(id);
    }

    /// Not even the employer can pull the employee's salary out.
    function test_RevertWhen_EmployerWithdraws() public {
        uint256 id = _open(RATE * 30 days);
        vm.warp(start + 1 days);
        vm.prank(boss);
        vm.expectRevert(SalaryStream.NotEmployee.selector);
        stream.withdraw(id);
    }

    function test_RevertWhen_WithdrawingNothing() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(worker);
        vm.expectRevert(SalaryStream.NothingToWithdraw.selector);
        stream.withdraw(id);
    }

    function test_RevertWhen_StrangerTopsUp() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(stranger);
        vm.expectRevert(SalaryStream.NotEmployer.selector);
        stream.topUp(id, 1_000);
    }

    function test_RevertWhen_ToppingUpNothing() public {
        uint256 id = _open(RATE * 30 days);
        vm.prank(boss);
        vm.expectRevert(SalaryStream.ZeroAmount.selector);
        stream.topUp(id, 0);
    }

    function test_RevertWhen_StreamNotFound() public {
        vm.expectRevert(SalaryStream.StreamNotFound.selector);
        stream.getStream(99);
    }

    function test_StreamIdsIncrementFromZero() public {
        assertEq(stream.streamCount(), 0);
        assertEq(_open(1_000), 0);
        assertEq(_open(1_000), 1);
        assertEq(stream.streamCount(), 2);
    }

    // ───────────── conservation ─────────────

    /// Over a full life — accrue, withdraw, pause, resume, top up, cancel — the
    /// contract ends holding nothing and nobody is short.
    function test_WholeLifecycleConservesEveryPaisa() public {
        uint256 deposit = RATE * 20 days;
        uint256 id = _open(deposit);
        uint256 bossStart = token.balanceOf(boss);

        vm.warp(start + 2 days);
        vm.prank(worker);
        stream.withdraw(id);

        vm.warp(start + 4 days);
        vm.prank(boss);
        stream.pauseStream(id);

        vm.warp(start + 9 days);
        vm.prank(boss);
        stream.resumeStream(id);

        vm.prank(boss);
        stream.topUp(id, RATE * 5 days);

        vm.warp(start + 12 days);
        vm.prank(boss);
        stream.cancelStream(id);

        vm.prank(worker);
        stream.withdraw(id);

        // Paid for 4 days before the pause, plus 3 days after resuming.
        uint256 paid = RATE * 7 days;
        assertEq(token.balanceOf(worker), FAUCET + paid, "paid for time worked, not paused");
        assertEq(
            token.balanceOf(boss),
            bossStart - RATE * 5 days + (deposit + RATE * 5 days - paid),
            "employer got back everything not earned"
        );
        assertEq(token.balanceOf(address(stream)), 0, "contract empty");
    }
}
