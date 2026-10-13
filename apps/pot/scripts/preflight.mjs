/**
 * Is this deployment wired up correctly? Run it before anyone tests.
 *
 * Reads the chain and your environment. Sends nothing. Never prints a secret —
 * secrets are reported only as "set" or "missing", and the only values shown
 * are public contract addresses.
 *
 *   node --env-file=.env.local --no-warnings scripts/preflight.mjs
 *
 * The one failure it exists to catch: the key the SERVER signs with is not the
 * address the CONTRACT trusts. Everything looks fine, and then every single
 * "join" is rejected. That is a five-minute fix if you see it and an hour of
 * confusion if you don't.
 *
 * Exit code 0 = no failures (warnings are allowed). 1 = at least one failure.
 */

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
} from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  accountabilityPoolAbi,
  behaviourSavingsAbi,
  giftAbi,
  incomeShareAbi,
  microCoverAbi,
  potManagerAbi,
  salaryStreamAbi,
  socialPayAbi,
  testRupeeAbi,
} from "../lib/abis.ts";

/** The public addresses of the roles treated as compromised. */
const COMPROMISED = new Map([
  ["0xbe4ad8cc900e5824440526e7669a82881c661d94", "the compromised trust signer"],
  ["0xd6a07f0ae71ce9a8f36f0d50cd907ac652c0eda7", "the compromised deployer"],
]);

const env = process.env;
let failures = 0;
let warnings = 0;

/**
 * Normally the server's key MUST be in this shell so its match with the
 * contract can be proved. `--no-signer-check` downgrades that to a warning —
 * and the verdict then says the match was NOT verified, never plain READY.
 */
const SKIP_SIGNER_CHECK = process.argv.includes("--no-signer-check");
let signerVerified = false;

const line = (tag, text) => console.log(`  ${tag.padEnd(5)} ${text}`);
const pass = (t) => line("PASS", t);
const warn = (t) => (warnings++, line("WARN", t));
const fail = (t) => (failures++, line("FAIL", t));
const section = (t) => console.log(`\n${t}`);

/** pass(okText) when `ok`, otherwise badLevel(badText). */
function check(ok, okText, badText, badLevel = fail) {
  if (ok) pass(okText);
  else badLevel(badText);
}

const NAMES = {
  token: ["NEXT_PUBLIC_TEST_RUPEE_ADDRESS", "TestRupee", testRupeeAbi],
  pot: ["NEXT_PUBLIC_POT_MANAGER_ADDRESS", "PotManager", potManagerAbi],
  pay: ["NEXT_PUBLIC_SOCIAL_PAY_ADDRESS", "SocialPay", socialPayAbi],
  gift: ["NEXT_PUBLIC_GIFT_ADDRESS", "Gift", giftAbi],
  savings: ["NEXT_PUBLIC_BEHAVIOUR_SAVINGS_ADDRESS", "BehaviourSavings", behaviourSavingsAbi],
  stream: ["NEXT_PUBLIC_SALARY_STREAM_ADDRESS", "SalaryStream", salaryStreamAbi],
  agreement: ["NEXT_PUBLIC_INCOME_SHARE_ADDRESS", "IncomeShare", incomeShareAbi],
  cover: ["NEXT_PUBLIC_MICRO_COVER_ADDRESS", "MicroCover", microCoverAbi],
  pool: ["NEXT_PUBLIC_ACCOUNTABILITY_POOL_ADDRESS", "AccountabilityPool", accountabilityPoolAbi],
};

const rpc = env.NEXT_PUBLIC_RPC_URL || undefined;
const pc = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

async function tryRead(address, abi, functionName) {
  try {
    return await pc.readContract({ address, abi, functionName });
  } catch {
    return undefined;
  }
}

// ───────────── network ─────────────
section("Network");
try {
  const id = await pc.getChainId();
  check(id === 10143, "RPC is Monad Testnet (10143)", `RPC reports chain ${id}, not 10143`);
  const block = await pc.getBlockNumber();
  const rawBlock = env.NEXT_PUBLIC_DEPLOY_BLOCK || "0";
  const deployBlock = Number(rawBlock);
  if (!Number.isInteger(deployBlock) || deployBlock < 0) {
    fail("NEXT_PUBLIC_DEPLOY_BLOCK is not a whole number");
  } else if (!deployBlock) warn("NEXT_PUBLIC_DEPLOY_BLOCK is unset or 0");
  else if (BigInt(deployBlock) > block) fail("NEXT_PUBLIC_DEPLOY_BLOCK is in the future");
  else pass(`deploy block ${deployBlock} (chain is at ${block})`);
} catch (e) {
  fail(`could not reach the RPC: ${(e.shortMessage || e.message).split("\n")[0]}`);
}

// ───────────── contracts ─────────────
section("Contracts");
const addr = {};
for (const [key, [envName, label]] of Object.entries(NAMES)) {
  const value = env[envName];
  if (!value) {
    fail(`${envName} is missing`);
    continue;
  }
  if (!isAddress(value)) {
    fail(`${envName} is not an address`);
    continue;
  }
  const code = await pc.getCode({ address: value });
  if (!code || code === "0x") {
    fail(`${label}: no contract at ${getAddress(value)}`);
    continue;
  }
  addr[key] = getAddress(value);
  pass(`${label.padEnd(18)} ${addr[key]}`);
}

// Every contract that holds test money must be using THE token the app uses.
section("Wiring");
if (addr.token) {
  for (const key of ["pot", "pay", "gift", "savings", "stream", "cover", "pool"]) {
    if (!addr[key]) continue;
    const [, label, abi] = NAMES[key];
    const t = await tryRead(addr[key], abi, "token");
    // Unreadable is a FAILURE, not a warning: a wrong address, a wrong ABI or a
    // dead RPC must never turn into a green result.
    if (t === undefined) fail(`${label}: could not read token() — wrong address or RPC trouble`);
    else if (getAddress(t) === addr.token) pass(`${label} uses this TestRupee`);
    else fail(`${label} uses a DIFFERENT token (${getAddress(t)}) — money would not line up`);
  }
}

// ───────────── roles ─────────────
section("Roles (set when each contract was deployed; they cannot be changed)");
const roleReads = [
  ["pot", "trustSigner", "PotManager.trustSigner"],
  ["pool", "attester", "AccountabilityPool.attester"],
  ["agreement", "recorder", "IncomeShare.recorder"],
  ["cover", "insurerSigner", "MicroCover.insurerSigner"],
  ["cover", "insurer", "MicroCover.insurer"],
  ["pay", "arbitrator", "SocialPay.arbitrator"],
  ["savings", "admin", "BehaviourSavings.admin"],
];
const roleValue = {};
for (const [key, fn, label] of roleReads) {
  if (!addr[key]) continue;
  const v = await tryRead(addr[key], NAMES[key][2], fn);
  if (v === undefined) {
    fail(`${label}: could not read — wrong address or RPC trouble`);
    continue;
  }
  roleValue[label] = getAddress(v);
  const bad = COMPROMISED.get(v.toLowerCase());
  check(
    !bad,
    `${label} = ${getAddress(v)}`,
    `${label} = ${getAddress(v)} — ${bad}. This deployment still depends on a compromised key.`
  );
}

// ───────────── the server's signer ─────────────
section("The server's signer (this is the check that matters most)");
const onChainSigner = roleValue["PotManager.trustSigner"];
const enabled = env.TRUST_SIGNER_ENABLED === "true";
const keyVar = env.TRUST_SIGNER_KEY;

if (!keyVar) {
  // This is the check the whole script exists for, so its absence is a failure
  // by default, not a quiet warning. `--no-signer-check` is the explicit way out.
  if (SKIP_SIGNER_CHECK) {
    warn("TRUST_SIGNER_KEY is not in this shell; signer match NOT verified (--no-signer-check)");
  } else {
    fail(
      "TRUST_SIGNER_KEY is not in this shell, so the signer match can't be proved. " +
        "Load it (node --env-file=.env.local …) or pass --no-signer-check to skip knowingly."
    );
  }
} else if (!/^0x[0-9a-fA-F]{64}$/.test(keyVar)) {
  fail("TRUST_SIGNER_KEY is set but is not a 32-byte hex key (value not shown)");
} else {
  let derived = null;
  try {
    derived = privateKeyToAccount(keyVar).address;
  } catch {
    // Well-formed hex that is not a valid key (e.g. all zeros). Say so without
    // echoing anything the library might have put in its message.
    fail("TRUST_SIGNER_KEY is not a valid signing key (value not shown)");
  }
  if (derived) {
    if (COMPROMISED.has(derived.toLowerCase())) {
      fail(`TRUST_SIGNER_KEY is ${COMPROMISED.get(derived.toLowerCase())}. Use a fresh key.`);
    } else if (!onChainSigner) {
      fail(`server signer is ${derived}, but the contract's trustSigner couldn't be read`);
    } else if (derived === onChainSigner) {
      signerVerified = true;
      pass(`server signer ${derived} MATCHES the contract's trustSigner — joins will be accepted`);
    } else {
      fail(
        `server signer ${derived} is NOT the contract's trustSigner ${onChainSigner} — every join will be rejected`
      );
    }
  }
}
if (!enabled) {
  warn("TRUST_SIGNER_ENABLED is not 'true' — joins will answer 'temporarily unavailable'");
} else {
  check(Boolean(keyVar), "TRUST_SIGNER_ENABLED=true", "TRUST_SIGNER_ENABLED=true but there is no key");
}

// ───────────── the rest of the environment (set / missing only) ─────────────
section("Environment (names only — values are never shown)");
for (const name of [
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "PRIVY_APP_SECRET",
  "PRIVY_VERIFICATION_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_ARBITRATOR_ADDRESS",
]) {
  check(Boolean(env[name]), `${name} is set`, `${name} is missing`);
}
// The app only logs a warning without this, so it is not a failure — but blocked
// requests can't be debugged during a test without it.
check(
  Boolean(env.IP_HASH_SALT),
  "IP_HASH_SALT is set",
  "IP_HASH_SALT is missing (the app still runs; blocked requests just can't be traced)",
  warn
);

// The server resolves disputes against this address; it must be the one SocialPay trusts.
if (env.NEXT_PUBLIC_ARBITRATOR_ADDRESS && roleValue["SocialPay.arbitrator"]) {
  check(
    isAddress(env.NEXT_PUBLIC_ARBITRATOR_ADDRESS) &&
      getAddress(env.NEXT_PUBLIC_ARBITRATOR_ADDRESS) === roleValue["SocialPay.arbitrator"],
    "NEXT_PUBLIC_ARBITRATOR_ADDRESS matches SocialPay.arbitrator",
    "NEXT_PUBLIC_ARBITRATOR_ADDRESS does not match SocialPay.arbitrator — disputes would be rejected"
  );
}
const appUrl = env.NEXT_PUBLIC_APP_URL;
if (!appUrl) {
  warn("NEXT_PUBLIC_APP_URL is empty (fine locally; set it for a live site)");
} else {
  check(
    !/localhost|127\.0\.0\.1/.test(appUrl),
    `NEXT_PUBLIC_APP_URL = ${appUrl}`,
    `NEXT_PUBLIC_APP_URL is local (${appUrl}) — set the real origin for a live site`,
    warn
  );
}

// Never a plain READY unless the one check that matters was actually proved.
const verdict =
  failures > 0
    ? "NOT READY"
    : signerVerified
      ? "READY"
      : "READY, BUT THE SIGNER MATCH WAS NOT VERIFIED";
console.log(`\n${verdict}  ${failures} failure(s), ${warnings} warning(s)\n`);
process.exit(failures === 0 ? 0 : 1);
