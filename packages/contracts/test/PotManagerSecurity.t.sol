// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PotManager} from "../src/PotManager.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev A token that tries to re-enter PotManager while it is paying someone out.
///      TestRupee is a plain ERC-20 with no hooks, so this stands in for the
///      hostile-token case the pot has to survive.
contract ReentrantToken is ERC20 {
    PotManager public mgr;
    uint256 public potId;
    bool public armed;
    bool public reentryAttempted;
    bool public reentryBlocked;

    constructor() ERC20("Evil Rupee", "eINR") {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(PotManager mgr_, uint256 potId_) external {
        mgr = mgr_;
        potId = potId_;
        armed = true;
    }

    /// OpenZeppelin v5 routes every transfer through _update.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // Only when the pot itself is paying out, and only once.
        if (armed && from == address(mgr)) {
            armed = false;
            reentryAttempted = true;
            try mgr.claimRefund(potId) {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
    }
}

contract PotManagerSecurityTest is Test {
    ReentrantToken token;
    PotManager mgr;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant CODE = keccak256("invite-secret");
    bytes32 inviteHash;

    address trustSigner;
    uint256 trustKey;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new ReentrantToken();
        (trustSigner, trustKey) = makeAddrAndKey("trust-signer");
        mgr = new PotManager(token, trustSigner);
        inviteHash = keccak256(abi.encodePacked(CODE));

        for (uint256 i; i < 2; i++) {
            address who = i == 0 ? alice : bob;
            token.mint(who, 1_000_000);
            vm.prank(who);
            token.approve(address(mgr), type(uint256).max);
        }
    }

    function _exp() internal view returns (uint64) {
        return uint64(block.timestamp + 10 minutes);
    }

    function _auth(uint256 potId, address joiner) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(keccak256("PotManager.join.v1"), address(mgr), block.chainid, potId, joiner, _exp()))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// A pot that missed its target, so both contributions are refundable.
    function _refundingPot() internal returns (uint256 id) {
        vm.prank(alice);
        id = mgr.createPot(inviteHash, 100_000, 5, 900_000, uint64(block.timestamp + 7 days));
        vm.prank(bob);
        mgr.join(id, CODE, _exp(), _auth(id, bob));

        vm.prank(alice);
        mgr.deposit(id, 300_000);
        vm.prank(bob);
        mgr.deposit(id, 200_000);

        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);
    }

    function test_ReentrantClaimIsBlockedAndNobodyIsPaidTwice() public {
        uint256 id = _refundingPot();
        token.arm(mgr, id);

        uint256 a0 = token.balanceOf(alice);
        vm.prank(alice);
        mgr.claimRefund(id);

        assertTrue(token.reentryAttempted(), "the token should have tried to re-enter");
        assertTrue(token.reentryBlocked(), "the reentrancy guard must reject it");

        // Paid exactly once, for exactly what she put in.
        assertEq(token.balanceOf(alice) - a0, 300_000);
        assertTrue(mgr.refundClaimed(id, alice));
        assertEq(mgr.refundableOf(id, alice), 0);

        // And the attack did not disturb the other contributor's money.
        assertEq(mgr.refundableOf(id, bob), 200_000);
        assertEq(token.balanceOf(address(mgr)), 200_000);

        uint256 b0 = token.balanceOf(bob);
        vm.prank(bob);
        mgr.claimRefund(id);
        assertEq(token.balanceOf(bob) - b0, 200_000);
        assertEq(token.balanceOf(address(mgr)), 0, "pot fully emptied");
        assertEq(uint8(mgr.getPot(id).state), uint8(PotManager.PotState.Closed));
    }

    /// The pot's accounting must never let claims exceed what was contributed,
    /// however much each person put in.
    function testFuzz_ClaimsNeverExceedContributions(uint96 aAmount, uint96 bAmount) public {
        uint256 a = bound(uint256(aAmount), 1, 400_000);
        uint256 b = bound(uint256(bAmount), 1, 400_000);

        vm.prank(alice);
        uint256 id = mgr.createPot(inviteHash, 100_000, 5, 900_000, uint64(block.timestamp + 7 days));
        vm.prank(bob);
        mgr.join(id, CODE, _exp(), _auth(id, bob));

        vm.prank(alice);
        mgr.deposit(id, a);
        vm.prank(bob);
        mgr.deposit(id, b);

        vm.warp(block.timestamp + 8 days);
        mgr.finalizeFailed(id);

        assertEq(token.balanceOf(address(mgr)), a + b);

        vm.prank(alice);
        mgr.claimRefund(id);
        vm.prank(bob);
        mgr.claimRefund(id);

        assertEq(token.balanceOf(address(mgr)), 0, "nothing stranded, nothing overpaid");
        assertEq(uint8(mgr.getPot(id).state), uint8(PotManager.PotState.Closed));
    }
}
