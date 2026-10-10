<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Pot — project rules for this folder

Read `../../docs/tech.md` before changing anything here, and `../../docs/context.md`
for what is and isn't done. The money rules are in `../../packages/contracts`.

- **`lib/abis.ts` is generated** by `scripts/gen-abis.mjs`. Never hand-edit it.
  After any contract change: `cd ../../packages/contracts && forge build`, then
  `pnpm gen:abis`.
- **wagmi config comes from `@privy-io/wagmi`**, not `wagmi` (`lib/wagmi.ts`).
- **Every write goes through `useSponsoredCall`** (`lib/tx.ts`), which sponsors
  the fee and waits for the receipt. Don't call `sendTransaction` directly, and
  don't report success before the receipt lands.
- **Interface copy may never say** wallet, gas, transaction, blockchain, web3,
  crypto, token, connect, seed phrase, signature, onchain, contract, mint or
  faucet. Say add money, repay, approve, close pot, refund, test money. Code
  identifiers are exempt; anything a person reads is not.
- **Amounts are paise** (`bigint`, 2 decimals) everywhere on the wire, rupees
  only in the UI. Convert with `lib/money.ts`, never with `Number`.
- **Names and memo text stay offchain** (`lib/store.ts`). Only `keccak256`
  hashes go onchain.
- **The repayment limit is a cumulative budget per person**, not a per-request
  cap. Copy that says otherwise is a bug.
- Mobile-first: one `max-w-md` column, the main action in `StickyBar`.
- No invented numbers, users, or features anywhere — including placeholder
  metrics in UI copy.
