"use client";

/**
 * Take out cover — the form.
 *
 * ──────────────── what paying here actually buys ────────────────
 *
 * Paying the premium puts it in holding. It does not start any cover: an insurer
 * has to take on the risk, and on this test setup there is no insurer able to —
 * the key that would do it has been treated as compromised and switched off.
 * So the honest summary of this screen is "put a premium in holding, and take it
 * back after a day", and it is said in those words before any money moves, not
 * discovered afterwards.
 *
 * Nothing here is priced. A premium is the number a licensed underwriter exists
 * to produce, so the person sets both amounts themselves.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { parseEventLogs } from "viem";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActionButton } from "@/components/feature/action-button";
import { CoverTerms } from "@/components/feature/cover/cover-terms";
import {
  CoverNotSetUpNotice,
  NoEvidenceStoreNote,
  NotCoveredYetNotice,
  NotInsuranceNotice,
} from "@/components/feature/cover/cover-notices";
import {
  AmountField,
  ChoiceGroup,
  TextField,
} from "@/components/feature/fields";
import { Alert, TestMoneyNote } from "@/components/feature/primitives";
import { MICRO_COVER_ADDRESS, microCoverAbi, ready } from "@/lib/contracts";
import { coverError, useTakeOutCover } from "@/lib/features/cover";
import {
  COVER_SHAPES,
  INSURER_UNAVAILABLE,
  PERIODS,
  type PeriodChoice,
} from "@/lib/features/cover-state";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { useNowSeconds } from "@/lib/now";
import { useTokenState } from "@/lib/token";

export default function NewCoverPage() {
  return (
    <AppShell back="/cover" title="Take out cover">
      <LoginGate>
        <NewCover />
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

function NewCover() {
  const router = useRouter();
  const nowSeconds = useNowSeconds(60_000);
  const takeOut = useTakeOutCover();
  const { data: token } = useTokenState(MICRO_COVER_ADDRESS);

  const [shapeId, setShapeId] = useState<(typeof COVER_SHAPES)[number]["id"]>(
    COVER_SHAPES[0].id
  );
  const [terms, setTerms] = useState<string>(COVER_SHAPES[0].suggestedTerms);
  const [period, setPeriod] = useState<PeriodChoice>("1d");
  const [premium, setPremium] = useState("");
  const [coverage, setCoverage] = useState("");

  if (!ready.policies) return <CoverNotSetUpNotice />;

  const shape = COVER_SHAPES.find((s) => s.id === shapeId) ?? COVER_SHAPES[0];
  const periodSeconds = PERIODS.find((p) => p.value === period)?.seconds ?? 86_400;
  const premiumPaise = toPaise(premium);
  const coveragePaise = toPaise(coverage);

  const coverageOk = coveragePaise > premiumPaise;
  const valid =
    terms.trim().length > 0 && premiumPaise > 0n && coverageOk;

  const submit = () => {
    if (!terms.trim()) {
      toast.error("Say what this cover is for first.");
      return;
    }
    if (premiumPaise <= 0n) {
      toast.error("Enter a premium.");
      return;
    }
    if (!coverageOk) {
      toast.error("The cover amount has to be more than the premium.");
      return;
    }
    if (token && token.balance < premiumPaise) {
      toast.error("You don't have enough test money. Collect some first.");
      return;
    }

    takeOut.mutate(
      {
        terms,
        premiumPaise,
        coveragePaise,
        durationSeconds: periodSeconds,
        allowance: token?.allowance ?? 0n,
      },
      {
        onSuccess: (receipt) => {
          const created = parseEventLogs({
            abi: microCoverAbi,
            eventName: "PolicyCreated",
            logs: receipt.logs,
          })[0];
          toast.success("Premium is in holding. You are not covered yet.");
          if (created) {
            const id = Number((created.args as { policyId: bigint }).policyId);
            router.push(`/cover/${id}`);
          } else {
            router.push("/cover");
          }
        },
        onError: (err) => toast.error(coverError(err)),
      }
    );
  };

  return (
    <div className="space-y-8 pb-4">
      <NotInsuranceNotice />

      <ChoiceGroup
        label="What do you want to cover?"
        value={shapeId}
        onChange={(next) => {
          setShapeId(next);
          const picked = COVER_SHAPES.find((s) => s.id === next);
          if (picked) setTerms(picked.suggestedTerms);
        }}
        options={COVER_SHAPES.map((s) => ({
          value: s.id,
          title: s.title,
          body: s.summary,
        }))}
      />

      <TextField
        label="In your own words"
        value={terms}
        onChange={setTerms}
        maxLength={200}
        placeholder="Cover for my laptop against accidental damage today"
        hint="This is the wording that would apply. Only a fingerprint of it goes on record."
      />

      <ChoiceGroup
        label="For how long?"
        value={period}
        onChange={setPeriod}
        options={PERIODS.map((p) => ({
          value: p.value,
          title: p.title,
          body: "",
        }))}
      />

      <div className="space-y-6">
        <AmountField
          label="Premium — what you pay"
          value={premium}
          onChange={setPremium}
        />
        <AmountField
          label="Cover amount — the most it would pay"
          value={coverage}
          onChange={setCoverage}
          error={
            coverage.trim() && premiumPaise > 0n && !coverageOk
              ? "This has to be more than the premium."
              : undefined
          }
        />
        <p className="text-small text-muted-foreground">
          Nothing here is priced for you. A premium is the number a licensed
          insurer works out, and there isn&apos;t one — so you choose both
          amounts yourself.
        </p>
      </div>

      {premiumPaise > 0n && coverageOk ? (
        <CoverTerms
          terms={terms}
          premiumPaise={premiumPaise}
          coveragePaise={coveragePaise}
          startSeconds={nowSeconds}
          endSeconds={nowSeconds + periodSeconds}
          cannotCheck={shape.cannotCheck}
          nowSeconds={nowSeconds}
          inForce={false}
        />
      ) : null}

      <NotCoveredYetNotice />

      <Alert tone="attention" title="This can't start on this test setup">
        {INSURER_UNAVAILABLE.bind}
      </Alert>

      <NoEvidenceStoreNote />
      <TestMoneyNote />

      <StickyBar>
        <ActionButton
          disabled={!valid}
          pending={takeOut.isPending}
          pendingLabel="Putting it in holding…"
          onClick={submit}
        >
          {premiumPaise > 0n
            ? `Put ${formatRupees(premiumPaise)} in holding`
            : "Put a premium in holding"}
        </ActionButton>
      </StickyBar>
    </div>
  );
}
