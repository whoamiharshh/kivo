"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetMyName } from "@/lib/actions";
import { loadDisplayNames } from "@/lib/store";
import { useAppWallet } from "@/lib/tx";
import { personLabel } from "@/components/person";

/** The name friends see next to your share. Stored offchain, never onchain. */
export function NameRow() {
  const { address } = useAppWallet();
  const setName = useSetMyName();
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!address) return;
    let live = true;
    void loadDisplayNames([address]).then((names) => {
      if (live) setSaved(names[address.toLowerCase()] ?? null);
    });
    return () => {
      live = false;
    };
  }, [address]);

  if (!address) return null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(saved ?? "");
          setEditing(true);
        }}
        className="w-full text-left text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Friends see you as{" "}
        <span className="font-medium text-foreground">
          {personLabel(address, saved)}
        </span>
        {" — change"}
      </button>
    );
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const next = draft.trim();
        if (!next) return;
        setName.mutate(next, {
          onSuccess: () => {
            setSaved(next);
            setEditing(false);
            toast.success("Name saved");
          },
          onError: () => toast.error("Couldn't save that name."),
        });
      }}
    >
      <Input
        autoFocus
        value={draft}
        maxLength={24}
        placeholder="Your name"
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={setName.isPending}>
        {setName.isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
