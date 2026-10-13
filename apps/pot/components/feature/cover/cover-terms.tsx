/**
 * What is covered, what is not, for how long, and who decides.
 *
 * ──────────────── the one thing this feature must get right ────────────────
 *
 * A person must never be led to believe they are covered when they are not. In
 * practice that is a layout problem as much as a copy problem: a big cover
 * amount at the top and the exclusions three scrolls down is a screen that
 * tells the truth and still misleads. So these four facts are one block —
 * amount, period, what it does not cover, who decides — and the exclusions are
 * set in the same size as the amount rather than as fine print.
 *
 * Presentational on purpose: everything arrives as props, including
 * `nowSeconds`, so the same component renders a policy that exists and a
 * preview of one that does not, and a screenshot of either is stable.
 */
import {
  EXPOSURE_CAVEAT,
  momentLabel,
  relativeLabel,
} from "@/lib/features/cover-state";
import { formatRupees } from "@/lib/money";
import { Amount, Card, StatRow, TestMoneyNote } from "../primitives";

export function CoverTerms({
  terms,
  premiumPaise,
  coveragePaise,
  startSeconds,
  endSeconds,
  cannotCheck,
  nowSeconds,
  /** Set while nothing has been bound, so no label may read as live cover. */
  inForce,
}: {
  /** What the cover says, in the buyer's own words. */
  terms: string;
  premiumPaise: bigint;
  coveragePaise: bigint;
  startSeconds: number;
  endSeconds: number;
  /** The honest limits of this kind of cover. Never empty. */
  cannotCheck: readonly string[];
  nowSeconds: number;
  inForce: boolean;
}) {
  const started = nowSeconds >= startSeconds;
  const ended = nowSeconds > endSeconds;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-small text-muted-foreground">
          Pays out at most
        </p>
        <Amount paise={coveragePaise} size="display" />
        <TestMoneyNote className="mt-1" />

        {terms ? (
          <p className="mt-4 text-body text-foreground">{terms}</p>
        ) : (
          <p className="mt-4 text-body text-muted-foreground">
            Nothing was written down about what this covers.
          </p>
        )}

        <div className="mt-4 border-t pt-2">
          <StatRow label="Premium">{formatRupees(premiumPaise)}</StatRow>
          <StatRow label="Cover starts">{momentLabel(startSeconds)}</StatRow>
          <StatRow label="Cover ends" emphasis>
            {momentLabel(endSeconds)}
          </StatRow>
        </div>

        {/* The period restated in words, because two dates side by side are
            read as "it is covered" whatever they actually say. */}
        <p className="mt-2 text-small text-muted-foreground">
          {!started
            ? `Nothing is covered until it starts, in ${relativeLabel(startSeconds, nowSeconds)}.`
            : ended
              ? `The cover period finished ${relativeLabel(endSeconds, nowSeconds)}.`
              : inForce
                ? `Covered for another ${relativeLabel(endSeconds, nowSeconds)}.`
                : `The period runs for another ${relativeLabel(endSeconds, nowSeconds)}, but nobody has taken on the risk, so nothing is covered.`}
        </p>
      </Card>

      {/* Same weight as the amount above. This is the half of a cover screen
          that usually gets hidden, and hiding it is how people get hurt. */}
      <Card>
        <h3 className="text-h3 text-foreground">What this does not cover</h3>
        <ul className="mt-3 space-y-3">
          {cannotCheck.map((line) => (
            <li key={line} className="flex gap-2.5 text-body text-foreground">
              <span aria-hidden="true" className="text-muted-foreground">
                —
              </span>
              <span>{line}</span>
            </li>
          ))}
          <li className="flex gap-2.5 text-body text-foreground">
            <span aria-hidden="true" className="text-muted-foreground">
              —
            </span>
            <span>{EXPOSURE_CAVEAT}</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
