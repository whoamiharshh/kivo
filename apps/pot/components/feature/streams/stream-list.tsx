"use client";

/**
 * Every arrangement this person is on either side of.
 *
 * ──────────────── two sides, one component ────────────────
 *
 * The same row on the chain is two different situations in real life: money
 * leaving you at a steady rate, or money arriving. Rather than branch on
 * `paying` in a dozen places, each row asks `describe()` and `project()` — the
 * same pure functions the detail screen uses — and renders what they say. The
 * list and the detail can therefore never disagree about what an arrangement
 * is doing.
 *
 * ──────────────── why money coming in is listed first ────────────────
 *
 * Somebody opening this screen is far more often checking what they have
 * earned than auditing what they are paying out. The order follows that,
 * rather than the order the arrangements were made in.
 *
 * Presentational: it takes rows and a clock, so the screen above does the
 * reading and this can be dropped elsewhere without a query.
 */

import Link from "next/link";
import {
  EmptyState,
  RowList,
  StatusBadge,
} from "@/components/feature/primitives";
import { describe, project, type StreamView } from "@/lib/features/stream-state";
import { formatRupees } from "@/lib/money";

export function StreamList({
  streams,
  nowSeconds,
}: {
  streams: StreamView[];
  nowSeconds: number;
}) {
  if (streams.length === 0) {
    return (
      <EmptyState
        title="Nothing building up yet"
        body="Set up pay that builds up second by second, so whoever is earning it can take what they have earned whenever they need it."
      />
    );
  }

  const incoming = streams.filter((s) => !s.paying);
  const outgoing = streams.filter((s) => s.paying);

  return (
    <div className="space-y-6">
      {incoming.length > 0 ? (
        <Group label="Coming to you" streams={incoming} nowSeconds={nowSeconds} />
      ) : null}
      {outgoing.length > 0 ? (
        <Group
          label="You are paying"
          streams={outgoing}
          nowSeconds={nowSeconds}
        />
      ) : null}
    </div>
  );
}

function Group({
  label,
  streams,
  nowSeconds,
}: {
  label: string;
  streams: StreamView[];
  nowSeconds: number;
}) {
  return (
    <section>
      <h2 className="mb-3 text-small text-muted-foreground">
        {label}
      </h2>
      <RowList>
        {streams.map((stream) => (
          <StreamRow key={stream.id} stream={stream} nowSeconds={nowSeconds} />
        ))}
      </RowList>
    </section>
  );
}

function StreamRow({
  stream,
  nowSeconds,
}: {
  stream: StreamView;
  nowSeconds: number;
}) {
  const { status, tone } = describe(stream, nowSeconds);
  const figures = project(stream, nowSeconds);

  return (
    <Link
      href={`/streams/${stream.id}`}
      className="block px-5 py-4 transition-transform duration-100 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">
            {stream.paying
              ? `Paying ${stream.otherName}`
              : `From ${stream.otherName}`}
          </p>
          <p className="tabular mt-0.5 text-small text-muted-foreground">
            {formatRupees(figures.perDay)} a day
          </p>
        </div>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="tabular text-h1 text-foreground">
          {formatRupees(
            stream.paying ? figures.stillFunded : figures.withdrawable
          )}
        </span>
        <span className="text-small text-muted-foreground">
          {stream.paying ? "still yours" : "ready to take"}
        </span>
      </div>

      {/* The one thing worth interrupting somebody about: the money is about
          to stop building up because there is none left to build from. */}
      {stream.paying && figures.lowRunway && !figures.ended ? (
        <p className="mt-2 text-caption font-semibold text-warning-strong">
          Running low — top it up to keep it going
        </p>
      ) : null}
    </Link>
  );
}
