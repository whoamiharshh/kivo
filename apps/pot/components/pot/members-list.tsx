"use client";

import { Person } from "@/components/person";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupees } from "@/lib/money";

/** Who is in the pot and what each person has put in so far. */
export function MembersList({
  members,
  me,
  maxMembers,
}: {
  members: { address: `0x${string}`; name: string | null; contributed: bigint }[];
  me: string | undefined;
  maxMembers: number;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        In this pot ({members.length} of {maxMembers})
      </h2>
      <Card>
        <CardContent className="divide-y p-0">
          {members.map((m) => (
            <div
              key={m.address}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <Person address={m.address} name={m.name} you={me} />
              <span className="tabular text-sm font-medium">
                {m.contributed > 0n ? formatRupees(m.contributed) : "—"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
