/**
 * The presentational pieces every feature screen is built from.
 *
 * All Server Components. None of them holds state, listens for an event or
 * touches a browser API, so none of them needs to ship JavaScript to the
 * phone. The interactive pieces live in their own files next to this one and
 * carry "use client" individually — one pressable card does not justify making
 * a whole screen interactive.
 *
 * Two rules hold throughout:
 *
 *  - No component names a colour. `tone` picks a semantic token set, so the
 *    palette changes in globals.css and every status badge in all seven
 *    features follows.
 *  - Nothing conveys state by colour alone. Every tone carries a word, and
 *    MemberRow carries a label as well as a dot, because a red dot and a green
 *    dot are the same dot to a colourblind user.
 */
import { formatRupees } from "@/lib/money";
import { cn } from "@/lib/utils";

/* ═══════════════════════════ status ═══════════════════════════ */

/**
 * One status vocabulary across all seven features.
 *
 * The words differ per feature — a pot is "Collecting", a goal is "In
 * progress", a policy is "Active" — but the *tones* are shared, so a person
 * learns the colour language once: indigo is in flight, emerald is a good
 * ending, amber needs attention, stone is over.
 */
export type Tone = "progress" | "good" | "attention" | "over";

const TONE: Record<Tone, string> = {
  progress: "bg-primary-subtle text-primary-strong border-primary-ring",
  good: "bg-success-bg text-success-strong border-success-ring",
  attention: "bg-warning-bg text-warning-strong border-warning-ring",
  over: "bg-muted text-neutral-strong border-neutral-ring",
};

export function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-[6px] border px-2 text-small font-semibold",
        TONE[tone]
      )}
    >
      {children}
    </span>
  );
}

/* ═══════════════════════════ money ═══════════════════════════ */

/**
 * An amount, in paise, rendered as rupees.
 *
 * `data-amount` switches on tabular figures (globals.css), so ₹1,999 and
 * ₹2,000 occupy identical width and a live-updating balance never twitches
 * the row it sits in.
 */
export function Amount({
  paise,
  size = "body",
  className,
}: {
  paise: bigint;
  size?: "display" | "h1" | "h2" | "body" | "small";
  className?: string;
}) {
  const sizes = {
    display: "text-display",
    h1: "text-h1",
    h2: "text-h2",
    body: "text-body font-semibold",
    small: "text-small",
  } as const;

  return (
    <span data-amount className={cn(sizes[size], className)}>
      {formatRupees(paise)}
    </span>
  );
}

/**
 * The disclosure that has to appear on every screen showing a balance.
 *
 * Deliberately quiet rather than alarming — it is a statement of fact, not a
 * warning — but never omitted, because a number with a ₹ in front of it looks
 * exactly like money whatever the context.
 */
export function TestMoneyNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-caption text-tertiary", className)}>
      Test money. No real value.
    </p>
  );
}

/* ═══════════════════════════ layout ═══════════════════════════ */

/** A titled block. The title is optional so the same component can group
 *  anonymous rows without an empty heading taking up space. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-6", className)}>
      {title || action ? (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title ? (
            <h2 className="text-h3 text-foreground">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A white card. The one surface in the app that sits above the background. */
export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-5 text-card-foreground shadow-xs",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A label/value row, used in every summary card. Values are right-aligned so
 *  a column of amounts reads as a column. */
export function StatRow({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-body text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right text-body text-foreground",
          emphasis && "font-semibold"
        )}
      >
        {children}
      </span>
    </div>
  );
}

/* ═══════════════════════════ empty and alert ═══════════════════════════ */

/**
 * Every list has one of these. An empty list with no explanation reads as a
 * broken screen, and the fix is one sentence saying what would appear here.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-card/50 px-5 py-10 text-center">
      <h3 className="text-h3 text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-[280px] text-body text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** A block of consequence: what is about to happen, or what just went wrong. */
export function Alert({
  tone = "attention",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  const fills: Record<Tone, string> = {
    progress: "bg-primary-subtle border-primary-ring text-primary-strong",
    good: "bg-success-bg border-success-ring text-success-strong",
    attention: "bg-warning-bg border-warning-ring text-warning-strong",
    over: "bg-muted border-neutral-ring text-neutral-strong",
  };

  return (
    <div className={cn("rounded-lg border p-5", fills[tone])}>
      {title ? <p className="text-body font-semibold">{title}</p> : null}
      <div className={cn("text-body", title && "mt-1")}>{children}</div>
    </div>
  );
}

/* ═══════════════════════════ people ═══════════════════════════ */

/** Initial-in-a-circle. No photos anywhere in this app, so there is nothing
 *  to load and nothing to shift the layout. */
export function Avatar({
  name,
  size = 36,
}: {
  name: string;
  size?: 28 | 32 | 36 | 44;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-body font-semibold text-muted-foreground"
    >
      {initial}
    </span>
  );
}

/**
 * One person in a list, with what they have done.
 *
 * The state carries a word next to the dot, not only a colour — state is
 * never conveyed by colour alone.
 */
export function MemberRow({
  name,
  detail,
  state,
  stateLabel,
  trailing,
}: {
  name: string;
  detail?: string;
  state?: "done" | "waiting";
  stateLabel?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex h-[60px] items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">
          {name}
        </p>
        {detail ? (
          <p className="truncate text-small text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      {trailing}
      {state ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-small font-medium",
            state === "done" ? "text-success-strong" : "text-warning-strong"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full",
              state === "done" ? "bg-success" : "bg-warning"
            )}
          />
          {stateLabel ?? (state === "done" ? "Paid" : "Waiting")}
        </span>
      ) : null}
    </div>
  );
}

/** Rows with hairlines between them, which is how every list in the app is
 *  separated. */
export function RowList({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y rounded-lg border bg-card px-5">{children}</div>
  );
}
