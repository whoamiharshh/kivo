# Setting up a safe workspace for frontend work (Antigravity or anyone)

## The one rule that matters

**Do not open the main project folder in an AI IDE.** An AI tool reads every file
in the folder it is given — including `apps/pot/.env.local` and
`packages/contracts/.env`. Tomorrow those will hold your **fresh server signer
key** and your rotated Supabase and Privy secrets. A frontend tool needs none of
them.

So: work in a **separate copy that has no secrets in it.** It takes five minutes.

---

## Step by step

**1. Push the project to GitHub first** (`docs/launch-checklist.md` §1). The copy
comes *from* GitHub, so it can only contain what is safe to publish.

**2. Clone it into a new folder, away from the main one.** In PowerShell:

```powershell
cd C:\Users\Sir\Desktop        # anywhere that is not inside the pot folder
git clone https://github.com/<your-username>/pot.git pot-frontend
cd pot-frontend
git checkout -b frontend-polish
pnpm install --frozen-lockfile
```

(`pnpm install` works from a clean checkout; the five optional native build steps
are already declined in `pnpm-workspace.yaml`.)

**3. Create `apps/pot/.env.local` in the copy with PUBLIC values only** (the
list is in the section "To see the real screens" below). The old sample-data
design preview was removed on 2026-10-13, so without those values the app only
shows its setup notice. **Do not copy** any of: `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY`,
`SUPABASE_SECRET_KEY`, `TRUST_SIGNER_KEY`, `TRUST_SIGNER_ENABLED`,
`IP_HASH_SALT`, `DEPLOYER_KEY`, or the contents of `packages/contracts/.env`.

**4. Run it.**

```powershell
cd apps\pot
pnpm dev
```

Open **http://localhost:3000**. With only the public values below it shows the
sign-in screen; the signed-in screens need you to sign in by hand (next section).
A console warning that the configuration is incomplete is expected in a
workspace that deliberately holds no secrets.

**5. Open `AGENTS.md` and `docs/antigravity-brief.md` in the copy and give them to
the tool** as its instructions. Those files are in the repo, so the copy has them.

---

## What you can see without signing in

Only the sign-in screen. There is no sample-data page: the app never shows
invented pots, people or balances, so every other screen needs a signed-in person.
The screens live in `apps/pot/app/(app)/` and are built from the shared pieces in
`apps/pot/components/`.

### To see the real screens

Sign in **yourself**, by hand, in the browser the tool opens — an AI tool can't
complete a Google login, and you shouldn't want it to. For that you add, to the
copy's `.env.local`, only **public** values:

```
NEXT_PUBLIC_PRIVY_APP_ID            (a public identifier, not the secret)
NEXT_PUBLIC_DEPLOY_BLOCK  and the nine NEXT_PUBLIC_*_ADDRESS values
```

(after the fresh deploy), and Privy must allow `http://localhost:3000` as a
development origin. Then everything that runs in the browser works — sign in,
get test money, create a pot, add money. **Joining a pot will not work in this
copy**, on purpose: it needs the server signer key, which this copy doesn't have.
Test joining on the deployed site.

---

## What the tool must hand back

1. A **branch** (`frontend-polish`), not a change to `main`.
2. The list of files it changed.
3. Output of the four checks, all passing:
   `npm run typecheck` · `npm run lint` · `npm test` · `npm run build`

Push the branch to GitHub and tell me. I will, before anything is merged:
- read the diff for any change to logic, labels or the honesty notices,
- re-run the four checks and the secret scan,
- check the banned-words list against what a person can read,
- then you merge it, and Vercel deploys the result.

---

## If you must use the main folder anyway

Don't. If there is truly no alternative, **first** move `apps/pot/.env.local` and
`packages/contracts/.env` somewhere outside the folder, and move them back only
when the tool is closed. Treat any key that sat in a folder an AI tool had open
as exposed, and rotate it.
