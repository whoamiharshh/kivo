# How the app finds your pots (and what it costs)

The pot list on Home and the activity feed inside a pot are read **directly from
the PotManager contract**. They do not use Supabase, an indexer, a scheduler or
`eth_getLogs`. If the chain's RPC is reachable, they work.

Supabase is still optional for *display text only*: pot names, people's names
and repayment memos. If it is missing or unreachable the app falls back to
on-device storage and then to a plain label (`Pot #3`, `Friend 3A9C`). It can
never stop a pot from showing up.

## Home: which pots are mine?

`useMyPots` in `apps/pot/lib/queries.ts`:

1. `potCount()` — how many pots exist.
2. `isMember(potId, me)` for the **newest 200** pots, batched 100 per call.
3. `getPot(potId)` for the ones I am in, batched 50 per call.

For the demo (five known pots) that is three RPC round trips per refresh, every
30 seconds.

### Where this stops scaling

- **It only looks at the newest 200 pots.** On a deployment with more than 200
  pots, someone who joined an older pot will not see it on Home. They can still
  open it by link.
- Cost grows with the number of pots ever created, not with the number you are
  in. At a few hundred pots it is fine; at many thousands it is not.
- One failing call fails the whole read (`allowFailure: false`). The screen
  shows an error with a retry rather than a half-empty list.

### What to do when it outgrows this

In order of effort:

1. Raise `MAX_POTS_SCANNED`. Cheap, but cost scales linearly.
2. Add a `memberPots(address)` view to PotManager. That means a **new contract
   deployment**, so it is a product decision, not a patch.
3. Run an indexer. The source for one exists in the repo
   (`lib/server/pot-indexer.ts`, `app/api/pots*`, migration
   `20261012_pot_activity_index.sql`). It is **not used by the demo, the
   migration is not applied, and nothing schedules it.** Applying it needs a
   database you approve.

## Inside a pot: the activity feed

`usePotActivity` rebuilds history from the contract's own views (`getPot`,
`getMembers`, `contributed`, `refundClaimed`, `getSpend`) through
`deriveStateFeed` in `apps/pot/lib/activity.ts`.

Because it reads *state*, not *events*, it cannot show:

- **When** anything happened. Entries carry no time and no transaction link.
- **Separate deposits.** Someone who added money three times appears once, with
  their total.
- **Who approved** a repayment. The contract stores that it was paid, not by
  whom.
- **Exact cross-kind order.** Entries are grouped (joins and deposits, then
  repayments, then refunds, then closing) rather than strictly time-ordered.

What it does show is always true to the contract, and it cannot lag or fall
behind a missing indexer.

### Repayment numbering

PotManager numbers a pot's repayments from **1** (`spendId = ++spendCount`);
`getSpend(potId, 0)` is an empty record. `spendIdAt()` in `lib/activity.ts` is
the single place that encodes this, and it has regression tests. Approve and
withdraw buttons send exactly these ids.

## Why not `eth_getLogs`

Monad's public testnet RPC rejects any log query wider than **100 blocks**
(`eth_getLogs is limited to a 100 range`). Scanning from the deploy block to
"now" is therefore not possible without paging thousands of requests, which is
why the older log-scanning approach was abandoned for the state reads above.
