"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The form controls, shared by all seven features' create and action screens.
 *
 * ──────────────── why every field is labelled, always ────────────────
 *
 * A placeholder is not a label. It disappears the moment someone types, which
 * is exactly when they are most likely to be interrupted and come back unsure
 * what the box was for, and a screen reader may never announce it. Every
 * control here takes a real `label` tied to its input by id, and the
 * placeholder is only ever an example of the answer.
 *
 * Errors are shown under the field that caused them, in words, with the border
 * changed as well as the colour — never colour alone.
 */

const BASE_INPUT =
  "h-[52px] w-full rounded-md border bg-card px-4 text-body text-foreground " +
  "placeholder:text-tertiary focus:border-primary focus:outline-none " +
  "focus:ring-[3px] focus:ring-primary/10 disabled:bg-muted disabled:text-tertiary";

const ERROR_INPUT = "border-danger focus:border-danger focus:ring-danger/10";

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-small font-semibold text-foreground"
    >
      {children}
    </label>
  );
}

function Helper({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string;
  hint?: string;
}) {
  if (!error && !hint) return null;
  return (
    <p
      id={id}
      className={cn(
        "mt-2 text-small",
        error ? "text-danger-strong" : "text-muted-foreground"
      )}
    >
      {error ?? hint}
    </p>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  maxLength = 60,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxLength?: number;
}) {
  const id = useId();
  const helperId = `${id}-helper`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? helperId : undefined}
        className={cn(BASE_INPUT, error && ERROR_INPUT)}
      />
      <Helper id={helperId} error={error} hint={hint} />
    </div>
  );
}

/**
 * An amount, typed in rupees.
 *
 * The raw string is kept rather than a parsed number, for two reasons that
 * both bite in practice: a half-typed "1200." is not a number yet but must
 * still be visible in the box, and parsing on every keystroke would fight the
 * person typing. The caller converts with `rupeesToPaise` when it submits.
 *
 * `inputMode="decimal"` brings up the numeric keypad on a phone without
 * refusing a decimal point, which `type="number"` does inconsistently across
 * Android keyboards.
 */
export function AmountField({
  label,
  value,
  onChange,
  hint,
  error,
  size = "display",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  error?: string;
  size?: "display" | "body";
}) {
  const id = useId();
  const helperId = `${id}-helper`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "flex items-center rounded-md border bg-card px-4 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/10",
          size === "display" ? "h-[72px]" : "h-[52px]",
          error &&
            "border-danger focus-within:border-danger focus-within:ring-danger/10"
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mr-1 text-muted-foreground",
            size === "display" ? "text-h2" : "text-body"
          )}
        >
          ₹
        </span>
        <input
          id={id}
          data-amount
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="0"
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? helperId : undefined}
          className={cn(
            "w-full border-0 bg-transparent p-0 text-foreground placeholder:text-tertiary focus:outline-none",
            size === "display" ? "text-display" : "text-body"
          )}
        />
      </div>
      <Helper id={helperId} error={error} hint={hint} />
    </div>
  );
}

/** Quick amounts, so the common case is one tap instead of four. */
export function AmountPills({
  options,
  onPick,
  label = "Quick amounts",
}: {
  /** Whole rupees. */
  options: number[];
  onPick: (rupees: string) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((rupees) => (
        <button
          key={rupees}
          type="button"
          onClick={() => onPick(String(rupees))}
          className="h-11 rounded-full border bg-card px-4 text-small font-semibold text-foreground hover:border-primary hover:text-primary-strong"
        >
          ₹{rupees.toLocaleString("en-IN")}
        </button>
      ))}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max = 50,
  hint,
  error,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const helperId = `${id}-helper`;

  // A stepper rather than a bare text box: the range is small, and two 52px
  // targets beat a numeric keyboard for choosing a number between 2 and 20.
  const step = (by: number) =>
    onChange(Math.max(min, Math.min(max, value + by)));

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={value <= min}
          aria-label={`Fewer: ${value - 1}`}
          className="size-[52px] shrink-0 rounded-md border bg-card text-h3 text-foreground disabled:text-tertiary"
        >
          −
        </button>
        <input
          id={id}
          data-amount
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/\D/g, ""));
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          aria-describedby={error || hint ? helperId : undefined}
          className={cn(BASE_INPUT, "text-center", error && ERROR_INPUT)}
        />
        <button
          type="button"
          onClick={() => step(1)}
          disabled={value >= max}
          aria-label={`More: ${value + 1}`}
          className="size-[52px] shrink-0 rounded-md border bg-card text-h3 text-foreground disabled:text-tertiary"
        >
          +
        </button>
      </div>
      <Helper id={helperId} error={error} hint={hint} />
    </div>
  );
}

/**
 * A date, as YYYY-MM-DD.
 *
 * The native picker is used on purpose: it is already localised, already
 * accessible, and already familiar on both platforms. A custom calendar would
 * be more code, more bundle and worse.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const helperId = `${id}-helper`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? helperId : undefined}
        className={cn(BASE_INPUT, error && ERROR_INPUT)}
      />
      <Helper id={helperId} error={error} hint={hint} />
    </div>
  );
}

/**
 * A choice between a few options, each with its consequence spelled out.
 *
 * Rendered as cards rather than bare radio dots because the thing being chosen
 * is usually what happens to somebody's money, and that deserves a sentence of
 * explanation next to the option rather than hidden in help text.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; title: string; body?: string }[];
}) {
  const name = useId();

  return (
    <fieldset>
      <legend className="mb-2 block text-small font-semibold text-foreground">
        {label}
      </legend>
      <div className="space-y-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-md border bg-card p-4",
                selected
                  ? "border-primary bg-primary-subtle"
                  : "hover:border-primary-ring"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-5 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-body font-semibold",
                    selected ? "text-primary-strong" : "text-foreground"
                  )}
                >
                  {option.title}
                </span>
                {option.body ? (
                  <span className="mt-0.5 block text-small text-muted-foreground">
                    {option.body}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
