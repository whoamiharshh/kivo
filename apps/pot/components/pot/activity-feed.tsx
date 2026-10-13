"use client";

import { personLabel } from "@/components/person";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupees } from "@/lib/money";
import type { FeedItem } from "@/lib/queries";

/** Plain-language history, built from the pot's own events. */
function describe(
  item: FeedItem,
  names: Record<string, string>,
  me: string | undefined
): { text: React.ReactNode; tone: "neutral" | "in" | "out" } {
  const who = (a: `0x${string}` | undefined) =>
    personLabel(a, a ? names[a.toLowerCase()] : null, me);
  const amount = item.amount ? formatRupees(item.amount) : "";

  switch (item.kind) {
    case "created":
      return {
        text: <>Pot created{item.amount ? ` with a ${amount} target` : ""}</>,
        tone: "neutral",
      };
    case "joined":
      return { text: <>{who(item.actor)} joined</>, tone: "neutral" };
    case "added":
      return {
        text: (
          <>
            <b>{who(item.actor)}</b> added <b className="tabular">{amount}</b>
          </>
        ),
        tone: "in",
      };
    case "requested":
      return {
        text: (
          <>
            {who(item.actor)} asked to repay <b className="tabular">{amount}</b>{" "}
            to {who(item.to)}
            {item.memo ? ` — ${item.memo}` : ""}
            {item.needsApproval ? " (needs approval)" : ""}
          </>
        ),
        tone: "neutral",
      };
    case "funded":
      return {
        text: (
          <>
            The pot filled up — <b className="tabular">{amount}</b> collected
          </>
        ),
        tone: "in",
      };
    case "refunding":
      return {
        text: (
          <>
            Deadline passed without filling up — everyone can take their money back
          </>
        ),
        tone: "out",
      };
    case "approved":
      return { text: <>{who(item.actor)} approved it</>, tone: "neutral" };
    case "cancelled":
      return {
        text: <>A repayment request was withdrawn</>,
        tone: "neutral",
      };
    case "paid":
      return {
        text: (
          <>
            <b className="tabular">{amount}</b> repaid to{" "}
            <b>{who(item.to)}</b>
          </>
        ),
        tone: "out",
      };
    case "closed":
      return {
        text: (
          <>
            Pot closed — what was left went back to members
          </>
        ),
        tone: "neutral",
      };
    case "refunded":
      return {
        text: (
          <>
            <b>{who(item.actor)}</b> got their money back
          </>
        ),
        tone: "out",
      };
  }
}

const DOT = {
  neutral: "bg-muted-foreground/40",
  in: "bg-emerald-500",
  out: "bg-sky-500",
} as const;

export function ActivityFeed({
  items,
  names,
  me,
}: {
  items: FeedItem[];
  names: Record<string, string>;
  me: string | undefined;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Nothing has happened yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-0 p-0">
            {items.map((item) => {
              const { text, tone } = describe(item, names, me);
              return (
                <div
                  key={item.key}
                  className="flex gap-3 border-b px-4 py-3 last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-[7px] size-1.5 shrink-0 rounded-full ${DOT[tone]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug">{text}</p>
                    {item.occurredAt || item.transactionHash ? (
                      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        {item.occurredAt ? (
                          <time dateTime={item.occurredAt}>
                            {new Intl.DateTimeFormat(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(item.occurredAt))}
                          </time>
                        ) : null}
                        {item.transactionHash ? (
                          <span aria-label="Event reference">
                            Ref {item.transactionHash.slice(0, 10)}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
