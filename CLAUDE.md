# Pot — Project Brief for Claude Code

Read this fully before doing anything. Work in the build order (section 9).
Stop at each CHECKPOINT and wait for the human to say "continue".
The human has never written Solidity: explain every command they must run, in plain words.

## 1. Product (one line)
Pot is a shared money box for friend groups: everyone puts money in, the pot
repays whoever paid for group costs under agreed rules, and leftover money goes
back to each person automatically. No friend has to hold the group's money.

## 2. User
Delhi college students running a shared kitty — group trips, flat/hostel
groceries, club or event funds. (Human will confirm which one we demo; copy and
examples should match it.)

## 3. Why onchain (must stay true in code and pitch)
Today one friend collects everyone's UPI money and must be trusted to spend and
refund fairly. In Pot the money sits in a contract nobody controls; spending
rules and refunds execute by themselves.

## 4. Core flow (the ONLY flow for v1)
1. Create pot: name, amount per person (display only), approval limit, max members.
2. Share invite link on WhatsApp → friend logs in with Google → joins.
3. Add money ("Get ₹5,000 test money" button, then add to pot).
4. Repay a member: "₹1,200 to Rahul — cab". To someone else and under limit → instant.
   Over limit, or repaying yourself → needs 1 approval from another member.
5. Close pot (creator): leftover returned to each member in proportion to what they put in.
6. Activity feed: every add, repayment, approval, refund.

## 5. OUT of scope (do not build)
Scheduled/automatic pulls, recurring rent, landlord/utility payouts, penalties,
redistributing money between members, real-money onramp, mainnet, personal data
onchain, any invented metrics.

## 6. Contracts — ALREADY WRITTEN in `contracts/` (not yet compiled)
- `src/TestRupee.sol` — ERC-20 "Test Rupee" (tINR), 2 decimals (1 unit = 1 paisa), `faucet()` = ₹5,000/day.
- `src/PotManager.sol` — all pots in one contract:
  `createPot(inviteHash, approvalLimit, maxMembers)`, `join(potId, inviteCode)`,
  `deposit(potId, amount)` (needs ERC-20 approve first), `requestSpend(potId, to, amount, memoHash)`,
  `approveSpend(potId, spendId)`, `closePot(potId)`; views `getPot`, `getMembers`, `getSpend`,
  `contributed`, `isMember`. Events for every action — build the activity feed from events.
- `inviteHash = keccak256(abi.encodePacked(inviteCode))`; inviteCode is a random bytes32 put in the invite link.
- `test/PotManager.t.sol` — 20 tests. Fix compile errors if any; do NOT weaken a rule to make a test pass without telling the human.
- `script/Deploy.s.sol` — deploys both, prints addresses.

## 7. App (to build, in `app/`)
- Next.js (whatever `create-next-app@latest` installs) + TypeScript + Tailwind + shadcn/ui, mobile-first (`max-w-md`).
- Privy: Google login, embedded wallet auto-created, Privy native gas sponsorship on Monad Testnet — every transaction sponsored. Embedded wallet confirmation modals off, so actions feel like normal taps. Verify current Privy docs for the exact sponsorship API before coding.
- First deposit: send `approve(PotManager, max)` once, then `deposit`; show as a single "Add money" step.
- wagmi/viem; `monadTestnet` from `viem/chains`. Contract addresses + ABIs in `app/lib/contracts.ts`.
- Display names and memo text stored offchain (Supabase free tier) keyed by address / memoHash. Only hashes go onchain.
- Amounts in ₹ with a small "test money" tag.

## 8. UI language rule
Never show: wallet, gas, transaction, blockchain, web3, crypto, token, connect,
seed phrase, signature, onchain, contract, mint, faucet. Use: add money, repay,
approve, close pot, refund, test money.

## 9. Build order
1. `cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && forge test -vv` → CHECKPOINT
2. Deploy to Monad testnet (human uses a keystore account, never pastes a private key into chat) → CHECKPOINT; write addresses into README
3. Next.js scaffold in `app/` + Privy Google login + one sponsored test call (`faucet()`) → CHECKPOINT
4. Screens, one at a time with a CHECKPOINT after each: Home/Create → Invite/Join → Pot view (balance, members, feed) → Repay/Approve → Close & refunds
5. Deploy to Vercel, judge access instructions in README → CHECKPOINT
6. User-testing script + feedback log template (record only real results)

## 10. Honesty rules
No invented numbers, users, or features. README separates: what works, what is
test money, what is future work.
