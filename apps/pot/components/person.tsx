"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** A stable, friendly colour per person so the group is easy to scan. */
const TINTS = [
  "bg-emerald-100 text-emerald-900",
  "bg-sky-100 text-sky-900",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-900",
  "bg-violet-100 text-violet-900",
  "bg-teal-100 text-teal-900",
];

function tintFor(address: string) {
  let sum = 0;
  for (const ch of address.toLowerCase()) sum = (sum + ch.charCodeAt(0)) % 997;
  return TINTS[sum % TINTS.length];
}

/** Falls back to a short tag when someone hasn't set a name yet. */
export function personLabel(
  address: string | undefined,
  name: string | null | undefined,
  you?: string
): string {
  if (!address) return "Someone";
  if (you && address.toLowerCase() === you.toLowerCase()) return "You";
  if (name && name.trim()) return name.trim();
  return `Friend ${address.slice(2, 6).toUpperCase()}`;
}

function initials(label: string) {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Person({
  address,
  name,
  you,
  className,
  size = "md",
}: {
  address: string | undefined;
  name?: string | null;
  you?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const label = personLabel(address, name, you);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Avatar className={size === "sm" ? "size-6" : "size-8"}>
        <AvatarFallback
          className={cn(
            "text-[11px] font-semibold",
            tintFor(address ?? "0x")
          )}
        >
          {initials(label)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{label}</span>
    </span>
  );
}
