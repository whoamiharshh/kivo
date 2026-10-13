"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, StickyBar } from "@/components/app-shell";
import { LoginGate } from "@/components/login-gate";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreatePot } from "@/lib/actions";
import { formatRupees, rupeesToPaise } from "@/lib/money";
import { defaultDeadlineInput, localInputToUnix } from "@/lib/time";
import { readableError } from "@/lib/tx";

const MAX_MEMBERS_CAP = 20;

export default function CreatePage() {
  return (
    <AppShell back="/" title="New pot">
      <LoginGate>
        <CreateForm />
      </LoginGate>
    </AppShell>
  );
}

function CreateForm() {
  const router = useRouter();
  const create = useCreatePot();

  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState(() => defaultDeadlineInput(7));
  const [limit, setLimit] = useState("1000");
  const [maxMembers, setMaxMembers] = useState("6");

  const members = Number(maxMembers);
  const membersValid =
    Number.isInteger(members) && members >= 2 && members <= MAX_MEMBERS_CAP;

  let targetPaise = 0n;
  try {
    targetPaise = target ? rupeesToPaise(target) : 0n;
  } catch {
    targetPaise = 0n;
  }
  const perPerson =
    membersValid && targetPaise > 0n ? targetPaise / BigInt(members) : 0n;

  function submit() {
    if (!name.trim()) return toast.error("Give the pot a name.");
    if (!membersValid) {
      return toast.error(`Pick between 2 and ${MAX_MEMBERS_CAP} people.`);
    }

    let targetValue: bigint;
    let approvalLimitPaise: bigint;
    let deadlineUnix: bigint;
    try {
      targetValue = rupeesToPaise(target);
      approvalLimitPaise = limit ? rupeesToPaise(limit) : 0n;
      deadlineUnix = localInputToUnix(deadline);
    } catch (err) {
      return toast.error(
        err instanceof Error ? err.message : "Check the details."
      );
    }

    if (targetValue === 0n) {
      return toast.error("Set how much the group is collecting.");
    }
    if (deadlineUnix <= BigInt(Math.floor(Date.now() / 1000))) {
      return toast.error("Pick a date in the future.");
    }

    create.mutate(
      {
        name,
        myName,
        targetPaise: targetValue,
        perPersonPaise: perPerson,
        approvalLimitPaise,
        maxMembers: members,
        deadline: deadlineUnix,
      },
      {
        onSuccess: ({ potId }) => {
          toast.success("Pot created");
          router.push(`/pot/${potId}?invite=1`);
        },
        onError: (err) => toast.error(readableError(err)),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="pot-name">What&apos;s this pot for?</Label>
        <Input
          id="pot-name"
          autoFocus
          value={name}
          maxLength={40}
          placeholder="Goa trip · Fest decor · Flat groceries"
          className="h-12 text-base"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="target">How much does the group need?</Label>
        <MoneyInput id="target" value={target} onChange={setTarget} />
        <p className="text-sm text-muted-foreground">
          Nothing can be spent until the pot reaches this. If it doesn&apos;t,
          everyone takes their money back.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="deadline">By when?</Label>
        <Input
          id="deadline"
          type="datetime-local"
          value={deadline}
          className="h-12 text-base"
          onChange={(e) => setDeadline(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          After this, money can&apos;t go in. If the target was missed, it
          becomes refundable.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="members">How many people, at most</Label>
        <Input
          id="members"
          value={maxMembers}
          inputMode="numeric"
          className="tabular h-12 text-base"
          onChange={(e) =>
            setMaxMembers(e.target.value.replace(/[^\d]/g, "").slice(0, 2))
          }
        />
        {!membersValid && maxMembers !== "" ? (
          <p className="text-sm text-destructive">
            Between 2 and {MAX_MEMBERS_CAP} people.
          </p>
        ) : (
          perPerson > 0n && (
            <p className="text-sm text-muted-foreground">
              That&apos;s about{" "}
              <span className="tabular font-medium text-foreground">
                {formatRupees(perPerson)}
              </span>{" "}
              each — a suggestion only, nobody is charged automatically.
            </p>
          )
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="limit">Each person can repay, in total, up to</Label>
        <MoneyInput id="limit" value={limit} onChange={setLimit} />
        <p className="text-sm text-muted-foreground">
          Once the pot is full, each person can repay friends up to this much
          in total, straight away. After they&apos;ve used that up — or to
          repay themselves — one other person has to approve.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="my-name">Your name</Label>
        <Input
          id="my-name"
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
          disabled={create.isPending}
          onClick={submit}
        >
          {create.isPending ? "Creating…" : "Create pot"}
        </Button>
      </StickyBar>
    </div>
  );
}
