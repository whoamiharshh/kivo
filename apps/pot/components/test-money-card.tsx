"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollectTestMoney } from "@/lib/actions";
import { formatRupees } from "@/lib/money";
import { useTestMoney } from "@/lib/queries";
import { readableError } from "@/lib/tx";
import { NameRow } from "@/components/name-row";

/** What this person has to put into pots, plus the one-tap top-up. */
export function TestMoneyCard() {
  const { data, isLoading } = useTestMoney();
  const collect = useCollectTestMoney();

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Your money</p>
            {isLoading || !data ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <p className="tabular text-3xl font-semibold leading-none">
                {formatRupees(data.balance)}
              </p>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0">
            test money
          </Badge>
        </div>

        <Button
          variant="outline"
          className="h-11 w-full"
          disabled={collect.isPending || (data ? !data.canCollect : false)}
          onClick={() => {
            collect.mutate(undefined, {
              onSuccess: () => toast.success("₹5,000 test money added"),
              onError: (err) => toast.error(readableError(err)),
            });
          }}
        >
          {collect.isPending
            ? "Adding…"
            : data && !data.canCollect
              ? "Come back tomorrow for more"
              : "Get ₹5,000 test money"}
        </Button>

        <NameRow />
      </CardContent>
    </Card>
  );
}
