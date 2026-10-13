/**
 * Does the whole pot flow actually work on-chain?
 *
 * The app has never completed a single money action end to end, and it is not
 * obvious whether the fault is the contracts, the wiring, or the wallet. This
 * walks the entire lifecycle against the DEPLOYED contracts with the deployer
 * key — faucet, approve, create, deposit, repay, close, refund — and says
 * exactly which step breaks, if any.
 *
 * The Foundry tests already cover the contracts in a simulator. This covers
 * something they cannot: the contracts as actually deployed on Monad testnet,
 * reached the way the app reaches them.
 *
 * Diagnostic only. Nothing in the app imports it.
 *
 *   node scripts/flow-check.mjs
 */

// ── DISABLED ────────────────────────────────────────────────────────────────
// This script signs with DEPLOYER_KEY, read from packages/contracts/.env, and
// that key is treated as compromised. It exits here, before reading anything.
// Use scripts/flow-check-safe.mjs instead — see docs/flow-check.md.
console.error(
  "\nSTOPPED  flow-check.mjs is disabled: it signs with the compromised deployer key.\n" +
    "         Use scripts/flow-check-safe.mjs (a dry run by default). See docs/flow-check.md.\n"
);
process.exit(1);

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  toHex,
  formatEther,
} from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { potManagerAbi, testRupeeAbi } from "../lib/abis.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
      ];
    })
);

const POT = env.NEXT_PUBLIC_POT_MANAGER_ADDRESS;
const TOKEN = env.NEXT_PUBLIC_TEST_RUPEE_ADDRESS;

const deployerKey = readFileSync("../../packages/contracts/.env", "utf8")
  .match(/^DEPLOYER_KEY=(.*)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, "");
const account = privateKeyToAccount(deployerKey);

const pc = createPublicClient({ chain: monadTestnet, transport: http() });
const wc = createWalletClient({
  account,
  chain: monadTestnet,
  transport: http(),
});

const rs = (p) => `Rs ${(Number(p) / 100).toLocaleString("en-IN")}`;

async function step(label, fn) {
  process.stdout.write(label.padEnd(32));
  try {
    const out = await fn();
    console.log(`OK    ${out ?? ""}`);
    return out;
  } catch (e) {
    const msg = (e.shortMessage || e.message || String(e)).split("\n")[0];
    console.log(`FAIL  ${msg}`);
    throw e;
  }
}

async function send(to, abi, functionName, args) {
  const hash = await wc.sendTransaction({
    to,
    data: encodeFunctionData({ abi, functionName, args }),
  });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`reverted (${hash})`);
  return r;
}

const read = (abi, functionName, args) =>
  pc.readContract({ address: abi === testRupeeAbi ? TOKEN : POT, abi, functionName, args });

console.log(`\nactor   ${account.address}`);
console.log(`MON     ${formatEther(await pc.getBalance({ address: account.address }))}\n`);

// ── 1. Test money ───────────────────────────────────────────────────────────
const held = await read(testRupeeAbi, "balanceOf", [account.address]);
if (held === 0n) {
  await step("faucet()", async () => {
    await send(TOKEN, testRupeeAbi, "faucet", []);
    return rs(await read(testRupeeAbi, "balanceOf", [account.address]));
  });
} else {
  console.log(`${"faucet()".padEnd(32)}SKIP  already holds ${rs(held)}`);
}

// ── 2. One-time allowance ───────────────────────────────────────────────────
const allowance = await read(testRupeeAbi, "allowance", [account.address, POT]);
if (allowance < 100_00n) {
  await step("approve(PotManager)", () =>
    send(TOKEN, testRupeeAbi, "approve", [POT, 2n ** 255n])
  );
} else {
  console.log(`${"approve(PotManager)".padEnd(32)}SKIP  already allowed`);
}

// ── 3. Create ───────────────────────────────────────────────────────────────
const inviteCode = keccak256(toHex(`flow-check-${Date.now()}`));
const inviteHash = keccak256(inviteCode);
const target = 50_00n; // Rs 50
const approvalLimit = 20_00n; // repayments under this settle instantly
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 86_400);

await step("createPot()", () =>
  send(POT, potManagerAbi, "createPot", [
    inviteHash,
    approvalLimit,
    5,
    target,
    deadline,
  ])
);

const potId = (await read(potManagerAbi, "potCount", [])) - 1n;
console.log(`${"".padEnd(32)}      pot #${potId}`);

// ── 4. Fund it to the target ────────────────────────────────────────────────
await step("deposit() up to target", async () => {
  await send(POT, potManagerAbi, "deposit", [potId, target]);
  const p = await read(potManagerAbi, "getPot", [potId]);
  return `state=${p.state} balance=${rs(p.balance)}`;
});

// ── 5. Repay a member, under the limit ──────────────────────────────────────
//
// Simulated rather than sent. The contract reverts with `RecipientNotMember`
// for anybody outside the pot, so the only valid payee in a one-person pot is
// the creator — and repaying yourself needs an approval that nobody else is
// here to give, which would then block `closePot` with `PendingRequests`.
// Simulating proves the call is accepted without stranding the pot.
await step("requestSpend() to a member", async () => {
  await pc.simulateContract({
    address: POT,
    abi: potManagerAbi,
    functionName: "requestSpend",
    args: [potId, account.address, 10_00n, keccak256(toHex("cab to the station"))],
    account: account.address,
  });
  return "accepted";
});

// ── 6. Close, which pays the leftover straight back ─────────────────────────
//
// `claimRefund` is deliberately not called: that is the path for a pot that
// never reached its target and went to Refunding. A funded pot pays out when
// it closes, so asking to claim afterwards reverts, correctly.
await step("closePot()", async () => {
  const before = await read(testRupeeAbi, "balanceOf", [account.address]);
  await send(POT, potManagerAbi, "closePot", [potId]);
  const after = await read(testRupeeAbi, "balanceOf", [account.address]);
  const p = await read(potManagerAbi, "getPot", [potId]);
  return `state=${p.state}, came back ${rs(after - before)}`;
});

console.log(`
The whole pot flow works against the deployed contracts. pot #${potId}
`);
