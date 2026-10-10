# Pot — the app

The mobile-first Next.js front end for Pot. The money rules live in
`../../packages/contracts`; this is the part a person taps.

- **How to run it, step by step:** `../../README.md`
- **What's built, what's blocked:** `../../docs/context.md`
- **Contract surface, file map, data flow:** `../../docs/tech.md`

## Quick start

```bash
pnpm install
pnpm dev          # localhost:3000
```

If a setup card appears instead of the app, an entry in `.env.local` is still
blank and the card names which one. Copy `.env.example` to `.env.local` and
fill it in — every value is a public `NEXT_PUBLIC_*` identifier, and
`../../README.md` steps 2–4 say where each one comes from.

## The commands

```bash
pnpm dev           # dev server
pnpm build         # production build
pnpm typecheck      # typecheck
npx eslint app components lib
pnpm gen:abis      # regenerate lib/abis.ts from ../../packages/contracts/out
```

## Two things that will bite you

- **`lib/abis.ts` is generated.** Never edit it by hand. After any contract
  change: `cd ../../packages/contracts && forge build`, then `cd ../../apps/pot && pnpm gen:abis`.
- **wagmi's config comes from `@privy-io/wagmi`, not `wagmi`.** See
  `lib/wagmi.ts` — the embedded wallet needs Privy's version to attach.

## House rule for copy

No interface text may say wallet, gas, transaction, blockchain, web3, crypto,
token, connect, seed phrase, signature, onchain, contract, mint or faucet. Say
add money, repay, approve, close pot, refund, test money. Code identifiers are
exempt; anything a person reads is not.
