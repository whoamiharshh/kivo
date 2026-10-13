# REBUILD_GUIDE

Part of the [PROJECT_DOSSIER](PROJECT_DOSSIER.md). A step-by-step plan for a new
developer or agent to recreate the product from the repository's documents and
source, plus the rules a frontend agent (the user named "Antigravity") must follow
to improve the UI without breaking behaviour. It reproduces what exists and flags
what must be fixed while rebuilding; it does not invent requirements.

## 0. Decisions to take before writing anything

1. **Keys and roles (blocking).** Five contracts embed a role address at
   construction. Decide the signer/deployer strategy first
   ([SECURITY.md](SECURITY.md) §3, §7). Rebuilding with fresh keys means a fresh
   deployment and new `NEXT_PUBLIC_*_ADDRESS` values. Never reuse the exposed
   addresses `0xbe4AD8…1D94` (trust signer) and `0xD6A07f…EDA7` (deployer).
2. **Pot discovery/history design.** Pick one: (A) event indexer + Supabase
   (needs a scheduler and a catch-up strategy) or (B) direct on-chain reads +
   state-derived feed (no history, O(pots)). B is what the working tree does now.
3. **Judging/hackathon criteria.** Not in the repo (Unknown). Obtain them before
   prioritising features. The repo only says "Monad Metropolis, Track 2" and that
   a Vercel URL with judge instructions and a user-testing log are expected
   (`CLAUDE.md` §9).

## 1. Accounts and access needed

| Need | Why | Who can do it |
|---|---|---|
| Funded Monad Testnet key (≈4 MON per the earlier plan) | deploy 9 contracts | owner (never paste keys in chat; use `cast wallet import`) |
| Privy app | Google login, embedded wallets, fee sponsorship for chain 10143, identity-token toggle, allowed domains/OAuth redirects | owner (dashboard) |
| Supabase project | offchain text + trust tables | owner (dashboard/SQL) |
| Vercel project | hosting, env vars | owner |
| RPC endpoint (optional but recommended) | avoid public rate limits | owner |

Safe without accounts: reading code, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
building contracts, running Foundry tests.

## 2. Rebuild order

### Step 1 — Workspace
`package.json` (`private`, `packageManager pnpm@12.10.1`, scripts `build/lint/typecheck/test:contracts`),
`pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.gitignore` (must ignore
`node_modules`, `.next`, `.env*`, `packages/contracts/{out,cache,broadcast,lib}`,
`.dist`, `.remember`, `.backup`, `.playwright-mcp`, zips). Add `.remember/`,
`.backup/`, `.playwright-mcp/` to the ignore list (currently not ignored).

### Step 2 — Contracts (`packages/contracts`)
Recreate the nine contracts exactly as in [CONTRACTS.md](CONTRACTS.md) (or start
from the Solidity files). Tooling: Foundry, solc 0.8.24, OpenZeppelin 5.7.0,
forge-std 1.17.0, `optimizer_runs = 200`. Implementation notes worth preserving:
- ids: pots/spends/pools/policies start at 1; payments/gifts/goals/streams/
  agreements start at 0.
- All digests are EIP-191 over `keccak256(abi.encode(…))` binding
  `address(this)` and `block.chainid` (and an action tag for join and pool
  attestation); keep the TypeScript twins in step (Step 6) and test the pair.
- `deadline` is exclusive; pro-rata with last-contributor dust; partial-fill
  deposits; cumulative per-member approval budget; reservation of pending spends.
- Deploy script guard rails (chain 10143 only unless `ALLOW_OTHER_CHAIN`; explicit
  non-deployer roles elsewhere).
Run `forge test` (target: the documented 408 tests) before anything else.

### Step 3 — Database
Create a Supabase project; run `supabase/schema.sql`, then the migrations in
filename order. **The repo cannot recreate the live database:** five migrations
recorded by the live project (`socialpay_trust_layer`, `pot_offchain_text`,
`lock_down_trigger_function`, `employer_trust_layer`, `isa_trust_layer`) are not in
`supabase/migrations/`. Export them from
the live project (`supabase db dump` or the SQL editor) into the repo before
relying on a rebuild. Table list and policies: [ARCHITECTURE.md](ARCHITECTURE.md) §6.
While rebuilding, fix K-03: write the invite code from an authenticated server
route (service key) or insert without `.select()` and check the error.

### Step 4 — App scaffold (`apps/pot`)
`create-next-app` → Next 16.4.0, React 19.3, TypeScript, Tailwind 4. Add shadcn
(`components.json`: style `base-nova`, baseColor `neutral`, CSS variables, lucide).
`next.config.ts`: `cacheComponents: true`, `partialPrefetching: true`,
`distDir` from `NEXT_DIST_DIR`, Turbopack `root` = monorepo root with the
`@tailwindcss/turbopack` CSS rule. Read the Next docs shipped in
`node_modules/next/dist/docs/` first (`AGENTS.md` warns APIs differ from older
versions). Install: `@privy-io/react-auth ^3.48`, `@privy-io/wagmi ^4`,
`@privy-io/node ^0.35`, `wagmi ^3.7`, `viem ^2.56`, `@tanstack/react-query ^5`,
`@supabase/supabase-js ^2`, `zod ^4`, `motion ^14`, `sonner`, `@base-ui/react`,
`vitest ^5`.

### Step 5 — Config and providers
`lib/env.ts` (zod; skip during build via `NEXT_PHASE`; lenient in development),
`instrumentation.ts`, `lib/contracts.ts` (**write each `process.env.NEXT_PUBLIC_*`
access out literally** — computed access is never inlined by Next),
`lib/abis.ts` generated by `scripts/gen-abis.mjs`, `lib/wagmi.ts` (config from
`@privy-io/wagmi`, five-endpoint fallback transport, `retryCount`/`retryDelay`),
`app/providers.tsx` (Privy: Google only, embedded wallet for users without one,
`showWalletUIs: false`, chain 10143), route group `(app)` with `<Providers>`.

### Step 6 — Libraries (dependency order)
`money.ts` → `time.ts` → `now.ts` → `tx.ts` (`useSponsoredCall`: sponsor true,
wait for receipt, never retry unsponsored; `readableError` — **map every
reachable revert**, add `CannotApproveOwnPayout`, `AuthorizationExpired`,
`BadAuthorization`) → `store.ts` (Supabase + localStorage; check errors) →
`actions.ts` → `queries.ts` → `token.ts`/`people.ts` → `features/*` (one module
per feature, with `*-state.ts` pure logic split out so server components can import
it) → `trust/client.ts`.

### Step 7 — Server
`lib/server/{env,privy,guards,route-kit,nonce,trust-signer,trust,chain,db,logging}`
and `app/api/**` per [API_REFERENCE.md](API_REFERENCE.md). Mandatory behaviours:
two-token verification with subject cross-check; address only from the identity
token; reserve nonce **before** returning a signature; fail-closed rate limit;
64 KiB body cap; default-deny signer.

### Step 8 — Screens and components
Per [FEATURE_MATRIX.md](FEATURE_MATRIX.md) and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
Build in this order (each is a checkpoint): Home/Create → Invite/Join → Pot view
→ Repay/Approve/Cancel → Close/Refund → other features → Agreements → Cover.

### Step 9 — Tests
Port the 11 vitest files, then add the missing ones listed in
[TESTING.md](TESTING.md) §7 (spend-id indexing, discovery with RPC failure, store
error paths, API route tests with mocked Privy/Supabase). Keep `server-only`
aliased and placeholder env values in `vitest.config.mts`.

### Step 10 — Deploy (not performed in the repo)
Deploy contracts with a script; record addresses/block in README; set Vercel env
(`NEXT_PUBLIC_*` must exist at build time); allow the exact production origin in
Privy (no wildcard `*.vercel.app`) and the OAuth redirect; confirm fee sponsorship
for chain 10143; run the smoke test in `apps/pot/DEPLOY.md`.

## 3. Pitfalls already paid for (preserve the fixes)

1. `@privy-io/wagmi`'s `createConfig`/`WagmiProvider`, not wagmi's.
2. Privy dashboard: "Return user data in an identity token" must be ON or every
   trust call returns 401 `missing_identity_token` (nobody can join).
3. Literal `NEXT_PUBLIC_*` access (Step 5).
4. Windows `EPERM` unlinking `.next` artifacts → build with
   `NEXT_DIST_DIR=.next-validation`.
5. Monad public RPC rejects `eth_getLogs` over 100 blocks (HTTP 413, -32614)
   — per code comments; avoid wide log scans in the client.
6. Public RPC rate limits at ~30 concurrent reads — use a fallback transport and
   dedicated endpoint for events.
7. Per-spender ERC-20 allowances: read the allowance for each contract
   (`lib/token.ts`), not PotManager's.
8. Amounts are `bigint` paise end to end; request bodies carry amounts as decimal
   strings.
9. Spend ids start at 1 (K-01); pot ids start at 1; payments/gifts/goals/streams
   start at 0.
10. Postgres `INSERT … RETURNING` obeys SELECT policies (K-03).
11. A server-only module must `import "server-only"`; tests alias it.

## 4. Prioritised rebuild checklist

**P0 — Security / correctness (blocks any real demo)**
- [ ] Decide key strategy; deploy fresh contracts with new roles (approval needed).
- [ ] Rotate Supabase service key and Privy secret.
- [ ] Fix invite-code persistence (K-03) and verify with an anon-role test.
- [ ] Fix spend-id indexing (K-01); add tests.
- [ ] Remove or repair gift condition confirmation (K-02).
- [ ] Add ownership checks to `attest-behaviour` (S-1).
- [ ] Run the Foundry suite; run app tests, lint, build.

**P1 — Demo-critical features**
- [ ] Direct on-chain discovery (or a working indexer with a scheduler).
- [ ] Pot feed fidelity decision (timestamps/top-ups).
- [ ] Hide or build Agreements and Cover entries (K-07).
- [ ] Authenticated end-to-end run of the full pot journey with two accounts.

**P2 — Hardening**
- [ ] Move text writes behind server routes / tighten RLS (S-2).
- [ ] `NEXT_PUBLIC_APP_URL`, Privy allowlists, Vercel env verification.
- [ ] Map all revert names in `readableError` (K-09).
- [ ] CI (typecheck, lint, vitest, forge test), secret scanning.

**P3 — Operations / polish**
- [ ] Monitoring, backups with a restore drill, staging environment, analytics
      policy, load test with an authorised RPC.
- [ ] Unify the two visual dialects; fix `text-text-tertiary`; dedupe badge/card/
      avatar components.
- [ ] Update stale docs (DEPLOY.md, tech.md, production-readiness.md, README).

## 5. Handoff constraints for a frontend-only agent ("Antigravity")

Goal: improve visual design without breaking functionality.

**Do not change** (behavioural surface):
- `lib/actions.ts`, `lib/queries.ts`, `lib/tx.ts`, `lib/store.ts`, `lib/contracts.ts`,
  `lib/abis.ts` (generated), `lib/features/**`, `lib/trust/**`, `lib/server/**`,
  `app/api/**`, `supabase/**`, `packages/contracts/**`, `scripts/**`.
- Hook return shapes and query keys (screens and invalidation rely on them), e.g.
  `useMyPots() → { potId, pot, name, perPersonPaise }[]`, `usePot()`,
  `usePotActivity() → { items, pending, names }`.
- Amount handling (`bigint` paise; only `lib/money.ts` converts), deadline
  semantics (exclusive), and the plain-language rule (no wallet/gas/chain words).
- Disclosures that must stay: test-money notes, "not insurance", "self-reported"
  statements, the refund promise on the join screen.

**Free to change:** `app/globals.css` tokens (keep semantic token names),
`components/ui/*` styling, `components/**` markup/classes, page layout and
spacing, motion (respect `prefers-reduced-motion`), empty/error/loading visuals,
iconography, copy tone (within the language rule).

**Before and after each change run:** `pnpm test` (77 tests), `pnpm typecheck`,
`pnpm lint`, `pnpm build`. Browser-check mobile width 390 px: no horizontal
scroll, primary action reachable, focus ring visible.

**Known visual debt to address while there** (see DESIGN_SYSTEM §5): the two
dialects, raw palette names, `text-text-tertiary`, duplicate badge/card/avatar
components, small secondary touch targets, toast-only form errors. Do **not** "fix"
data issues visually (e.g. the missing timestamps in the feed or the phantom
pending request) — those are logic issues tracked as K-01/K-05.
