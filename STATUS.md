# Pot: Status, Remaining Work, Deploy Readiness

## Update — 2026-10-13 (read this first; the older text below predates it)

What changed since the text below was written:

- **Foundry is installed** (1.8.5). Contract suite re-run today: **408 passed, 0 failed**.
- **App checks re-run today:** typecheck clean, lint clean, **119 tests pass**, production build passes.
- **Pot discovery and the activity feed now read straight from the contract** (no
  Supabase, no indexer). A repayment-numbering bug (off by one) was found and fixed
  with regression tests. See `docs/pot-discovery.md`.
- **Agreements and Cover now have working create / view screens** against the
  existing contracts. Actions that need the insurer or recorder are labelled
  unavailable and offer no button; nothing is simulated.
- **The old `flow-check.mjs` is disabled** (it signed with a compromised key).
  `apps/pot/scripts/flow-check-safe.mjs` replaces it and is a dry run by default.
- **New:** `apps/pot/scripts/preflight.mjs` (is this deployment wired correctly?),
  `docs/flow-check.md`, `docs/fresh-deployment-plan.md`, `docs/five-phone-test.md`,
  `docs/manual-verification.md`, `docs/antigravity-brief.md`.
- **Still true:** nothing has been deployed, no key rotated, nothing sent to the
  chain this session. **No new person can join a pot until fresh contracts and a
  fresh signer are live** — join needs the trust signer. That is the critical path.
- Uncommitted work is backed up. **Latest:**
  `C:\Users\Sir\AppData\Local\PotBackups\pot-uncommitted-20261013-003512`
  (everything, including the git history). Earlier, before the Cover and
  Agreements screens: `…\pot-uncommitted-20261012-233753`.

---

As of 2026-10-12. Facts come from `HANDOFF.md`, `apps/pot/DEPLOY.md` and
`docs/production-readiness.md`. Time figures are my estimates, not measured.

## Completed (verified locally)

- Contracts: 9 deployed to Monad Testnet (chain 10143), bytecode and roles read back. Contract suite last passed 408/408 (`forge` is not installed now, so not rerun today).
- App screens: Home, Pot detail, Savings, Pools, Streams, Gifts, SocialPay, route-aware nav, sign-in polish.
- Server hardening: zod env validation, 64KB payload cap, per-IP rate limit, origin check, nonce test, audit-log IP hashing.
- Trust signer is off by default (`TRUST_SIGNER_ENABLED`), and the leaked signer address is refused even if enabled.
- Finalized-block activity indexer and member-verified pot discovery: written as source only. The migration is not applied and the worker has not run.
- Checks passing: 77 app tests, lint, typecheck, production build, `git diff --check`.
- `apps/pot/DEPLOY.md` written. Local backup made (`PotBackups\pot-current-20261012-163802`).

## Not done

### Needs you (I cannot do these)
1. Rotate the exposed `TRUST_SIGNER_KEY` and `DEPLOYER_KEY`. Contract roles are immutable, so this means redeploying fresh contracts. That needs your explicit approval, new keys, and about 4 MON funding.
2. Rotate the Supabase service key and Privy app secret (both were exposed in an earlier transcript).
3. Vercel: link the project, set env vars (list in `DEPLOY.md`), set `NEXT_PUBLIC_APP_URL`.
4. Privy dashboard: add the deployed domain to the allowlist, and confirm Google login and fee sponsorship.
5. Apply the Supabase activity migration (and run the indexer) in a database you approve.
6. Click through every flow yourself and report what breaks.

### Needs me, after your go-ahead
- Dual-deployment support if old pots must keep working beside new contracts.
- Agreements UI, Cover create/detail, pot edit/leave.
- Authenticated end-to-end test of a money flow (never run so far).
- Install Foundry and rerun the contract tests.

### Not built or verified at all
Monitoring and analytics, staging/prod separation, backup restore drill, load test above 60 readers.

## Time estimate (rough)

| Goal | Estimate |
|---|---|
| Testnet demo deploy, current contracts, signer disabled | 1 to 2 hours, mostly your Vercel/Privy clicks |
| Same, plus fresh contracts and rotated keys, wired in and tested | 4 to 6 hours |
| Plus Agreements/Cover UI, E2E test, monitoring | 1 to 2 more days |

## Deploy checklist

- [ ] Decide: ship with the leaked keys for a throwaway demo, or rotate first
- [ ] New keys generated (never pasted into chat), funded
- [ ] Supabase and Privy secrets rotated
- [ ] Vercel: root `apps/pot`, all env vars set for Production and Preview
- [ ] `NEXT_PUBLIC_APP_URL` set to the deployed origin
- [ ] Privy: domain allowlisted, Google login works, sponsorship on
- [ ] Supabase RLS reviewed, activity migration applied if using the indexer
- [ ] Manual pass: sign in, get test money, create pot, join, repay, approve, close
- [ ] README and DEPLOY.md match what actually works

## Open risk to check first

With `TRUST_SIGNER_ENABLED=false`, the trust routes return 503. Pot joins use
the trust signer on-chain (`PotManager.trustSigner`), so joining and other
signer-backed actions may not work until a replacement signer is live. I have
not tested this end to end. Check it before relying on a signer-off deploy.
