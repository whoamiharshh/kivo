"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** The link friends tap to join. The code lives only in the link. */
export function InviteCard({
  potId,
  potName,
  inviteCode,
  spotsLeft,
}: {
  potId: number;
  potName: string;
  inviteCode: string | null;
  spotsLeft: number;
}) {
  const [copied, setCopied] = useState(false);

  if (!inviteCode) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-5 text-sm text-muted-foreground">
          The invite link for this pot was made on another device, so it
          isn&apos;t saved here. Ask whoever created the pot to share it again.
        </CardContent>
      </Card>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = `${origin}/join/${potId}/${inviteCode}`;
  const message = `Join our pot "${potName}" — everyone puts in, and it repays whoever pays for things. ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy it.");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="space-y-1">
          <p className="font-medium">Invite your friends</p>
          <p className="text-sm text-muted-foreground">
            {spotsLeft > 0
              ? `Room for ${spotsLeft} more ${spotsLeft === 1 ? "person" : "people"}.`
              : "This pot is full."}
          </p>
        </div>

        <p className="tabular break-all rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {link}
        </p>

        <div className="flex gap-2">
          <Button
            className="h-11 flex-1"
            render={
              <a
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            Share on WhatsApp
          </Button>
          <Button variant="outline" className="h-11" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
