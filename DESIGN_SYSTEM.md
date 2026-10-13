# DESIGN_SYSTEM

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). Records the **actual**
implemented design (read from `apps/pot/app/globals.css`, `components/**`,
`lib/motion.ts` on 2026-10-12) so a frontend agent can reproduce it and improve it
without changing behaviour. It does not propose a redesign; the "Inconsistencies
and gaps" section lists observed problems only. No screenshots were taken in this
pass, so claims about visual appearance are derived from code.

## 1. Intent and trust signals

A consumer-finance product for students handling shared money. The code and
comments state these deliberate choices:

- **Plain, non-crypto language** (hard rule, `CLAUDE.md` §8 / `AGENTS.md`): never
  "wallet, gas, transaction, blockchain, web3, crypto, token, connect, seed phrase,
  signature, onchain, contract, mint, faucet". Use "add money, repay, approve,
  close pot, refund, test money". Code identifiers are exempt.
- **Honesty cues**: a "Test app. The money in it has no real value." line on the
  sign-in and a "Test app. Balances have no real value." footer on Home; a
  `TestMoneyNote` primitive ("Test money. No real value."); disclosures that
  self-reported goals are not verified; Cover screens say it is not insurance.
- **State never by colour alone**: every `StatusBadge` tone carries a word.
- **Light-only** (a money app used in daylight on a phone): a `.dark` variable set
  exists only so shadcn primitives resolve; nothing sets the class.
- **One metaphor**: the *pot as a vessel that fills* (cards and the pot-detail hero
  tint rise from the bottom via `scaleY`), with an outlined pot-with-lid SVG in the
  empty state and sign-in screen.

## 2. Tokens (from `app/globals.css`)

Tailwind 4 is CSS-first; there is no `tailwind.config`. Components are meant to
use semantic utilities (`bg-card`, `text-foreground`, `bg-primary`) and never raw
palette names.

### Colour

| Token | Value | Notes |
|---|---|---|
| `--background` | `#fafaf9` | warm stone-50 page |
| `--card` / `--popover` | `#ffffff` | the one raised surface |
| `--foreground` / `--card-foreground` | `#1c1917` | 16.1:1 on background (per comment) |
| `--muted` / `--secondary` / `--accent` | `#f5f5f4` | |
| `--muted-foreground` | `#57534e` | 7.2:1 (AA body) |
| `--text-tertiary` | `#a8a29e` | **2.5:1 — decorative/large only** (per comment) → utility `text-tertiary` |
| `--border` / `--input` | `#e7e5e4` | |
| `--primary` / `--ring` | `#4f46e5` (indigo-600); hover `#4338ca`; subtle `#eef2ff`; strong `#4338ca`; ring `#c7d2fe`; foreground `#fff` | |
| Success | `#10b981`; bg `#ecfdf5`; strong `#047857`; ring `#a7f3d0` | |
| Warning | `#f59e0b`; bg `#fffbeb`; strong `#b45309`; ring `#fde68a` | |
| Danger / `--destructive` | `#ef4444`; bg `#fef2f2`; strong `#b91c1c`; ring `#fecaca` | |
| Neutral | strong `#57534e`; ring `#e7e5e4` | |
| Privy modal accent | `#4f46e5`, theme light | `app/providers.tsx` |
| `viewport.themeColor` | `#ffffff` | `app/layout.tsx` |

Status tone mapping (`components/feature/primitives.tsx`): `progress` → primary
subtle/strong/ring; `good` → success; `attention` → warning; `over` → muted/neutral.

### Typography

Font: **Inter** via `next/font/google` (self-hosted at build), weights 400/500/600/700,
`display: swap`, CSS variable `--font-sans`; `antialiased`. Body base 15 px / 22 px.

| Token (utility) | Size / line / weight | Other |
|---|---|---|
| `text-display` | 36 / 40 / 700 | letter-spacing −0.02em |
| `text-h1` | 28 / 34 / 700 | −0.01em |
| `text-h2` | 22 / 28 / 600 | |
| `text-h3` | 18 / 24 / 600 | |
| `text-body` | 15 / 22 / 400 | |
| `text-small` | 13 / 18 / 500 | |
| `text-caption` | 12 / 16 / 500 | |
| `text-overline` | 11 / 14 / 600 | +0.06em |

Amounts use `.tabular` / `[data-amount]` → `font-variant-numeric: tabular-nums`.

### Radius, shadow, motion

- Radius: `--radius-sm 10px`, `md 12px`, `lg 16px`, `full 999px`; `--radius: 16px`.
- Shadows `xs/sm/md/lg` (warm-black at 4–8 % alpha); depth cue is shadow, not
  gradients.
- Easing `cubic-bezier(0.16, 1, 0.3, 1)` (CSS `--ease-out-expo` and `EASE` in
  `lib/motion.ts`); `DURATION.progress` etc. in seconds. Only `transform`,
  `opacity`, `filter` animate (progress bar width is the stated exception).
  `prefers-reduced-motion` collapses animations/transitions to ~0 ms.
- Focus: `:focus-visible` → 3 px ring `primary/25`.

### Layout and spacing

Single column: `AppShell` = `mx-auto min-h-dvh w-full max-w-md`, sticky header
(`border-b bg-background/85 backdrop-blur`, `px-4 py-3`), main `px-4 pb-28 pt-4`.
`StickyBar` is a fixed bottom bar (`border-t bg-background/90 backdrop-blur`,
`max-w-md px-4 py-3`) holding the primary action at thumb height. Vertical rhythm
via `space-y-3/4/6/7` and `Section` (`mt-6`, `h3` title). There is no breakpoint
logic beyond `max-w-md`; desktop shows the same centred column.

## 3. Components

### Primitives (`components/ui`, shadcn "base-nova" on Base UI)
`avatar`, `badge`, `button`, `card`, `dialog`, `input`, `label`, `separator`,
`skeleton`, `sonner` (toasts). Button variants: `default`, `outline`, `ghost`,
`destructive`; sizes `default h-8`, `xs h-6`, `sm h-7`, `lg h-9`, icon sizes.
Primary actions override to `h-11`/`h-12` in call sites. Dialogs are Base UI
`Dialog` with `max-w-[calc(100vw-2rem)]`.

### Feature kit (`components/feature`)
`StatusBadge`, `Amount`, `TestMoneyNote`, `Section`, `Card`, `StatRow`,
`EmptyState`, `Alert`, `Avatar`, `MemberRow`, `RowList` (`primitives.tsx`,
server-component-safe); `TextField`, `AmountField`, `AmountPills`, `NumberField`,
`DateField`, `ChoiceGroup` (`fields.tsx`); `ActionButton`, `StickyAction`;
`FeatureCard` (list row); `ProgressBar`; per-feature lists (`pay`, `gifts`,
`savings`, `pools`, `streams`, `cover`) and notices (`cover-notices`,
`savings/notes`, `cover-terms`).

### Pot components (`components/pot`)
`PotCard` (vessel card with staggered fill: `delay 0.06 × index`), `pot-status`
(state badge + target progress), `members-list`, `invite-card`, `activity-feed`,
`pending-list`, `refund-card`, dialogs `add-money`, `repay`, `close`.

### Shell/common
`AppShell`, `LoginGate` (sign-in pitch with `FullPot` SVG and Q&A list), `HomeNav`
(visible feature routes), `BalanceRow`, `NameRow`, `Person` (avatar fallback with
initials and a tint hashed from the address), `MoneyInput`, `SetupNotice`.

### Iconography
Mostly inline SVG (back chevron, pot illustrations); `lucide-react` is installed
and referenced by shadcn config. No icon set is applied systematically.

### Forms
Labels above inputs; inputs `h-12 text-base`; hint text `text-sm
text-muted-foreground`; money entry via `MoneyInput` (₹ prefix, validated by
`rupeesToPaise`); dates via native `datetime-local`/`date` inputs with `min/max`;
errors surface as toasts (not inline field errors) except a few inline messages.

### Tables and charts
None. Lists are cards/rows. No charts exist.

### States
- Loading: `Skeleton` blocks sized near the final layout.
- Empty: illustrated `EmptyState` / dashed `Card` with a sentence.
- Error: card with message and "Try again"; toasts for action failures.
- Transaction: buttons switch to pending text ("Creating…", "Adding…");
  success toast after the receipt; no wallet prompt.

## 4. Responsive behaviour and accessibility (as implemented)

- Mobile-first, `max-w-md` column, `min-h-dvh`, safe use of `pb-28` under the
  sticky bar. Viewport allows zoom (no `maximum-scale`).
- Reported earlier (not re-verified): sign-in view has no horizontal overflow at
  390 px (`docs/production-readiness.md`).
- `aria-label` on the back link; `aria-hidden` on decorative SVGs/fills;
  `aria-pressed` on the repay recipient buttons; `dl/dt/dd` for the sign-in Q&A;
  `time` elements with `dateTime` in the feed.
- Colour contrast: body and muted text meet AA by the file's own figures;
  `text-tertiary` does not and is documented as decorative only.
- Touch targets: primary actions are 44–48 px; secondary buttons use the shadcn
  `sm` (28 px) and `default` (32 px) heights — below the common 44 px guidance
  (observation).
- Keyboard focus ring is global and consistent.

## 5. Inconsistencies and gaps (observed in code)

1. **Two visual dialects.** Pot screens/components (`components/pot/*`,
   `ui/card`) use the older `text-sm/text-xs` scale and ad-hoc classes
   (`border-amber-200 bg-amber-50/60` in `pending-list.tsx`, 89 uses of the old
   scale vs 146 token-scale uses); the feature screens use the token scale and
   `feature/primitives`. The Home screen and pot hero were recently reworked to the
   vessel style; other pot components were not.
2. **Raw palette names despite the "never name a colour" rule**: 11 places in 7
   files (`person.tsx`, `activity-feed.tsx`, `feature/primitives.tsx`,
   `ui/dialog.tsx`, `pot-card.tsx`, `pending-list.tsx`, `app/(app)/page.tsx`).
3. **Broken token class.** `text-text-tertiary` appears 14 times (e.g. the
   "Test app…" captions) but the theme defines `--color-tertiary` (utility
   `text-tertiary`). The mismatched class likely renders with no colour override
   (not verified in a browser).
4. **Duplicate component names** with different implementations: `Card` and
   `Avatar` exist in both `ui/` and `feature/primitives.tsx`; three status-badge
   implementations (`pot-card.tsx`, `pot-status.tsx`, `feature/primitives.tsx`).
5. **Dead component**: `components/test-money-card.tsx` is unused.
6. **Cover page** uses a hand-rolled `<button className="h-11 rounded-md border
   …">` instead of `Button`.
7. **Error presentation** is toast-only for most forms (no inline field errors,
   no focus management on failure).
8. **Dark mode variables** exist but are unused; Toaster is pinned to light.
9. **Copy mismatch**: README says the Home button reads "Get ₹5,000 test money";
   the shipped label is "Get ₹5,000".
10. **No visible "test money" tag on the Home balance itself** (only a footer
    line), although the brief asked for a small tag next to amounts.
11. **Activity feed under implementation B** shows no timestamp/ref; the UI
    handles `null` but the design for "undated, per-person totals" is not
    considered.
12. **No Figma/design source or screenshots** are in the repo; the screen gallery
    that once existed (`/preview`) was deleted in the working tree.

## 6. Reproduction checklist for another frontend agent

1. Recreate `globals.css` tokens exactly (section 2); install Inter weights 400–700.
2. Keep the `max-w-md` column, sticky header, `StickyBar` primary action.
3. Rebuild `PotCard`/pot hero with a full-height tinted layer scaled on Y from the
   bottom (`origin-bottom`), tint by state: progress → `primary-subtle`, funded →
   `success-bg`, refunding → `warning-bg`.
4. Preserve all copy rules and disclosure lines; never add wallet vocabulary.
5. Keep behaviour contracts intact (hooks in `lib/actions.ts`, `lib/queries.ts`,
   `lib/features/*` are the functional surface) — see
   [REBUILD_GUIDE.md](REBUILD_GUIDE.md) "Antigravity handoff constraints".
