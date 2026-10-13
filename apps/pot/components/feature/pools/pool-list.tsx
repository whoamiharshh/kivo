"use client";

/**
 * Every group commitment this person is in.
 *
 * ──────────────── what a row has to carry ────────────────
 *
 * A pool is a promise with other people's money attached, so a row that showed
 * only the commitment would be hiding the part that matters. Each row carries
 * four things: what the group agreed to, how this person is doing against it,
 * how long is left, and what their stake is. The badge reads the whole pool;
 * the progress bar reads only this person.
 *
 * ──────────────── why "marked today" is on the row ────────────────
 *
 * The one thing a member has to do is mark the day, and the window closes at
 * midnight. Burying that on the detail screen means somebody opens the app,
 * sees a tidy list, and loses their stake to a tap they did not know was
 * waiting. So an unmarked day is said on the row itself.
 *
 * Presentational: it takes rows and renders them, so the screen above does the
 * reading and this component can be dropped elsewhere without a query.
 */

import Link from "next/link";
import { ProgressBar } from "@/components/feature/progress-bar";
import {
  EmptyState,
  RowList,
  StatusBadge,
} from "@/components/feature/primitives";
import {
  daysLeftToMark,
  describePool,
  poolTitle,
  type PoolView,
} from "@/lib/features/pool-state";
import { formatRupees } from "@/lib/money";

export function PoolList({
  pools,
  nowSeconds,
}: {
  pools: PoolView[];
  nowSeconds: number;
}) {
  if (pools.length === 0) {
    return (
      <EmptyState
        title="No group commitments yet"
        body="Agree something with your friends, everyone puts a stake in, and whoever keeps it shares what the others leave behind."
      />
    );
  }

  return (
    <RowList>
      {pools.map((pool) => (
        <PoolRow key={pool.id} pool={pool} nowSeconds={nowSeconds} />
      ))}
    </RowList>
  );
}

function PoolRow({ pool, nowSeconds }: { pool: PoolView; nowSeconds: number }) {
  const { status, tone } = describePool(pool, nowSeconds);
  const left = daysLeftToMark(pool.deadline, nowSeconds);

  // The bar is this person's own progress, not the group's. A group average
  // would be comforting and useless: nobody's stake depends on the average.
  const needed = pool.requiredDays - pool.graceDays;
  const done = Math.min(pool.me.daysAttested, needed);

  return (
    <Link
      href={`/pools/${pool.id}`}
      className="block px-5 py-4 transition-transform duration-100 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">
          {poolTitle(pool)}
        </h3>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      {pool.me.joined ? (
        <>
          <ProgressBar
            className="mt-3"
            value={done}
            max={needed > 0 ? needed : 1}
            label={`Your progress: ${done} of ${needed} days marked`}
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-small text-muted-foreground">
              {done} of {needed} days marked
            </span>
            <span className="text-small text-muted-foreground">
              {left === 0
                ? "Last day has passed"
                : left === 1
                  ? "1 day left"
                  : `${left} days left`}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-small text-muted-foreground">
          {pool.memberCount} of {pool.maxMembers} people have joined
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="tabular text-caption text-text-tertiary">
          {formatRupees(pool.stakePerMember)} each
        </span>
        {/* The job waiting on them, said where they will see it. */}
        {pool.me.joined && !pool.recordedToday && left > 0 ? (
          <span className="text-caption font-semibold text-warning-strong">
            Today not marked yet
          </span>
        ) : null}
      </div>
    </Link>
  );
}
