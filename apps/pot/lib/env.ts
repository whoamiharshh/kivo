/**
 * Configuration, validated once instead of trusted everywhere.
 *
 * ──────────────── why this file is split in two ────────────────
 *
 * This module is imported by `app/providers.tsx` ("use client") and by
 * `lib/store.ts`, so **its top level runs in the browser as well as on the
 * server**. That is the single fact that decides its shape:
 *
 *  - `NEXT_PUBLIC_*` values are compiled into the browser bundle, so they can
 *    be checked in both places.
 *  - `TRUST_SIGNER_KEY` is a secret. It is never in the bundle, so in the
 *    browser it reads as `undefined` — not because anything is misconfigured,
 *    but because that is exactly what is supposed to happen. Requiring it on
 *    the browser's code path would make every page load throw.
 *
 * So the secret half is validated only where `window` does not exist. A leak
 * would show up as a *failed* check here, never as a passing one.
 *
 * ──────────────── why the build is exempt ────────────────
 *
 * `next build` evaluates the root layout to prerender pages. A build machine
 * legitimately has no runtime secrets — on Vercel they are injected into the
 * running function, not into the builder. Validation therefore skips the build
 * phase and fires on server start and on every request path afterwards, which
 * is what "validate at startup" means for a server that is built elsewhere.
 * Nothing is skipped at runtime.
 *
 * `lib/server/env.ts` still checks each secret again at the moment it is used.
 * That is deliberate overlap: this file fails a misconfigured server fast and
 * loudly, that one guarantees no code path can read a blank secret even if
 * this module is ever bypassed.
 */
import { z } from "zod";

const hint = (name: string, where: string) =>
  `${name} is not set. ${where} See apps/pot/.env.example, which lists every variable with the place to get it.`;

/** Values that are compiled into the browser bundle, and are public by design. */
const publicSchema = z.object({
  NEXT_PUBLIC_PRIVY_APP_ID: z
    .string()
    .min(1, hint("NEXT_PUBLIC_PRIVY_APP_ID", "Sign-in cannot work without it.")),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, hint("NEXT_PUBLIC_SUPABASE_URL", "Names and memos are stored there."))
    .url("NEXT_PUBLIC_SUPABASE_URL must be a URL, e.g. https://abcdefgh.supabase.co"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(
      1,
      hint("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Names and memos are stored there.")
    ),
});

/** Secrets. Validated only off the browser, for the reason in the header. */
const serverSchema = z.object({
  TRUST_SIGNER_KEY: z
    .string()
    .min(1, hint("TRUST_SIGNER_KEY", "The trust layer signs with it."))
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      "TRUST_SIGNER_KEY must be 0x followed by 64 hex characters. Generate one with: openssl rand -hex 32"
    ),
});

/** True while `next build` is prerendering, when secrets are legitimately absent. */
const building =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.NEXT_PHASE === "phase-export";

function explain(error: z.ZodError): never {
  // One message listing everything that is wrong, rather than one per restart.
  const lines = error.issues.map((i) => `  - ${i.message}`).join("\n");
  throw new Error(
    `Pot cannot start: the configuration is incomplete.\n\n${lines}\n\nCopy apps/pot/.env.example to apps/pot/.env.local and fill in the blanks.`
  );
}

const publicParsed = publicSchema.safeParse({
  // Read as literal property accesses: Next.js substitutes these at build time
  // only when written out in full, so a dynamic lookup would come back empty.
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!publicParsed.success && !building) explain(publicParsed.error);

if (typeof window === "undefined" && !building) {
  const serverParsed = serverSchema.safeParse({
    TRUST_SIGNER_KEY: process.env.TRUST_SIGNER_KEY,
  });
  if (!serverParsed.success) explain(serverParsed.error);
}

const values = publicParsed.success
  ? publicParsed.data
  : {
      NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    };

export const PRIVY_APP_ID = values.NEXT_PUBLIC_PRIVY_APP_ID;
export const SUPABASE_URL = values.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = values.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Kept because `providers.tsx` and `store.ts` already branch on these.
 *
 * Past the validation above they are always true at runtime, so the setup
 * notice they guard is now only reachable during a build. They are left in
 * place rather than deleted: if the hard-fail is ever relaxed, the graceful
 * path is still there instead of having to be rebuilt.
 */
export const privyConfigured = PRIVY_APP_ID.length > 0;
export const supabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** The app's own origin, used to refuse cross-site API calls. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
