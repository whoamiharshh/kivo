// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title The one test that stops the whole trust layer being silently broken.
///
/// The app's server recreates each contract's digest in TypeScript so that
/// signing needs no RPC call (apps/pot/lib/server/trust-signer.ts). If the two
/// formulas ever drift apart, every signature the server issues is rejected
/// on-chain — a total failure that stays invisible until somebody tries a
/// transaction and gets an opaque revert.
///
/// So the expected values below are not computed here. They were produced by
/// the TypeScript side, by running:
///
///     cd apps/pot && node scripts/check-digests.mjs
///
/// and pasted in. This test asserts Solidity agrees. Change a digest formula
/// on either side and this test fails, which is the entire point: it is a
/// tripwire between two languages, not a tautology.
///
/// The inputs are fixed, arbitrary and deliberately not round numbers, so that
/// a transposed argument shows up rather than cancelling out.
contract TrustLayerDigestsTest is Test {
    address constant POT_MANAGER = 0x00000000000000000000000000000000000000A1;
    address constant SAVINGS = 0x00000000000000000000000000000000000000A2;
    address constant GIFT = 0x00000000000000000000000000000000000000A3;
    address constant MICRO_COVER = 0x00000000000000000000000000000000000000a4;
    address constant INCOME_SHARE = 0x00000000000000000000000000000000000000A5;
    address constant POOL = 0x00000000000000000000000000000000000000a6;
    address constant JOINER = 0x00000000000000000000000000000000000000B1;

    uint256 constant CHAIN_ID = 10143;
    uint256 constant POT_ID = 7;
    uint64 constant EXPIRY = 1800000000;
    uint256 constant GOAL_ID = 3;
    uint256 constant GIFT_ID = 11;
    uint256 constant POLICY_ID = 5;
    uint256 constant POOL_ID = 13;
    uint64 constant DAY = 20400;
    uint256 constant AGREEMENT_ID = 9;
    uint256 constant INDEX = 2;
    uint256 constant INCOME = 4567800;
    uint256 constant REPAYMENT = 456780;
    uint256 constant PAYOUT = 250000;

    bytes32 constant SIGNAL_HASH = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 constant CONDITION_HASH = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 constant EVIDENCE_HASH = 0x3333333333333333333333333333333333333333333333333333333333333333;

    // ─── produced by apps/pot/scripts/check-digests.mjs ───
    bytes32 constant TS_JOIN_ACTION = 0xde5e91721cf0d97010e32fd441ae7710f1fc9189ed429daae35d39a7cac8e0f0;
    bytes32 constant TS_JOIN = 0xc8839f47feacfc6f6db63c58030f4fe9ed7d84a23cac0cdd7a0e7360699056f1;
    bytes32 constant TS_BEHAVIOUR = 0xe312d236ab7f71572417559b508846b5da218c12f0cd39685dad6dea64236fd0;
    bytes32 constant TS_CONDITION = 0xe3b06ba9a8b613ee6a3491444c64e7aa53930674b02fb6fd54cac0c708a4743a;
    bytes32 constant TS_SETTLEMENT = 0x390054eef4ab8623f78a6da016b9d482c42ed5e9ce2516361967d83be3b9fd69;
    bytes32 constant TS_REPAYMENT = 0x46a426dcb5368c0d441fd33d709c99b2758a6108071182a60358a7aab563059e;
    bytes32 constant TS_POOL_ACTION = 0xadc68841ac77fec449e95afffd24a62a65ebf71eed213bbb3b4aabb014a3cc5e;
    bytes32 constant TS_POOL_ATTEST = 0x256232c342d44fb2d889c46e6fadd45ea453330ad77064c858e73ce932755011;

    /// The action tag itself, so a change to the string is caught on its own
    /// rather than only as part of the join digest.
    function test_JoinActionTagMatchesTypeScript() public pure {
        assertEq(keccak256("PotManager.join.v1"), TS_JOIN_ACTION);
    }

    function test_JoinDigestMatchesTypeScript() public pure {
        bytes32 inner =
            keccak256(abi.encode(keccak256("PotManager.join.v1"), POT_MANAGER, CHAIN_ID, POT_ID, JOINER, EXPIRY));
        assertEq(inner, TS_JOIN, "PotManager.join digest drifted from the server");
    }

    function test_BehaviourDigestMatchesTypeScript() public pure {
        bytes32 inner = keccak256(abi.encode(SAVINGS, CHAIN_ID, GOAL_ID, SIGNAL_HASH));
        assertEq(inner, TS_BEHAVIOUR, "BehaviourSavings digest drifted from the server");
    }

    function test_ConditionDigestMatchesTypeScript() public pure {
        bytes32 inner = keccak256(abi.encode(GIFT, CHAIN_ID, GIFT_ID, CONDITION_HASH));
        assertEq(inner, TS_CONDITION, "Gift digest drifted from the server");
    }

    function test_SettlementDigestMatchesTypeScript() public pure {
        bytes32 inner = keccak256(abi.encode(MICRO_COVER, CHAIN_ID, POLICY_ID, EVIDENCE_HASH, PAYOUT));
        assertEq(inner, TS_SETTLEMENT, "MicroCover digest drifted from the server");
    }

    function test_RepaymentDigestMatchesTypeScript() public pure {
        bytes32 inner = keccak256(abi.encode(INCOME_SHARE, CHAIN_ID, AGREEMENT_ID, INDEX, INCOME, REPAYMENT));
        assertEq(inner, TS_REPAYMENT, "IncomeShare digest drifted from the server");
    }

    function test_PoolActionTagMatchesTypeScript() public pure {
        assertEq(keccak256("AccountabilityPool.attest.v1"), TS_POOL_ACTION);
    }

    function test_PoolAttestationDigestMatchesTypeScript() public pure {
        bytes32 inner = keccak256(
            abi.encode(keccak256("AccountabilityPool.attest.v1"), POOL, CHAIN_ID, POOL_ID, JOINER, DAY)
        );
        assertEq(inner, TS_POOL_ATTEST, "AccountabilityPool digest drifted from the server");
    }

    /// The EIP-191 wrapper is applied identically on both sides: viem's
    /// `signMessage({ message: { raw } })` and
    /// `MessageHashUtils.toEthSignedMessageHash` have to produce the same
    /// preimage, or recovery fails even when the inner digest is right.
    function test_Eip191WrapperIsTheStandardPrefix() public pure {
        bytes32 inner = TS_JOIN;
        assertEq(
            MessageHashUtils.toEthSignedMessageHash(inner),
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner))
        );
    }
}
