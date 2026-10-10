/**
 * The bits every trust-layer route needs, written once.
 *
 * Validation here is deliberately strict and deliberately boring: a route that
 * accepts a loosely-shaped body and coerces it is a route that will one day
 * sign something nobody meant. Every reader below either returns the exact
 * type asked for or throws.
 */
import "server-only";
import { NonceError } from "./nonce";
import { ChainError } from "./chain";

export class BadRequest extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "BadRequest";
  }
}

export function ok(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function fail(message: string, reason: string, status: number) {
  return Response.json(
    { error: message, reason },
    { status, headers: { "cache-control": "no-store" } }
  );
}

/**
 * Turn any of our error types into a response.
 *
 * Anything unrecognised is re-thrown so `handle` logs it and returns a 500 —
 * swallowing an unknown error here would turn a bug into a silent 400.
 */
export function asResponse(err: unknown): Response {
  if (err instanceof BadRequest) return fail(err.message, err.reason, err.status);
  if (err instanceof NonceError) return fail(err.message, err.reason, err.status);
  if (err instanceof ChainError) return fail(err.message, err.reason, err.status);
  throw err;
}

/**
 * The largest request body any trust route will look at: 64 KiB.
 *
 * Every route here takes a handful of ids, an amount and a short string. The
 * biggest honest request is a few hundred bytes, so this is three orders of
 * magnitude of headroom and still refuses a body big enough to be a problem.
 */
export const MAX_BODY_BYTES = 65_536;

/** 413. The byte count is logged, not returned: the caller gains nothing from it. */
function tooLarge(bytes: number): never {
  console.warn(`[route-kit] refused a ${bytes}-byte body (limit ${MAX_BODY_BYTES})`);
  throw new BadRequest("That request was too large.", "payload_too_large", 413);
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  // Checked BEFORE parsing, and on the raw bytes rather than on the parsed
  // object: the point of a size limit is to not spend memory on the thing you
  // are about to reject. `content-length` is a claim by the caller, so it is
  // used only as a cheap early exit and the real count is taken from the text.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    tooLarge(declared);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new BadRequest("We couldn't read that request.", "bad_json");
  }

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BODY_BYTES) tooLarge(bytes);

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new BadRequest("We couldn't read that request.", "bad_json");
  }
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_SIG = /^0x[0-9a-fA-F]{130}$/;

export function readId(b: Record<string, unknown>, key: string): number {
  const v = b[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  return v;
}

export function readHash(b: Record<string, unknown>, key: string): `0x${string}` {
  const v = b[key];
  if (typeof v !== "string" || !HEX32.test(v)) {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  return v as `0x${string}`;
}

export function readSignature(
  b: Record<string, unknown>,
  key: string
): `0x${string}` {
  const v = b[key];
  if (typeof v !== "string" || !HEX_SIG.test(v)) {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  return v as `0x${string}`;
}

export function readText(
  b: Record<string, unknown>,
  key: string,
  max: number
): string {
  const v = b[key];
  if (typeof v !== "string") {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  return trimmed;
}

export function readOneOf<T extends string>(
  b: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T {
  const v = b[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  return v as T;
}

export function readBool(b: Record<string, unknown>, key: string): boolean {
  const v = b[key];
  if (typeof v !== "boolean") {
    throw new BadRequest("That request was missing something.", `bad_${key}`);
  }
  return v;
}

/**
 * Amounts arrive as decimal strings, never as JSON numbers.
 *
 * Paise fit in a double today, but "today" is doing a lot of work in that
 * sentence and a silently rounded amount of money is the worst class of bug in
 * this codebase. A string parsed to BigInt cannot round.
 */
export function readPaise(
  b: Record<string, unknown>,
  key: string,
  max: bigint
): bigint {
  const v = b[key];
  if (typeof v !== "string" || !/^[0-9]{1,20}$/.test(v)) {
    throw new BadRequest("That amount doesn't look right.", `bad_${key}`);
  }
  const n = BigInt(v);
  if (n > max) {
    throw new BadRequest("That amount is too large.", `${key}_too_large`);
  }
  return n;
}

/** An ISO date (YYYY-MM-DD), rejected rather than coerced if it is not one. */
export function readDay(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new BadRequest("That date doesn't look right.", `bad_${key}`);
  }
  // Rejects 2026-02-31 and friends, which the regex above happily allows.
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new BadRequest("That date doesn't look right.", `bad_${key}`);
  }
  return v;
}
