# Rules for AI coding tools working in this repo

**Pot** is a mobile-first app where a group pools **test money** toward a target
by a deadline, spends it under shared rules, and gets the rest back — or gets
everything back if the target is missed. It runs on a test network. Nothing here
is real money.

## Read these first, in order

1. `docs/antigravity-brief.md` — what you may change, what you must not, and the
   rules that cannot be broken. **If you are doing UI or design work, this is
   your brief.**
2. `docs/frontend-workspace.md` — how to run the app and see the screens.
3. `DESIGN_SYSTEM.md` — the visual system.
4. `apps/pot/AGENTS.md` — notes on this version of Next.js. Read the guide in
   `node_modules/next/dist/docs/` before writing Next.js code; it differs from
   older versions.

`CLAUDE.md` in this folder is the **original v1 brief and is out of date**. Do
not follow its build order, its "stop at each checkpoint" rule, or its
description of what is built. Follow this file and the documents above.

## Never

- **Never open, read, print or copy any `.env*` file.** Not `.env.local`, not
  `packages/contracts/.env`, not a Vercel export. They may contain private keys.
  You do not need them for UI work.
- Never put a key, secret or token in code, a comment, a log, a commit or a message.
- Never change anything under `packages/contracts/`, `apps/pot/lib/`
  (except `lib/motion.ts`), `apps/pot/app/api/`, `supabase/` or
  `apps/pot/scripts/` for a UI task.
- Never add a dependency without asking.
- Never push to `main`. Work on a branch.
- Never make an action look finished before it is, and never invent activity,
  people, balances or results in the real product. There is no sample-data
  page: a new person sees an empty app.

## Words people must never see

Nothing a person can read may contain: *wallet, gas, transaction, blockchain,
web3, crypto, token, connect, seed phrase, signature, onchain, contract, mint,
faucet.* Use: *add money, repay, approve, close pot, refund, test money.* Code
and comments may use technical words; rendered text may not.

## Honesty notices stay

Wherever an amount appears it is labelled **test money**. The notices on Cover
("A demonstration, not insurance", "can't start on this test setup") and
Agreements ("A record, not money") are required. Do not shorten, soften, hide or
move them.

## Commands (run from `apps/pot`)

```
npm run typecheck
npm run lint
npm test
npm run build
```

All four must pass before you hand work back. Contract tests: `forge test` in
`packages/contracts`.

## Where things are

- `apps/pot/app/(app)/` — the screens. `apps/pot/components/` — the pieces.
- `apps/pot/lib/` — hooks, money maths, contract calls. **Not for UI changes.**
- `packages/contracts/src/` — the Solidity.
- `docs/` — briefs, plans, test guides, honest status.
