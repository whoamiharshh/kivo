# Checking the pot lifecycle on testnet (`flow-check-safe`)

This is the review document for `apps/pot/scripts/flow-check-safe.mjs`.
**Nothing has been sent.** The script has only been run as a dry run, which
reads the chain and sends no transaction.

## What it proves, and what it does not

| It proves | It does not prove |
|---|---|
| The deployed contracts do what the tests say, on the real chain: a pot that fills up closes and returns the money; a pot that misses its deadline can be opened for refunds and each person claims theirs back. | Google sign-in, the embedded wallet, fee sponsorship, or any screen. Those need a browser. |
| Every step's resulting state and balance is checked, not just "no error". | Joining a pot (it needs the trust signer, which is separate). |

## Why there is a new script

The old `flow-check.mjs` signed with `DEPLOYER_KEY`, read from a file. That key
is treated as compromised, so the old script now **exits immediately** with a
pointer here. The new one:

- reads **no files** — the key only ever comes from your shell, and is never printed;
- takes the target contracts **explicitly**;
- refuses any chain except Monad Testnet (10143);
- refuses the two compromised role addresses;
- is a **dry run by default**: sending needs both `--send` and `--yes`.

## Setup (all on your machine; nothing goes in chat)

**1. Make a throwaway key.** In a terminal:

```
cast wallet new
```

It prints an address and a private key. Keep the key in that window only. It
has no other use; do not reuse a key that holds anything.

**2. Fund the address** from the Monad testnet faucet. It needs **at least
0.35 MON** (0.5 is comfortable). Check:

```
cast balance <address> --rpc-url https://testnet-rpc.monad.xyz
```

**3. Review the plan** (public address only, no key needed). PowerShell:

```powershell
cd apps\pot
$env:FLOW_CHECK_POT_MANAGER = "0x<PotManager address>"
$env:FLOW_CHECK_TEST_RUPEE  = "0x<TestRupee address>"
$env:FLOW_CHECK_ADDRESS     = "0x<throwaway address>"
node --no-warnings scripts\flow-check-safe.mjs
```

**4. Only after you are happy with that output**, send it. Put the key in the
environment without typing it into the command line or leaving it in history:

```powershell
$secure = Read-Host "Throwaway key" -AsSecureString
$env:FLOW_CHECK_KEY = [System.Net.NetworkCredential]::new("", $secure).Password
node --no-warnings scripts\flow-check-safe.mjs --send --yes
Remove-Item Env:FLOW_CHECK_KEY
```

## The exact transactions

This is the real output of the dry run against the **current** deployment (pot
numbers #6 and #7 are because five pots already exist; on a fresh deployment
they would be #1 and #2).

```
   1. TestRupee  faucet()                          mints ₹5,000 of test money to you   (only if you hold < ₹70)
   2. TestRupee  approve(PotManager, ₹70)          lets the pot take exactly what this test uses
   3. PotManager createPot(target ₹50, +1 day)     creates pot #6
   4. PotManager deposit(#6, ₹50)                  reaches the target → Funded
   5. PotManager requestSpend(#6, you, ₹10)        SIMULATED ONLY, not sent
   6. PotManager closePot(#6)                      returns ₹50 to you → Closed
   7. PotManager createPot(target ₹50, +3 min)     creates pot #7
   8. PotManager deposit(#7, ₹20)                  below target → stays Collecting
   9. (wait)     until the chain clock passes the deadline   about 3 minutes, no transaction
  10. PotManager finalizeFailed(#7)                → Refunding
  11. PotManager claimRefund(#7)                   returns ₹20 to you → Closed
```

**9 transactions** are sent (8 if you already hold ₹70 of test money). Step 5 is
only simulated: repaying yourself needs a second person's approval, and a
pending request would stop the pot from closing.

## Funds

| What | How much | Why |
|---|---|---|
| MON for fees | **≥ 0.35 MON** (script refuses below this; 0.5 is comfortable) | Measured gas price is 102 gwei. The script's upper bound is about 0.32 MON for 9 transactions, so the minimum is set just above it. Monad charges on the gas limit, so the real cost is nearer the bound than you might expect. |
| Test money | **₹70**, all of it returned | ₹50 + ₹20 are put in and come back. The faucet supplies ₹5,000 if you have none. |

## State it leaves behind

- Two new pots, both **Closed**, with nothing in them. The five existing pots
  are untouched.
- The pot counter goes up by 2.
- Your throwaway account ends with the same test money it started with — plus
  ₹5,000 newly minted by the faucet if it was used. The faucet **mints**, so the
  token's total supply grows by that amount.
- The approval is for exactly ₹70 and the two deposits use all of it, so no
  spending allowance is left behind.
- Everything is public on the chain explorer, under the throwaway address.

## What the script checks before it will send anything

1. The RPC reports chain **10143**.
2. There is contract code at both addresses.
3. `PotManager.token()` is the TestRupee you gave (they belong together).
4. The account is not one of the two compromised addresses.
5. The account has ≥ 0.35 MON, and ₹70 of test money or a faucet claim available.

If it stops part-way it prints which pot to recover and how (`closePot` for a
funded pot; `finalizeFailed` then `claimRefund` after a missed deadline). Nothing
is lost, and any unused approval is capped at ₹70.

## Honest limits

- The faucet allows one claim per address per day.
- Step 9 waits on the chain's own clock; it gives up after 10 minutes. Both
  deadlines are set from the chain's clock, not your laptop's, so a wrong laptop
  clock can't make a deposit land after its deadline.
- The script identifies the pot it created from that transaction's own event,
  not from the pot counter, so another person creating a pot at the same moment
  cannot make it act on the wrong one.
- It has not been run with `--send`. Its refusal paths (compromised addresses,
  a missing key, a malformed key, a missing contract address) and its dry run
  have been run.
