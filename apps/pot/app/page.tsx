"use client";

import Link from "next/link";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { TestMoneyCard } from "@/components/test-money-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupees } from "@/lib/money";
import { PotState, useMyPots } from "@/lib/queries";
import { deadlineLabel } from "@/lib/time";

export default function HomePage() {
  return (
    <AppShell>
      <LoginGate>
        <Home />
      </LoginGate>
    </AppShell>
  );
}

function Home() {
  const { data: pots, isLoading, isError, refetch } = useMyPots();

  return (
    <div className="space-y-6">
      <TestMoneyCard />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Your pots</h2>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="space-y-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load your pots.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetch();
                  toast.message("Trying again…");
                }}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !pots || pots.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <p className="text-[15px] font-medium">No pots yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Make one for your next trip or your flat&apos;s groceries, then
                share the link on WhatsApp.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {pots.map(({ potId, pot, name }) => {
              const collecting = pot.state === PotState.Collecting;
              const pct =
                pot.targetAmount === 0n
                  ? 0
                  : Number((pot.totalContributed * 100n) / pot.targetAmount);
              return (
                <li key={potId}>
                  <Link href={`/pot/${potId}`} className="block">
                    <Card className="transition-colors hover:border-primary/40">
                      <CardContent className="space-y-3 py-4">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{name}</p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {collecting
                                ? deadlineLabel(pot.deadline)
                                : pot.state === PotState.Funded
                                  ? "Ready to spend"
                                  : pot.state === PotState.Refunding
                                    ? "Money is claimable"
                                    : "Finished"}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="tabular text-lg font-semibold leading-tight">
                              {formatRupees(
                                collecting ? pot.totalContributed : pot.balance
                              )}
                            </p>
                            {collecting ? (
                              <p className="tabular text-xs text-muted-foreground">
                                of {formatRupees(pot.targetAmount)}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {collecting ? (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        ) : (
                          <Badge
                            variant={
                              pot.state === PotState.Funded
                                ? "default"
                                : pot.state === PotState.Refunding
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {pot.state === PotState.Funded
                              ? "Target reached"
                              : pot.state === PotState.Refunding
                                ? "Didn't fill up"
                                : "Closed"}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <StickyBar>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          render={<Link href="/create" />}
        >
          Create a pot
        </Button>
      </StickyBar>
    </div>
  );
}
