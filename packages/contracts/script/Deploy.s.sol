// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TestRupee} from "../src/TestRupee.sol";
import {PotManager} from "../src/PotManager.sol";
import {SocialPay} from "../src/SocialPay.sol";
import {Gift} from "../src/Gift.sol";
import {BehaviourSavings} from "../src/BehaviourSavings.sol";
import {SalaryStream} from "../src/SalaryStream.sol";
import {IncomeShare} from "../src/IncomeShare.sol";
import {MicroCover} from "../src/MicroCover.sol";
import {AccountabilityPool} from "../src/AccountabilityPool.sol";

/// @title Deploy — every active contract, with the roles named explicitly.
///
/// Four of these contracts hand a power to an address that is chosen at deploy
/// time and then immutable: who may admit a joiner, who may arbitrate a
/// dispute, who may attest a behaviour, who may record an income, and who may
/// authorise an insurance payout. Getting one of those wrong is not a bug you
/// can patch — it is a redeployment, and on a real network it can be an
/// unlicensed financial activity carried out by whoever happened to run this
/// script.
///
/// So this script refuses to guess. Two rules:
///
///  1. **It only runs on Monad Testnet (chain id 10143)** unless you set
///     `ALLOW_OTHER_CHAIN=true`, which you have to type on purpose.
///
///  2. **On Monad Testnet**, a role you do not set falls back to the deployer
///     and prints a loud warning naming it as a placeholder. That is honest for
///     a demo where no licensed counterparty exists. **On any other chain**,
///     every role must be set explicitly and none of them may be the deployer.
///     A deploy that would make the person running this script the insurer is
///     refused, not warned about.
///
/// Usage on Monad Testnet (placeholders, demo only):
///
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
///
/// Usage anywhere else (every role named, none of them you):
///
///   ALLOW_OTHER_CHAIN=true \
///   TRUST_SIGNER=0x... ARBITRATOR=0x... SAVINGS_ADMIN=0x... \
///   POOL_ATTESTER=0x... \
///   RECORDER=0x... INSURER=0x... INSURER_SIGNER=0x... \
///   forge script script/Deploy.s.sol --rpc-url ... --broadcast
///
/// What each role is, and what it would take for it to be real, is in
/// README.md under "Running this anywhere but Monad Testnet".
contract Deploy is Script {
    uint256 internal constant MONAD_TESTNET = 10143;

    /// @dev Thrown when run off Monad Testnet without `ALLOW_OTHER_CHAIN=true`.
    error WrongNetwork(uint256 chainId);
    /// @dev Thrown off Monad Testnet when a role was not set.
    error RoleNotSet(string role);
    /// @dev Thrown off Monad Testnet when a role was set to the deployer.
    error RoleIsDeployer(string role);

    /// @dev Grouped into a struct because eight addresses plus eight
    ///      contracts in one frame is more locals than the EVM stack allows.
    struct Roles {
        address trustSigner;
        address arbitrator;
        address savingsAdmin;
        address poolAttester;
        address recorder;
        address insurer;
        address insurerSigner;
    }

    function run() external {
        bool testnet = block.chainid == MONAD_TESTNET;
        if (!testnet && !vm.envOr("ALLOW_OTHER_CHAIN", false)) {
            revert WrongNetwork(block.chainid);
        }

        Roles memory r = _roles(testnet);

        if (testnet) {
            console.log("");
            console.log("Monad Testnet. Every role warned about above is a PLACEHOLDER held by");
            console.log("the deployer. None of them stands for a licensed counterparty. Test");
            console.log("money only. See docs/limitations.md.");
            console.log("");
        }

        vm.startBroadcast();
        TestRupee token = new TestRupee();
        _logOne("TestRupee:", address(token));
        _logOne("PotManager:", address(new PotManager(token, r.trustSigner)));
        _logOne("SocialPay:", address(new SocialPay(token, r.arbitrator)));
        _logOne("Gift:", address(new Gift(token)));
        _logOne("BehaviourSavings:", address(new BehaviourSavings(token, r.savingsAdmin)));
        _logOne("AccountabilityPool:", address(new AccountabilityPool(token, r.poolAttester)));
        _logOne("SalaryStream:", address(new SalaryStream(token)));
        _logOne("IncomeShare:", address(new IncomeShare(r.recorder)));
        _logOne("MicroCover:", address(new MicroCover(token, r.insurer, r.insurerSigner)));
        vm.stopBroadcast();

        _logRoles(r);
    }

    /// @dev Resolved before broadcasting, so a missing role fails before any
    ///      transaction is sent rather than halfway through a deploy.
    function _roles(bool testnet) internal view returns (Roles memory r) {
        r.trustSigner = _role("TRUST_SIGNER", testnet);
        r.arbitrator = _role("ARBITRATOR", testnet);
        r.savingsAdmin = _role("SAVINGS_ADMIN", testnet);
        r.poolAttester = _role("POOL_ATTESTER", testnet);
        r.recorder = _role("RECORDER", testnet);
        r.insurer = _role("INSURER", testnet);

        // The claims-signing key is deliberately separate from the treasury:
        // see MicroCover. It falls back to the treasury only as a placeholder.
        r.insurerSigner = vm.envOr("INSURER_SIGNER", address(0));
        if (r.insurerSigner == address(0)) {
            if (!testnet) revert RoleNotSet("INSURER_SIGNER");
            r.insurerSigner = r.insurer;
            console.log("WARNING: INSURER_SIGNER unset, reusing INSURER. Placeholder.");
        }
        if (!testnet && r.insurerSigner == msg.sender) revert RoleIsDeployer("INSURER_SIGNER");
    }

    function _logOne(string memory label, address at) internal pure {
        console.log(label, at);
    }

    function _logRoles(Roles memory r) internal view {
        console.log("chainId:", block.chainid);
        console.log("--- roles ---");
        console.log("trust signer:    ", r.trustSigner);
        console.log("arbitrator:      ", r.arbitrator);
        console.log("savings admin:   ", r.savingsAdmin);
        console.log("pool attester:   ", r.poolAttester);
        console.log("ISA recorder:    ", r.recorder);
        console.log("insurer treasury:", r.insurer);
        console.log("insurer signer:  ", r.insurerSigner);
        console.log("");
        console.log("BehaviourSavings has no approved verifier yet, so ExternalSignal");
        console.log("goals cannot be created. The savings admin must call");
        console.log("registerVerifier then setBehaviourVerifier. SaveConsistently");
        console.log("goals need no verifier and work immediately.");
    }

    /// @dev Reads a role from the environment. On Monad Testnet a missing role
    ///      becomes the deployer, loudly. Anywhere else, a missing role or one
    ///      pointing at the deployer stops the deploy.
    function _role(string memory name, bool mayDefault) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) {
            if (!mayDefault) revert RoleNotSet(name);
            console.log("WARNING: placeholder role held by the deployer:", name);
            return msg.sender;
        }
        if (!mayDefault && a == msg.sender) revert RoleIsDeployer(name);
    }
}
