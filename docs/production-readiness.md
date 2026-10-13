# Production Readiness Record

Status as of 2026-10-12. This is an evidence log, not a claim that the app is
production-ready. Contract roles and provider settings must be handled as
separate approval gates.

## Continuation Checklist

| Requirement | State | Evidence / blocker |
|---|---|---|
| Preserve the incoming worktree | Done locally | Snapshot saved outside OneDrive at `C:\Users\Sir\AppData\Local\PotBackups\pot-current-20261012-135613`; includes ignored environment files. No user changes were cleaned or restored. |
| Contain accidental use of the compromised trust signer | Implemented and unit-tested locally | `TRUST_SIGNER_ENABLED` defaults off; the known legacy signer address is refused even if enabled; startup no longer requires the key while disabled; trust routes map this to 503. This does not revoke the key or change any deployed server. |
| Replace reconstructed Pot history and all-pot discovery scan | Implemented locally; not deployed or database-tested | Added a finalized-block indexer, private member lookup index, authenticated discovery/history APIs, finalized membership rechecks, timestamps, transaction references, separate deposits, and catch-up UI. The migration is unapplied and the worker has not run against Supabase. |
| Verify Monad finality behavior | Read-only verified | Testnet RPC returned chain id 10143 and a finalized block. Monad's official RPC docs identify `finalized` as the irreversible settlement boundary and document provider-specific `eth_getLogs` limits. |
| App tests, lint, typecheck, production compilation | Passed locally | App suite: 77 tests across 11 files; lint and typecheck passed; isolated Next production build passed with the new discovery route. No authenticated financial journey was run. |
| Contract test suite | Blocked locally | `forge` is not installed or on PATH; WSL is not installed. No contract source changed. |
| `NEXT_PUBLIC_APP_URL`, Privy allowlist, OAuth, and fee sponsorship | Not independently verified | Vercel project is not linked locally and dashboard access was unavailable. The local URL remains blank; no provider setting was changed. |
| Development/production separation, monitoring, analytics, backups, restore | Open | No verified isolated staging project, production telemetry, analytics config, or restore drill. Requires provider/database access and privacy/security review. |
| Progressive load test above 60 readers | Open | No reproducible benchmark exists. Public RPCs are rate-limited; run only against an authorized dedicated endpoint or local fork, not by stressing the shared public RPC. |
| Key rotation, contract authority change, database migration, production cutover | Approval/access blocked | No key or role was changed; no live migration, deployment, contract write, financial action, or data deletion was performed. |
| Agreements, Cover, pot edit/leave, E2E, monitoring, analytics, restore, load test | Open | These need contract semantics, signer/partner decisions, provider access, or broader implementation and validation; details remain below. |

Files changed in this continuation: `HANDOFF.md`, `README.md`,
`apps/pot/.env.example`, `apps/pot/.gitignore`, `apps/pot/README.md`,
`apps/pot/DEPLOY.md`,
`apps/pot/eslint.config.mjs`, `apps/pot/next.config.ts`,
`apps/pot/app/api/internal/pot-index/route.ts`,
`apps/pot/app/api/pots/activity/route.ts`, `apps/pot/app/api/pots/route.ts`,
`apps/pot/app/api/trust/attest-behaviour/route.ts`,
`apps/pot/app/api/trust/attest-condition/route.ts`,
`apps/pot/app/api/trust/attest-day/route.ts`,
`apps/pot/app/api/trust/attest-income/route.ts`,
`apps/pot/app/api/trust/attest-oracle/route.ts`,
`apps/pot/app/api/trust/authorize-action/route.ts`,
`apps/pot/app/api/trust/record-repayment/route.ts`,
`apps/pot/app/api/trust/verify-employer/route.ts`,
`apps/pot/app/(app)/page.tsx`, `apps/pot/app/(app)/pot/[id]/page.tsx`,
`apps/pot/components/pot/activity-feed.tsx`,
`apps/pot/lib/activity.ts`, `apps/pot/lib/activity.test.ts`,
`apps/pot/lib/env.ts`, `apps/pot/lib/env.test.ts`,
`apps/pot/lib/queries.ts`, `apps/pot/lib/server/chain.ts`,
`apps/pot/lib/server/database.types.ts`, `apps/pot/lib/server/env.ts`,
`apps/pot/lib/server/env.test.ts`, `apps/pot/lib/server/indexer-auth.ts`,
`apps/pot/lib/server/indexer-auth.test.ts`, `apps/pot/lib/server/logging.ts`,
`apps/pot/lib/server/logging.test.ts`, `apps/pot/lib/server/nonce.ts`,
`apps/pot/lib/server/pot-indexer.ts`, `apps/pot/lib/server/route-kit.ts`,
`apps/pot/lib/server/trust.ts`, `apps/pot/lib/tx.ts`,
`apps/pot/lib/tx.test.ts`, `docs/production-readiness.md`, `docs/tech.md`,
`supabase/migrations/20261012_pot_activity_index.sql`.

Commands and results in this continuation:

- `pnpm --filter pot test`: final 77 passed across 11 files.
- Focused Vitest runs: signer gate 5 passed; transaction error sanitization 2 passed; activity event mapping 1 passed; indexer authorization 2 passed.
- `pnpm --filter pot typecheck`: passed after implementation and after restoring the original `tsconfig.json`.
- `pnpm --filter pot lint`: passed with no warnings after removing one unused import.
- `NEXT_DIST_DIR=.next-validation pnpm --filter pot build`: final production build passed; routes include `/api/pots`, `/api/pots/activity`, and `/api/internal/pot-index`. The normal `.next` directory was left untouched because Windows returned `EPERM` while unlinking an existing route artifact.
- Browser: local home rendered the Google sign-in screen; no console errors or failed asset/API requests were captured on a fresh load. No sign-in or financial action was performed.
- Browser: at a 390 px mobile viewport, the sign-in screen had no horizontal overflow. This does not verify signed-in screens or financial actions.
- Browser: unauthenticated GETs to `/api/pots` and `/api/pots/activity?potId=1` returned 401 without exposing data.
- `pnpm --filter contracts test --summary`: could not start because Foundry is unavailable. WSL installation was declined/cancelled; no system tooling was installed.

## Security Incident

Treat `TRUST_SIGNER_KEY` and `DEPLOYER_KEY` as compromised. Their values are
not recorded here. Neither key has been rotated, and no contract authority,
deployment, provider configuration, or financial state has been changed.

Read-only checks confirmed chain id 10143, deployed code at all nine configured
contract addresses, and immutable role bindings:

| Key | Roles confirmed on testnet | Risk boundary |
|---|---|---|
| `TRUST_SIGNER_KEY` | Pot join authorizer, accountability-pool attester, income-share recorder, insurance claim signer | The key signs outcomes. A pot join still needs the invite code; income-share repayment still needs the recipient's signature; claim signatures are bounded by the policy and reserve. |
| `DEPLOYER_KEY` | SocialPay arbitrator, BehaviourSavings admin, MicroCover insurer | Arbitration needs a matching vote from another participant; verifier configuration can be changed; the insurer can bind or decline policies, remit premiums, and withdraw uncommitted reserve. |

All these contract roles are immutable. Replacing a local environment value
will not revoke the old signer and may break legitimate app actions. Containing
the deployed roles requires fresh contracts after explicit approval. Existing
contract state does not migrate automatically; old deployments remain
authoritative and readable. The deployed asset is test money only.

No key rotation, authority revocation, contract migration/deployment, deletion,
or production setting change will be performed without a separate approval
after its consequences are reviewed.

## Verified

- A local preservation copy was made outside the repository before edits; it
  includes ignored environment files and user-created artifacts.
- `packages/contracts`: the previous recorded `forge test --summary` completed
  with 408 passed across eleven suites; Foundry was unavailable for a rerun in
  this continuation.
- `apps/pot`: final test suite has 77 passing tests; typecheck and lint passed.
- `apps/pot`: the final isolated production build succeeded with the new
  discovery and activity API routes. Agreements remains an unavailable-state
  page; Cover create/detail routes remain absent.
- The local browser rendered the unauthenticated sign-in screen. Authenticated
  pages and financial journeys were not tested.
- Public Supabase API probe: `pots.invite_code` is absent; anonymous selection
  from `pots_private` returns zero rows.
- Read-only browser checks confirmed `/agreements` is an unavailable-state
  page, and `/cover` no longer links to its missing creation route. A fresh
  Cover reload had no HTTP responses with status 400 or higher.
- The local `NEXT_PUBLIC_APP_URL` is blank. Vercel's production value and the
  Privy dashboard's allowed origins/OAuth redirects were not accessible and
  remain unverified.
- Source now refuses trust-signing and signer-backed writes by default until
  `TRUST_SIGNER_ENABLED=true`; the known compromised legacy signer is rejected
  regardless of that flag. This is only a source change until a reviewed app
  deployment is explicitly approved. It does not revoke the old immutable
  contract role or stop a different server still running old code.
- A local finalized-event indexer and member-scoped paginated activity API are
  implemented. Their migration is not applied to Supabase, the worker has not
  been run, and history on any deployed app is not verified.
- A local browser loaded the unauthenticated sign-in page successfully.
  Unauthenticated requests to both new Pot APIs returned 401. Authenticated
  screens, contract actions, and complete user journeys remain unverified.

## Open Work

| Area | Current evidence | Required next work |
|---|---|---|
| Key containment | Both exposed key identities map to live immutable testnet roles; local source now fails closed for trust signing. | Obtain explicit approval for rotation/redeployment. The source guard is not deployed revocation; do not merely replace env values. |
| User journey tests | Contract tests pass; browser home rendered; financial journeys were not exercised. | Add and run non-production E2E flows for pot create/join/deposit/repay/approve/close, with duplicate-submit, RPC failure, auth and authorization coverage. |
| Pot controls | `PotManager` has no edit or leave action. | Decide contract semantics for edits and leaving before implementing UI; preserve existing contribution/refund invariants. |
| Activity history | Local event mapper, finalized indexer, cursor API, DB schema, and UI are implemented and unit-tested. Migration is unapplied; no event data has been indexed. | Review/apply migration only in an authorized isolated database, run the indexer there, test finality/checkpoint failure behavior and authorized pagination, then schedule and monitor it in a verified deployment. Do not claim deployed history yet. |
| Discovery scalability | Local source uses an authenticated private member index and rechecks candidate membership at the finalized block; the migration is unapplied. | Apply and verify the schema in an approved isolated database, run index catch-up, and exercise stale-index/error states before relying on this path in a deployment. |
| Agreements | UI route exists and shows an unavailable-state page; the contract and trust route also exist. | Implement create/detail/repayment flows only after signer authority and recipient consent are covered by tests. |
| Cover | `/cover` exists; create/detail routes remain unavailable in this demo. An insurer partner is also required for real cover. | Do not represent the prototype as insurance; design the flow with a licensed partner and correct insurer signing infrastructure. |
| Gift conditions | The contract verifies the named attester's signature, not the real-world event itself. The signer is now disabled by default in local source. | Keep gift conditions explicitly unverified unless a real evidence source and independent adjudication process are implemented; add replay/authorization tests before making any verification claim. |
| Yield | No yield contract, custody provider, investment strategy, risk controls, or verified rate source exists. Pot is test money and principal-return logic, not an investment product. | Reject yield for this product scope; do not display or imply a return. Revisit only with a licensed/authorized provider, legal review, risk disclosures, and independently verified rates. |
| Peer-vouching | Pot already has explicit member approval for above-limit/self repayments; no verified social graph exists. | Reject peer-vouching as unnecessary for the core flow and privacy/coercion risks. Do not collect social graph data without evidence that it is essential and consented. |
| Production operations | No verified Vercel settings, Privy origins, production/development split, monitoring, analytics, or tested restore procedure. | Account access is required to inspect actual deployed settings; establish isolated environments, privacy-conscious monitoring and backup/restore drills before enabling users. |
| Load and RPC | No reproducible load test above 60 concurrent readers was found. | Add progressively increasing read/write load tests with measured latency, error rate and RPC limits; retain the test artifact. |
| Worktree artifacts | Many untracked Playwright logs/screenshots and route changes are present. | Preserve them. Review ownership and sensitivity before any cleanup; do not delete or restore files without approval. |

## Changes and Checks In This Pass

- Corrected `apps/pot/lib/server/chain.ts` so its comment no longer claims
  `MicroCover.activatePolicy` is implemented by the server writer.
- Corrected the trust-key descriptions in `apps/pot/lib/server/env.ts` and
  `apps/pot/.env.example` to reflect deployed permissions and immutability.
- Updated `apps/pot/DEPLOY.md` with the read-only role map, safe approval gate,
  verified invite-code protection, official Privy guidance, and withdrawn
  unsupported load-test claim.
- Removed the Cover action that linked to a missing route; the page now states
  that policy creation is unavailable in this demo.
- Added the Agreements unavailable-state page and synced the route registry so
  the feature list matches the filesystem.
- Updated `README.md` from the stale test total to the verified 408 tests
  across eleven suites and listed `AccountabilityPool.sol`.
- Marked the 2026-10-10 context and security-audit documents as historical so
  their obsolete deployment and vulnerability claims are not mistaken for
  current findings.
- `pnpm --filter pot typecheck` passed after the server-module correction.
- `pnpm --filter pot test`, `pnpm --filter pot typecheck`,
  `pnpm --filter pot lint`, `pnpm --filter pot build`, and
  `git diff --check` passed.
- No contract source or live testnet state was changed in this pass.