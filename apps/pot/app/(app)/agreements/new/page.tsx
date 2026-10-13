"use client";

/**
 * Record an agreement.
 *
 * ──────────────── the person recording it is the one funding ────────────────
 *
 * `createAgreement` stores `msg.sender` as the funder, so this screen can only
 * record an agreement where *you* are the one putting money in. Offering "I am
 * the one being funded" would need the contract to accept a funder argument, and
 * it does not.
 *
 * ──────────────── the wording is shown, then hashed ────────────────
 *
 * The contract refuses an agreement with no document behind it. There is no
 * signed PDF and no lending partner here, so the honest document is the plain
 * wording itself: it is built once, shown in full below, and that exact string is
 * what gets hashed. Nothing is signed, nothing is lent, and the preview says so.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton } from "@/components/feature/action-button";
import {
  AmountField,
  DateField,
  NumberField,
} from "@/components/feature/fields";
import {
  Alert,
  Avatar,
  EmptyState,
  RowList,
  StatRow,
  TestMoneyNote,
} from "@/components/feature/primitives";
import { ready } from "@/lib/contracts";
import {
  RECORDING_UNAVAILABLE,
  agreementError,
  monthlyShare,
  shortAddress,
  termsDocument,
  useCreateAgreement,
} from "@/lib/features/agreement";
import {
  dateInputDaysAhead,
  deadlineFromDateInput,
} from "@/lib/features/savings-state";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useKnownPeople, type Person } from "@/lib/people";
import { loadDisplayNames } from "@/lib/store";
import { useAppWallet } from "@/lib/tx";

export default function NewAgreementPage() {
  return (
    <AppShell back="/agreements" title="Record an agreement">
      <LoginGate>
        <NewAgreement />
      </LoginGate>
    </AppShell>
  );
}

function toPaise(raw: string): bigint {
  try {
    return raw.trim() ? rupeesToPaise(raw) : 0n;
  } catch {
    return 0n;
  }
}

function NewAgreement() {
  const router = useRouter();
  const create = useCreateAgreement();
  const { address } = useAppWallet();
  const { data: people, isLoading: peopleLoading } = useKnownPeople();

  // Your own saved name goes into the wording; the other person reads it later.
  const { data: myNames } = useQuery({
    queryKey: ["my-name", address],
    enabled: Boolean(address),
    queryFn: () => loadDisplayNames([address as string]),
  });

  // Fixed for the life of this screen: the preview and the hashed text must be
  // byte-identical, and the date is part of the text.
  const [drawnUpOn] = useState(() => new Date());

  const [recipient, setRecipient] = useState<Person | null>(null);
  const [funding, setFunding] = useState("");
  const [percent, setPercent] = useState(10);
  const [cap, setCap] = useState("");
  const [endDate, setEndDate] = useState(dateInputDaysAhead(365));

  const fundingPaise = toPaise(funding);
  const capPaise = toPaise(cap);
  const capOk = capPaise >= fundingPaise && fundingPaise > 0n;

  let termEndSeconds: number | null = null;
  try {
    termEndSeconds = Number(deadlineFromDateInput(endDate));
  } catch {
    termEndSeconds = null;
  }

  const funderName =
    (address && myNames?.[address.toLowerCase()]) ||
    (address ? shortAddress(address) : "You");

  const terms = useMemo(() => {
    if (!recipient || fundingPaise <= 0n || !capOk || termEndSeconds === null) {
      return "";
    }
    return termsDocument({
      funderName,
      recipientName: recipient.name,
      fundingPaise,
      percent,
      capPaise,
      termEndSeconds,
      drawnUpOn,
    });
  }, [
    recipient,
    fundingPaise,
    capOk,
    termEndSeconds,
    funderName,
    percent,
    capPaise,
    drawnUpOn,
  ]);

  if (!ready.agreements) {
    return (
      <Alert tone="attention" title="Not set up yet">
        This needs one more address in the app&apos;s settings.
      </Alert>
    );
  }

  if (peopleLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  if (!people || people.length === 0) {
    return (
      <EmptyState
        title="Nobody to record one with yet"
        body="You can record an agreement with people you already share a pot with. Make a pot and invite somebody first."
      />
    );
  }

  const valid = Boolean(recipient) && terms.length > 0 && termEndSeconds !== null;

  const submit = () => {
    if (!recipient || !terms || termEndSeconds === null) {
      toast.error("Fill in everything first.");
      return;
    }
    create.mutate(
      {
        recipient: recipient.address,
        fundingPaise,
        percent,
        capPaise,
        termEndSeconds,
        terms,
      },
      {
        onSuccess: (agreementId) => {
          toast.success("The agreement is on record.");
          router.push(`/agreements/${agreementId}`);
        },
        onError: (err) => toast.error(agreementError(err)),
      }
    );
  };

  return (
    <div className="space-y-8 pb-4">
      <Alert tone="attention" title="A record, not money">
        <p>
          You are recording that <strong>you</strong> are funding somebody, who
          will repay a share of what they earn. No money moves through this app
          and none is held by it.
        </p>
        <p className="mt-2">{RECORDING_UNAVAILABLE}</p>
      </Alert>

      <section>
        <h2 className="mb-3 text-small font-semibold text-foreground">
          Who are you funding?
        </h2>
        <RowList>
          {people.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => setRecipient(p)}
              className={`flex w-full items-center gap-3 px-5 py-3 text-left ${
                recipient?.address === p.address ? "bg-primary-subtle" : ""
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
        label="How much are you funding?"
        value={funding}
        onChange={setFunding}
      />

      <NumberField
        label="Share of their income, in percent"
        value={percent}
        onChange={setPercent}
        min={1}
        max={100}
        hint="Each month they repay this share of what they say they earned."
      />

      <AmountField
        label="The most they will ever repay"
        value={cap}
        onChange={setCap}
        error={
          cap.trim() && fundingPaise > 0n && !capOk
            ? "This has to be at least what you are funding."
            : undefined
        }
      />

      <DateField
        label="Repayments stop on"
        value={endDate}
        onChange={setEndDate}
        min={dateInputDaysAhead(1)}
        max={dateInputDaysAhead(3650)}
      />

      {terms ? (
        <section className="space-y-3">
          <h2 className="text-small font-semibold text-foreground">
            The exact wording that will be recorded
          </h2>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-4 text-small text-foreground">
            {terms}
          </pre>
          <Alert tone="progress" title="What this means in numbers">
            <StatRow label="Funded">{formatRupees(fundingPaise)}</StatRow>
            <StatRow label="Most ever repaid">{formatRupees(capPaise)}</StatRow>
            <StatRow label="On ₹10,000 of income">
              {formatRupees(monthlyShare(1_000_000n, BigInt(percent)))} a month
            </StatRow>
          </Alert>
        </section>
      ) : null}

      <TestMoneyNote />

      <StickyBar>
        <ActionButton
          disabled={!valid}
          pending={create.isPending}
          pendingLabel="Recording…"
          onClick={submit}
        >
          Record this agreement
        </ActionButton>
      </StickyBar>
    </div>
  );
}
