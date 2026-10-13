"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { motion } from "motion/react";
import { DURATION, EASE } from "@/lib/motion";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { ActivityFeed } from "@/components/pot/activity-feed";
import { AddMoneyDialog } from "@/components/pot/add-money-dialog";
import { ClosePotDialog } from "@/components/pot/close-dialog";
import { InviteCard } from "@/components/pot/invite-card";
import { MembersList } from "@/components/pot/members-list";
import { PendingList } from "@/components/pot/pending-list";
import { StateBadge, TargetProgress } from "@/components/pot/pot-status";
import { RefundCard } from "@/components/pot/refund-card";
import { RepayDialog } from "@/components/pot/repay-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupees } from "@/lib/money";
import { PotState, usePot, usePotActivity } from "@/lib/queries";
import { isPast } from "@/lib/time";
import { useAppWallet } from "@/lib/tx";

/**
 * The route's own parameters are read inside a Suspense boundary.
 *
 * Which pot, which payment, which invite code is in the URL, and the URL is
 * only known when somebody actually asks for the page. Reading it above a
 * boundary would stop Next from prerendering the frame around it, so the
 * person would wait on an empty screen instead of seeing the shell at once.
 */
export default function PotPage() {
  return (
    <LoginGate>
      <Suspense fallback={<PotSkeleton />}>
        <PotView />
      </Suspense>
    </LoginGate>
  );
}

function PotSkeleton() {
  return (
    <AppShell back="/">
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </AppShell>
  );
}

function PotView() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const potId = Number(params.id);
  const { address } = useAppWallet();

  const pot = usePot(Number.isFinite(potId) ? potId : undefined);
  const isPotMember = Boolean(
    address &&
      pot.data?.members.some(
        (member) => member.address.toLowerCase() === address.toLowerCase()
      )
  );
  const activity = usePotActivity(
    isPotMember && Number.isFinite(potId) ? potId : undefined
  );

  if (pot.isLoading || !pot.data) {
    return (
      <AppShell back="/">
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </AppShell>
    );
  }

  if (pot.isError) {
    return (
      <AppShell back="/">
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="font-medium">We couldn&apos;t find that pot.</p>
            <p className="text-sm text-muted-foreground">
              The link may be wrong, or the pot may not exist yet.
            </p>
            <Button variant="outline" onClick={() => void pot.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const {
    name,
    pot: p,
    members,
    perPersonPaise,
    inviteCode,
    remainingToTarget,
    myRefund,
    myInstantRemaining,
    available,
  } = pot.data;

  const isMember = isPotMember;
  const isCreator = p.creator.toLowerCase() === address?.toLowerCase();
  const spotsLeft = Math.max(0, p.maxMembers - members.length);
  const justCreated = search.get("invite") === "1";
  const names = activity.data?.names ?? {};

  const collecting = p.state === PotState.Collecting;
  const funded = p.state === PotState.Funded;
  const closed = p.state === PotState.Closed;
  const failedButNotFinalized = collecting && isPast(p.deadline);
  const canAddMoney = isMember && collecting && !failedButNotFinalized;

  return (
    <AppShell back="/" title={name}>
      <div className="space-y-6">
        {/* The same vessel as on the home screen, larger. One product, one
            idea: the box fills as the money goes in. Left-aligned rather than
            centred — a centred figure reads as a receipt, and this is a thing
            being filled, not a total being presented. */}
        <div className="relative overflow-hidden rounded-lg border bg-card">
          <motion.div
            aria-hidden="true"
            initial={{ scaleY: 0 }}
            animate={{
              scaleY:
                p.targetAmount === 0n
                  ? 0
                  : Math.min(
                      1,
                      Number((p.totalContributed * 100n) / p.targetAmount) / 100
                    ),
            }}
            transition={{ duration: DURATION.progress, ease: EASE }}
            className={`absolute inset-0 origin-bottom ${
              p.state === PotState.Refunding
                ? "bg-warning-bg"
                : funded
                  ? "bg-success-bg"
                  : "bg-primary-subtle"
            }`}
          />

          <div className="relative space-y-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {collecting ? "Collected so far" : "In the pot"}
              </p>
              <StateBadge pot={p} />
            </div>

            <p className="tabular text-4xl font-semibold leading-none">
              {formatRupees(collecting ? p.totalContributed : p.balance)}
            </p>

            <TargetProgress pot={p} remaining={remainingToTarget} />

            {funded ? (
              <div className="space-y-1 border-t pt-3 text-sm text-muted-foreground">
                {p.reserved > 0n ? (
                  <p>
                    <span className="tabular font-medium text-foreground">
                      {formatRupees(available)}
                    </span>{" "}
                    free to use ·{" "}
                    <span className="tabular">{formatRupees(p.reserved)}</span>{" "}
                    set aside for repayments waiting on approval
                  </p>
                ) : (
                  <p>Everything in the pot is free to use.</p>
                )}
                {isMember ? (
                  <p>
                    You can repay up to{" "}
                    <span className="tabular font-medium text-foreground">
                      {formatRupees(myInstantRemaining)}
                    </span>{" "}
                    more without asking anyone.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {!isMember ? (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              You&apos;re not in this pot. Ask a friend for the invite link.
            </CardContent>
          </Card>
        ) : null}

        <RefundCard
          potId={potId}
          pot={p}
          myRefund={myRefund}
          isMember={isMember}
        />

        {isMember &&
        collecting &&
        !failedButNotFinalized &&
        (justCreated || spotsLeft > 0) ? (
          <InviteCard
            potId={potId}
            potName={name}
            inviteCode={inviteCode}
            spotsLeft={spotsLeft}
          />
        ) : null}

        {isMember ? (
          <PendingList
            potId={potId}
            pending={activity.data?.pending ?? []}
            names={names}
            me={address}
            creator={p.creator}
            closed={!funded}
          />
        ) : null}

        <MembersList members={members} me={address} maxMembers={p.maxMembers} />

        {isMember && activity.isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : isMember && activity.isError ? (
          <Card>
            <CardContent className="space-y-3 py-6 text-center">
              <p className="font-medium">History couldn&apos;t load.</p>
              <p className="text-sm text-muted-foreground">
                Nothing has been changed. Try again when you&apos;re back online.
              </p>
              <Button variant="outline" onClick={() => void activity.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : isMember ? (
          <ActivityFeed
            items={activity.data?.items ?? []}
            names={names}
            me={address}
          />
        ) : null}

        {isCreator && funded ? (
          <ClosePotDialog
            potId={potId}
            members={members}
            balance={p.balance}
            totalContributed={p.totalContributed}
            pendingCount={p.pendingSpendCount}
            me={address}
            trigger={
              <Button variant="ghost" className="w-full text-muted-foreground">
                Close pot and return what&apos;s left
              </Button>
            }
          />
        ) : null}

        {closed ? (
          <p className="pb-2 text-center text-sm text-muted-foreground">
            This pot is finished. Nothing more can go in or out.
          </p>
        ) : null}
      </div>

      {canAddMoney || (isMember && funded) ? (
        <StickyBar>
          <div className="flex gap-2">
            {canAddMoney ? (
              <AddMoneyDialog
                potId={potId}
                suggestedPaise={perPersonPaise}
                remainingToTarget={remainingToTarget}
                trigger={
                  <Button size="lg" className="h-12 flex-1 text-base">
                    Add money
                  </Button>
                }
              />
            ) : null}

            {isMember && funded ? (
              <RepayDialog
                potId={potId}
                members={members}
                me={address}
                available={available}
                instantRemaining={myInstantRemaining}
                trigger={
                  <Button size="lg" className="h-12 flex-1 text-base">
                    Repay someone
                  </Button>
                }
              />
            ) : null}
          </div>
        </StickyBar>
      ) : null}
    </AppShell>
  );
}
