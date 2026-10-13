# Pot Handoff

Updated 2026-10-12. No public-chain write, key rotation, authority change, data deletion, database migration, or deployment was performed in this continuation. A fresh local-only backup of the completed source state was made after the final edits (see Preservation). The local Next.js dev server is available at `http://localhost:3000` (PID 15800) for user review. No `.vercel` project link is present. Existing browser/database MCP services were left untouched.

## Continuation Update

- Added a default-deny server signer gate. Trust signing is off unless `TRUST_SIGNER_ENABLED=true`, and the known compromised legacy signer address is rejected even with the flag. Disabled signing can start without loading a key and returns a 503 unavailable response. This is source code only; it does not revoke the immutable role or update any deployed server.
- Added local source for a finalized-block Pot event indexer, bounded 100-block log scans, lease/checkpoint and idempotent event storage, a member-verified paginated history endpoint, and a timestamped feed that keeps repeated deposits separate. The migration is not applied and the worker has not run.
- Replaced the client-side all-pot membership scan in source with an authenticated member-index endpoint that rechecks candidate memberships at the finalized head. It uses the same unapplied Supabase migration and is not deployed.
- Testnet RPC read-only check confirmed chain id `10143` and support for the `finalized` block tag. No other inventory state was changed.
- The sign-in page rendered in the local browser at desktop and 390 px mobile widths, with no horizontal overflow, console errors, or failed requests on the fresh load. Unauthenticated GETs to `/api/pots` and `/api/pots/activity?potId=1` returned 401. No login or financial action was performed.
- Final local app validation: 77 tests passed across 11 files; lint and typecheck passed; the isolated production build includes `/api/pots`, `/api/pots/activity`, and `/api/internal/pot-index`. Next's generated `tsconfig.json` edits were removed afterward.
- `git diff --check` passed. `forge`, Supabase CLI, and WSL were unavailable; the contract suite was not rerun in this continuation.
- A broad search unintentionally displayed the already-compromised local signer value in tool output. It is not reproduced here or written into repository files. Treat the key as exposed; the source gate is local only and is not a replacement for the approval-gated recovery plan.
- Foundry, Supabase CLI, and WSL were unavailable. No dependency or system tool was installed. Production Vercel and Privy settings were not accessed.

## User Decision And Safety Boundary

The user does **not** approve a production app cutover yet. They authorized preserving the current state, documenting the old deployment, investigating data consequences and dual-deployment support, and preparing/testing fresh contracts only in an isolated environment. They did **not** authorize a public deployment, revocation, migration, deletion, or irreversible action. Obtain separate explicit approval before any such operation.

Treat `TRUST_SIGNER_KEY` and `DEPLOYER_KEY` as compromised. Their values are not recorded here. Do not print, paste, commit, or ask for them in chat. The private keys remain in ignored local environment files; those files are included in the local backups.

## Preservation

Local-only backups are outside the repository and outside OneDrive:

- Baseline before this continuation: `C:\Users\Sir\AppData\Local\PotBackups\pot-preserved-20261012-025450` (2,921 files)
- Current edited state: `C:\Users\Sir\AppData\Local\PotBackups\pot-current-20261012-032327` (2,926 files)
- Exact worktree snapshot before this continuation: `C:\Users\Sir\AppData\Local\PotBackups\pot-current-20261012-135613`
- Completed source state after final edits (build and restored-config typecheck passing): `C:\Users\Sir\AppData\Local\PotBackups\pot-current-20261012-163802`. Checked file-by-file (path and size) against the workspace; the only differences are logs and generated build output (`.remember`, `.next-validation`), which are intentionally excluded.

Both include the local environment files and user artifacts. The current copy was hash-checked against the workspace for `README.md`, `apps/pot/.env.local`, `packages/contracts/.env`, `apps/pot/lib/server/chain.ts`, and `docs/production-readiness.md`. It predates this handoff file; the workspace copy of `HANDOFF.md` is saved separately. The copy excludes `.git`, dependency folders, and generated build/cache output. Existing dirty and untracked files were not cleaned or restored.

## Old Testnet Deployment

Read-only verification used Monad Testnet, chain id `10143`. At block `70223952` (Unix timestamp `1791755697`), all nine configured addresses matched the Foundry broadcast artifact and had deployed bytecode. Addresses are public; no private key is included.

| Contract | Old address | Immutable role(s) confirmed |
|---|---|---|
| TestRupee | `0xcc29aa71b0f98c90af219c2cdc9cbad68b86bdaa` | None |
| PotManager | `0x2818b52178840ef546fc728c12daec39be235968` | `trustSigner` = trust-signer address below |
| SocialPay | `0x4f407850a04286c6d2362c311e70586cc73e1133` | `arbitrator` = deployer address below |
| Gift | `0xeb89662b92c881adef9f5c410f357fc1dc3b0d5d` | No immutable platform role |
| BehaviourSavings | `0x008a65aa1de78fe2551427f17e63d2881af29930` | `admin` = deployer address below |
| AccountabilityPool | `0x14cd8532b4aa4ef5e583ceb82db7ec29e5517994` | `attester` = trust-signer address below |
| SalaryStream | `0x208fdb568cf949fb7fdc02d74ed9811249e73974` | No immutable platform role |
| IncomeShare | `0x80340b46ab439c722e0c990f532f94c90a7cf2ef` | `recorder` = trust-signer address below |
| MicroCover | `0x380491ffd851602100adbbf855ff403623db5816` | `insurer` = deployer; `insurerSigner` = trust signer |

Public role addresses read from the contracts:

- Trust signer: `0xbe4AD8Cc900e5824440526E7669a82881c661D94`
- Deployer/treasury: `0xD6A07f0aE71CE9a8f36f0d50Cd907aC652c0EDA7`

The trust signer authorizes Pot joins (still requires the invite code), signs AccountabilityPool attestations and MicroCover claims, and is the IncomeShare recorder. IncomeShare repayment records still require the recipient's signature. The server writer implements `IncomeShare.recordRepayment`; it does **not** implement `MicroCover.activatePolicy`.

The deployer controls SocialPay arbitration (requires a second matching vote), BehaviourSavings verifier administration, and the MicroCover insurer role (bind/decline policies, remit premiums, withdraw only uncommitted reserve). None of these addresses is an upgradeable proxy. Changing environment variables does not revoke old roles.

## Existing State Snapshot

At block `70223952`:

- PotManager `potCount`: 5; two distinct member addresses across the five pots.
- Pots 1 and 2: Closed, one member each, 5,000 paise contributed each, zero current pot balance.
- Pots 3 and 4: Collecting, one member each, no contributions.
- Pot 5: Collecting, one member, 200,000 paise contributed and held (INR 2,000 in test money).
- Aggregate PotManager balance: 200,000 paise; no pending repayment was reported in the captured output. Pot 5's target, deadline, and exact reserved amount still need a clean follow-up read.
- SocialPay payments, Gift records, BehaviourSavings goals, AccountabilityPool pools, SalaryStream streams, IncomeShare agreements, and MicroCover policies: all zero at that snapshot. Their TestRupee contract balances were zero; MicroCover reserve, committed reserve, and remittable premium were zero.
- The browser showed a named pot for id 4; names are offchain and were intentionally not copied into this handoff. The public-chain snapshot also contained pot 5, so the app session did not represent every address's full set of pots.
- A read-only Supabase probe confirmed `pots.invite_code` is absent and anonymous selection from `pots_private` returns zero rows. Exact row counts for pots, private invite records, profiles, and memos were not collected.
- Wallet-level TestRupee balances and the token total supply were not captured in the concise snapshot. Do not infer they are zero.

This is test money only. No balance was moved. TestRupee, PotManager state, and offchain metadata do not automatically transfer to fresh contract addresses.

## Dual-Deployment Consequences

Current app configuration has one address per contract in `apps/pot/lib/contracts.ts`. Pot query keys, routes, and store keys identify a pot by `potId` alone. Supabase `pots` and `pots_private` are also keyed by `pot_id`; browser storage uses `pot:meta:<id>`. A second PotManager starts its IDs again, so naïvely switching addresses would collide with old metadata and make old pots disappear from normal app navigation.

Recommended coexistence design, to validate before proposing a cutover:

1. Keep the old deployment registered as a legacy deployment and add the new deployment as a separate record keyed by `(chainId, contractAddress)`.
2. Include a deployment identifier or manager address in pot routes, invite authorization, query keys, event-index keys, and local-storage keys. Never accept an arbitrary manager address from a request; resolve only from a server allowlist.
3. Add manager address to `pots` and `pots_private` and use composite uniqueness with `pot_id`; migrate existing metadata without exposing or rewriting invite codes. Profiles can remain address-keyed; memos can remain hash-keyed, subject to access-control review.
4. Keep old pots readable. Old user-authorized operations may be needed to settle existing contributions; however, old joins cannot be made fully safe because the old immutable trust signer cannot be revoked. Keep old join authorization disabled unless the residual risk is explicitly accepted.
5. Make new pot creation and other new activity use only the new deployment. Index old and new contracts separately. Do not migrate balances or claim that contract storage has been transferred.
6. Prefer reusing the existing test token in an isolated test deployment if the goal is to preserve wallet balances; this requires a deployment path that accepts an existing token. A fresh token would make old wallet balances invisible in the new app. In either design, Pot 5's 200,000 paise remains in the old PotManager until its old contract's rules return it.
7. Test the coexistence path on local Anvil/a fork with independent ephemeral test keys. This session did not deploy any fresh contracts, even to testnet.

No migration or cutover design has been implemented or proven yet. Existing policy, payment, gift, savings, pool, stream, and agreement records were empty at the snapshot, but the five Pot records and their metadata still need preservation planning.

## Changes Made In This Session

- `apps/pot/lib/server/chain.ts`: corrected a stale comment that claimed the server implements `MicroCover.activatePolicy`.
- `apps/pot/lib/server/env.ts` and `apps/pot/.env.example`: corrected trust-signer capability and immutability descriptions.
- `apps/pot/DEPLOY.md`: documented the verified roles, approval-gated recovery plan, Privy allowed-domain guidance, local-vs-production app URL status, and removed unsupported load-test claims. This file was already untracked in the incoming worktree.
- `apps/pot/app/(app)/cover/page.tsx`: removed a dead link to missing `/cover/new`; the page now states creation is unavailable in this demo.
- `apps/pot/app/(app)/agreements/page.tsx`: added an explicit unavailable-state page so the route is honest and non-broken when the feature is not yet implemented.
- `apps/pot/lib/nav/routes.ts`: synchronized the registry flag with the filesystem for `/agreements`.
- `README.md`: updated the contract list and test count; it already contained other user edits before this session.
- `docs/context.md` and `docs/security-audit.md`: marked their 2026-10-10 status/finding snapshots historical and linked current evidence.
- `docs/production-readiness.md`: added the current evidence log and open-work checklist.

No existing Playwright logs, screenshots, deleted routes, or untracked app work were removed or restored.

## Validation

Passed:

- `forge test --summary`: 408 passed, 0 failed across 11 suites.
- `pnpm --filter pot test`: 60 passed across 5 test files.
- `pnpm --filter pot typecheck`
- `pnpm --filter pot lint`
- `pnpm --filter pot build`: production build succeeded; route manifest showed no Agreements or Cover create/detail route.
- `git diff --check`
- Browser: authenticated home rendered; `/agreements` shows an unavailable state; `/cover` no longer exposes the dead CTA. Fresh Cover reload had no HTTP 4xx responses.
- Supabase anonymous read-only checks confirmed the invite-code split described above.

Not completed / failed or unavailable:

- Earlier `pnpm install` reported `ERR_PNPM_IGNORED_BUILDS`; the existing installation still passed tests/build. No dependency build scripts were approved.
- The standalone browser automation harness could not resolve Patchright; integrated browser checks worked.
- An extra detailed inventory script returned `outcome_unknown`; process inspection confirmed no matching Node inventory process remains. Use the summary above as the captured snapshot and rerun precise fields tomorrow.
- No E2E financial journey, load test, Vercel/Privy dashboard check, restore drill, analytics/monitoring setup, or production environment verification was completed.

## Resume Checklist

- [ ] Read this handoff and `docs/production-readiness.md`; do not echo secrets.
- [ ] Repeat a read-only snapshot at the current Monad Testnet block. Verify Pot 5's target, deadline, reservation, current state, and token balance; aggregate wallet token balances without logging participant addresses.
- [ ] Count Supabase rows for `pots`, `pots_private`, `profiles`, and `memos` without selecting names, invite codes, or memo text. Do not mutate the database.
- [ ] Build and locally test a dual-deployment data model: address-aware routes/query keys/storage, composite Supabase keys, old-pot read/settlement compatibility, and old-join disablement. The new activity schema keys events by chain and manager, but this is not a complete dual-deployment migration.
- [ ] Test fresh contracts only in isolated local Anvil/fork state with independent ephemeral keys; do not broadcast to Monad Testnet.
- [ ] Document the residual risk and tradeoffs; request separate approval before any public deployment, role rotation/revocation, app cutover, migration, or financial operation.
- [ ] Apply and verify the activity migration only in an approved isolated database, run the protected indexer there, and test authorization, pagination, retries, checkpoint mismatch, and concurrency.
- [ ] Continue remaining feature work: indexed Pot discovery; Pot edit/leave semantics; Agreements UI; Cover create/detail with licensed partner boundary; authenticated E2E; monitoring/analytics; environment separation; restore drill; measured load tests above 60 readers.

## First Step Tomorrow

Start with a **read-only current-state inventory**, not a deployment: open this file, change to `packages/contracts`, confirm `cast chain-id --rpc-url monad_testnet` returns `10143`, then re-read PotManager ids 1–5 and all seven other contract counters/balances at one recorded block. Capture Pot 5's exact target, deadline, reserved amount, and held balance without printing member addresses. Do not run `forge script --broadcast`, change `.env.local`, apply the Supabase migration, or touch provider dashboards until the coexistence design and approval gate are resolved.
