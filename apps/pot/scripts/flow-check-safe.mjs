/**
 * Does the pot lifecycle actually work on the deployed contracts?
 *
 * ──────────────── what this is, and what it is not ────────────────
 *
 * It walks both endings of a pot against the REAL contracts on Monad Testnet,
 * signing with an ordinary throwaway account:
 *
 *   A. a pot that fills up   : create → add money → close (money comes back)
 *   B. a pot that does not   : create → add some → deadline passes →
 *                              open refunds → claim (money comes back)
 *
 * It does NOT test Google sign-in, the embedded wallet, fee sponsorship or any
 * screen. Those need a browser. It tests the contracts, reached the way any
 * account reaches them.
 *
 * ──────────────── why this replaced flow-check.mjs ────────────────
 *
 * The old script signed with DEPLOYER_KEY read from a file, and that key is
 * treated as compromised. This one:
 *
 *  - reads NO files. The key comes only from your shell environment.
 *  - never prints the key. It prints the address.
 *  - takes its target contracts explicitly, never from an env file.
 *  - refuses any chain but Monad Testnet (10143).
 *  - refuses the two known-compromised role addresses.
 *  - DEFAULTS TO A DRY RUN. Sending needs both --send and --yes.
 *
 * ──────────────── usage ────────────────
 *
 *   Review the plan (reads the chain, sends nothing):
 *     FLOW_CHECK_ADDRESS=0x<your throwaway address>        \
 *     FLOW_CHECK_POT_MANAGER=0x<PotManager>                \
 *     FLOW_CHECK_TEST_RUPEE=0x<TestRupee>                  \
 *     node scripts/flow-check-safe.mjs
 *
 *   Send it for real (only after the plan has been reviewed):
 *     FLOW_CHECK_KEY=0x<throwaway key> ... node scripts/flow-check-safe.mjs --send --yes
 *
 * See docs/flow-check.md for how to make and fund the throwaway key.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  toHex,
} from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { potManagerAbi, testRupeeAbi } from "../lib/abis.ts";

// ───────────── the rules, written down ─────────────

const REQUIRED_CHAIN_ID = 10143;

/** Public addresses of the roles treated as compromised. Never to be used. */
const REFUSED = new Map([
  ["0xbe4ad8cc900e5824440526e7669a82881c661d94", "the compromised trust signer"],
  ["0xd6a07f0ae71ce9a8f36f0d50cd907ac652c0eda7", "the compromised deployer"],
]);

/**
 * Enough MON to cover every transaction below with room to spare. Deliberately
 * above the worst-case fee the plan prints (about 0.32 MON), so a balance just
 * over the minimum can't run dry halfway through a pot.
 */
const MIN_MON = 0.35;

/** How long the failing pot's collection window lasts, in seconds. */
const FAIL_WINDOW = 180n;

/** Amounts, in paise (2 decimals): ₹1 = 100. */
const TARGET = 5_000n; // ₹50 — what each pot is trying to collect
const APPROVAL_LIMIT = 2_000n; // ₹20
const REFUND_PATH_DEPOSIT = 2_000n; // ₹20 into the pot that will miss its target
const NEEDED_TOKENS = TARGET + REFUND_PATH_DEPOSIT; // ₹70, all of it returned

// ───────────── arguments and environment ─────────────

const args = new Set(process.argv.slice(2));
const SEND = args.has("--send");
const YES = args.has("--yes");

function fail(message) {
  console.error(`\nSTOPPED  ${message}\n`);
  process.exit(1);
}

const env = process.env;
const POT = env.FLOW_CHECK_POT_MANAGER;
const TOKEN = env.FLOW_CHECK_TEST_RUPEE;
if (!POT || !isAddress(POT)) fail("Set FLOW_CHECK_POT_MANAGER to the PotManager address.");
if (!TOKEN || !isAddress(TOKEN)) fail("Set FLOW_CHECK_TEST_RUPEE to the TestRupee address.");

let account = null;
let address;
if (env.FLOW_CHECK_KEY) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.FLOW_CHECK_KEY)) {
    fail("FLOW_CHECK_KEY is not a 32-byte hex key. (Not printed, on purpose.)");
  }
  account = privateKeyToAccount(env.FLOW_CHECK_KEY);
  address = account.address;
  if (env.FLOW_CHECK_ADDRESS && getAddress(env.FLOW_CHECK_ADDRESS) !== address) {
    fail("FLOW_CHECK_ADDRESS does not belong to FLOW_CHECK_KEY.");
  }
} else if (env.FLOW_CHECK_ADDRESS && isAddress(env.FLOW_CHECK_ADDRESS)) {
  address = getAddress(env.FLOW_CHECK_ADDRESS);
} else {
  fail("Set FLOW_CHECK_ADDRESS (public, for a dry run) or FLOW_CHECK_KEY (to send).");
}

if (SEND && !account) fail("--send needs FLOW_CHECK_KEY.");
if (SEND && !YES) {
  fail("--send also needs --yes, so a stray command can't spend anything.");
}
if (REFUSED.has(address.toLowerCase())) {
  fail(`That account is ${REFUSED.get(address.toLowerCase())}. Use a fresh throwaway account.`);
}

const rpc = env.FLOW_CHECK_RPC || undefined;
const pc = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
const wc = account
  ? createWalletClient({ account, chain: monadTestnet, transport: http(rpc) })
  : null;

// ───────────── helpers ─────────────

const rs = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN")}`;
const STATE = ["Collecting", "Funded", "Refunding", "Closed"];
const read = (to, abi, functionName, a = []) =>
  pc.readContract({ address: to, abi, functionName, args: a });

/** The ids of the pots this run created, so a failure can say what to recover. */
let potA;
let potB;

function recoveryHint() {
  const lines = [];
  if (potA !== undefined) {
    lines.push(
      `  pot #${potA}: if it is Funded, its creator (your throwaway account) can call closePot(${potA}) to get the money back.`
    );
  }
  if (potB !== undefined) {
    lines.push(
      `  pot #${potB}: once its deadline has passed, anyone can call finalizeFailed(${potB}), then the contributor claimRefund(${potB}).`
    );
  }
  if (lines.length) {
    console.log("\nStopped part-way. Nothing is lost; to recover:");
    lines.forEach((l) => console.log(l));
    console.log("  Any unused approval is capped at ₹70 and harmless.\n");
  }
}

/** The chain's own clock — deadlines are judged against this, not your laptop's. */
async function chainNowSeconds() {
  return BigInt((await pc.getBlock()).timestamp);
}

const results = [];
async function step(label, fn) {
  process.stdout.write(label.padEnd(44));
  try {
    const note = await fn();
    console.log(`OK    ${note ?? ""}`);
    results.push({ label, ok: true });
    return note;
  } catch (e) {
    const msg = (e.shortMessage || e.message || String(e)).split("\n")[0];
    console.log(`FAIL  ${msg}`);
    results.push({ label, ok: false, msg });
    recoveryHint();
    throw e;
  }
}

async function send(to, abi, functionName, a) {
  const hash = await wc.sendTransaction({
    to,
    data: encodeFunctionData({ abi, functionName, args: a }),
  });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`reverted (${hash})`);
  return r;
}

function expect(cond, message) {
  if (!cond) throw new Error(`expected: ${message}`);
}

/** The id of the pot a createPot receipt made, read from its own event. */
function createdPotId(receipt) {
  const [created] = parseEventLogs({
    abi: potManagerAbi,
    eventName: "PotCreated",
    logs: receipt.logs,
  });
  if (!created) throw new Error("no PotCreated event in the receipt");
  return created.args.potId;
}

// ───────────── read-only checks (always run) ─────────────

console.log(`\nMode      ${SEND ? "SEND (will submit transactions)" : "DRY RUN (sends nothing)"}`);
console.log(`Account   ${address}`);
console.log(`PotMgr    ${getAddress(POT)}`);
console.log(`TestRupee ${getAddress(TOKEN)}\n`);

const chainId = await pc.getChainId();
if (chainId !== REQUIRED_CHAIN_ID) {
  fail(`RPC reports chain ${chainId}; this only runs on Monad Testnet (${REQUIRED_CHAIN_ID}).`);
}
for (const [name, a] of [["PotManager", POT], ["TestRupee", TOKEN]]) {
  const code = await pc.getCode({ address: a });
  if (!code || code === "0x") fail(`No contract at ${name} address ${a}.`);
}
const wired = await read(POT, potManagerAbi, "token");
if (getAddress(wired) !== getAddress(TOKEN)) {
  fail("PotManager.token() is not the TestRupee you gave — these two do not belong together.");
}

const mon = Number(formatEther(await pc.getBalance({ address })));
const held = await read(TOKEN, testRupeeAbi, "balanceOf", [address]);
const lastClaim = await read(TOKEN, testRupeeAbi, "lastClaim", [address]);
const cooldown = await read(TOKEN, testRupeeAbi, "COOLDOWN");
const faucetAmount = await read(TOKEN, testRupeeAbi, "FAUCET_AMOUNT");
const chainNow = BigInt((await pc.getBlock()).timestamp);
const canClaim = lastClaim === 0n || chainNow >= lastClaim + cooldown;
const potCountBefore = await read(POT, potManagerAbi, "potCount");
const gasPrice = await pc.getGasPrice();

const needFaucet = held < NEEDED_TOKENS;
console.log("Checks");
console.log(`  chain id ${chainId}                             ok`);
console.log(`  both contracts have code, and belong together   ok`);
console.log(`  MON for fees        ${mon.toFixed(4)} ${mon >= MIN_MON ? "ok" : `LOW (want ≥ ${MIN_MON})`}`);
console.log(`  test money held     ${rs(held)} ${needFaucet ? `(needs ${rs(NEEDED_TOKENS)})` : "ok"}`);
console.log(`  faucet available    ${needFaucet ? (canClaim ? `yes (+${rs(faucetAmount)})` : "NO — claimed within the last day") : "not needed"}`);
console.log(`  pots that exist     ${potCountBefore}`);
console.log(`  gas price           ${Number(gasPrice) / 1e9} gwei\n`);

// ───────────── the plan ─────────────

const plan = [
  needFaucet && ["TestRupee", "faucet()", `mints ${rs(faucetAmount)} of test money to you`],
  ["TestRupee", `approve(PotManager, ${rs(NEEDED_TOKENS)})`, "lets the pot take exactly what this test uses"],
  ["PotManager", `createPot(target ${rs(TARGET)}, deadline +1 day)`, `creates pot #${Number(potCountBefore) + 1}`],
  ["PotManager", `deposit(#${Number(potCountBefore) + 1}, ${rs(TARGET)})`, "reaches the target → Funded"],
  ["PotManager", `requestSpend(#${Number(potCountBefore) + 1}, you, ₹10)`, "SIMULATED ONLY, not sent"],
  ["PotManager", `closePot(#${Number(potCountBefore) + 1})`, `returns ${rs(TARGET)} to you → Closed`],
  ["PotManager", `createPot(target ${rs(TARGET)}, deadline +3 min)`, `creates pot #${Number(potCountBefore) + 2}`],
  ["PotManager", `deposit(#${Number(potCountBefore) + 2}, ${rs(REFUND_PATH_DEPOSIT)})`, "below target → stays Collecting"],
  ["(wait)", "until the chain clock passes the deadline", "about 3 minutes, no transaction"],
  ["PotManager", `finalizeFailed(#${Number(potCountBefore) + 2})`, "→ Refunding"],
  ["PotManager", `claimRefund(#${Number(potCountBefore) + 2})`, `returns ${rs(REFUND_PATH_DEPOSIT)} to you → Closed`],
].filter(Boolean);

console.log("Plan");
plan.forEach(([to, call, note], i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${to.padEnd(10)} ${call.padEnd(52)} ${note}`)
);
const sent = plan.filter(([to, call]) => to !== "(wait)" && !call.startsWith("requestSpend")).length;
console.log(`\n  ${sent} transactions will be sent. Upper-bound fee ≈ ${((sent * 350_000 * Number(gasPrice)) / 1e18).toFixed(3)} MON.`);
console.log(`  Left behind: pots #${Number(potCountBefore) + 1} and #${Number(potCountBefore) + 2}, both Closed. Your test money ends where it started`);
console.log(`  (plus ${rs(faucetAmount)} newly minted by the faucet if it was needed).\n`);

if (!SEND) {
  console.log("DRY RUN — nothing was sent. Re-run with --send --yes to execute the plan above.\n");
  process.exit(0);
}

if (mon < MIN_MON) fail(`Only ${mon.toFixed(4)} MON; need at least ${MIN_MON} so no step runs dry.`);
if (needFaucet && !canClaim) fail("Needs test money but the faucet was claimed in the last day.");

// ───────────── A. a pot that fills up ─────────────

console.log("A. A pot that fills up");
if (needFaucet) {
  await step("faucet()", async () => {
    await send(TOKEN, testRupeeAbi, "faucet", []);
    return rs(await read(TOKEN, testRupeeAbi, "balanceOf", [address]));
  });
}
await step("approve(PotManager)", async () => {
  await send(TOKEN, testRupeeAbi, "approve", [POT, NEEDED_TOKENS]);
  const a = await read(TOKEN, testRupeeAbi, "allowance", [address, POT]);
  expect(a >= NEEDED_TOKENS, "allowance covers the test");
  return `allowance ${rs(a)}`;
});

const startBalance = await read(TOKEN, testRupeeAbi, "balanceOf", [address]);

const inviteA = keccak256(toHex(`flow-check-A-${Date.now()}`));
await step("createPot()", async () => {
  const r = await send(POT, potManagerAbi, "createPot", [
    keccak256(inviteA),
    APPROVAL_LIMIT,
    2,
    TARGET,
    (await chainNowSeconds()) + 86_400n,
  ]);
  // The id comes from this transaction's own event, not from potCount: on a
  // shared testnet somebody else's pot could land in between.
  potA = createdPotId(r);
  const p = await read(POT, potManagerAbi, "getPot", [potA]);
  expect(STATE[p.state] === "Collecting", "new pot is Collecting");
  expect(p.targetAmount === TARGET, "target recorded");
  return `pot #${potA}`;
});

await step("deposit() up to target", async () => {
  await send(POT, potManagerAbi, "deposit", [potA, TARGET]);
  const p = await read(POT, potManagerAbi, "getPot", [potA]);
  expect(STATE[p.state] === "Funded", "pot became Funded at the target");
  expect(p.balance === TARGET, "pot holds the target");
  return `${STATE[p.state]}, holds ${rs(p.balance)}`;
});

await step("requestSpend() accepted (simulated)", async () => {
  await pc.simulateContract({
    address: POT,
    abi: potManagerAbi,
    functionName: "requestSpend",
    args: [potA, address, 1_000n, keccak256(toHex("cab to the station"))],
    account: address,
  });
  return "accepted, not sent";
});

await step("closePot() returns the money", async () => {
  await send(POT, potManagerAbi, "closePot", [potA]);
  const p = await read(POT, potManagerAbi, "getPot", [potA]);
  const back = await read(TOKEN, testRupeeAbi, "balanceOf", [address]);
  expect(STATE[p.state] === "Closed", "pot is Closed");
  expect(p.balance === 0n, "pot is empty");
  expect(back === startBalance, "every paisa came back");
  return `${STATE[p.state]}, balance back to ${rs(back)}`;
});

// ───────────── B. a pot that does not fill up ─────────────

console.log("\nB. A pot that misses its target");
const deadlineB = (await chainNowSeconds()) + FAIL_WINDOW;
const inviteB = keccak256(toHex(`flow-check-B-${Date.now()}`));

await step("createPot() with a 3-minute deadline", async () => {
  const r = await send(POT, potManagerAbi, "createPot", [
    keccak256(inviteB),
    APPROVAL_LIMIT,
    2,
    TARGET,
    deadlineB,
  ]);
  potB = createdPotId(r);
  return `pot #${potB}`;
});

await step("deposit() below target", async () => {
  await send(POT, potManagerAbi, "deposit", [potB, REFUND_PATH_DEPOSIT]);
  const p = await read(POT, potManagerAbi, "getPot", [potB]);
  expect(STATE[p.state] === "Collecting", "still Collecting");
  return `${STATE[p.state]}, ${rs(p.totalContributed)} of ${rs(p.targetAmount)}`;
});

await step("waiting for the deadline", async () => {
  const started = Date.now();
  for (;;) {
    const now = BigInt((await pc.getBlock()).timestamp);
    if (now >= deadlineB) return `${Math.round((Date.now() - started) / 1000)}s`;
    if (Date.now() - started > 600_000) throw new Error("deadline never passed within 10 minutes");
    await new Promise((r) => setTimeout(r, 5_000));
  }
});

await step("finalizeFailed() opens refunds", async () => {
  await send(POT, potManagerAbi, "finalizeFailed", [potB]);
  const p = await read(POT, potManagerAbi, "getPot", [potB]);
  expect(STATE[p.state] === "Refunding", "pot is Refunding");
  const owed = await read(POT, potManagerAbi, "refundableOf", [potB, address]);
  expect(owed === REFUND_PATH_DEPOSIT, "refundable equals what was put in");
  return `${STATE[p.state]}, you can claim ${rs(owed)}`;
});

await step("claimRefund() returns the money", async () => {
  await send(POT, potManagerAbi, "claimRefund", [potB]);
  const p = await read(POT, potManagerAbi, "getPot", [potB]);
  const back = await read(TOKEN, testRupeeAbi, "balanceOf", [address]);
  expect(STATE[p.state] === "Closed", "pot is Closed after the last claim");
  expect(back === startBalance, "every paisa came back");
  return `${STATE[p.state]}, balance back to ${rs(back)}`;
});

const passed = results.filter((r) => r.ok).length;
console.log(`\nBoth endings of a pot work on the deployed contracts. ${passed} steps passed.\n`);
