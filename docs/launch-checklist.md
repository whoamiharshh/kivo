# Launch checklist — solo, zero budget, cutoff 14 Oct 09:30

Everything here uses free tiers. Times are IST and assume the cutoff is
**Wednesday 14 Oct 2026, 09:30 IST**. If that is wrong, tell me and the
schedule shifts.

**Free things used:** GitHub (free), Vercel Hobby (free; it is meant for
personal, non-commercial use — a hackathon prototype on test money fits, but
read its terms if this ever turns into a business), Supabase free tier, Privy's
free developer plan, Monad testnet MON from the faucet (free, worthless),
Foundry. Nothing here needs a card. Free tiers have limits I have not measured
here, so treat "free" as "free for a demo", not "free at scale".

---

## 0. The order that matters

```
GitHub (safe to push) ─┐
2 fresh keys ──────────┼─► deploy contracts ─► env vars ─► Vercel ─► Privy domain
faucet MON ────────────┘            │                                    │
rotate Supabase + Privy secrets ────┘                                    ▼
                                                           preflight ─► flow-check
                                                                          │
                                         Antigravity polish ─► 5 phones ─► 5 real people
                                                                          │
                                                        video + README ─► submit
```

Don't start a step before the ones above it are done. The most common way to
lose a day is to skip down to Vercel before the contracts exist.

---

## 1. GitHub — what is already safe, and what to do

**Audit done (read-only), result:**

- Your real secrets are **not** in the repo. I searched for the exact values of
  all six (`TRUST_SIGNER_KEY`, `DEPLOYER_KEY`, `SUPABASE_SECRET_KEY`,
  `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY`, `IP_HASH_SALT`) in every tracked
  file, every un-ignored file, and all 8 commits: **none found**. No `.env` file
  was ever committed.
- The `.env` files are git-ignored. The repo is small (about 4 MB).
- There is **no GitHub remote yet**, so nothing has been pushed anywhere.
- `.gitignore` is fixed so tool captures and notes are not published
  (`.playwright-mcp/`, `.remember/`, `.backup/`, the stray zip, `_spec/`).

**Do this (about 15 minutes).**

1. On github.com create a new repository. Name it `pot`. Choose **Private** for
   now. Do **not** add a README or licence (the repo already has them).
2. In the repo folder, in PowerShell:

```powershell
# remove already-tracked junk from git's index ONLY (the files stay on your disk)
git rm -r --cached .playwright-mcp "files (2).zip" _spec

git status --short        # READ THIS LIST. Expect: source, docs, supabase/, scripts. No .env.
git add -A
git commit -m "Pot: group money pots with deadlines, refunds and approvals (test money)"

git branch -M main
git remote add origin https://github.com/<your-username>/pot.git
git push -u origin main
```

3. **Before the push**, tell me "committed". I will re-run the secret check against
   the new commit. It takes a minute and is the cheap insurance.

When the hackathon needs a public link, change the repo to **Public** in
Settings → General → Danger Zone, *after* a last look. A public repo cannot be
un-published.

---

## 2. Keys and secrets (you — never in chat)

| Step | How | Done |
|---|---|---|
| Two fresh keys | `cast wallet new` twice. One is the **deployer**, one the **server signer**. Keep each only in its own terminal window. | ☐ |
| Import the deployer | `cast wallet import pot-deployer --interactive` | ☐ |
| Faucet MON | Send to the **deployer address**. About 4 MON for the deploy; the simulation prints the exact need. Also ~0.5 MON to a third throwaway address for `flow-check-safe`. | ☐ |
| Rotate Supabase | Dashboard → Project Settings → API → regenerate the service/secret key | ☐ |
| Rotate Privy secret | Privy dashboard → your app → Settings → regenerate the app secret | ☐ |
| Store the signer key | **Only** in Vercel's environment settings and your local `.env.local` (git-ignored). Never in a file you commit. | ☐ |

---

## 3. Deploy the contracts (needs your go — you gave it)

Follow `docs/fresh-deployment-plan.md` §4 exactly: **simulate first**, read it,
then broadcast. Then:

1. Read all 7 roles back (`cast call …`, plan §4).
2. Put the nine addresses and the deploy block in `.env.local`.
3. `node --env-file=.env.local --no-warnings scripts\preflight.mjs` → must say
   plain **READY**.
4. `scripts\flow-check-safe.mjs`: dry run, read, then `--send --yes`.

(Tell me the simulation output and the addresses and I'll check them against the
plan before you broadcast.)

---

## 4. Vercel (free) — one thing differs from a normal project

This repo is a **pnpm monorepo** and the app lives in `apps/pot`.

1. vercel.com → sign in **with GitHub** → *Add New → Project* → import `pot`.
2. **Root Directory:** `apps/pot`. Framework: Next.js (auto-detected). Leave the
   build and install commands at their defaults.
3. **Environment variables** (Production *and* Preview). Names only:

```
NEXT_PUBLIC_PRIVY_APP_ID
PRIVY_APP_SECRET   PRIVY_VERIFICATION_KEY
NEXT_PUBLIC_SUPABASE_URL   NEXT_PUBLIC_SUPABASE_ANON_KEY   SUPABASE_SECRET_KEY
IP_HASH_SALT
TRUST_SIGNER_KEY   TRUST_SIGNER_ENABLED = true   (only after preflight is READY)
NEXT_PUBLIC_APP_URL                        ← your final https://…vercel.app address
NEXT_PUBLIC_DEPLOY_BLOCK
NEXT_PUBLIC_TEST_RUPEE_ADDRESS     NEXT_PUBLIC_POT_MANAGER_ADDRESS
NEXT_PUBLIC_SOCIAL_PAY_ADDRESS     NEXT_PUBLIC_GIFT_ADDRESS
NEXT_PUBLIC_BEHAVIOUR_SAVINGS_ADDRESS   NEXT_PUBLIC_SALARY_STREAM_ADDRESS
NEXT_PUBLIC_INCOME_SHARE_ADDRESS   NEXT_PUBLIC_MICRO_COVER_ADDRESS
NEXT_PUBLIC_ACCOUNTABILITY_POOL_ADDRESS   NEXT_PUBLIC_ARBITRATOR_ADDRESS
```

4. **The install, and what was already fixed.** A from-scratch install of exactly
   what git will commit **failed** at first with `ERR_PNPM_IGNORED_BUILDS` — five
   optional native build steps that pnpm 12 refuses to skip silently. That would
   have failed Vercel's install step too. It is fixed in `pnpm-workspace.yaml`
   (the five are explicitly declined; the lockfile is unchanged), and the clean
   copy then installed and **built with exit 0 and no environment variables**.
   - The repo pins `pnpm@12.10.1`; Vercel's own pnpm support is documented up to
     v10. Tested here: pnpm 10 hands over to the pinned 12.10.1 and installs
     fine, so **no extra setting should be needed**.
   - **Only if the first Vercel build fails at the install step with a
     pnpm-version message**, add the variable `ENABLE_EXPERIMENTAL_COREPACK = 1`
     (it makes Vercel use exactly the pinned version) and redeploy. I could not
     test Vercel itself from here, so that is a fallback, not a prediction.
   - If neither works, paste me the first error line.
5. `NEXT_PUBLIC_*` values are baked in at **build** time. After you change any,
   **redeploy** — saving the value alone does nothing.
6. Note the production address (`https://<project>.vercel.app`). Put it in
   `NEXT_PUBLIC_APP_URL` and redeploy once.

**Do this early** (even before the contracts exist): create the project so you
know the final URL, which Privy needs.

---

## 5. Privy (free)

- Login methods: **Google only**.
- Allowed domains: add the **exact** production URL, e.g.
  `https://pot-yourname.vercel.app`. **Do not** add `*.vercel.app` — other
  people's projects share that suffix.
- Set the OAuth redirect URL separately under *Advanced*.
- Fee sponsorship: enable it for **Monad Testnet (10143)**. Monad's docs say
  Privy subsidises testnet usage; confirm it is on in *your* dashboard, and check
  whether it is restricted to specific contract addresses (if so, add the new ones).

---

## 6. Supabase (free)

- After exporting them, clear only the old `pots` and `pots_private` rows
  (plan §7) — a fresh deployment numbers pots from 1 again.
- Apply nothing else. The activity migration is **not needed** and is not used.

---

## 7. Schedule (IST)

| When | What |
|---|---|
| **Tonight, now → ~03:00** | GitHub push (private) · create the Vercel project (to learn the URL) · send the questionnaire to ~20 friends · line up 5 testers · generate the 2 keys · rotate Supabase + Privy secrets · **then sleep** |
| **13 Oct 09:00–12:00** | Faucet MON → simulate → broadcast deploy → role read-back → env → `preflight` READY → `flow-check-safe` |
| **12:00–14:00** | Redeploy on Vercel · Privy domain · you do one full run alone on the live site |
| **14:00–17:00** | **Antigravity polish** on a branch (3 h, hard stop). I then re-run the four checks and review its diff |
| **17:00–18:30** | **Phase A**: 5 phones, on the *polished* build (`docs/five-phone-test.md`) |
| **18:30–21:30** | **Phase B**: 5 real people. Record results honestly |
| **21:30–00:30** | Demo video (3 min), README, pitch |
| **00:30–03:00** | Submission form filled; everything re-checked; sleep |
| **14 Oct 07:00–09:00** | Final live check of the URL, repo and video. **Submit by 08:30.** Cutoff 09:30 |

**Safety rule for the last 12 hours:** after 21:30 on 13 Oct, change copy and
docs only. No new code. A last-minute fix is how a working demo dies.

---

## 8. What you submit (solo)

- A live URL that works on a phone, with test-money disclosure visible.
- The GitHub link (public by then, if required).
- A ~3-minute video: (1) a friend joins from a WhatsApp link; (2) the pot fills
  and repays someone; (3) a second pot misses its deadline and refunds; (4) the
  real results from your testers — including what went badly.
- A short README: the problem, who it's for, how it works, what is real and what
  is not (test money; Cover and Agreements limits), known limitations.
- Team: **solo founder** — say so plainly.

Claims allowed: only what the sessions and the questionnaire actually showed.
No market-size, demand, or user-number claims beyond that.

---

## 9. If something goes wrong

| Problem | What to do |
|---|---|
| Vercel install fails | Add `ENABLE_EXPERIMENTAL_COREPACK=1` and redeploy (see §4); if it still fails, send me the first error line |
| `preflight` says NOT READY | Read the first `FAIL`; it names the fix |
| Joins fail | `preflight` → "server signer … NOT the contract's trustSigner" |
| Deploy runs out of MON | The simulation prints the need; top up from the faucet and re-run |
| Tester can't get through sign-in | Privy domain / redirect; test the exact URL |
| 3 hours before cutoff and something is broken | Cut scope: show the pot story only, from a recording if needed. Never ship an untested change |
