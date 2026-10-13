"use client";

/**
 * Set a gift aside.
 *
 * ──────────────── the two kinds are a real fork, not a toggle ────────────────
 *
 * A date gift needs nobody: it unlocks itself when the day comes. A condition
 * gift needs a person, and that person is the whole trust model. Asking for
 * both and quietly ignoring one would let somebody name a confirmer for a
 * birthday gift and believe it mattered. So the choice comes first and the
 * rest of the form changes underneath it.
 *
 * ──────────────── "firm promise" is shown as a consequence ────────────────
 *
 * Promising firmly is the one switch here with no undo. It is offered with
 * the sentence that says what it costs rather than a label and a tooltip,
 * because somebody who flips it without reading has given away a right they
 * cannot ask for back.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import {
  AmountField,
  ChoiceGroup,
  DateField,
  TextField,
} from "@/components/feature/fields";
import { ActionButton } from "@/components/feature/action-button";
import {
  Alert,
  Avatar,
  EmptyState,
  RowList,
  StatRow,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { GIFT_ADDRESS, ready } from "@/lib/contracts";
import {
  CONFIRMER_DISCLOSURE,
  IRREVOCABLE_EXPLAINER,
  giftError,
  useCreateGift,
} from "@/lib/features/gift";
import {
  dateInputDaysAhead,
  deadlineFromDateInput,
} from "@/lib/features/savings-state";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useKnownPeople, type Person } from "@/lib/people";
import { useTokenState } from "@/lib/token";

export default function NewGiftPage() {
  return (
    <AppShell back="/gifts" title="Set a gift aside">
      <LoginGate>
        <NewGift />
      </LoginGate>
    </AppShell>
  );
}

function NewGift() {
  const router = useRouter();
  const create = useCreateGift();
  const { data: people, isLoading: peopleLoading } = useKnownPeople();
  const { data: token } = useTokenState(GIFT_ADDRESS);

  const [recipient, setRecipient] = useState<Person | null>(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"date" | "condition">("date");
  const [date, setDate] = useState(dateInputDaysAhead(30));
  const [confirmer, setConfirmer] = useState<Person | null>(null);
  const [firm, setFirm] = useState(false);

  if (!ready.gifts) {
    return (
      <Alert tone="attention" title="Not set up yet">
        Gifts need one more address in this app&apos;s settings.
      </Alert>
    );
  }

  if (peopleLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  if (!people || people.length === 0) {
    return (
      <EmptyState
        title="Nobody to give to yet"
        body="You can set a gift aside for people you already share a pot with. Make a pot and invite somebody first."
      />
    );
  }

  let amountPaise = 0n;
  try {
    amountPaise = amount.trim() ? rupeesToPaise(amount) : 0n;
  } catch {
    amountPaise = 0n;
  }

  // The person receiving it cannot also be the one who confirms it: that
  // would let them unlock their own gift, which is not a promise at all.
  const confirmers = people.filter((p) => p.address !== recipient?.address);

  const valid =
    Boolean(recipient) &&
    amountPaise > 0n &&
    (kind === "date" ? date.trim().length > 0 : Boolean(confirmer));

  const submit = () => {
    if (!recipient) {
      toast.error("Choose who the gift is for.");
      return;
    }
    if (amountPaise <= 0n) {
      toast.error("Enter an amount first.");
      return;
    }

    let releaseTime: bigint | undefined;
    if (kind === "date") {
      try {
        releaseTime = deadlineFromDateInput(date);
      } catch {
        toast.error("Pick a date.");
        return;
      }
    } else if (!confirmer) {
      toast.error("Choose who confirms it.");
      return;
    }

    create.mutate(
      {
        recipient: recipient.address,
        amountPaise,
        message: message.trim(),
        kind,
        releaseTime,
        attester: confirmer?.address,
        irrevocable: firm,
        allowance: token?.allowance ?? 0n,
      },
      {
        onSuccess: (giftId) => {
          toast.success("The gift is set aside.");
          router.push(`/gifts/${giftId}`);
        },
        onError: (err) => toast.error(giftError(err)),
      }
    );
  };

  return (
    <div className="space-y-8 pb-4">
      <PersonPicker
        label="Who is it for?"
        people={people}
        chosen={recipient}
        onChoose={setRecipient}
      />

      <AmountField label="How much?" value={amount} onChange={setAmount} />

      <TextField
        label="What is it for?"
        value={message}
        onChange={setMessage}
        placeholder="When you finish your exams"
      />

      <ChoiceGroup
        label="When should it unlock?"
        value={kind}
        onChange={setKind}
        options={[
          {
            value: "date",
            title: "On a date",
            body: "It unlocks by itself. Nobody has to do anything.",
          },
          {
            value: "condition",
            title: "When somebody confirms it",
            body: "A person you both trust says the thing happened.",
          },
        ]}
      />

      {kind === "date" ? (
        <DateField
          label="Unlocks on"
          value={date}
          onChange={setDate}
          min={dateInputDaysAhead(1)}
          max={dateInputDaysAhead(365)}
        />
      ) : (
        <>
          <PersonPicker
            label="Who confirms it?"
            people={confirmers}
            chosen={confirmer}
            onChoose={setConfirmer}
          />
          <Alert tone="attention" title="What confirming actually means">
            {CONFIRMER_DISCLOSURE}
          </Alert>
        </>
      )}

      <section>
        <label className="flex cursor-pointer gap-3 rounded-md border bg-card p-4">
          <input
            type="checkbox"
            checked={firm}
            onChange={(e) => setFirm(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-foreground">
              Promise it firmly
            </span>
            <span className="mt-1 block text-small text-muted-foreground">
              {IRREVOCABLE_EXPLAINER}
            </span>
          </span>
        </label>
      </section>

      {amountPaise > 0n ? (
        <Alert tone="progress" title="What you are setting aside">
          <StatRow label="Amount">{formatRupees(amountPaise)}</StatRow>
          <StatRow label="Can you take it back?">
            {firm ? "No, it is a firm promise" : "Yes, while it is waiting"}
          </StatRow>
        </Alert>
      ) : null}

      <TestMoneyNote />

      <StickyBar>
        <ActionButton
          disabled={!valid}
          pending={create.isPending}
          pendingLabel="Setting it aside…"
          onClick={submit}
        >
          {amountPaise > 0n
            ? `Set aside ${formatRupees(amountPaise)}`
            : "Set a gift aside"}
        </ActionButton>
      </StickyBar>
    </div>
  );
}

function PersonPicker({
  label,
  people,
  chosen,
  onChoose,
}: {
  label: string;
  people: Person[];
  chosen: Person | null;
  onChoose: (p: Person) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-small font-semibold text-foreground">{label}</h2>
      <RowList>
        {people.map((p) => (
          <button
            key={p.address}
            type="button"
            onClick={() => onChoose(p)}
            className={`flex w-full items-center gap-3 px-5 py-3 text-left ${
              chosen?.address === p.address ? "bg-primary-subtle" : ""
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
  );
}
