"use client";

/**
 * Set up pay that builds up over time.
 *
 * ──────────────── a rate per second is not a thing people think in ────────────────
 *
 * The contract wants paise per second. Nobody has ever decided to pay somebody
 * 0.57 paise per second. So the form asks for the two numbers a person
 * actually has in their head — how much a day, and for how long — and derives
 * the rate with `ratePerSecondFor`, which rounds to a whole paisa.
 *
 * Rounding means the daily figure the contract will honour can differ from the
 * one that was typed. Rather than hide that, the screen shows what the rate
 * really pays, derived the way the contract will derive it. If the two differ,
 * the person sees the one that is true.
 *
 * ──────────────── money put in is not money spent ────────────────
 *
 * The deposit stays the payer's until it is earned, and the unearned part
 * comes back when the arrangement closes. That is said next to the field,
 * because "put money in" reads like "give money away" and it is not.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { AmountField, NumberField } from "@/components/feature/fields";
import { ActionButton } from "@/components/feature/action-button";
import {
  Alert,
  Avatar,
  EmptyState,
  RowList,
  StatRow,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { SALARY_STREAM_ADDRESS, ready } from "@/lib/contracts";
import {
  DAY_SECONDS,
  perPeriod,
  ratePerSecondFor,
  streamError,
  useStartStream,
} from "@/lib/features/stream";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useKnownPeople, type Person } from "@/lib/people";
import { useTokenState } from "@/lib/token";

export default function NewStreamPage() {
  return (
    <AppShell back="/streams" title="Set up pay">
      <LoginGate>
        <NewStream />
      </LoginGate>
    </AppShell>
  );
}

function NewStream() {
  const router = useRouter();
  const start = useStartStream();
  const { data: people, isLoading: peopleLoading } = useKnownPeople();
  const { data: token } = useTokenState(SALARY_STREAM_ADDRESS);

  const [person, setPerson] = useState<Person | null>(null);
  const [perDay, setPerDay] = useState("");
  const [days, setDays] = useState(30);
  const [deposit, setDeposit] = useState("");

  if (!ready.streams) {
    return (
      <Alert tone="attention" title="Not set up yet">
        This needs one more address in the app&apos;s settings.
      </Alert>
    );
  }

  const paise = (text: string) => {
    try {
      return text.trim() ? rupeesToPaise(text) : 0n;
    } catch {
      return 0n;
    }
  };

  const perDayPaise = paise(perDay);
  const depositPaise = paise(deposit);
  const rate = ratePerSecondFor(perDayPaise, DAY_SECONDS);
  // What the rounded rate genuinely pays, worked out the contract's way.
  const actualPerDay = perPeriod(rate, DAY_SECONDS);
  const durationSeconds = days * DAY_SECONDS;
  const fullCost = perPeriod(rate, durationSeconds);
  const daysCovered =
    rate > 0n ? Number(depositPaise / rate) / DAY_SECONDS : 0;

  const valid = Boolean(person) && rate > 0n && depositPaise > 0n;

  if (peopleLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  if (!people || people.length === 0) {
    return (
      <EmptyState
        title="Nobody to pay yet"
        body="You can set this up with people you already share a pot with. Make a pot and invite somebody first."
      />
    );
  }

  return (
    <div className="space-y-8 pb-4">
      <section>
        <h2 className="mb-3 text-small font-semibold text-foreground">
          Who are you paying?
        </h2>
        <RowList>
          {people.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => setPerson(p)}
              className={`flex w-full items-center gap-3 px-5 py-3 text-left ${
                person?.address === p.address ? "bg-primary-subtle" : ""
              }`}
            >
              <Avatar name={p.name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-foreground">
                  {p.name}
                </span>
                {p.sharedPots.length > 0 ? (
                  <span className="block truncate text-small text-muted-foreground">
                    {p.sharedPots.join(" · ")}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </RowList>
      </section>

      <AmountField
        label="How much a day?"
        value={perDay}
        onChange={setPerDay}
        hint="It builds up second by second at this rate."
      />

      <NumberField
        label="For how many days?"
        value={days}
        onChange={setDays}
        min={1}
        max={365}
      />

      <AmountField
        label="Put in now"
        value={deposit}
        onChange={setDeposit}
        size="body"
        hint="This stays yours until it is earned. Whatever is never earned comes back to you."
      />

      {rate > 0n ? (
        <Alert tone="progress" title="What this sets up">
          <StatRow label="Pays">{formatRupees(actualPerDay)} a day</StatRow>
          <StatRow label="Over">{days} days</StatRow>
          <StatRow label="Full term costs">{formatRupees(fullCost)}</StatRow>
          {depositPaise > 0n ? (
            <StatRow label="What you put in covers">
              {daysCovered >= days
                ? "the whole term"
                : `about ${Math.max(0, Math.floor(daysCovered))} days`}
            </StatRow>
          ) : null}
          {actualPerDay !== perDayPaise && perDayPaise > 0n ? (
            <p className="mt-3">
              A rate has to be a whole number of paise per second, so the daily
              figure settles at {formatRupees(actualPerDay)} rather than{" "}
              {formatRupees(perDayPaise)}.
            </p>
          ) : null}
        </Alert>
      ) : null}

      <TestMoneyNote />

      <StickyBar>
        <ActionButton
          disabled={!valid}
          pending={start.isPending}
          pendingLabel="Setting it up…"
          onClick={() => {
            if (!person) {
              toast.error("Pick who you are paying.");
              return;
            }
            start.mutate(
              {
                employee: person.address,
                ratePerSecond: rate,
                durationSeconds,
                depositPaise,
                allowance: token?.allowance ?? 0n,
              },
              {
                onSuccess: (streamId) => {
                  toast.success("It is running.");
                  router.push(`/streams/${streamId}`);
                },
                onError: (err) => toast.error(streamError(err)),
              }
            );
          }}
        >
          {depositPaise > 0n
            ? `Start, and put in ${formatRupees(depositPaise)}`
            : "Start"}
        </ActionButton>
      </StickyBar>
    </div>
  );
}
