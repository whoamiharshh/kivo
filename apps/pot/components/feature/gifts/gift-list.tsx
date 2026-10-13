"use client";

/**
 * Gifts, sorted by what they want from you.
 *
 * ──────────────── three piles, not one list ────────────────
 *
 * A gift concerns somebody in one of three ways and they need different
 * things. One waiting on *your* word is a job. One ready for you to take is
 * good news. The rest are a record. Merging them into a single chronological
 * list buries the job, and a confirmer who does not notice they were asked is
 * the one failure this feature cannot survive — the money sits still until
 * they act.
 *
 * So "Waiting on you" comes first, always, even when it is the oldest thing
 * on the screen.
 *
 * Presentational: it takes rows, the signed-in address and a clock. The
 * screen above does the reading.
 */

import Link from "next/link";
import {
  EmptyState,
  RowList,
  StatusBadge,
} from "@/components/feature/primitives";
import {
  ConditionType,
  describeGift,
  giftTitle,
  pendingAction,
  secondsUntilTimeout,
  waitLabel,
  type GiftView,
} from "@/lib/features/gift-state";
import { formatRupees } from "@/lib/money";

export function GiftList({
  gifts,
  me,
  nowSeconds,
}: {
  gifts: GiftView[];
  me: `0x${string}` | undefined;
  nowSeconds: number;
}) {
  if (gifts.length === 0) {
    return (
      <EmptyState
        title="No gifts yet"
        body="Set money aside for somebody that unlocks on a date, or when a person you both trust says the thing happened."
      />
    );
  }

  const needsYou: GiftView[] = [];
  const readyForYou: GiftView[] = [];
  const rest: GiftView[] = [];

  for (const gift of gifts) {
    const action = pendingAction(gift, me, nowSeconds);
    if (action === "confirm") needsYou.push(gift);
    else if (action === "claim" || action === "release") readyForYou.push(gift);
    else rest.push(gift);
  }

  return (
    <div className="space-y-6">
      {needsYou.length > 0 ? (
        <Group label="Waiting on you" gifts={needsYou} nowSeconds={nowSeconds} />
      ) : null}
      {readyForYou.length > 0 ? (
        <Group
          label="Ready to take"
          gifts={readyForYou}
          nowSeconds={nowSeconds}
        />
      ) : null}
      {rest.length > 0 ? (
        <Group label="Everything else" gifts={rest} nowSeconds={nowSeconds} />
      ) : null}
    </div>
  );
}

function Group({
  label,
  gifts,
  nowSeconds,
}: {
  label: string;
  gifts: GiftView[];
  nowSeconds: number;
}) {
  return (
    <section>
      <h2 className="mb-3 text-small text-muted-foreground">
        {label}
      </h2>
      <RowList>
        {gifts.map((gift) => (
          <GiftRow key={gift.id} gift={gift} nowSeconds={nowSeconds} />
        ))}
      </RowList>
    </section>
  );
}

function GiftRow({ gift, nowSeconds }: { gift: GiftView; nowSeconds: number }) {
  const { status, tone } = describeGift(gift, nowSeconds);
  const isDate = gift.conditionType === ConditionType.Time;
  const untilTimeout = secondsUntilTimeout(gift, nowSeconds);

  return (
    <Link
      href={`/gifts/${gift.id}`}
      className="block px-5 py-4 transition-transform duration-100 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">
            {gift.sending ? `For ${gift.otherName}` : `From ${gift.otherName}`}
          </p>
          <p className="truncate text-small text-muted-foreground">
            {giftTitle(gift)}
          </p>
        </div>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="tabular text-h1 text-foreground">
          {formatRupees(gift.amount)}
        </span>
        <span className="text-small text-muted-foreground">
          {isDate
            ? `unlocks ${waitLabel(
                Math.max(0, Number(gift.releaseTime) - nowSeconds)
              )}`
            : "needs confirming"}
        </span>
      </div>

      {/* The escape hatch, named before anybody has to ask about it: a gift
          nobody confirms does not stay stuck forever. */}
      {!isDate && untilTimeout > 0 && !gift.sending ? (
        <p className="mt-2 text-caption text-text-tertiary">
          Yours anyway {waitLabel(untilTimeout)} if nobody confirms it
        </p>
      ) : null}
    </Link>
  );
}
