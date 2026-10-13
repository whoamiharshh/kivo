"use client";

/**
 * Pay a person — sending.
 *
 * ──────────────── the hold is the whole screen ────────────────
 *
 * SocialPay does not transfer money to the recipient. It *holds* it until they
 * say they got it, and returns it to the sender if they never do. A person who
 * does not understand that will either assume the payment failed and send
 * again, or assume it arrived and stop chasing. So this screen says what will
 * happen before the tap, in the summary directly above the button, in the same
 * words the list screen uses afterwards ("Waiting on them").
 *
 * ──────────────── why there is no address box ────────────────
 *
 * You choose a person, never an address — see the header of `lib/people.ts`
 * for why that is a product decision and not a convenience. The honest cost is
 * that you can only pay somebody you already share a pot with, so the empty
 * state says exactly that instead of leaving a blank list to be read as a bug.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton, StickyAction } from "@/components/feature/action-button";
import {
  AmountField,
  AmountPills,
  ChoiceGroup,
  TextField,
} from "@/components/feature/fields";
import {
  Alert,
  Avatar,
  Card,
  EmptyState,
  StatRow,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { SOCIAL_PAY_ADDRESS, ready } from "@/lib/contracts";
import { useSendPayment } from "@/lib/features/pay";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useKnownPeople, type Person } from "@/lib/people";
import { useTokenState } from "@/lib/token";
import { readableError } from "@/lib/tx";

/** The windows offered, inside the contract's own 1 hour … 30 days bounds. */
const WINDOWS = [
  {
    value: "1",
    title: "1 day",
    body: "Most payments. They have a day to accept.",
  },
  { value: "3", title: "3 days", body: "If they might not open the app today." },
  {
    value: "7",
    title: "7 days",
    body: "For something you are in no hurry about.",
  },
] as const;

type WindowChoice = (typeof WINDOWS)[number]["value"];

export default function NewPaymentPage() {
  return (
    <AppShell back="/pay" title="Pay someone">
      <LoginGate>
        <NewPayment />
      </LoginGate>
    </AppShell>
  );
}

function NewPayment() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [rupees, setRupees] = useState("");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState<WindowChoice>("1");

  const { data: people, isLoading: peopleLoading } = useKnownPeople();
  const { data: token } = useTokenState(SOCIAL_PAY_ADDRESS);
  const send = useSendPayment();

  if (!ready.pay) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Paying a person needs one more address in the app&apos;s settings.
      </Alert>
    );
  }

  // Parsed rather than validated twice: one try/catch is the single source of
  // truth for "is this a number we can send".
  let paise: bigint | null = null;
  let amountError: string | undefined;
  if (rupees.trim()) {
    try {
      paise = rupeesToPaise(rupees);
      if (paise === 0n) {
        paise = null;
        amountError = "Enter an amount above zero.";
      }
    } catch (err) {
      amountError = err instanceof Error ? err.message : "Enter an amount.";
    }
  }

  const balance = token?.balance;
  const tooMuch = paise !== null && balance !== undefined && paise > balance;
  const canSend = person !== null && paise !== null && !tooMuch;

  if (peopleLoading) {
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }

  if (!people || people.length === 0) {
    return (
      <EmptyState
        title="Nobody to pay yet"
        body="You can pay anyone you share a pot with. Make a pot and share the link, then they will show up here."
        action={
          <Link
            href="/create"
            className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-small font-semibold text-primary-foreground"
          >
            Create a pot
          </Link>
        }
      />
    );
  }

  const windowTitle = WINDOWS.find((w) => w.value === days)?.title;

  return (
    <div className="space-y-6 pb-4">
      {/* Step 1 — who. A chosen person collapses the list to one row so the
          amount is not pushed below the fold on a small phone. */}
      <section>
        <h2 className="mb-3 text-small font-semibold text-foreground">
          Who are you paying?
        </h2>

        {person ? (
          <button
            type="button"
            onClick={() => setPerson(null)}
            className="flex w-full items-center gap-3 rounded-lg border border-primary bg-primary-subtle p-4 text-left"
          >
            <Avatar name={person.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-primary-strong">
                {person.name}
              </span>
              <span className="block truncate text-small text-muted-foreground">
                {person.sharedPots.join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-small font-semibold text-primary-strong">
              Change
            </span>
          </button>
        ) : (
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {people.map((p) => (
              <button
                key={p.address}
                type="button"
                onClick={() => setPerson(p)}
                className="flex min-h-[64px] w-full items-center gap-3 px-5 py-3 text-left active:bg-muted/60"
              >
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-foreground">
                    {p.name}
                  </span>
                  <span className="block truncate text-small text-muted-foreground">
                    {p.sharedPots.join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* The rest appears only once there is somebody to pay — an amount with
          no recipient is not a thing a person can act on. */}
      {person ? (
        <>
          <section className="space-y-4">
            <AmountField
              label="How much?"
              value={rupees}
              onChange={setRupees}
              error={
                amountError ??
                (tooMuch && balance !== undefined
                  ? `You have ${formatRupees(balance)}.`
                  : undefined)
              }
              hint={
                balance !== undefined && !amountError && !tooMuch
                  ? `You have ${formatRupees(balance)}`
                  : undefined
              }
            />
            <AmountPills options={[100, 500, 1000, 2000]} onPick={setRupees} />
          </section>

          <TextField
            label="What is it for?"
            value={memo}
            onChange={setMemo}
            placeholder="Cab to the airport"
            hint="They will see this. Only a fingerprint of the text is stored publicly."
          />

          <ChoiceGroup
            label="How long do they have to accept?"
            value={days}
            onChange={setDays}
            options={WINDOWS.map((w) => ({ ...w }))}
          />

          {/* The summary is the honesty of this screen: it names the hold and
              what happens if nobody acts, in advance. */}
          {paise !== null ? (
            <Card>
              <StatRow label="They receive">{formatRupees(paise)}</StatRow>
              <StatRow label="Held until they accept" emphasis>
                {windowTitle}
              </StatRow>
              <p className="mt-3 text-small text-muted-foreground">
                The money leaves your balance now and is held until{" "}
                {person.name} says they got it. If they never do, you can take
                it back after {windowTitle}.
              </p>
              <TestMoneyNote className="mt-3" />
            </Card>
          ) : null}
        </>
      ) : null}

      <StickyAction>
        <ActionButton
          disabled={!canSend}
          pending={send.isPending}
          pendingLabel="Sending…"
          onClick={() => {
            if (!person || paise === null) return;
            const amount = paise;
            send.mutate(
              {
                recipient: person.address,
                amountPaise: amount,
                memo,
                confirmWindowSeconds: Number(days) * 24 * 60 * 60,
                // Zero when the balance has not loaded, which makes the send
                // path do the one-time approval rather than skip it. Skipping
                // it wrongly costs a person a reverted payment; doing it when
                // it was not needed costs nothing.
                allowance: token?.allowance ?? 0n,
              },
              {
                onSuccess: () => {
                  toast.success(
                    `${formatRupees(amount)} sent to ${person.name}`
                  );
                  router.push("/pay");
                },
                onError: (err) => toast.error(readableError(err)),
              }
            );
          }}
        >
          {paise !== null ? `Send ${formatRupees(paise)}` : "Send"}
        </ActionButton>
      </StickyAction>
    </div>
  );
}
