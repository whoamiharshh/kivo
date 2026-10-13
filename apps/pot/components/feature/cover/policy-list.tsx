/**
 * The cover a person has, and what each one actually covers.
 *
 * ──────────────── why a card and not a row ────────────────
 *
 * A payment is a row: one other person, one amount. A policy is four facts
 * that cannot be separated without misleading somebody — what it pays out,
 * what it cost, whether it is live *right now*, and until when — so it gets a
 * card with room for the period next to the amount.
 *
 * ──────────────── no progress bar ────────────────
 *
 * `FeatureCard` draws one when there is a target to work towards. Cover has
 * no target: the cover amount is not something being filled up, and a bar at
 * 100% next to it would read as "fully funded", which is a different claim
 * about somebody else's money. So the bar is simply left off.
 *
 * Presentational on purpose: it takes an array and a time. Nothing in here
 * calls the clock, so the server render and the first browser render cannot
 * disagree about whether cover has ended.
 */
import {
  ClaimState,
  PolicyState,
  coverInForce,
  describe,
  pendingAction,
  relativeLabel,
} from "@/lib/features/cover-state";
import type { PolicyView } from "@/lib/features/cover-state";
import { formatRupees } from "@/lib/money";
import { FeatureCard } from "../feature-card";
import { EmptyState, TestMoneyNote } from "../primitives";

export function PolicyList({
  policies,
  nowSeconds,
  basePath = "/cover",
}: {
  policies: PolicyView[];
  /** Passed in rather than read from the clock. */
  nowSeconds: number;
  basePath?: string;
}) {
  if (policies.length === 0) {
    return (
      <EmptyState
        title="No cover yet"
        body="Cover you take out shows up here, with what it pays out and the exact hours it runs for. Nothing has been taken out so far."
      />
    );
  }

  const needsYou = policies.filter(
    (p) => pendingAction(p, nowSeconds) !== null
  );
  const rest = policies.filter((p) => pendingAction(p, nowSeconds) === null);

  return (
    <div className="space-y-6">
      {needsYou.length > 0 ? (
        <section>
          <h2 className="mb-3 text-small text-muted-foreground">
            Needs you
          </h2>
          <div className="space-y-3">
            {needsYou.map((p) => (
              <PolicyCard
                key={p.id}
                policy={p}
                nowSeconds={nowSeconds}
                basePath={basePath}
              />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section>
          {needsYou.length > 0 ? (
            <h2 className="mb-3 text-small text-muted-foreground">
              Everything else
            </h2>
          ) : null}
          <div className="space-y-3">
            {rest.map((p) => (
              <PolicyCard
                key={p.id}
                policy={p}
                nowSeconds={nowSeconds}
                basePath={basePath}
              />
            ))}
          </div>
        </section>
      ) : null}

      <TestMoneyNote />
    </div>
  );
}

/** One policy. The amount shown is the cover amount — what it would pay out. */
export function PolicyCard({
  policy,
  nowSeconds,
  basePath = "/cover",
}: {
  policy: PolicyView;
  nowSeconds: number;
  basePath?: string;
}) {
  const { status, tone } = describe(policy, nowSeconds);

  return (
    <FeatureCard
      href={`${basePath}/${policy.id}`}
      title={policy.terms || `Cover #${policy.id}`}
      status={status}
      tone={tone}
      paise={policy.coverage}
      footerLeft={`Premium ${formatRupees(policy.premium)}`}
      footerRight={periodLine(policy, nowSeconds)}
    />
  );
}

/**
 * The second fact in the footer: where this policy is in time.
 *
 * Never shortened to a date on its own. "Ends Sat 6:00 pm" beside a cover
 * amount is read as "you are covered until Saturday", which is false for a
 * policy nobody has bound and for one that has not started.
 */
function periodLine(policy: PolicyView, nowSeconds: number): string {
  if (policy.claim.state === ClaimState.Paid) {
    return `Paid out ${formatRupees(policy.claim.payout)}`;
  }
  if (policy.claim.state === ClaimState.Declined) return "Nothing was paid";
  if (policy.claim.state === ClaimState.Submitted) return "Waiting on a decision";

  switch (policy.state) {
    case PolicyState.Escrowed:
      return "Premium held — nothing covered";
    case PolicyState.Refunded:
      return "Premium came back to you";
    case PolicyState.Closed:
      return "Nothing was claimed";
    case PolicyState.Active: {
      if (nowSeconds < Number(policy.startTime)) {
        return `Starts in ${relativeLabel(Number(policy.startTime), nowSeconds)}`;
      }
      if (coverInForce(policy, nowSeconds)) {
        return `${relativeLabel(Number(policy.endTime), nowSeconds)} left`;
      }
      return `Ended ${relativeLabel(Number(policy.endTime), nowSeconds)}`;
    }
    default:
      return "";
  }
}
