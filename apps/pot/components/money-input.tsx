"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Rupees in, rupees shown. Digits and at most two decimal places. */
export function MoneyInput({
  value,
  onChange,
  placeholder = "0",
  id,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        ₹
      </span>
      <Input
        id={id}
        autoFocus={autoFocus}
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        className="tabular h-12 pl-7 text-base"
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.]/g, "");
          if (next === "" || /^\d*(\.\d{0,2})?$/.test(next)) onChange(next);
        }}
      />
    </div>
  );
}
