"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { Person } from "@/components/person";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useJoinPot } from "@/lib/actions";
import { formatRupees } from "@/lib/money";
import { PotState, usePot } from "@/lib/queries";
import { deadlineExact, deadlineLabel, isPast } from "@/lib/time";
import { readableError, useAppWallet } from "@/lib/tx";

export default function JoinPage() {
  return (
    <AppShell back="/" title="Join a pot">
      <LoginGate>
        <JoinView />
      </LoginGate>
    </AppShell>
  );
}

function JoinView() {
  const params = useParams<{ potId: string; code: string }>();
  const router = useRouter();
  const potId = Number(params.potId);
  const code = params.code as `0x${string}`;
  const codeLooksValid = /^0x[0-9a-fA-F]{64}$/.test(code ?? "");

  const { address } = useAppWallet();
  const pot = usePot(Number.isFinite(potId) ? potId : undefined);
  const join = useJoinPot();
  const [myName, setMyName] = useState("");

  if (!codeLooksValid) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          That invite link doesn&apos;t look right. Ask your friend to send it
          again.
        </CardContent>
      </Card>
    );
  }

  if (pot.isLoading || !pot.data) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  const { name, pot: p, members } = pot.data;
  const already = members.some(
    (m) => m.address.toLowerCase() === address?.toLowerCase()
  );
  const full = members.length >= p.maxMembers;

  if (already) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">You&apos;re already in {name}.</p>
          </CardContent>
        </Card>
        <Button
          className="h-12 w-full text-base"
          onClick={() => router.push(`/pot/${potId}`)}
        >
          Open pot
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to
          </p>
          <p className="text-2xl font-semibold leading-tight">{name}</p>
          <p className="text-sm text-muted-foreground">
            {members.length} of {p.maxMembers} people have joined
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="tabular font-medium text-foreground">
              {formatRupees(p.totalContributed)}
            </span>{" "}
            of {formatRupees(p.targetAmount)} collected ·{" "}
            {deadlineLabel(p.deadline)}
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            If the pot doesn&apos;t reach {formatRupees(p.targetAmount)} by{" "}
            {deadlineExact(p.deadline)}, everyone takes their money back.
          </p>
        </CardContent>
      </Card>

      {members.length > 0 ? (
        <Card>
          <CardContent className="divide-y p-0">
            {members.map((m) => (
              <div key={m.address} className="px-4 py-3">
                <Person address={m.address} name={m.name} you={address} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {p.state === PotState.Closed || p.state === PotState.Refunding ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {p.state === PotState.Refunding
              ? "This pot didn't reach its target in time, so it's returning everyone's money. You can't join now."
              : "This pot is already finished."}
          </CardContent>
        </Card>
      ) : p.state === PotState.Collecting && isPast(p.deadline) ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            The date for this pot has passed, so it&apos;s no longer taking
            people.
          </CardContent>
        </Card>
      ) : full ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            This pot is full.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              autoFocus
              value={myName}
              maxLength={24}
              placeholder="So friends know who put in what"
              className="h-12 text-base"
              onChange={(e) => setMyName(e.target.value)}
            />
          </div>

          <StickyBar>
            <Button
              size="lg"
              className="h-12 w-full text-base"
              disabled={join.isPending}
              onClick={() =>
                join.mutate(
                  { potId, inviteCode: code, myName },
                  {
                    onSuccess: () => {
                      toast.success(`You're in ${name}`);
                      router.push(`/pot/${potId}`);
                    },
                    onError: (err) => toast.error(readableError(err)),
                  }
                )
              }
            >
              {join.isPending ? "Joining…" : "Join this pot"}
            </Button>
          </StickyBar>
        </>
      )}
    </div>
  );
}
