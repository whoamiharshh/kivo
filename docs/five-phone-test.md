# Testing Pot with 5 phones — the whole way through

Two phases. **Phase A** is you, alone, with five phones: it finds what is broken
before a real person sees it. **Phase B** is five real people on their own
phones: it produces the evidence. Don't skip A to get to B — a tester who hits a
bug you could have found teaches you nothing.

Everything here is **test money**. Nothing real moves.

---

## 0. The order of the day

| When | What | Who |
|---|---|---|
| Morning | Fresh deploy → wire the app → `preflight` says READY → `flow-check-safe` | you + me |
| Midday | Live URL up, Privy allows it, one full run on your own laptop | you |
| Afternoon | **Phase A** — 5-phone rehearsal (≈ 90 min) | you |
| Fix window | Anything Phase A found | me |
| Evening | **Phase B** — 5 real people (≈ 20 min each) | you |
| Night | Record results, demo video, submit | you |

Do not start Phase A until `preflight` prints **READY** (see §1).

---

## 1. Before you touch a phone

On your laptop, in `apps/pot`:

```powershell
node --env-file=.env.local --no-warnings scripts\preflight.mjs
```

It must end in plain `READY`. If it says `NOT READY`, read the `FAIL` lines —
each says what is wrong. The one that matters most is **"server signer … is NOT
the contract's trustSigner"**: that means every join will be rejected.

`--env-file=.env.local` is what puts `TRUST_SIGNER_KEY` in front of the script so
it can prove the match. If the key isn't there, the script **fails** rather than
guessing; and if you knowingly skip that check with `--no-signer-check`, the
verdict reads *"READY, BUT THE SIGNER MATCH WAS NOT VERIFIED"* — which is not the
same as ready. It never prints the key.

Then run the contract-level check once (details in `docs/flow-check.md`):

```powershell
node --no-warnings scripts\flow-check-safe.mjs            # dry run: read the plan
node --no-warnings scripts\flow-check-safe.mjs --send --yes   # only after reading it
```

This proves a pot can fill-and-close and can miss-its-deadline-and-refund on the
real chain. It does **not** test sign-in or joining; the phones do.

Finally, open the live URL **on your laptop**, sign in with your own Google
account, and do the whole of Scenario 1–4 below once, alone. If you can't, five
phones won't help.

---

## 2. Setting up the five phones

- **Five different Google accounts**, one per phone. Use your own, family's, or
  throwaway ones. Joining needs a *different* account each time — the same
  account on two phones is the same person.
- Label them: **Asha, Ben, Chitra, Dev, Esha** (a sticky note on each). You will
  type these as the display names, and it makes the screens easy to read.
- Use **Chrome** on each phone. If a link opens inside WhatsApp's own browser,
  tap the menu → *Open in Chrome* — sign-in can misbehave inside in-app browsers.
- If you can, put **two of the phones on mobile data and three on wifi**. If
  everything is on one wifi and you hit "too many tries", see §6.
- Keep a notes file open on the laptop. Write down *what you did, what you
  expected, what happened*, and the exact words of any error.

---

## 3. Phase A — the rehearsal

For every step: **do it, then check the "you should see".** If it doesn't match,
that's a bug — write it down and keep going unless you can't.

### Scenario 1 — Sign in (all 5 phones)

1. Open the live URL → tap **Continue with Google** → pick the phone's account.
2. You'll see **"Setting up your account…"** for a few seconds the first time.
3. **You should see:** the Home screen with a **Your money** card showing ₹0 and a
   **test money** tag, and an empty "Your pots" list.

> Watch for: stuck forever on "Setting up your account…" (Privy problem, §6);
> a Google error page; the page asking about "wallet", "gas" or "crypto" (it
> must never say those words — report it).

### Scenario 2 — Make a pot and bring four people in

**Phone 1 (Asha):**
1. Tap **Get ₹5,000 test money**. *You should see* ₹5,000 under Your money.
2. Tap **Create a pot** and fill in:
   - *What's this pot for?* → `Goa trip`
   - *How much does the group need?* → `3000`
   - *By when?* → tomorrow (leave the default if it's a week out — fine)
   - *How many people, at most* → `5`
   - *Each person can repay, in total, up to* → `500`
   - *Your name* → `Asha`
3. Tap **Create pot**. *You should see* the pot page: **₹0 collected of ₹3,000**, a
   progress bar, and an **Invite your friends** card with the link.
4. Tap **Share on WhatsApp** (or **Copy**) and send the link to the other four
   phones (message yourself, or WhatsApp groups work well).

**Phones 2–5 (Ben, Chitra, Dev, Esha), one at a time:**
1. Open the link in Chrome → sign in (Scenario 1 if new) → you land on the
   invite page showing **Goa trip**, "1 of 5 people have joined", and the rule
   "If the pot doesn't reach ₹3,000 by …, everyone takes their money back."
2. Type the name → tap **Join this pot**.
3. *You should see:* the pot page, with you in the member list.

> Watch for: **"This action is temporarily unavailable"** on join → the server
> signer is off or missing. Run `preflight`. This is the single most likely
> deploy-day failure.

### Scenario 3 — Fill it

On **each** of the five phones:
1. **Get ₹5,000 test money**, open the pot, tap **Add money**.
2. Enter `600` (5 × ₹600 = ₹3,000, exactly the target) → **Add money**.
3. *You should see:* the amount and progress bar move. After the **fifth**
   deposit the badge changes to **Ready to spend** and the bar is full.

Two things to try on the way:
- On one phone, enter **more than the pot still needs** (e.g. `5000` when ₹600
  remains). *You should see* only the remainder go in and the rest stay with you.
  The dialog explains this in advance.
- Try adding money with **₹0 test money** — you should get a clear message, not
  a crash.

### Scenario 4 — Spend it, with the approval rule

Now the pot is full. Each person may move up to ₹500 **in total** without
anyone's approval (a running budget, not per payment).

1. **Phone 1:** **Repay someone** → Ben → `300` → "cab" → **Repay**. *You should
   see* it go through at once ("Ben gets this straight away… you'll have ₹200
   left").
2. **Phone 1 again:** → Chitra → `400`. *You should see* the dialog say you can
   only move ₹200 on your own, so it needs approval, and the button reads
   **Ask for approval**. Send it.
3. **Phone 4 (Dev):** open the pot → **Waiting for approval** shows ₹400 to
   Chitra, "asked by Asha", and **₹400 set aside**. Tap **Approve**. *You should
   see* it paid, and the "set aside" amount disappear.
4. **Try to cheat:** on Phone 1, try to approve your own request (you shouldn't
   be offered the button). Repay yourself ₹100 — it must ask for approval.
5. **Phone 1:** make another repayment that needs approval, then as the
   creator tap **Close pot and return what's left**. *You should see* it
   **refuse**, explaining a repayment is still waiting. **Withdraw** it, then
   close works.

### Scenario 5 — Close and see everyone's share

**Phone 1:** **Close pot and return what's left** → read the preview of each
person's share → confirm. *You should see* each member's share listed, adding up
to what was left, and the pot badge change to **Finished**. On each phone,
**Your money** should have gone up by that share.

### Scenario 6 — A pot that misses its deadline

This is your headline feature, so do it properly.

1. **Phone 1:** create a second pot, `Fail test`, target `3000`, and set *By when?*
   to **about 6 minutes from now**. Max 5 people.
2. **Phones 2 and 3:** join it. Put `500` in from phones 1, 2 and 3. It stays
   **Collecting** (₹1,500 of ₹3,000).
3. **Wait for the deadline to pass.** (Make tea. The app re-checks every ~20 s.)
4. Open the pot on any member's phone. *You should see* **"This pot didn't fill up
   in time"** and the app opening refunds for you; a button **Open refunds now**
   is there if it didn't happen on its own.
5. On each of the three phones: **Claim your ₹500 back**. *You should see* the
   money return. After the last claim the pot is **Finished**.
6. **Try to cheat:** after claiming, try again (should refuse); try from a phone
   that never paid (should have nothing to claim); try spending from this pot
   (must not be possible).

> Honest note for the demo: a contract can't wake itself at the deadline. Someone
> has to trigger the refund step — the app does it for the first member who
> looks, and anyone can. Say that in the video; don't claim it's automatic.

### Scenario 7 — Try to break it

Do these on purpose; each should end in a **clear message, never a blank screen
or a spinner that never stops**:
- Open an invite link while **signed out**.
- Join the **same pot twice** with the same account.
- Add a **sixth** person to a 5-person pot ("This pot is full").
- Change one character of the invite link ("That invite link isn't valid").
- **Airplane mode** in the middle of adding money; turn it back on. *Check:* does
  your balance still tell the truth? Never trust a "success" you didn't see.
- Refresh while something is pending; use the back button mid-flow.
- Rotate the phone; zoom the page; try a small, old phone if you have one.

---

## 4. What to write down

For every scenario, one line in your notes:

| Scenario | Phone | Worked? | Time | What happened (exact words of any error) |
|---|---|---|---|---|

Screenshot any error. Copy the **exact toast text** — it tells me the cause.
**Never paste a private key, a seed phrase, or a `.env` file** anywhere.

When you report a problem to me, send: the scenario, the phone, the exact
message, and the output of `preflight`.

---

## 5. Phase B — five real people

**Who:** people who have actually run or paid into a group kitty — a trip, a
fest, a flat. Ask which, and use that word. Five different people, each on **their
own phone**, each with their own Google account.

**Before they arrive**
- Keep a pot ready that they can *join* (so the first thing they do is real): a
  pot named for something they'd recognise, with an invite link ready to send.
- Tell them it is **test money** and nothing is charged.
- Ask permission before recording the screen or taking notes. No names in your
  notes — "Tester 3, 2nd-year, ran a hostel kitty".

**What to say** (then stop talking — count to ten before answering a question):

> "You and your friends are putting money together for something. Try this app to
> set that up, however you'd do it. Say out loud what you're thinking, including
> when something is annoying. I can't help, and you can't break anything — if
> you get stuck, that's the app's fault, not yours."

**The tasks** (the same ones in `docs/user-testing.md`, in this order):
1. Sign in and get some money.
2. Join the pot from the link.
3. Put their share in.
4. Make a pot of their own and get the link to a friend.
5. Repay someone ₹300, then ₹1,000 — and say *why* the second one waits.
6. Close the pot and say who got what back.
7. (If time) look at a pot that missed its deadline and get their money back.

**Watch, don't help:** where do they hesitate, which word confuses them, do they
expect to be charged, do they understand why a repayment is waiting?

**Afterwards, the same day,** fill in `docs/feedback-log.md` — one entry each —
and ask the four questions at the end of `docs/user-testing.md`. Record what
happened, not what you hoped. **If 3 of 5 got through without help, write 3 of 5.**
A true "4 of 5 got stuck at sign-in, here's the fix" beats a made-up success.

**Also tonight:** send `docs/questionnaire.md` to ~20 friends. It's six questions
about their last group expense and takes two minutes. Even if testing slips, this
is real evidence.

### Messages you can paste

*To a tester:*
> Hi! I'm building a small app for friends who pool money for trips and events.
> Could you spend 20 minutes trying it on your phone and tell me honestly what's
> confusing? It's test money only — nothing real. I'll send a link. Use Chrome and
> a Google account. When are you free?

*For the questionnaire:*
> Quick favour — 6 short questions about the last time you and friends put money
> together for something (a trip, an event, a flat). No right answers, takes 2
> minutes: <link>. It's research for a project, thank you!

---

## 6. When something goes wrong

| What you see | Most likely cause | What to do |
|---|---|---|
| Join says **"This action is temporarily unavailable"** | `TRUST_SIGNER_ENABLED` isn't `true`, or the signer key is missing | Run `preflight`; set the variable in Vercel; **redeploy** |
| Join fails with "didn't approve" / authorization error | Server signer ≠ contract's `trustSigner` | `preflight` prints both addresses; fix the key |
| Stuck on **"Setting up your account…"** | Privy domain not allowed, wrong App ID | Privy dashboard → allowed domains = the exact URL; check `NEXT_PUBLIC_PRIVY_APP_ID` |
| Google sign-in page errors out | OAuth redirect not configured in Privy | Add the exact redirect URL in Privy → Advanced |
| Actions fail with **"Fees aren't being covered"** | Fee sponsorship off for Monad Testnet, or restricted to the old contract addresses | Privy dashboard → fee sponsorship → enable 10143 and the new addresses |
| Home shows an error / empty list that should have pots | RPC rate limit (429) | Wait 30 s; set a dedicated `NEXT_PUBLIC_RPC_URL`; redeploy |
| Everyone suddenly gets "Too many tries" | All testers on one wifi address | Raise `TRUST_IP_MAX_PER_MINUTE`; or put some phones on mobile data |
| "Not set up yet" on a screen | A `NEXT_PUBLIC_*` address missing in the **build** | Set it in Vercel and **rebuild** (it is baked in at build time) |
| Names show as "Friend 3A9C" | Supabase unreachable — names fall back | Not a blocker; note it |
| "Come back tomorrow for more" | Faucet is once a day per account | Use another account or wait |

Fixing a Vercel variable does nothing until the site is **rebuilt**.

---

## 7. What you can honestly claim afterwards

Only what you saw. If the join flow worked for 4 of 5, say 4 of 5. If a tester
never got through sign-in, say so — that's useful and it's credible. Do not
claim demand, willingness to pay, or user numbers beyond what these sessions and
the questionnaire actually showed.
