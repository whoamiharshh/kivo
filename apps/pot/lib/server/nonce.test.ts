/**
 * Replay protection, pinned down.
 *
 * ──────────────── what this proves, and what it does not ────────────────
 *
 * `consumeNonce` issues one conditional UPDATE: set `used_at`, **where** the
 * nonce matches, `used_at is null`, and the row has not expired. Zero rows
 * matched means somebody already used it, which is a 409. That conditional is
 * the entire replay defence at the API boundary, so these tests assert the
 * branch directly.
 *
 * The database is faked, and the fake implements those three conditions
 * itself. So this suite proves the **route-visible behaviour**: a second use
 * of one nonce produces a 409 rather than a success or a 500, and the 409
 * survives the error-to-Response mapping a route actually goes through. It
 * does not prove PostgreSQL honours the same conditions — that is what the
 * `used_at is null` predicate in the real statement is for, and it is why the
 * update is conditional in SQL rather than a read-then-write in TypeScript.
 *
 * Worth stating plainly: a consumed nonce does **not** invalidate a signature
 * already issued for six of the seven actions. The contract's own one-shot
 * rule does that. See `docs/trust-layer.md`, section 5.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** One row of the `trust_nonces` table, only the columns this path touches. */
type NonceRow = {
  id: number;
  nonce: string;
  signer_did: string;
  action_type: string;
  payload_hash: string;
  used_at: string | null;
  expires_at: string;
};

let rows: NonceRow[] = [];
let nextId = 1;

/**
 * A Supabase query builder, cut down to the two chains this module builds:
 *
 *   insert(values).select(cols).single()
 *   update(patch).eq(..).is(..).gt(..).select(cols)
 *
 * The filters are applied for real, because the conditional update is the
 * thing under test. Anything outside those two shapes throws rather than
 * quietly returning a pass.
 */
function builder() {
  const filters: { kind: "eq" | "is" | "gt"; col: keyof NonceRow; val: unknown }[] =
    [];
  let mode: "insert" | "update" | null = null;
  let patch: Partial<NonceRow> = {};
  let values: Partial<NonceRow> = {};
  let wantsSingle = false;

  const matches = (row: NonceRow) =>
    filters.every(({ kind, col, val }) => {
      const cell = row[col];
      if (kind === "eq") return cell === val;
      if (kind === "is") return cell === val;
      return String(cell) > String(val); // gt, on ISO timestamps
    });

  function run() {
    if (mode === "insert") {
      const row: NonceRow = {
        id: nextId++,
        nonce: String(values.nonce),
        signer_did: String(values.signer_did),
        action_type: String(values.action_type),
        payload_hash: String(values.payload_hash),
        used_at: null,
        expires_at: String(values.expires_at),
      };
      rows.push(row);
      return { data: wantsSingle ? row : [row], error: null };
    }
    if (mode === "update") {
      const hit = rows.filter(matches);
      for (const row of hit) Object.assign(row, patch);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    throw new Error("the fake was asked for a query shape it does not model");
  }

  const api = {
    insert(v: Partial<NonceRow>) {
      mode = "insert";
      values = v;
      return api;
    },
    update(p: Partial<NonceRow>) {
      mode = "update";
      patch = p;
      return api;
    },
    eq(col: keyof NonceRow, val: unknown) {
      filters.push({ kind: "eq", col, val });
      return api;
    },
    is(col: keyof NonceRow, val: unknown) {
      filters.push({ kind: "is", col, val });
      return api;
    },
    gt(col: keyof NonceRow, val: unknown) {
      filters.push({ kind: "gt", col, val });
      return api;
    },
    select() {
      return api;
    },
    single() {
      wantsSingle = true;
      return api;
    },
    // Awaiting the chain is what executes it, as with the real client.
    then<T>(resolve: (value: ReturnType<typeof run>) => T) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return api;
}

vi.mock("./db", () => ({
  db: () => ({
    from(table: string) {
      if (table !== "trust_nonces") {
        throw new Error(`unexpected table: ${table}`);
      }
      return builder();
    },
  }),
}));

const { consumeNonce, reserveNonce, NonceError } = await import("./nonce");
const { asResponse } = await import("./route-kit");

beforeEach(() => {
  rows = [];
  nextId = 1;
});

describe("consumeNonce", () => {
  it("accepts a nonce once and refuses the second use with 409", async () => {
    const reserved = await reserveNonce({
      did: "did:privy:test-subject",
      action: "attest_behaviour",
      payloadHash: `0x${"ab".repeat(32)}`,
      ttlSeconds: 900,
    });

    // First use: the row is unused and unexpired, so it is consumed.
    await expect(consumeNonce(reserved.nonce)).resolves.toBeUndefined();
    expect(rows[0]!.used_at).not.toBeNull();

    // Second use of the SAME nonce: zero rows match, which is the replay.
    const replay = consumeNonce(reserved.nonce);
    await expect(replay).rejects.toBeInstanceOf(NonceError);
    await expect(replay).rejects.toMatchObject({
      status: 409,
      reason: "nonce_already_used",
    });
  });

  it("answers a replay with an HTTP 409, not a 500", async () => {
    const reserved = await reserveNonce({
      did: "did:privy:test-subject",
      action: "attest_day",
      payloadHash: `0x${"cd".repeat(32)}`,
      ttlSeconds: 900,
    });
    await consumeNonce(reserved.nonce);

    // The same mapping a route performs in its catch block.
    let response: Response | undefined;
    try {
      await consumeNonce(reserved.nonce);
    } catch (err) {
      response = asResponse(err);
    }

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({
      reason: "nonce_already_used",
    });
  });

  it("refuses a nonce that was never issued", async () => {
    await expect(consumeNonce("f".repeat(32))).rejects.toMatchObject({
      status: 409,
      reason: "nonce_already_used",
    });
  });

  it("refuses an expired nonce even though it was never used", async () => {
    const reserved = await reserveNonce({
      did: "did:privy:test-subject",
      action: "attest_income",
      payloadHash: `0x${"ef".repeat(32)}`,
      ttlSeconds: 900,
    });
    // Backdate it past its expiry, leaving used_at null.
    rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();

    await expect(consumeNonce(reserved.nonce)).rejects.toMatchObject({
      status: 409,
    });
    expect(rows[0]!.used_at).toBeNull();
  });

  it("lets two different nonces be consumed independently", async () => {
    const first = await reserveNonce({
      did: "did:privy:one",
      action: "attest_condition",
      payloadHash: `0x${"11".repeat(32)}`,
      ttlSeconds: 900,
    });
    const second = await reserveNonce({
      did: "did:privy:two",
      action: "attest_condition",
      payloadHash: `0x${"22".repeat(32)}`,
      ttlSeconds: 900,
    });

    await expect(consumeNonce(first.nonce)).resolves.toBeUndefined();
    await expect(consumeNonce(second.nonce)).resolves.toBeUndefined();
    expect(first.nonce).not.toBe(second.nonce);
  });
});

describe("reserveNonce", () => {
  it("hands out a nonce matching the column's format, unused", async () => {
    const reserved = await reserveNonce({
      did: "did:privy:test-subject",
      action: "join_pot",
      payloadHash: `0x${"ab".repeat(32)}`,
      ttlSeconds: 600,
    });

    // The database CHECK is ^[0-9a-f]{32}$; an insert that fails it is a 500
    // at runtime, so the generator has to agree with it.
    expect(reserved.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0]!.used_at).toBeNull();
    expect(reserved.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
