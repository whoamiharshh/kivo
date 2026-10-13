# Deploying Pot

Everything below has been checked against the app as it stands. Nothing here
is aspirational.

## Before you push

### 1. Compromised keys: approval required

Treat both local signing keys as compromised. Their values are intentionally
not repeated here. No key rotation, authority revocation, deployment, or
production configuration change has been performed.

Read-only verification on 2026-10-12 confirmed Monad Testnet (chain 10143),
deployed bytecode at all nine configured contract addresses, and these role
bindings:

| Local key | Deployed permissions | Important limits |
|---|---|---|
| `TRUST_SIGNER_KEY` | `PotManager.trustSigner`, `AccountabilityPool.attester`, `IncomeShare.recorder`, `MicroCover.insurerSigner` | Pot joins still require the invite code; repayment records still require the recipient's signature; insurance signatures are bounded by policy terms and collateral. |
| `DEPLOYER_KEY` | `SocialPay.arbitrator`, `BehaviourSavings.admin`, `MicroCover.insurer` | Arbitration requires a second matching vote; the savings admin can change verifier settings; the insurer can remit premiums and withdraw only uncommitted reserve. |

The trust signer is also used by the server to submit `IncomeShare.recordRepayment`.
The current server code does not implement a `MicroCover.activatePolicy`
write. All listed contract roles are constructor-set immutables. **Changing an
environment variable does not revoke the exposed key.** It can instead break
server actions while the old key remains authoritative. Revocation for these
deployments requires new contracts; existing state and balances do not move to
them automatically.

Rotation/redeployment is blocked until the human explicitly approves it after
reviewing consequences. The safe plan is to assign independent, newly
generated keys to the server signer and deployer/treasury roles; deploy fresh
contracts only after approval; read back code and every immutable role; test
the new deployment separately; and cut the app over only after its provider
settings are verified. Leave old contracts readable and untouched. They remain
under the exposed authorities, and do not migrate balances or user state
without a separate approved plan. The deployed token is test money, not a
real-money asset; this does not reduce the need to contain the credentials.

### 2. Supabase row-level security

The migrations in `supabase/migrations/` set RLS policies. A read-only check
against the configured public API on 2026-10-12 found no `invite_code` column
on `pots`, and an anonymous query of `pots_private` returned zero rows. This
confirms the invite-code split on that API, not every table policy or backup
setting. Review the remaining policies against the current production data
before enabling real users.

## Vercel

### Project settings

- **Root directory:** `apps/pot`
- **Framework preset:** Next.js (detected)
- **Build and install commands:** leave as detected — this is a pnpm workspace
  and Vercel handles it

### Environment variables

Set all of these in **Project → Settings → Environment Variables**, for
Production *and* Preview. Copy the values from `apps/pot/.env.local`.

Public — compiled into the browser bundle, not secret:

```
NEXT_PUBLIC_PRIVY_APP_ID
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_DEPLOY_BLOCK
NEXT_PUBLIC_POT_MANAGER_ADDRESS
NEXT_PUBLIC_TEST_RUPEE_ADDRESS
NEXT_PUBLIC_SOCIAL_PAY_ADDRESS
NEXT_PUBLIC_GIFT_ADDRESS
NEXT_PUBLIC_BEHAVIOUR_SAVINGS_ADDRESS
NEXT_PUBLIC_SALARY_STREAM_ADDRESS
NEXT_PUBLIC_INCOME_SHARE_ADDRESS
NEXT_PUBLIC_MICRO_COVER_ADDRESS
NEXT_PUBLIC_ACCOUNTABILITY_POOL_ADDRESS
NEXT_PUBLIC_ARBITRATOR_ADDRESS
```

Secret — server only. None of these may ever be renamed into a
`NEXT_PUBLIC_` variable:

```
PRIVY_APP_SECRET
PRIVY_VERIFICATION_KEY
SUPABASE_SECRET_KEY
TRUST_SIGNER_ENABLED      ← keep false until an approved replacement is deployed and verified
TRUST_SIGNER_KEY          ← replacement only after the approved rotation plan
IP_HASH_SALT
POT_INDEXER_SECRET        ← only after the index migration and protected job are configured
```

One that is **blank in the local `.env.local`** and must be set for a deployed
origin. The Vercel value was not available for verification:

```
NEXT_PUBLIC_APP_URL       ← the deployed origin, e.g. https://pot.vercel.app
                            The trust routes compare each request's Origin
                            against it as an additional allowed origin. The
                            guard also allows the request's own origin; set
                            this explicitly for a canonical origin behind a
                            proxy and verify the deployed value.
```

Optional, worth setting before any group test:

```
NEXT_PUBLIC_RPC_URL       ← a dedicated Monad testnet endpoint. Unset, the app
                            falls back across public endpoints. Provider rate
                            limits vary; no reproducible concurrent-reader
                            benchmark is checked in.
TRUST_IP_MAX_PER_MINUTE   ← defaults to 240. Raise it if a room of testers
                            behind one address starts seeing 429s.
```

## Immediately after the first deploy

### Privy — verify the deployed domain

The Privy dashboard settings and deployed login have not been independently
verified. In **Configuration → App settings → Domains**, allow only the exact
production origin. Do not allow a generic `*.vercel.app` domain; Privy's
current guidance says these can be claimed by unrelated projects. Configure
the exact OAuth redirect URL separately under **Advanced**. Keep localhost
out of the production app's allowlist. Confirm fee sponsorship for Monad
Testnet (10143) in the dashboard before any live action test.

Official references checked 2026-10-12:
[Privy allowed domains](https://docs.privy.io/recipes/dashboard/allowed-domains),
[Privy OAuth redirects](https://docs.privy.io/recipes/react/allowed-oauth-redirects),
[Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables).
Next.js inlines `NEXT_PUBLIC_*` values at build time, so production values must
be set for the production build, not changed only after deployment.

### Smoke test the live URL

In this order, on a phone if you can:

1. Sign in with Google
2. Get ₹5,000 test money
3. Create a pot
4. Add money to it — the card should visibly fill
5. Close it, and check the money comes back

If step 2 fails it is sponsorship or the domain allowlist, in that order.

`node scripts/flow-check.mjs` walks the same lifecycle against the contracts
directly, so you can tell a broken app from a broken chain in one command.

## What to tell a judge

The honest framing, because it is checkable and therefore stronger than a
claim that is not:

- Nine contracts have deployed bytecode on Monad Testnet. This is not a
  production deployment.
- Routes exist for Pot, Pay, Gifts, Savings, Pools, Streams and Cover; full
  user journeys have not been independently verified end to end.
- Agreements has a contract and server route, but no user-facing route. Cover
  creation and policy detail routes are also missing.
- The local source now includes a finalized-block Pot event indexer and a
  member-checked paginated history API. Its migration has not been applied,
  the worker has not run, and no deployed environment serves indexed history.
- Test money only. Nothing has real value.
- Behaviour goals and group commitments are **self-reported** — nothing reads
  a step count or any health data, and the screens say so.
- Pot history is not yet available in a deployed environment. The client no
  longer presents synthesized current state as dated history; it requires the
  unapplied server index and shows an error/catching-up state instead. Pot
  discovery still checks every contract pot ID from the client.
- Income share agreements have contracts and a trust route, but no screens.

## Known limits, stated rather than hidden

- **No deployed event indexer or measured load test.** Local indexer code and a
  migration exist, but neither has been applied or run. The former claim of 60
  concurrent readers without failures has no reproducible test artifact and is
  withdrawn.
- **Pot editing and leaving** are not contract actions and have no verified
  end-to-end flow.
- **Production operations** (Vercel variables, Privy origins, monitoring,
  analytics, backup recovery, and separate environments) remain unverified.
