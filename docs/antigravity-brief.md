# Brief for Antigravity — visual polish only

Paste this whole file as the first message. It is written to be followed
literally.

## What this is

**Pot** is a mobile-first app where a group of friends pools test money toward a
target by a deadline. If the target is reached they spend it under shared rules
and the rest is returned fairly; if not, everyone takes their own money back.
It runs on a test network with **test money only** — nothing real.

Your job is **visual polish**: make it look and feel like a calm, modern,
trustworthy consumer app. The logic, the data and the money rules are finished
and verified. **Do not change them.**

## The stack (so you don't fight it)

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS **v4**.
- Components in `apps/pot/components/ui` are shadcn on **Base UI**. They use a
  `render` prop, **not** `asChild`: `<Button render={<Link href="/x" />}>`.
- Animation uses `motion/react`; shared timings live in `apps/pot/lib/motion.ts`.
- Layout is a single column, `max-w-md`, designed for a phone first.
- Read `DESIGN_SYSTEM.md` at the repo root before you start.

## How you'll see the UI

You will **not** be able to sign in with Google — and you must not try. Instead:

- There is **no sample-data page** and none may be added: the app never shows
  invented people, pots or balances. A new person sees an empty app.
- The pot page, create, join and the dialogs are *assembled* from those pieces in
  `apps/pot/app/(app)/`. Edit the pieces and the screens follow; the human tests
  the real screens by signing in by hand.
- `docs/frontend-workspace.md` explains the safe workspace. **Never open or read a
  `.env*` file.** `AGENTS.md` at the repo root has the full rules.
- If you add a new reusable piece, build it from the existing primitives in
  `components/feature/primitives.tsx` and `components/ui/`. Do not add sample
  data anywhere.

## Where you may work

You may change **how things look**: spacing, type, colour, radius, shadows,
icons, illustrations, empty states, loading skeletons, motion.

| Allowed | |
|---|---|
| `apps/pot/app/globals.css` | tokens, colours, base styles |
| `apps/pot/components/ui/*` | the primitive components |
| `apps/pot/components/feature/*` | the shared feature components |
| `apps/pot/components/*.tsx`, `components/pot/*` | presentational parts |
| `apps/pot/app/(app)/**/page.tsx` | **markup and classes only** |
| `apps/pot/lib/motion.ts` | timings and easing |

## Where you must not work

| Forbidden | Why |
|---|---|
| `apps/pot/lib/**` (except `motion.ts`) | hooks, contract calls, money maths, error handling — verified and tested |
| `apps/pot/app/api/**` | the server |
| `packages/contracts/**` | the smart contracts |
| `supabase/**`, `apps/pot/scripts/**` | database and scripts |
| any `.env*` file, `package.json` dependencies, `next.config.ts` | configuration — no new dependencies without asking |

Inside a page file, **do not change which hooks it calls, what it passes them,
or any `onClick` / `mutate` logic.** If a layout change seems to need that,
stop and ask.

## Rules that must not be broken

1. **Words people never see.** Nothing a person can read may contain: *wallet,
   gas, transaction, blockchain, web3, crypto, token, connect, seed phrase,
   signature, onchain, contract, mint, faucet.* Use: *add money, repay,
   approve, close pot, refund, test money.* Code comments may use technical
   words; rendered text may not.
2. **"Test money" stays visible** wherever an amount of money is shown.
3. **Honesty notices are not decoration — keep them, keep them prominent, keep
   their wording exactly.** In particular: the "A demonstration, not insurance"
   block and the "can't start on this test setup" blocks on Cover; the "A record,
   not money" blocks on Agreements; and the explanation under each deadline. Do
   not shorten, soften, collapse behind a toggle, or move them below the fold.
4. **Never make an action look finished before it is.** Pending states, spinners
   and "…ing" labels stay. Do not add optimistic success animations.
5. **Do not rename these labels** — a tester is guided by them:
   `Continue with Google` · `Get ₹5,000 test money` · `Create a pot` ·
   `Create pot` · `Invite your friends` · `Join this pot` · `Add money` ·
   `Repay someone` · `Ask for approval` · `Approve` · `Withdraw this request` ·
   `Close pot and return what's left` · `Open refunds now` ·
   `Claim your … back`.
6. Keep every `aria-*`, `role`, `label`/`htmlFor` and focus style. Touch targets
   stay ≥ 44 px. Contrast stays accessible.

## What "good" looks like

Think of the calm, spacious feel of modern AI products — DeepSeek, Lovable,
Google AI Studio — applied to money:

- A quiet neutral canvas, **one** accent colour, generous whitespace.
- Soft cards with hairline borders and rounded corners; little or no shadow.
- **Large, tabular numerals** for money; small, quiet status chips.
- One obvious primary action per screen, pinned at the bottom with the thumb.
- Gentle, fast motion that explains change (a bar filling, a card settling),
  never decoration for its own sake.
- Empty, loading and error states that feel designed, not leftover.

## Order of work (time-box: about 3 hours; stop when time is up)

1. Sign-in screen (`components/login-gate.tsx`)
2. Home — the "Your money" card and the pot list
3. Create a pot (`app/(app)/create/page.tsx`)
4. Pot page — the hero, progress bar, deadline, members, activity
5. Join page (`app/(app)/join/[potId]/[code]/page.tsx`)
6. Add money / Repay / Close dialogs
7. The "didn't fill up" refund card

Skip Cover, Agreements, Pay, Gifts, Savings, Pools and Streams unless time is
left. They work; they just aren't on the main path.

## After every screen, run — and keep green

From `apps/pot`:

```
npm run typecheck
npm run lint
npm test
npm run build
```

All four must pass before you move on. If a test fails because of a **label or
text you changed**, restore the text rather than editing the test.

## Working safely

- Work on a **separate git branch** (or a copy of the folder). Don't edit the
  only copy.
- Make small commits you can undo — one per screen.
- If you are unsure whether something is "look" or "logic", it's logic: ask.

## When you finish, report

1. Every file you changed, grouped by screen.
2. The output of the four commands.
3. Anything you wanted to change but were not allowed to.
